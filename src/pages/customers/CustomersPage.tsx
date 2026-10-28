import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Can } from "../../auth/auth";
import { useCan } from "../../auth/hooks";
import {
  Badge, Button, ConfirmDialog, Drawer, EmptyState, ErrorMessage, Field, Input, Loading, Modal, PageHeader, Table, Textarea, td, th,
} from "../../components/ui";
import { del, get, patch, post } from "../../lib/api";
import { useDebouncedValue } from "../../lib/hooks";
import { formatDateTime, formatMoney, formatPhone } from "../../lib/format";
import { ORDER_STATUS, ORDER_STATUS_TONE, PAYMENT_STATUS, PAYMENT_STATUS_TONE } from "../../lib/labels";
import type { Customer, OrderSummary, Page } from "../../lib/types";
import CustomerForm from "./CustomerForm";

function EditCustomer({ customer, onDone }: { customer: Customer; onDone: () => void }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [notes, setNotes] = useState(customer.notes ?? "");
  const save = useMutation({
    mutationFn: () => patch(`/customers/${customer.id}`, {
      name, notes: notes || null, ...(phone !== customer.phone ? { phone } : {}),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      await queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      onDone();
    },
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="الاسم">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
      <Field label="رقم الجوال" hint={can("change_customer_phone") ? "تغيير الجوال عملية حساسة وتُسجَّل" : "تغيير الجوال يتطلب صلاحية خاصة"}>
        {(id) => <Input id={id} dir="ltr" value={phone} disabled={!can("change_customer_phone")} onChange={(e) => setPhone(e.target.value)} />}
      </Field>
      <Field label="ملاحظات">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      <ErrorMessage error={save.error} />
      <Button type="submit" loading={save.isPending}>حفظ</Button>
    </form>
  );
}

function AddressForm({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [details, setDetails] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const add = useMutation({
    mutationFn: () => post(`/customers/${customerId}/addresses`, { label, details, mapsUrl: mapsUrl || null }),
    onSuccess: async () => {
      setLabel(""); setDetails(""); setMapsUrl("");
      await queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
    },
  });
  return (
    <form className="grid grid-cols-1 gap-2 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <Input aria-label="وصف العنوان" placeholder="الوصف (المنزل، القاعة…)" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <Input aria-label="العنوان" placeholder="العنوان" value={details} onChange={(e) => setDetails(e.target.value)} required />
      <Input aria-label="رابط الموقع" placeholder="https://maps…" dir="ltr" value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} />
      <div className="md:col-span-3"><ErrorMessage error={add.error} /></div>
      <Button type="submit" variant="secondary" loading={add.isPending}>إضافة عنوان</Button>
    </form>
  );
}

function CustomerDetail({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const can = useCan();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const customer = useQuery({ queryKey: ["customer", customerId], queryFn: () => get<{ data: Customer }>(`/customers/${customerId}`) });
  const orders = useQuery({
    queryKey: ["orders", { customerId }],
    queryFn: () => get<Page<OrderSummary>>("/orders", { customerId, pageSize: 50, archived: "include" }),
    enabled: can("view_orders"),
  });
  const balance = useQuery({
    queryKey: ["customer-balance", customerId],
    queryFn: () => get<{ data: { orders: number; total: number; paid: number; outstanding: number } }>(`/customers/${customerId}/balance`),
    enabled: can("view_payments"),
  });
  const removeAddress = useMutation({
    mutationFn: (addressId: string) => del(`/customers/${customerId}/addresses/${addressId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customer", customerId] }),
  });
  const toggleArchive = useMutation({
    mutationFn: () => post(`/customers/${customerId}/${customer.data?.data.archivedAt ? "restore" : "archive"}`),
    onSuccess: async () => {
      setArchiving(false);
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      await queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
    },
  });
  const data = customer.data?.data;

  return (
    <Drawer open onClose={onClose} title={data ? data.name : "العميل"}>
      {customer.isPending ? <Loading /> : !data ? <ErrorMessage error={customer.error} /> : (
        <div className="flex flex-col gap-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span dir="ltr" className="text-base">{formatPhone(data.phone)}</span>
            {data.archivedAt && <Badge tone="muted">مؤرشف</Badge>}
            <Can permission="manage_customers"><Button variant="secondary" onClick={() => setEditing(true)}>تعديل</Button></Can>
            <Can permission="archive_customers">
              <Button variant="ghost" onClick={() => setArchiving(true)}>{data.archivedAt ? "استعادة" : "أرشفة"}</Button>
            </Can>
            <Can permission="create_orders"><Link to="/orders/new"><Button>طلب جديد</Button></Link></Can>
          </div>
          {data.notes && <p className="rounded-lg bg-main/40 p-3 whitespace-pre-wrap">{data.notes}</p>}
          {balance.data && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-main/40 p-2"><div className="text-xs text-gray-600">الطلبات</div><div className="font-semibold">{balance.data.data.orders}</div></div>
              <div className="rounded-lg bg-Light-green p-2"><div className="text-xs text-gray-600">المدفوع</div><div className="font-semibold">{formatMoney(balance.data.data.paid)}</div></div>
              <div className="rounded-lg bg-Light-red p-2"><div className="text-xs text-gray-600">المتبقي</div><div className="font-semibold">{formatMoney(balance.data.data.outstanding)}</div></div>
            </div>
          )}
          <section>
            <h3 className="mb-2 font-semibold text-Text">العناوين</h3>
            {data.addresses.length === 0 && <p className="text-gray-600">لا توجد عناوين محفوظة.</p>}
            <ul className="mb-3 flex flex-col gap-2">
              {data.addresses.map((address) => (
                <li key={address.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-Text/10 p-2">
                  <span><strong>{address.label}:</strong> {address.details}</span>
                  <span className="flex gap-2">
                    {address.mapsUrl && <a href={address.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-secondary underline">الخريطة</a>}
                    <Can permission="manage_customers">
                      <button type="button" className="text-xs text-red-700" onClick={() => removeAddress.mutate(address.id)}>حذف</button>
                    </Can>
                  </span>
                </li>
              ))}
            </ul>
            <Can permission="manage_customers">{!data.archivedAt && <AddressForm customerId={data.id} />}</Can>
          </section>
          {can("view_orders") && (
            <section>
              <h3 className="mb-2 font-semibold text-Text">سجل الطلبات</h3>
              {orders.data?.data.length === 0 ? <p className="text-gray-600">لا توجد طلبات.</p> : (
                <Table>
                  <thead><tr><th className={th}>الطلب</th><th className={th}>الموعد</th><th className={th}>الحالة</th><th className={th}>الإجمالي</th>{can("view_payments") && <th className={th}>الدفع</th>}</tr></thead>
                  <tbody>
                    {orders.data?.data.map((order) => (
                      <tr key={order.id}>
                        <td className={td}><Link to={`/orders?open=${order.id}`} className="font-mono text-secondary hover:underline" dir="ltr">{order.number}</Link></td>
                        <td className={td}>{formatDateTime(order.scheduledAt)}</td>
                        <td className={td}><Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS[order.status]}</Badge></td>
                        <td className={td}>{formatMoney(order.total)}</td>
                        {can("view_payments") && (
                          <td className={td}>{order.status !== "draft" && order.paymentStatus && <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS[order.paymentStatus]}</Badge>}</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </section>
          )}
          <Modal open={editing} onClose={() => setEditing(false)} title="تعديل بيانات العميل">
            <EditCustomer customer={data} onDone={() => setEditing(false)} />
          </Modal>
          <ConfirmDialog
            open={archiving}
            title={data.archivedAt ? "استعادة العميل" : "أرشفة العميل"}
            message={data.archivedAt ? undefined : "يُخفى العميل من القوائم مع الاحتفاظ بسجل طلباته."}
            confirmLabel={data.archivedAt ? "استعادة" : "أرشفة"}
            loading={toggleArchive.isPending}
            error={toggleArchive.error}
            onClose={() => setArchiving(false)}
            onConfirm={() => toggleArchive.mutate()}
          />
        </div>
      )}
    </Drawer>
  );
}

export default function CustomersPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [creating, setCreating] = useState(false);
  const q = useDebouncedValue(search.trim(), 300);
  const archived = params.get("archived") === "only" ? "only" : "exclude";
  const page = Number(params.get("page") ?? 1) || 1;
  const openId = params.get("open");
  const setParam = (key: string, value: string | null) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });

  const list = useQuery({
    queryKey: ["customers", { q, archived, page }],
    queryFn: () => get<Page<Customer>>("/customers", { q, archived, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.pagination.total / 25)) : 1;

  return (
    <div>
      <PageHeader title="العملاء" actions={<Can permission="manage_customers"><Button onClick={() => setCreating(true)}>عميل جديد</Button></Can>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-md" type="search" placeholder="ابحث بالاسم أو رقم الجوال" aria-label="بحث"
          value={search} onChange={(e) => { setSearch(e.target.value); setParam("page", null); }} />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={archived === "only"} onChange={(e) => setParam("archived", e.target.checked ? "only" : null)} />
          المؤرشفون فقط
        </label>
      </div>
      <ErrorMessage error={list.error} />
      {list.isPending ? <Loading /> : list.data?.data.length === 0 ? (
        <EmptyState title={q ? "لا يوجد عميل يطابق البحث" : "لا يوجد عملاء بعد"} />
      ) : (
        <Table>
          <thead><tr><th className={th}>الاسم</th><th className={th}>الجوال</th><th className={th}>العناوين</th><th className={th}>تاريخ الإضافة</th></tr></thead>
          <tbody>
            {list.data?.data.map((customer) => (
              <tr key={customer.id} className="cursor-pointer hover:bg-main/40" onClick={() => setParam("open", customer.id)}>
                <td className={td}>{customer.name}</td>
                <td className={td} dir="ltr">{formatPhone(customer.phone)}</td>
                <td className={td}>{customer.addresses.map((a) => a.label).join("، ") || "—"}</td>
                <td className={td}>{formatDateTime(customer.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>السابق</Button>
          <span>صفحة {page} من {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setParam("page", String(page + 1))}>التالي</Button>
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="عميل جديد" wide>
        <CustomerForm
          onCreated={(customer) => { setCreating(false); setParam("open", customer.id); void list.refetch(); }}
          onExisting={(id) => { setCreating(false); setParam("open", id); }}
        />
      </Modal>
      {openId && <CustomerDetail customerId={openId} onClose={() => setParam("open", null)} />}
    </div>
  );
}
