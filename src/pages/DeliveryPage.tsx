import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Can } from "../auth/auth";
import { Badge, Button, Card, ErrorMessage, Field, Input, Loading, Modal, PageHeader, Table, td, th } from "../components/ui";
import { get, patch, post } from "../lib/api";
import { formatPhone, formatTime, riyadhToday } from "../lib/format";
import { DELIVERY_STATUS, DELIVERY_STATUS_TONE, ORDER_STATUS, ORDER_STATUS_TONE } from "../lib/labels";
import type { Driver, OrderSummary, Page } from "../lib/types";

function DriverForm({ driver, onDone }: { driver?: Driver; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [notes, setNotes] = useState(driver?.notes ?? "");
  const save = useMutation({
    mutationFn: () => {
      const body = { name, phone, notes: notes || null };
      return driver ? patch(`/drivers/${driver.id}`, body) : post("/drivers", body);
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["drivers"] }); onDone(); },
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label="الاسم">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
      <Field label="الجوال">{(id) => <Input id={id} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required />}</Field>
      <Field label="ملاحظات">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      <ErrorMessage error={save.error} />
      <Button type="submit" loading={save.isPending}>حفظ</Button>
    </form>
  );
}

export default function DeliveryPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? riyadhToday();
  const [editing, setEditing] = useState<Driver | "new" | null>(null);
  const drivers = useQuery({ queryKey: ["drivers", "all"], queryFn: () => get<{ data: Driver[] }>("/drivers", { includeInactive: true }) });
  const orders = useQuery({
    queryKey: ["orders", { date, fulfillmentType: "delivery", board: true }],
    queryFn: () => get<Page<OrderSummary>>("/orders", {
      date, fulfillmentType: "delivery", status: "confirmed,preparing,ready,completed", pageSize: 100,
    }),
    refetchInterval: 60_000,
  });
  const toggle = useMutation({
    mutationFn: (driver: Driver) => patch(`/drivers/${driver.id}`, { active: !driver.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
  });

  const groups = new Map<string, OrderSummary[]>();
  for (const order of orders.data?.data ?? []) {
    const key = order.driver?.name ?? "بدون سائق";
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="التوصيل والسائقين"
        actions={<Input type="date" aria-label="التاريخ" value={date} onChange={(e) => setParams(e.target.value ? { date: e.target.value } : {}, { replace: true })} />}
      />
      <Card title="توصيلات اليوم حسب السائق">
        {orders.isPending ? <Loading /> : groups.size === 0 ? <p className="text-sm text-gray-600">لا توجد طلبات توصيل في هذا اليوم.</p> : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[...groups.entries()].map(([driverName, list]) => (
              <div key={driverName} className="rounded-xl border border-Text/10 p-3">
                <h3 className="mb-2 font-semibold">{driverName} <span className="text-sm font-normal text-gray-600">({list.length})</span></h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {list.map((order) => (
                    <li key={order.id} className="flex flex-wrap items-center gap-2">
                      <span className="w-16 font-semibold">{formatTime(order.scheduledAt)}</span>
                      <Link to={`/orders?open=${order.id}`} className="font-mono text-secondary hover:underline" dir="ltr">{order.number}</Link>
                      <span>{order.customerName}</span>
                      <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS[order.status]}</Badge>
                      {order.deliveryStatus && <Badge tone={DELIVERY_STATUS_TONE[order.deliveryStatus]}>{DELIVERY_STATUS[order.deliveryStatus]}</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <ErrorMessage error={orders.error} />
      </Card>
      <Card title="السائقون" actions={<Can permission="manage_drivers"><Button onClick={() => setEditing("new")}>سائق جديد</Button></Can>}>
        {drivers.isPending ? <Loading /> : (
          <Table>
            <thead><tr><th className={th}>الاسم</th><th className={th}>الجوال</th><th className={th}>الحالة</th><th className={th} /></tr></thead>
            <tbody>
              {drivers.data?.data.map((driver) => (
                <tr key={driver.id}>
                  <td className={td}>{driver.name}{driver.notes && <div className="text-xs text-gray-500">{driver.notes}</div>}</td>
                  <td className={td} dir="ltr">{formatPhone(driver.phone)}</td>
                  <td className={td}>{driver.active ? <Badge tone="success">نشط</Badge> : <Badge tone="muted">غير نشط</Badge>}</td>
                  <td className={td}>
                    <Can permission="manage_drivers">
                      <Button variant="ghost" onClick={() => setEditing(driver)}>تعديل</Button>
                      <Button variant="ghost" onClick={() => toggle.mutate(driver)}>{driver.active ? "تعطيل" : "تفعيل"}</Button>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <ErrorMessage error={drivers.error ?? toggle.error} />
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "سائق جديد" : "تعديل السائق"}>
        {editing && <DriverForm driver={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
