import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Can } from "../../auth/auth";
import { useCan } from "../../auth/hooks";
import {
  Badge, Button, EmptyState, ErrorMessage, Input, Loading, PageHeader, Select, Table, td, th,
} from "../../components/ui";
import { get } from "../../lib/api";
import { formatDateTime, formatMoney, formatPhone } from "../../lib/format";
import {
  DELIVERY_STATUS, DELIVERY_STATUS_TONE, FULFILLMENT_TYPE, ORDER_STATUS, ORDER_STATUS_TONE, ORDER_TYPE,
  PAYMENT_STATUS, PAYMENT_STATUS_TONE,
} from "../../lib/labels";
import type { OrderStatus, OrderSummary, Page } from "../../lib/types";
import OrderDrawer from "./OrderDrawer";

const FILTER_KEYS = ["q", "date", "status", "paymentStatus", "fulfillmentType", "orderType", "archived", "page"] as const;

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>;
  const openId = params.get("open");

  const update = (changes: Partial<Record<string, string | null>>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value); else next.delete(key);
      }
      // Any filter change returns to the first page.
      if (!("page" in changes) && !("open" in changes)) next.delete("page");
      return next;
    }, { replace: true });
  };

  const query = useQuery({
    queryKey: ["orders", filters],
    queryFn: () => get<Page<OrderSummary>>("/orders", { ...filters, page: filters.page || 1, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });

  const hasFilters = FILTER_KEYS.some((key) => key !== "page" && filters[key]);
  const pagination = query.data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title="الطلبات"
        actions={<Can permission="create_orders"><Link to="/orders/new"><Button>طلب جديد</Button></Link></Can>}
      />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Input
          className="col-span-2"
          type="search"
          placeholder="رقم الطلب، اسم العميل، أو الجوال"
          aria-label="بحث"
          defaultValue={filters.q}
          onChange={(event) => update({ q: event.target.value.trim() })}
        />
        <Input type="date" aria-label="تاريخ التسليم" value={filters.date} onChange={(e) => update({ date: e.target.value })} />
        <Select aria-label="حالة الطلب" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">كل الحالات</option>
          {(Object.keys(ORDER_STATUS) as OrderStatus[]).map((status) => <option key={status} value={status}>{ORDER_STATUS[status]}</option>)}
          <option value="confirmed,preparing,ready">النشطة (مؤكد/تحضير/جاهز)</option>
        </Select>
        {can("view_payments") && (
          <Select aria-label="حالة الدفع" value={filters.paymentStatus} onChange={(e) => update({ paymentStatus: e.target.value })}>
            <option value="">كل حالات الدفع</option>
            {Object.entries(PAYMENT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        )}
        <Select aria-label="طريقة الاستلام" value={filters.fulfillmentType} onChange={(e) => update({ fulfillmentType: e.target.value })}>
          <option value="">توصيل واستلام</option>
          {Object.entries(FULFILLMENT_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select aria-label="نوع الطلب" value={filters.orderType} onChange={(e) => update({ orderType: e.target.value })}>
          <option value="">كل الأنواع</option>
          {Object.entries(ORDER_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={filters.archived === "only"} onChange={(e) => update({ archived: e.target.checked ? "only" : "" })} />
          المسودات المؤرشفة فقط
        </label>
        {hasFilters && (
          <Button variant="ghost" onClick={() => setParams(openId ? { open: openId } : {}, { replace: true })}>مسح الفلاتر</Button>
        )}
        {pagination && <span className="text-gray-600">{pagination.total} طلب</span>}
      </div>

      <ErrorMessage error={query.error} />
      {query.isPending ? <Loading /> : query.data && query.data.data.length === 0 ? (
        <EmptyState title={hasFilters ? "لا توجد طلبات تطابق الفلاتر" : "لا توجد طلبات بعد"}>
          {hasFilters ? "جرّب تغيير الفلاتر أو مسحها." : "ابدأ بإنشاء طلب جديد."}
        </EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>رقم الطلب</th>
              <th className={th}>العميل</th>
              <th className={th}>موعد التسليم</th>
              <th className={th}>الحالة</th>
              <th className={th}>التوصيل</th>
              <th className={th}>الإجمالي</th>
              {can("view_payments") && <th className={th}>الدفع</th>}
            </tr>
          </thead>
          <tbody>
            {query.data?.data.map((order) => (
              <tr
                key={order.id}
                className={`cursor-pointer hover:bg-main/40 ${order.id === openId ? "bg-main/60" : ""}`}
                onClick={() => update({ open: order.id })}
              >
                <td className={td}>
                  <button type="button" className="font-mono font-semibold text-secondary hover:underline" dir="ltr">{order.number}</button>
                  {order.orderType === "banquet" && <div><Badge tone="info">وليمة</Badge></div>}
                </td>
                <td className={td}>
                  <div>{order.customerName}</div>
                  <div className="text-xs text-gray-500" dir="ltr">{formatPhone(order.customerPhone)}</div>
                </td>
                <td className={td}>{formatDateTime(order.scheduledAt)}</td>
                <td className={td}>
                  <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS[order.status]}</Badge>
                  {order.archivedAt && <div><Badge tone="muted">مؤرشفة</Badge></div>}
                </td>
                <td className={td}>
                  {order.fulfillmentType === "pickup" ? <span className="text-gray-600">استلام</span> : order.deliveryStatus && (
                    <>
                      <Badge tone={DELIVERY_STATUS_TONE[order.deliveryStatus]}>{DELIVERY_STATUS[order.deliveryStatus]}</Badge>
                      {order.driver && <div className="text-xs text-gray-600">{order.driver.name}</div>}
                    </>
                  )}
                </td>
                <td className={td}>{formatMoney(order.total)}</td>
                {can("view_payments") && (
                  <td className={td}>
                    {order.status !== "draft" && order.paymentStatus && (
                      <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS[order.paymentStatus]}</Badge>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {pagination && totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <Button variant="secondary" disabled={pagination.page <= 1} onClick={() => update({ page: String(pagination.page - 1) })}>السابق</Button>
          <span>صفحة {pagination.page} من {totalPages}</span>
          <Button variant="secondary" disabled={pagination.page >= totalPages} onClick={() => update({ page: String(pagination.page + 1) })}>التالي</Button>
        </div>
      )}
      {openId && <OrderDrawer orderId={openId} onClose={() => update({ open: null })} />}
    </div>
  );
}
