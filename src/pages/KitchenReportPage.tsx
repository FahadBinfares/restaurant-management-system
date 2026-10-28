import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Can } from "../auth/auth";
import { Badge, Button, EmptyState, ErrorMessage, Input, Loading, PageHeader } from "../components/ui";
import { get, post } from "../lib/api";
import { formatDate, formatDateTime, formatTime, riyadhToday } from "../lib/format";
import { FULFILLMENT_TYPE, ORDER_STATUS, ORDER_STATUS_TONE, ORDER_TYPE } from "../lib/labels";
import type { KitchenOrder } from "../lib/types";

export default function KitchenReportPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? riyadhToday();
  const report = useQuery({
    queryKey: ["kitchen-report", date],
    queryFn: () => get<{ data: KitchenOrder[]; generatedAt: string }>("/reports/kitchen", { date }),
    refetchInterval: 60_000,
  });
  // The print is recorded in the audit log before the browser print dialog opens.
  const print = useMutation({
    mutationFn: () => post("/reports/kitchen/print", { date }),
    onSuccess: () => window.print(),
  });

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="تقرير المطبخ"
          actions={(
            <>
              <Input type="date" aria-label="التاريخ" value={date} onChange={(e) => setParams(e.target.value ? { date: e.target.value } : {}, { replace: true })} />
              <Can permission="print_kitchen_reports">
                <Button onClick={() => print.mutate()} loading={print.isPending} disabled={!report.data?.data.length}>طباعة</Button>
              </Can>
            </>
          )}
        />
        <ErrorMessage error={print.error} />
        <p className="mb-3 text-sm text-gray-600">يشمل الطلبات المؤكدة وقيد التحضير والجاهزة فقط، بغض النظر عن حالة الدفع.</p>
      </div>
      <div className="mb-4 hidden print:block">
        <h1 className="text-xl font-bold">تقرير المطبخ — {formatDate(date)}</h1>
        {report.data && <p className="text-xs">طُبع: {formatDateTime(report.data.generatedAt)}</p>}
      </div>
      {report.isPending ? <Loading /> : report.error ? <ErrorMessage error={report.error} /> : report.data.data.length === 0 ? (
        <EmptyState title="لا توجد طلبات للتحضير في هذا اليوم" />
      ) : (
        <div className="flex flex-col gap-4">
          {report.data.data.map((order) => (
            <article key={order.id} className="break-inside-avoid rounded-xl border-2 border-Text/20 bg-white p-4 print:rounded-none print:border-black">
              <header className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-b pb-2">
                <span className="text-2xl font-bold">{formatTime(order.scheduledAt)}</span>
                <span className="font-mono text-lg" dir="ltr">{order.number}</span>
                <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS[order.status]}</Badge>
                <span>{ORDER_TYPE[order.orderType]}</span>
                <span>{FULFILLMENT_TYPE[order.fulfillmentType]}{order.driver && ` — السائق: ${order.driver.name}`}</span>
                {order.guestCount && <span>الضيوف: {order.guestCount}</span>}
                <span className="text-gray-700">{order.customerName}</span>
              </header>
              <ul className="flex flex-col gap-2 text-lg">
                {order.lines.map((line, index) => (
                  <li key={index}>
                    <span className="font-bold">{line.quantity} ×</span> {line.name}
                    {line.components.length > 0 && (
                      <ul className="ms-6 text-base">
                        {line.components.map((component, i) => <li key={i}>– {component.name} × {component.quantity * line.quantity}</li>)}
                      </ul>
                    )}
                    {line.notes && <div className="ms-6 text-base font-semibold text-red-800">⚠ {line.notes}</div>}
                  </li>
                ))}
              </ul>
              {order.kitchenNotes && (
                <p className="mt-3 rounded-lg bg-Light-yellow p-2 font-semibold whitespace-pre-wrap print:border print:border-black">
                  ملاحظات: {order.kitchenNotes}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
