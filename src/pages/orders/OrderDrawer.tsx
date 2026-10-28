import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { useCan } from "../../auth/hooks";
import { Badge, Button, ConfirmDialog, Drawer, ErrorMessage, Loading, Tabs } from "../../components/ui";
import { ApiError, post } from "../../lib/api";
import { formatDateTime, formatMoney, formatPhone } from "../../lib/format";
import {
  DELIVERY_STATUS, DELIVERY_STATUS_TONE, FULFILLMENT_TYPE, INCOMPLETE_PROBLEMS, ORDER_STATUS, ORDER_STATUS_TONE,
  ORDER_TYPE, PAYMENT_STATUS, PAYMENT_STATUS_TONE,
} from "../../lib/labels";
import type { Order, OrderStatus } from "../../lib/types";
import AuditTab from "./AuditTab";
import DeliveryTab from "./DeliveryTab";
import { useInvalidateOrder, useOrder } from "./hooks";
import OrderSummaryView from "./OrderSummaryView";
import PaymentsTab from "./PaymentsTab";

type TabId = "details" | "payments" | "delivery" | "audit";

const NEXT_STATUS: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  confirmed: { to: "preparing", label: "بدء التحضير" },
  preparing: { to: "ready", label: "الطلب جاهز" },
  ready: { to: "completed", label: "إكمال الطلب" },
};
const PREVIOUS_STATUS: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  preparing: { to: "confirmed", label: "إرجاع إلى مؤكد" },
  ready: { to: "preparing", label: "إرجاع إلى التحضير" },
};

type Action =
  | { kind: "confirm" } | { kind: "cancel" } | { kind: "archive" } | { kind: "restore" }
  | { kind: "status"; to: OrderStatus; label: string; backwards: boolean };

function DetailsTab({ order }: { order: Order }) {
  const can = useCan();
  const invalidate = useInvalidateOrder(order.id);
  const [action, setAction] = useState<Action | null>(null);
  const run = useMutation({
    mutationFn: ({ action: current, reason }: { action: Action; reason: string }) => {
      const version = order.version;
      switch (current.kind) {
        case "confirm": return post(`/orders/${order.id}/confirm`, { version });
        case "cancel": return post(`/orders/${order.id}/cancel`, { version, reason });
        case "archive": return post(`/orders/${order.id}/archive`, { version });
        case "restore": return post(`/orders/${order.id}/restore`, { version });
        case "status": return post(`/orders/${order.id}/status`, { version, status: current.to, ...(reason ? { reason } : {}) });
      }
    },
    onSuccess: async () => { setAction(null); await invalidate(); },
  });
  const next = NEXT_STATUS[order.status];
  const previous = PREVIOUS_STATUS[order.status];
  const editable = ["draft", "confirmed", "preparing", "ready"].includes(order.status) && !order.archivedAt;
  const canEdit = order.status === "draft" ? can("create_orders") : can("edit_confirmed_orders");
  const problems = run.error instanceof ApiError && run.error.code === "ORDER_INCOMPLETE"
    ? (run.error.details as { problems: string[] }).problems : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        {editable && canEdit && <Link to={`/orders/${order.id}/edit`}><Button variant="secondary">تعديل</Button></Link>}
        {order.status === "draft" && !order.archivedAt && can("confirm_orders") && (
          <Link to={`/orders/${order.id}/edit?review=1`}><Button>مراجعة وتأكيد</Button></Link>
        )}
        {next && can("update_order_status") && (
          <Button onClick={() => setAction({ kind: "status", to: next.to, label: next.label, backwards: false })}>{next.label}</Button>
        )}
        {previous && can("update_order_status") && (
          <Button variant="ghost" onClick={() => setAction({ kind: "status", to: previous.to, label: previous.label, backwards: true })}>
            {previous.label}
          </Button>
        )}
        {order.status === "draft" && !order.archivedAt && can("create_orders") && (
          <Button variant="ghost" onClick={() => setAction({ kind: "archive" })}>أرشفة المسودة</Button>
        )}
        {order.archivedAt && can("restore_draft_orders") && <Button onClick={() => setAction({ kind: "restore" })}>استعادة المسودة</Button>}
        {["confirmed", "preparing", "ready"].includes(order.status) && can("cancel_order") && (
          <Button variant="danger" onClick={() => setAction({ kind: "cancel" })}>إلغاء الطلب</Button>
        )}
        <Button variant="ghost" onClick={() => window.print()}>طباعة الملخص</Button>
      </div>
      {problems.length > 0 && (
        <ul className="rounded-lg bg-Light-red px-4 py-2 text-sm text-red-800">
          {problems.map((problem) => <li key={problem}>• {INCOMPLETE_PROBLEMS[problem] ?? problem}</li>)}
        </ul>
      )}
      <OrderSummaryView order={order} />
      <ConfirmDialog
        open={action !== null}
        title={action?.kind === "cancel" ? "إلغاء الطلب" : action?.kind === "status" ? action.label
          : action?.kind === "archive" ? "أرشفة المسودة" : action?.kind === "restore" ? "استعادة المسودة" : "تأكيد الطلب"}
        message={action?.kind === "cancel"
          ? "لن يتم استرداد أي مبلغ تلقائياً. الاسترداد يتم من تبويب المدفوعات بصلاحية التسوية."
          : `الطلب ${order.number}`}
        confirmLabel={action?.kind === "cancel" ? "إلغاء الطلب" : "تأكيد"}
        danger={action?.kind === "cancel"}
        requireReason={action?.kind === "cancel" || (action?.kind === "status" && action.backwards)}
        loading={run.isPending}
        error={run.error && !problems.length ? run.error : null}
        onClose={() => { setAction(null); run.reset(); }}
        onConfirm={(reason) => action && run.mutate({ action, reason })}
      />
    </div>
  );
}

