import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useCan } from "../../auth/hooks";
import {
  Button, Card, ErrorMessage, Field, Input, Loading, PageHeader, Select, Textarea,
} from "../../components/ui";
import { ApiError, get, patch, post } from "../../lib/api";
import { formatDateTime, formatMoney, toRiyadhLocalInput } from "../../lib/format";
import { FULFILLMENT_TYPE, INCOMPLETE_PROBLEMS, ORDER_TYPE } from "../../lib/labels";
import type { CatalogPackage, Customer, Order, Product } from "../../lib/types";
import CustomerPicker from "./CustomerPicker";
import { emptyState, estimateTotals, stateFromOrder, toPayload, validate, type EditorState } from "./editorModel";
import { useOrder } from "./hooks";
import LinesEditor from "./LinesEditor";
import OrderSummaryView from "./OrderSummaryView";

type Step = "edit" | "review";

interface DiffRow { label: string; before: string; after: string }

/** Before/after comparison shown before saving changes to a confirmed order. */
function changesFor(original: Order, state: EditorState): DiffRow[] {
  const next = estimateTotals(state);
  const lines = (items: { name: string; quantity: number }[]) => items.map((l) => `${l.name} × ${l.quantity}`).join("، ") || "—";
  const rows: DiffRow[] = [
    { label: "الموعد", before: formatDateTime(original.scheduledAt), after: formatDateTime(state.scheduledAt ? `${state.scheduledAt}:00+03:00` : null) },
    { label: "طريقة الاستلام", before: FULFILLMENT_TYPE[original.fulfillmentType], after: FULFILLMENT_TYPE[state.fulfillmentType] },
    { label: "العنوان", before: original.deliveryAddress ?? "—", after: state.fulfillmentType === "delivery" ? state.deliveryAddress || "—" : "—" },
    { label: "الأصناف", before: lines(original.lines), after: lines(state.lines) },
    { label: "رسوم التوصيل", before: formatMoney(original.deliveryFee), after: formatMoney(next.deliveryFee) },
    { label: "الخصم", before: formatMoney(original.discountAmount), after: formatMoney(state.discountEdited ? next.discountAmount : original.discountAmount) },
    { label: "الإجمالي (تقديري)", before: formatMoney(original.total), after: formatMoney(state.discountEdited ? next.total : next.subtotal - original.discountAmount + next.deliveryFee) },
    { label: "ملاحظات المطبخ", before: original.kitchenNotes ?? "—", after: state.kitchenNotes || "—" },
    { label: "ملاحظات التوصيل", before: original.deliveryNotes ?? "—", after: state.deliveryNotes || "—" },
  ];
  return rows.filter((row) => row.before !== row.after);
}

/** Loads the order being edited (if any) before mounting the editor with it as initial state. */
export default function OrderEditorPage() {
  const { id: routeId } = useParams();
  const [searchParams] = useSearchParams();
  const existing = useOrder(routeId);
  if (routeId && existing.isPending) return <Loading />;
  if (routeId && (existing.error || !existing.data)) return <ErrorMessage error={existing.error} />;
  const initial = existing.data ?? null;
  if (initial && ["completed", "cancelled"].includes(initial.status)) {
    return <ErrorMessage error={new ApiError(409, { code: "ORDER_LOCKED", message: "" })} />;
  }
  return (
    <OrderEditor
      key={routeId ?? "new"}
      initialOrder={initial}
      reviewFirst={searchParams.get("review") === "1" && initial?.status === "draft"}
    />
  );
}

