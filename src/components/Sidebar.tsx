import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import logo from "../assets/App-Logo.png";
import { ME_QUERY_KEY, useCan, useMe } from "../auth/hooks";
import { post } from "../lib/api";
import { ROLE } from "../lib/labels";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 h-12 px-4 rounded-lg text-[17px] transition-colors ${
    isActive ? "bg-secondary text-white" : "text-Text hover:bg-secondary/20"
  }`;

function Icon({ d }: { d: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-6 shrink-0" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d={d} />
    </svg>
  );
}

const ICONS = {
  dashboard: "M3 6a3 3 0 0 1 3-3h2.25a3 3 0 0 1 3 3v2.25a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6Zm9.75 0a3 3 0 0 1 3-3H18a3 3 0 0 1 3 3v2.25a3 3 0 0 1-3 3h-2.25a3 3 0 0 1-3-3V6ZM3 15.75a3 3 0 0 1 3-3h2.25a3 3 0 0 1 3 3V18a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-2.25Zm9.75 0a3 3 0 0 1 3-3H18a3 3 0 0 1 3 3V18a3 3 0 0 1-3 3h-2.25a3 3 0 0 1-3-3v-2.25Z",
  orders: "M7.502 6h7.128A3.375 3.375 0 0 1 18 9.375v9.375a3 3 0 0 0 3-3V6.108c0-1.505-1.125-2.811-2.664-2.94a48.972 48.972 0 0 0-.673-.05A3 3 0 0 0 15 1.5h-1.5a3 3 0 0 0-2.663 1.618c-.225.015-.45.032-.673.05C8.662 3.295 7.554 4.542 7.502 6ZM3 9.375C3 8.339 3.84 7.5 4.875 7.5h9.75c1.036 0 1.875.84 1.875 1.875v11.25c0 1.035-.84 1.875-1.875 1.875h-9.75A1.875 1.875 0 0 1 3 20.625V9.375Z",
  customers: "M4.5 6.375a4.125 4.125 0 1 1 8.25 0 4.125 4.125 0 0 1-8.25 0ZM14.25 8.625a3.375 3.375 0 1 1 6.75 0 3.375 3.375 0 0 1-6.75 0ZM1.5 19.125a7.125 7.125 0 0 1 14.25 0v.003l-.001.119a.75.75 0 0 1-.363.63 13.067 13.067 0 0 1-6.761 1.873c-2.472 0-4.786-.684-6.76-1.873a.75.75 0 0 1-.364-.63l-.001-.122ZM17.25 19.128l-.001.144a2.25 2.25 0 0 1-.233.96 10.088 10.088 0 0 0 5.06-1.01.75.75 0 0 0 .42-.643 4.875 4.875 0 0 0-6.957-4.611 8.586 8.586 0 0 1 1.71 5.157v.003Z",
  kitchen: "M2.25 2.25a.75.75 0 0 0 0 1.5H3v10.5a3 3 0 0 0 3 3h1.21l-1.172 3.513a.75.75 0 0 0 1.424.474l.329-.987h8.418l.33.987a.75.75 0 0 0 1.422-.474l-1.17-3.513H18a3 3 0 0 0 3-3V3.75h.75a.75.75 0 0 0 0-1.5H2.25Zm6.54 15h6.42l.5 1.5H8.29l.5-1.5Z",
  catalog: "M5.25 2.25a3 3 0 0 0-3 3v4.318a3 3 0 0 0 .879 2.121l9.58 9.581c.92.92 2.39 1.186 3.548.428a18.849 18.849 0 0 0 5.441-5.44c.758-1.16.492-2.629-.428-3.548l-9.58-9.581a3 3 0 0 0-2.122-.879H5.25ZM6.375 7.5a1.125 1.125 0 1 0 0-2.25 1.125 1.125 0 0 0 0 2.25Z",
  delivery: "M3.375 4.5C2.339 4.5 1.5 5.34 1.5 6.375V13.5h12V6.375c0-1.036-.84-1.875-1.875-1.875h-8.25ZM13.5 15h-12v2.625c0 1.035.84 1.875 1.875 1.875h.375a3 3 0 1 1 6 0h3a.75.75 0 0 0 .75-.75V15Zm1.5-7.5h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 1 .439 1.061v5.004c0 .414-.336.75-.75.75H21a3 3 0 1 0-6 0h-.75V7.5H15Z",
  settings: "M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z",
} as const;

function Item({ to, icon, end, children }: { to: string; icon: keyof typeof ICONS; end?: boolean; children: ReactNode }) {
  return (
    <NavLink to={to} end={end} className={navLinkClass}>
      <Icon d={ICONS[icon]} />
      {children}
    </NavLink>
  );
}

export default function Sidebar() {
  const me = useMe();
  const can = useCan();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: () => post("/auth/logout"),
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(ME_QUERY_KEY, null);
      navigate("/login", { replace: true });
    },
  });

  return (
    <aside className="sidebar flex w-60 shrink-0 select-none flex-col bg-main text-Text print:hidden">
      <img src={logo} alt="شعار المطعم" className="mx-auto h-28 object-contain" />
      <nav className="flex flex-col gap-2 p-3">
        <Item to="/" icon="dashboard" end>لوحة التحكم</Item>
        {can("view_orders") && <Item to="/orders" icon="orders">الطلبات</Item>}
        {can("view_customers") && <Item to="/customers" icon="customers">العملاء</Item>}
        {can("view_kitchen_reports") && <Item to="/kitchen" icon="kitchen">تقرير المطبخ</Item>}
        {can("view_orders") && <Item to="/delivery" icon="delivery">التوصيل والسائقين</Item>}
        {can("manage_products") && <Item to="/catalog" icon="catalog">المنتجات والباقات</Item>}
        {(can("manage_employees") || can("manage_settings") || can("view_audit_log")) && (
          <Item to="/admin" icon="settings">الإدارة</Item>
        )}
      </nav>
      <div className="mt-auto border-t border-Text/15 p-4 text-sm">
        <NavLink to="/account" className="block font-semibold hover:underline">{me.employee.name}</NavLink>
        <div className="text-xs text-Text/70">{ROLE[me.employee.role]}</div>
        <button type="button" onClick={() => logout.mutate()} className="mt-2 text-xs text-secondary hover:underline">
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}
