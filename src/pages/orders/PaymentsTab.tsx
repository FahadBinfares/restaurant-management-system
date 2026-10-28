import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useCan } from "../../auth/hooks";
import { Badge, Button, ConfirmDialog, ErrorMessage, Field, Input, Select, Table, td, th } from "../../components/ui";
import { post } from "../../lib/api";
import { formatDateTime, formatMoney, moneyInputValue, parseMoney } from "../../lib/format";
import { PAYMENT_METHOD } from "../../lib/labels";
import type { Order, PaymentMethod } from "../../lib/types";
import { useInvalidateOrder } from "./hooks";

function PaymentForm({ order, kind, max }: { order: Order; kind: "payment" | "refund"; max: number }) {
  const invalidate = useInvalidateOrder(order.id);
  const [amount, setAmount] = useState(moneyInputValue(max));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  // One key per form instance: a double click cannot record two payments.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const parsed = parseMoney(amount);
  const save = useMutation({
    mutationFn: () => post(`/orders/${order.id}/payments`, {
      kind, method, amount: parsed, reference: reference || null, clientRequestId: requestId,
    }),
    onSuccess: async () => {
      setRequestId(crypto.randomUUID());
      setReference("");
      await invalidate();
    },
  });
  const invalid = parsed === null || parsed <= 0 || parsed > max;
  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-xl border border-Text/10 bg-main/30 p-4 md:grid-cols-4"
      onSubmit={(event) => { event.preventDefault(); if (!invalid) save.mutate(); }}
    >
      <Field label={kind === "refund" ? "مبلغ الاسترداد (ر.س)" : "المبلغ (ر.س)"} error={amount && parsed === null ? "مبلغ غير صحيح" : parsed !== null && parsed > max ? `الحد الأقصى ${formatMoney(max)}` : undefined}>
        {(id) => <Input id={id} inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      </Field>
      <Field label="الطريقة">
        {(id) => (
          <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {Object.entries(PAYMENT_METHOD).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        )}
      </Field>
      <Field label="مرجع (اختياري)" hint="رقم الحوالة أو الإيصال">
        {(id) => <Input id={id} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />}
      </Field>
      <div className="flex items-end">
        <Button type="submit" className="w-full" loading={save.isPending} disabled={invalid}>
          {kind === "refund" ? "تسجيل استرداد" : "تسجيل دفعة"}
        </Button>
      </div>
      <div className="md:col-span-4"><ErrorMessage error={save.error} /></div>
    </form>
  );
}

export default function PaymentsTab({ order }: { order: Order }) {
  const can = useCan();
  const invalidate = useInvalidateOrder(order.id);
  const [voiding, setVoiding] = useState<string | null>(null);
  const voidPayment = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => post(`/payments/${id}/void`, { reason }),
    onSuccess: async () => { setVoiding(null); await invalidate(); },
  });
  const balance = order.total - (order.paidAmount ?? 0);
  const refundable = order.status === "cancelled" ? order.paidAmount ?? 0 : Math.max(0, -balance);
  const payments = order.payments ?? [];

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-main/50 p-3"><dt className="text-xs text-gray-600">الإجمالي</dt><dd className="font-semibold">{formatMoney(order.total)}</dd></div>
        <div className="rounded-lg bg-Light-green p-3"><dt className="text-xs text-gray-600">المدفوع</dt><dd className="font-semibold">{formatMoney(order.paidAmount)}</dd></div>
        <div className="rounded-lg bg-Light-red p-3"><dt className="text-xs text-gray-600">المتبقي</dt><dd className="font-semibold">{formatMoney(Math.max(0, balance))}</dd></div>
      </dl>
      {order.status === "draft" && <p className="text-sm text-gray-600">تُسجَّل المدفوعات بعد تأكيد الطلب. التأكيد لا يتطلب دفعاً.</p>}
      {order.status !== "draft" && order.status !== "cancelled" && balance > 0 && can("record_payments") && (
        // Remount when the balance changes so the amount pre-fills with what is still owed.
        <PaymentForm key={`payment-${balance}`} order={order} kind="payment" max={balance} />
      )}
      {refundable > 0 && can("settle_cancelled_order") && (
        <div>
          <p className="mb-2 text-sm text-amber-800">
            {order.status === "cancelled" ? "الطلب ملغي. حدد المبلغ المسترد حسب سياسة المطعم (لا يلزم استرداد كامل المبلغ)." : "المدفوع أكبر من الإجمالي."}
          </p>
          <PaymentForm key={`refund-${refundable}`} order={order} kind="refund" max={refundable} />
        </div>
      )}
      {payments.length === 0 ? <p className="text-sm text-gray-500">لا توجد مدفوعات مسجلة.</p> : (
        <Table>
          <thead>
            <tr><th className={th}>التاريخ</th><th className={th}>النوع</th><th className={th}>المبلغ</th><th className={th}>الطريقة</th><th className={th}>بواسطة</th><th className={th} /></tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className={payment.voidedAt ? "text-gray-400 line-through" : ""}>
                <td className={td}>{formatDateTime(payment.receivedAt)}</td>
                <td className={td}>{payment.kind === "refund" ? <Badge tone="warning">استرداد</Badge> : "دفعة"}</td>
                <td className={td}>{formatMoney(payment.amount)}</td>
                <td className={td}>{PAYMENT_METHOD[payment.method]}{payment.reference && <div className="text-xs" dir="ltr">{payment.reference}</div>}</td>
                <td className={td}>{payment.recordedBy.name}</td>
                <td className={td}>
                  {payment.voidedAt ? (
                    <span className="text-xs no-underline" title={payment.voidReason ?? ""}>ملغى بواسطة {payment.voidedBy?.name}</span>
                  ) : can("void_payments") && <Button variant="ghost" onClick={() => setVoiding(payment.id)}>إلغاء القيد</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={voiding !== null}
        title="إلغاء قيد الدفع"
        message="لن يُحذف القيد، بل يُعلَّم كملغى ويبقى في السجل."
        confirmLabel="إلغاء القيد"
        danger
        requireReason
        loading={voidPayment.isPending}
        error={voidPayment.error}
        onClose={() => { setVoiding(null); voidPayment.reset(); }}
        onConfirm={(reason) => voiding && voidPayment.mutate({ id: voiding, reason })}
      />
    </div>
  );
}
