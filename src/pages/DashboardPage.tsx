import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Can } from "../auth/auth";
import { Badge, Button, Card, ErrorMessage, Loading, PageHeader } from "../components/ui";
import { get } from "../lib/api";
import { formatDate, formatMoney, formatTime } from "../lib/format";
import { DELIVERY_STATUS, DELIVERY_STATUS_TONE, ORDER_STATUS, ORDER_STATUS_TONE } from "../lib/labels";
import type { AlertOrder, Dashboard } from "../lib/types";

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-Text/10 bg-white p-4 shadow-sm">
      <div className="text-sm text-gray-600">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone ?? "text-Text"}`}>{value}</div>
    </div>
  );
}

function AlertList({ title, orders, empty }: { title: string; orders: AlertOrder[]; empty: string }) {
  return (
    <Card title={`${title} (${orders.length})`}>
      {orders.length === 0 ? <p className="text-sm text-gray-500">{empty}</p> : (
        <ul className="divide-y">
          {orders.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <Link to={`/orders?open=${order.id}`} className="font-mono font-semibold text-secondary hover:underline" dir="ltr">{order.number}</Link>
              <span>{order.customerName}</span>
              <span className="text-gray-600">{formatTime(order.scheduledAt)}</span>
              <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS[order.status]}</Badge>
              {order.deliveryStatus && <Badge tone={DELIVERY_STATUS_TONE[order.deliveryStatus]}>{DELIVERY_STATUS[order.deliveryStatus]}</Badge>}
              {order.deliveryFailureReason && <span className="text-xs text-red-700">{order.deliveryFailureReason}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => get<{ data: Dashboard }>("/dashboard"),
    refetchInterval: 60_000,
  });
  if (isPending) return <Loading />;
  if (error || !data) return <ErrorMessage error={error} />;
  const dashboard = data.data;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="لوحة التحكم"
        actions={<Can permission="create_orders"><Link to="/orders/new"><Button>طلب جديد</Button></Link></Can>}
      />
      <p className="-mt-3 text-sm text-gray-600">{formatDate(dashboard.date)}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="طلبات اليوم" value={dashboard.today.total} />
        <Stat label="مؤكدة" value={dashboard.today.confirmed} />
        <Stat label="قيد التحضير" value={dashboard.today.preparing} tone="text-amber-700" />
        <Stat label="جاهزة" value={dashboard.today.ready} tone="text-green-700" />
        <Stat label="مكتملة" value={dashboard.today.completed} />
        <Stat label="متأخرة" value={dashboard.delayed.length} tone={dashboard.delayed.length ? "text-red-700" : undefined} />
      </div>
      {dashboard.financial && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Stat label="المبالغ المتبقية على العملاء" value={formatMoney(dashboard.financial.outstandingAmount)} tone="text-red-700" />
          <Stat label="طلبات عليها مبالغ متبقية" value={dashboard.financial.outstandingOrders} />
          <Stat label="صافي المقبوض اليوم" value={formatMoney(dashboard.financial.receivedToday)} tone="text-green-700" />
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <AlertList title="طلبات متأخرة" orders={dashboard.delayed} empty="لا توجد طلبات متأخرة" />
        <AlertList title={`خلال ${dashboard.alertLeadMinutes} دقيقة`} orders={dashboard.upcoming} empty="لا توجد طلبات قريبة" />
        <AlertList title="مشاكل التوصيل" orders={dashboard.deliveryProblems} empty="لا توجد مشاكل" />
      </div>
    </div>
  );
}