function OrderEditor({ initialOrder, reviewFirst }: { initialOrder: Order | null; reviewFirst: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useCan();

  const products = useQuery({ queryKey: ["catalog", "products"], queryFn: () => get<{ data: Product[] }>("/catalog/products") });
  const packages = useQuery({ queryKey: ["catalog", "packages"], queryFn: () => get<{ data: CatalogPackage[] }>("/catalog/packages") });

  const [state, setState] = useState<EditorState>(() => (initialOrder ? stateFromOrder(initialOrder) : emptyState()));
  const [step, setStep] = useState<Step>(reviewFirst ? "review" : "edit");
  const [savedOrder, setSavedOrder] = useState<Order | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  // One key per editor session: double-clicking "save" creates a single order.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const order = savedOrder ?? initialOrder;
  const isDraft = !order || order.status === "draft";
  // Saved addresses of the selected customer, for picking a delivery address.
  const customerId = state.customer?.id;
  const customerDetails = useQuery({
    queryKey: ["customer", customerId],
    queryFn: () => get<{ data: Customer }>(`/customers/${customerId}`),
    enabled: Boolean(customerId) && !state.customer?.addresses.length,
  });


  const update = (patchState: Partial<EditorState>) => setState((current) => ({ ...current, ...patchState }));

  const save = useMutation({
    mutationFn: async () => {
      const payload = toPayload(state);
      if (!order) {
        return (await post<{ data: Order }>("/orders", payload, { "Idempotency-Key": idempotencyKey })).data;
      }
      return (await patch<{ data: Order }>(`/orders/${order.id}`, { ...payload, version: order.version })).data;
    },
    onSuccess: async (saved) => {
      setSavedOrder(saved);
      // Adopt server line ids so later saves keep each line's original price snapshot.
      setState((current) => ({
        ...stateFromOrder(saved),
        customer: current.customer ? { ...current.customer, addresses: current.customer.addresses } : null,
      }));
      queryClient.setQueryData(["order", saved.id], saved);
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const confirm = useMutation({
    mutationFn: (target: Order) => post<{ data: Order }>(`/orders/${target.id}/confirm`, { version: target.version }),
    onSuccess: async ({ data }) => {
      queryClient.setQueryData(["order", data.id], data);
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate(`/orders?open=${data.id}`);
    },
  });

  const totals = useMemo(() => estimateTotals(state), [state]);
  const diff = useMemo(() => (order && !isDraft ? changesFor(order, state) : []), [order, isDraft, state]);

  const startReview = async () => {
    const found = validate(state, { forConfirm: isDraft });
    setProblems(found);
    if (found.length) return;
    if (isDraft) {
      const saved = await save.mutateAsync().catch(() => null);
      if (saved) setStep("review");
    } else {
      setStep("review");
    }
  };

  const saveDraft = async () => {
    const found = validate(state, { forConfirm: false });
    setProblems(found);
    if (found.length) return;
    const saved = await save.mutateAsync().catch(() => null);
    if (saved) navigate(`/orders?open=${saved.id}`);
  };

  const versionConflict = (save.error ?? confirm.error) instanceof ApiError
    && ((save.error ?? confirm.error) as ApiError).code === "VERSION_CONFLICT";
  const confirmProblems = confirm.error instanceof ApiError && confirm.error.code === "ORDER_INCOMPLETE"
    ? (confirm.error.details as { problems: string[] }).problems.map((p) => INCOMPLETE_PROBLEMS[p] ?? p) : [];

  if (step === "review" && order) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <PageHeader title={isDraft ? `مراجعة الطلب ${order.number} قبل التأكيد` : `مراجعة التعديلات على ${order.number}`} />
        {isDraft ? (
          <Card>
            <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <span className="text-gray-600">العميل</span><span>{order.customerName}</span>
              <span className="text-gray-600">النوع</span><span>{ORDER_TYPE[order.orderType]} · {FULFILLMENT_TYPE[order.fulfillmentType]}</span>
              <span className="text-gray-600">الموعد</span><span>{formatDateTime(order.scheduledAt)}</span>
            </div>
            <OrderSummaryView order={order} />
            <p className="mt-3 text-xs text-gray-600">الدفع ليس شرطاً للتأكيد. بعد التأكيد يظهر الطلب في تقرير المطبخ.</p>
          </Card>
        ) : (
          <Card title="التغييرات">
            {diff.length === 0 ? <p className="text-sm text-gray-600">لا توجد تغييرات.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b text-right text-gray-600"><th className="py-1">البيان</th><th className="py-1">قبل</th><th className="py-1">بعد</th></tr></thead>
                <tbody>
                  {diff.map((row) => (
                    <tr key={row.label} className="border-b align-top">
                      <td className="py-2 font-medium">{row.label}</td>
                      <td className="py-2 text-red-800">{row.before}</td>
                      <td className="py-2 text-green-800">{row.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
        {confirmProblems.length > 0 && (
          <ul className="rounded-lg bg-Light-red px-4 py-2 text-sm text-red-800">{confirmProblems.map((p) => <li key={p}>• {p}</li>)}</ul>
        )}
        <ErrorMessage error={confirmProblems.length ? null : save.error ?? confirm.error} />
        {versionConflict && <Button variant="secondary" onClick={() => window.location.reload()}>إعادة تحميل الطلب</Button>}
        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => { setStep("edit"); confirm.reset(); }}>رجوع للتعديل</Button>
          {isDraft ? (
            can("confirm_orders") && <Button onClick={() => confirm.mutate(order)} loading={confirm.isPending}>تأكيد الطلب</Button>
          ) : (
            <Button
              disabled={diff.length === 0}
              loading={save.isPending}
              onClick={async () => {
                const saved = await save.mutateAsync().catch(() => null);
                if (saved) navigate(`/orders?open=${saved.id}`);
              }}
            >
              حفظ التعديلات
            </Button>
          )}
        </div>
      </div>
    );
  }

  const preparationStarted = order && ["preparing", "ready"].includes(order.status);
  const addresses = state.customer?.addresses.length ? state.customer.addresses : customerDetails.data?.data.addresses ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={order ? `تعديل الطلب ${order.number}` : "طلب جديد"}
        actions={<Link to={order ? `/orders?open=${order.id}` : "/orders"}><Button variant="ghost">إلغاء</Button></Link>}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card title="العميل">
            <CustomerPicker
              value={state.customer}
              onChange={(customer) => {
                const first = customer.addresses[0];
                update({
                  customer,
                  ...(first && !state.deliveryAddress ? { deliveryAddress: first.details, deliveryMapsUrl: first.mapsUrl ?? "" } : {}),
                });
              }}
            />
          </Card>

          <Card title="تفاصيل الطلب">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="نوع الطلب">
                {(id) => (
                  <Select id={id} value={state.orderType} onChange={(e) => update({ orderType: e.target.value as EditorState["orderType"] })}>
                    {Object.entries(ORDER_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="عدد الضيوف (اختياري)">
                {(id) => <Input id={id} type="number" min={1} value={state.guestCount} onChange={(e) => update({ guestCount: e.target.value })} />}
              </Field>
              <Field
                label="موعد التسليم (توقيت الرياض)"
                hint={preparationStarted && !can("override_order_schedule") ? "بدأ التحضير: تغيير الموعد يتطلب صلاحية خاصة" : undefined}
              >
                {(id) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    value={state.scheduledAt}
                    min={toRiyadhLocalInput(new Date().toISOString())}
                    disabled={Boolean(preparationStarted && !can("override_order_schedule"))}
                    onChange={(e) => update({ scheduledAt: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </Card>

          <Card title="الأصناف">
            {products.isPending || packages.isPending ? <Loading /> : (
              <LinesEditor
                lines={state.lines}
                products={products.data?.data ?? []}
                packages={packages.data?.data ?? []}
                onChange={(lines) => update({ lines })}
              />
            )}
            <ErrorMessage error={products.error ?? packages.error} />
          </Card>

          <Card title="الاستلام والتوصيل">
            <div className="flex flex-col gap-3">
              <div className="flex gap-4 text-sm">
                {(["delivery", "pickup"] as const).map((type) => (
                  <label key={type} className="flex items-center gap-1">
                    <input type="radio" name="fulfillment" checked={state.fulfillmentType === type} onChange={() => update({ fulfillmentType: type })} />
                    {FULFILLMENT_TYPE[type]}
                  </label>
                ))}
              </div>
              {state.fulfillmentType === "delivery" && (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {addresses.length > 0 && (
                    <Field label="عنوان محفوظ" className="md:col-span-2">
                      {(id) => (
                        <Select id={id} value="" onChange={(e) => {
                          const address = addresses.find((a) => a.id === e.target.value);
                          if (address) update({ deliveryAddress: address.details, deliveryMapsUrl: address.mapsUrl ?? "" });
                        }}>
                          <option value="">اختر من عناوين العميل…</option>
                          {addresses.map((a) => <option key={a.id} value={a.id}>{a.label}: {a.details}</option>)}
                        </Select>
                      )}
                    </Field>
                  )}
                  <Field label="عنوان التوصيل" className="md:col-span-2" hint="يُحفظ نسخة منه مع الطلب">
                    {(id) => <Input id={id} value={state.deliveryAddress} maxLength={500} onChange={(e) => update({ deliveryAddress: e.target.value })} />}
                  </Field>
                  <Field label="رابط الموقع (اختياري)">
                    {(id) => <Input id={id} dir="ltr" value={state.deliveryMapsUrl} onChange={(e) => update({ deliveryMapsUrl: e.target.value })} />}
                  </Field>
                  <Field label="رسوم التوصيل (ر.س)">
                    {(id) => <Input id={id} dir="ltr" inputMode="decimal" value={state.deliveryFee} onChange={(e) => update({ deliveryFee: e.target.value })} />}
                  </Field>
                  <Field label="ملاحظات التوصيل" className="md:col-span-2">
                    {(id) => <Input id={id} value={state.deliveryNotes} maxLength={1000} onChange={(e) => update({ deliveryNotes: e.target.value })} />}
                  </Field>
                </div>
              )}
            </div>
          </Card>

          <Card title="ملاحظات المطبخ">
            <Textarea aria-label="ملاحظات المطبخ" value={state.kitchenNotes} maxLength={2000} onChange={(e) => update({ kitchenNotes: e.target.value })} />
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="الحساب" className="xl:sticky xl:top-4">
            {can("apply_discount") && (
              <div className="mb-3 flex flex-col gap-2">
                <Field label="الخصم">
                  {(id) => (
                    <Select id={id} value={state.discountType} onChange={(e) => update({ discountType: e.target.value as EditorState["discountType"], discountEdited: true })}>
                      <option value="none">بدون خصم</option>
                      <option value="fixed">مبلغ ثابت (ر.س)</option>
                      <option value="percent">نسبة مئوية (%)</option>
                    </Select>
                  )}
                </Field>
                {state.discountType !== "none" && (
                  <>
                    <Input aria-label="قيمة الخصم" dir="ltr" inputMode="decimal" value={state.discountValue}
                      onChange={(e) => update({ discountValue: e.target.value, discountEdited: true })} />
                    <Input aria-label="سبب الخصم" placeholder="سبب الخصم (إلزامي)" value={state.discountReason}
                      onChange={(e) => update({ discountReason: e.target.value, discountEdited: true })} />
                  </>
                )}
              </div>
            )}
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-gray-600">مجموع الأصناف</dt><dd>{formatMoney(totals.subtotal)}</dd>
              {(state.discountEdited ? totals.discountAmount : order?.discountAmount ?? 0) > 0 && (
                <><dt className="text-gray-600">الخصم</dt><dd>- {formatMoney(state.discountEdited ? totals.discountAmount : order?.discountAmount)}</dd></>
              )}
              {state.fulfillmentType === "delivery" && <><dt className="text-gray-600">التوصيل</dt><dd>{formatMoney(totals.deliveryFee)}</dd></>}
              <dt className="font-semibold">الإجمالي التقديري</dt>
              <dd className="font-semibold">
                {formatMoney(state.discountEdited ? totals.total : totals.subtotal - (order?.discountAmount ?? 0) + totals.deliveryFee)}
              </dd>
            </dl>
            <p className="mt-2 text-xs text-gray-500">الأسعار شاملة الضريبة. الإجمالي النهائي يحسبه النظام عند الحفظ.</p>
          </Card>

          {problems.length > 0 && (
            <ul className="rounded-lg bg-Light-red px-4 py-2 text-sm text-red-800">{problems.map((p) => <li key={p}>• {p}</li>)}</ul>
          )}
          <ErrorMessage error={save.error} />
          {versionConflict && <Button variant="secondary" onClick={() => window.location.reload()}>إعادة تحميل الطلب</Button>}
          <div className="flex flex-col gap-2">
            {isDraft ? (
              <>
                <Button variant="secondary" onClick={saveDraft} loading={save.isPending && step === "edit"}>حفظ كمسودة</Button>
                {can("confirm_orders") && <Button onClick={startReview} loading={save.isPending}>مراجعة وتأكيد</Button>}
              </>
            ) : (
              <Button onClick={startReview}>مراجعة التعديلات</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
