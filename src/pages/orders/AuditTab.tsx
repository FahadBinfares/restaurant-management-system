import { useQuery } from "@tanstack/react-query";
import { ErrorMessage, Loading } from "../../components/ui";
import { get } from "../../lib/api";
import { formatDateTime, formatMoney } from "../../lib/format";
import { AUDIT_ACTIONS, DELIVERY_STATUS, ORDER_STATUS, PAYMENT_METHOD } from "../../lib/labels";
import type { AuditEntry } from "../../lib/types";

const FIELD_LABELS: Record<string, string> = {
  status: "الحالة", scheduledAt: "الموعد", deliveryAddress: "العنوان", deliveryMapsUrl: "الموقع", deliveryNotes: "ملاحظات التوصيل",
  kitchenNotes: "ملاحظات المطبخ", deliveryFee: "رسوم التوصيل", total: "الإجمالي", subtotal: "مجموع الأصناف",
  discountAmount: "الخصم", discountType: "نوع الخصم", discountValue: "قيمة الخصم", discountReason: "سبب الخصم", fulfillmentType: "طريقة الاستلام",
  orderType: "نوع الطلب", guestCount: "عدد الضيوف", customerId: "العميل", lines: "الأصناف", paidAmount: "المدفوع",
  amount: "المبلغ", method: "الطريقة", unitPrice: "سعر الوحدة", catalogPrice: "السعر الأصلي", deliveryStatus: "حالة التوصيل",
  driverName: "السائق", name: "الصنف", vatAmount: "الضريبة",
};
const MONEY_FIELDS = new Set(["deliveryFee", "total", "subtotal", "discountAmount", "paidAmount", "amount", "unitPrice", "catalogPrice", "vatAmount"]);

function renderValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (MONEY_FIELDS.has(field) && typeof value === "number") return formatMoney(value);
  if (field === "status" && typeof value === "string") return ORDER_STATUS[value as keyof typeof ORDER_STATUS] ?? value;
  if (field === "deliveryStatus" && typeof value === "string") return DELIVERY_STATUS[value as keyof typeof DELIVERY_STATUS] ?? value;
  if (field === "method" && typeof value === "string") return PAYMENT_METHOD[value as keyof typeof PAYMENT_METHOD] ?? value;
  if (field === "scheduledAt" && typeof value === "string") return formatDateTime(value);
  if (field === "lines" && Array.isArray(value)) {
    return value.map((line: { name: string; quantity: number }) => `${line.name} × ${line.quantity}`).join("، ");
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function AuditChanges({ entry }: { entry: AuditEntry }) {
  const fields = [...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])]
    .filter((field) => !["paymentId", "driverId", "overrodeConflicts"].includes(field));
  if (fields.length === 0) return null;
  return (
    <ul className="mt-1 text-xs text-gray-700">
      {fields.map((field) => (
        <li key={field}>
          {FIELD_LABELS[field] ?? field}:{" "}
          {entry.before && field in entry.before && <><span className="text-red-700 line-through">{renderValue(field, entry.before[field])}</span> ← </>}
          <span className="text-green-800">{renderValue(field, entry.after?.[field])}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AuditTab({ orderId }: { orderId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["order-audit", orderId],
    queryFn: () => get<{ data: AuditEntry[] }>(`/orders/${orderId}/audit`),
  });
  if (isPending) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  return (
    <ol className="flex flex-col gap-3">
      {data?.data.map((entry) => (
        <li key={entry.id} className="rounded-lg border border-Text/10 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <span className="font-medium">{AUDIT_ACTIONS[entry.action] ?? entry.action}</span>
            <span className="text-xs text-gray-600">{entry.actor?.name ?? "النظام"} · {formatDateTime(entry.createdAt)}</span>
          </div>
          {entry.reason && <p className="text-xs text-amber-800">السبب: {entry.reason}</p>}
          <AuditChanges entry={entry} />
        </li>
      ))}
    </ol>
  );
}
