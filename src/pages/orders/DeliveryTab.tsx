import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useCan } from "../../auth/hooks";
import { Badge, Button, ConfirmDialog, ErrorMessage, Field, Select } from "../../components/ui";
import { ApiError, get, post } from "../../lib/api";
import { formatDateTime, formatTime } from "../../lib/format";
import { DELIVERY_STATUS, DELIVERY_STATUS_TONE } from "../../lib/labels";
import type { Driver, Order } from "../../lib/types";
import { useInvalidateOrder } from "./hooks";

interface Conflict { id: string; number: string; scheduledAt: string; customerName: string }

export default function DeliveryTab({ order }: { order: Order }) {
  const can = useCan();
  const invalidate = useInvalidateOrder(order.id);
  const drivers = useQuery({ queryKey: ["drivers"], queryFn: () => get<{ data: Driver[] }>("/drivers") });
  const [driverId, setDriverId] = useState(order.driver?.id ?? "");
  const [failing, setFailing] = useState(false);

  const assign = useMutation({
    mutationFn: (force: boolean) => post(`/orders/${order.id}/delivery/assign`, { driverId: driverId || null, force }),
    onSuccess: invalidate,
  });
  const setStatus = useMutation({
    mutationFn: ({ status, reason }: { status: string; reason?: string }) =>
      post(`/orders/${order.id}/delivery/status`, { status, ...(reason ? { reason } : {}) }),
    onSuccess: async () => { setFailing(false); await invalidate(); },
  });
  const conflicts = assign.error instanceof ApiError && assign.error.code === "DRIVER_CONFLICT"
    ? (assign.error.details as { conflicts: Conflict[] }).conflicts : [];
  const active = !["draft", "cancelled"].includes(order.status);
  const assignable = active && order.status !== "completed" && ["unassigned", "assigned", "failed"].includes(order.deliveryStatus ?? "");

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>حالة التوصيل:</span>
        {order.deliveryStatus && <Badge tone={DELIVERY_STATUS_TONE[order.deliveryStatus]}>{DELIVERY_STATUS[order.deliveryStatus]}</Badge>}
        {order.driver && <span>السائق: {order.driver.name}</span>}
        {order.deliveredAt && <span className="text-gray-600">سُلّم {formatDateTime(order.deliveredAt)}</span>}
      </div>
      {order.deliveryFailureReason && <p className="text-red-700">سبب التعذر: {order.deliveryFailureReason}</p>}
      {order.status === "draft" && <p className="text-gray-600">يمكن إسناد سائق بعد تأكيد الطلب.</p>}

      {assignable && can("assign_drivers") && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="السائق" className="min-w-60">
            {(id) => (
              <Select id={id} value={driverId} onChange={(e) => { setDriverId(e.target.value); assign.reset(); }}>
                <option value="">بدون سائق</option>
                {drivers.data?.data.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
              </Select>
            )}
          </Field>
          <Button onClick={() => assign.mutate(false)} loading={assign.isPending} disabled={(driverId || null) === (order.driver?.id ?? null)}>
            حفظ
          </Button>
        </div>
      )}
      {conflicts.length > 0 ? (
        <div className="rounded-lg bg-Light-yellow p-3">
          <p className="font-medium">لدى السائق توصيلات قريبة من هذا الموعد:</p>
          <ul className="my-2">
            {conflicts.map((c) => <li key={c.id}>• <span dir="ltr">{c.number}</span> — {c.customerName} — {formatTime(c.scheduledAt)}</li>)}
          </ul>
          <Button variant="secondary" onClick={() => assign.mutate(true)} loading={assign.isPending}>إسناد رغم التعارض</Button>
        </div>
      ) : <ErrorMessage error={assign.error} />}

      {active && can("update_delivery_status") && (
        <div className="flex flex-wrap gap-2">
          {order.deliveryStatus === "assigned" && (
            <Button onClick={() => setStatus.mutate({ status: "out_for_delivery" })} loading={setStatus.isPending}>خرج للتوصيل</Button>
          )}
          {order.deliveryStatus === "out_for_delivery" && (
            <>
              <Button onClick={() => setStatus.mutate({ status: "delivered" })} loading={setStatus.isPending}>تم التوصيل</Button>
              <Button variant="danger" onClick={() => setFailing(true)}>تعذّر التوصيل</Button>
            </>
          )}
        </div>
      )}
      {!failing && <ErrorMessage error={setStatus.error} />}
      <ConfirmDialog
        open={failing}
        title="تعذّر التوصيل"
        confirmLabel="تسجيل"
        danger
        requireReason
        loading={setStatus.isPending}
        error={setStatus.error}
        onClose={() => { setFailing(false); setStatus.reset(); }}
        onConfirm={(reason) => setStatus.mutate({ status: "failed", reason })}
      />
    </div>
  );
}
