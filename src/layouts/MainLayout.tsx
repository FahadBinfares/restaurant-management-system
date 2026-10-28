import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Outlet } from "react-router";
import Sidebar from "../components/Sidebar";
import { get } from "../lib/api";
import { formatTime } from "../lib/format";
import type { Dashboard } from "../lib/types";

/** In-app alerts: polls the dashboard for due-soon, delayed, and delivery-problem orders. */
function AlertsBar() {
  const [dismissed, setDismissed] = useState<string>("");
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => get<{ data: Dashboard }>("/dashboard"),
    refetchInterval: 60_000,
  });
  if (!data) return null;
  const { delayed, upcoming, deliveryProblems } = data.data;
  const signature = [...delayed, ...upcoming, ...deliveryProblems].map((order) => order.id).sort().join();
  if (!signature || signature === dismissed) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-Light-yellow px-4 py-2 text-sm text-amber-950 print:hidden" role="status">
      {delayed.length > 0 && <span className="font-semibold text-red-800">⚠ {delayed.length} طلب متأخر</span>}
      {upcoming.length > 0 && (
        <span>
          {upcoming.length} طلب خلال {data.data.alertLeadMinutes} دقيقة
          {upcoming[0] && ` (أقربها ${upcoming[0].number} الساعة ${formatTime(upcoming[0].scheduledAt)})`}
        </span>
      )}
      {deliveryProblems.length > 0 && <span>{deliveryProblems.length} مشكلة توصيل</span>}
      <Link to="/" className="font-medium underline">التفاصيل</Link>
      <button type="button" className="ms-auto text-xs underline" onClick={() => setDismissed(signature)}>إخفاء</button>
    </div>
  );
}

export default function MainLayout() {
  return (
    <div className="flex min-h-screen bg-primary">
      <Sidebar />
      <main className="min-w-0 flex-1 p-6 print:p-0">
        <AlertsBar />
        <Outlet />
      </main>
    </div>
  );
}