export default function OrderDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const can = useCan();
  const [tab, setTab] = useState<TabId>("details");
  const { data: order, isPending, error } = useOrder(orderId);
  const tabs: { id: TabId; label: string }[] = [
    { id: "details", label: "تفاصيل الطلب" },
    ...(can("view_payments") ? [{ id: "payments" as const, label: "المدفوعات" }] : []),
    ...(order?.fulfillmentType === "delivery" ? [{ id: "delivery" as const, label: "التوصيل" }] : []),
    { id: "audit", label: "سجل التعديلات" },
  ];
  return (
    <Drawer
      open
      onClose={onClose}
      title={order ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono" dir="ltr">{order.number}</span>
          <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS[order.status]}</Badge>
          {order.paymentStatus && order.status !== "draft" && (
            <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS[order.paymentStatus]}</Badge>
          )}
          {order.deliveryStatus && <Badge tone={DELIVERY_STATUS_TONE[order.deliveryStatus]}>{DELIVERY_STATUS[order.deliveryStatus]}</Badge>}
        </div>
      ) : "الطلب"}
    >
      {isPending ? <Loading /> : error || !order ? <ErrorMessage error={error} /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-gray-600">العميل</span><span>{order.customerName} — <span dir="ltr">{formatPhone(order.customerPhone)}</span></span>
            <span className="text-gray-600">النوع</span><span>{ORDER_TYPE[order.orderType]} · {FULFILLMENT_TYPE[order.fulfillmentType]}</span>
            <span className="text-gray-600">الموعد</span><span>{formatDateTime(order.scheduledAt)}</span>
            <span className="text-gray-600">الإجمالي</span><span className="font-semibold">{formatMoney(order.total)}</span>
          </div>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
          {tab === "details" && <DetailsTab order={order} />}
          {tab === "payments" && <PaymentsTab order={order} />}
          {tab === "delivery" && <DeliveryTab order={order} />}
          {tab === "audit" && <AuditTab orderId={order.id} />}
        </>
      )}
    </Drawer>
  );
}
