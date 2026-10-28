import { formatDateTime, formatMoney, formatPhone } from "../../lib/format";
import { FULFILLMENT_TYPE, ORDER_TYPE } from "../../lib/labels";
import type { Order } from "../../lib/types";

/** Read-only order summary, used in the drawer, the confirmation review, and printing. */
export default function OrderSummaryView({ order }: {
  order: Pick<Order, "lines" | "subtotal" | "discountAmount" | "deliveryFee" | "total" | "vatAmount" | "discountReason"
    | "kitchenNotes" | "deliveryAddress" | "deliveryMapsUrl" | "deliveryNotes" | "fulfillmentType" | "orderType"
    | "guestCount" | "scheduledAt" | "customerName" | "customerPhone"> & { number?: string; cancelReason?: string | null };
}) {
  return (
    <div className="flex flex-col gap-4 text-sm print:text-xs">
      <div className="hidden print:block">
        <h2 className="text-lg font-bold">ملخص الطلب {order.number}</h2>
        <p>{order.customerName} — <span dir="ltr">{formatPhone(order.customerPhone)}</span></p>
        <p>{ORDER_TYPE[order.orderType]} · {FULFILLMENT_TYPE[order.fulfillmentType]} · {formatDateTime(order.scheduledAt)}</p>
      </div>
      {order.cancelReason && <div className="rounded-lg bg-Light-red px-3 py-2 text-red-800">سبب الإلغاء: {order.cancelReason}</div>}
      <table className="w-full">
        <thead>
          <tr className="border-b text-right text-gray-600">
            <th className="py-1 font-medium">الصنف</th>
            <th className="py-1 font-medium">الكمية</th>
            <th className="py-1 font-medium">سعر الوحدة</th>
            <th className="py-1 font-medium">المجموع</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line, index) => (
            <tr key={line.id ?? index} className="border-b align-top">
              <td className="py-2">
                <div className="font-medium">{line.name}{line.kind === "custom" && <span className="ms-1 text-xs text-gray-500">(صنف مخصص)</span>}</div>
                {line.components.length > 0 && (
                  <ul className="mt-1 text-xs text-gray-600">
                    {line.components.map((component, i) => <li key={i}>• {component.name} × {component.quantity}</li>)}
                  </ul>
                )}
                {line.notes && <div className="text-xs text-amber-800">ملاحظة: {line.notes}</div>}
                {line.catalogPrice !== null && line.unitPrice !== line.catalogPrice && (
                  <div className="text-xs text-amber-800">
                    سعر معدّل (الأصلي {formatMoney(line.catalogPrice)}){line.priceOverrideReason && ` — ${line.priceOverrideReason}`}
                  </div>
                )}
              </td>
              <td className="py-2">{line.quantity}</td>
              <td className="py-2">{formatMoney(line.unitPrice)}</td>
              <td className="py-2">{formatMoney(line.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ms-auto grid w-full max-w-xs grid-cols-2 gap-y-1">
        <dt className="text-gray-600">مجموع الأصناف</dt><dd>{formatMoney(order.subtotal)}</dd>
        {order.discountAmount > 0 && (<><dt className="text-gray-600">الخصم</dt><dd>- {formatMoney(order.discountAmount)}</dd></>)}
        {order.fulfillmentType === "delivery" && (<><dt className="text-gray-600">رسوم التوصيل</dt><dd>{formatMoney(order.deliveryFee)}</dd></>)}
        <dt className="font-semibold">الإجمالي</dt><dd className="font-semibold">{formatMoney(order.total)}</dd>
        <dt className="text-xs text-gray-500">يشمل ضريبة القيمة المضافة</dt><dd className="text-xs text-gray-500">{formatMoney(order.vatAmount)}</dd>
      </dl>
      {order.discountReason && order.discountAmount > 0 && <p className="text-xs text-gray-600">سبب الخصم: {order.discountReason}</p>}
      {order.guestCount && <p>عدد الضيوف: {order.guestCount}</p>}
      {order.fulfillmentType === "delivery" && (
        <div>
          <div className="font-medium text-Text">عنوان التوصيل</div>
          <p>{order.deliveryAddress ?? "—"}</p>
          {order.deliveryMapsUrl && (
            <a href={order.deliveryMapsUrl} target="_blank" rel="noopener noreferrer" className="text-secondary underline print:hidden">فتح الموقع على الخريطة</a>
          )}
          {order.deliveryNotes && <p className="text-gray-600">ملاحظات التوصيل: {order.deliveryNotes}</p>}
        </div>
      )}
      {order.kitchenNotes && (
        <div className="rounded-lg bg-Light-yellow px-3 py-2">
          <div className="font-medium">ملاحظات المطبخ</div>
          <p className="whitespace-pre-wrap">{order.kitchenNotes}</p>
        </div>
      )}
      <p className="hidden text-xs text-gray-500 print:block">هذا ملخص طلب وليس فاتورة ضريبية.</p>
    </div>
  );
}
