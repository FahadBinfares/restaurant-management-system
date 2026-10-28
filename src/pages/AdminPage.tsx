import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCan, useMe } from "../auth/hooks";
import {
  Badge, Button, Card, ConfirmDialog, ErrorMessage, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, td, th,
} from "../components/ui";
import { get, patch, post, put } from "../lib/api";
import { formatDateTime, formatPhone } from "../lib/format";
import { AUDIT_ACTIONS, PERMISSION_LABELS, ROLE } from "../lib/labels";
import type { AuditEntry, Employee, Page, Role, Settings } from "../lib/types";
import { AuditChanges } from "./orders/AuditTab";

function TemporaryPassword({ password, onClose }: { password: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="كلمة المرور المؤقتة">
      <div className="flex flex-col gap-3 text-sm">
        <p>سلّم هذه الكلمة للموظف بشكل آمن. <strong>لن تظهر مرة أخرى</strong>، وسيُطلب منه تغييرها عند أول دخول.</p>
        <code dir="ltr" className="select-all rounded-lg bg-main p-3 text-center font-mono text-xl tracking-wider">{password}</code>
        <Button onClick={onClose}>تم</Button>
      </div>
    </Modal>
  );
}

function PermissionsEditor({ employee, all, onDone }: { employee: Employee; all: string[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [grants, setGrants] = useState(new Set(employee.grants));
  const [revokes, setRevokes] = useState(new Set(employee.revokes));
  const save = useMutation({
    mutationFn: () => put(`/employees/${employee.id}/permissions`, { grants: [...grants], revokes: [...revokes] }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["employees"] }); onDone(); },
  });
  const roleDefault = (permission: string) =>
    (employee.permissions.includes(permission) && !grants.has(permission)) || revokes.has(permission);
  const stateOf = (permission: string) => grants.has(permission) ? "grant" : revokes.has(permission) ? "revoke" : "default";
  const setState = (permission: string, value: string) => {
    const nextGrants = new Set(grants);
    const nextRevokes = new Set(revokes);
    nextGrants.delete(permission);
    nextRevokes.delete(permission);
    if (value === "grant") nextGrants.add(permission);
    if (value === "revoke") nextRevokes.add(permission);
    setGrants(nextGrants);
    setRevokes(nextRevokes);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600">الافتراضي يتبع دور «{ROLE[employee.role]}». المنح والسحب يُطبَّق على هذا الموظف فقط ويُسجَّل.</p>
      <div className="max-h-[55vh] overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {all.map((permission) => (
              <tr key={permission} className="border-b">
                <td className="py-1">{PERMISSION_LABELS[permission] ?? permission}</td>
                <td className="py-1 text-xs text-gray-500">{roleDefault(permission) ? "ضمن الدور" : ""}</td>
                <td className="py-1">
                  <Select aria-label={PERMISSION_LABELS[permission]} value={stateOf(permission)} onChange={(e) => setState(permission, e.target.value)}>
                    <option value="default">حسب الدور</option>
                    <option value="grant">منح</option>
                    <option value="revoke">سحب</option>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorMessage error={save.error} />
      <Button onClick={() => save.mutate()} loading={save.isPending}>حفظ الصلاحيات</Button>
    </div>
  );
}

function NewEmployeeForm({ onCreated }: { onCreated: (password: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("reception");
  const create = useMutation({
    mutationFn: () => post<{ temporaryPassword: string }>("/employees", { name, phone, role }),
    onSuccess: async ({ temporaryPassword }) => {
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
      onCreated(temporaryPassword);
    },
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <Field label="الاسم">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
      <Field label="الجوال (يستخدم لتسجيل الدخول)">{(id) => <Input id={id} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required />}</Field>
      <Field label="الدور">
        {(id) => <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>{Object.entries(ROLE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}
      </Field>
      <ErrorMessage error={create.error} />
      <Button type="submit" loading={create.isPending}>إنشاء الحساب</Button>
    </form>
  );
}

type EmployeeAction = { kind: "reset-password" | "reset-mfa" | "revoke-sessions" | "toggle-active"; employee: Employee };

function EmployeesTab() {
  const me = useMe();
  const queryClient = useQueryClient();
  const employees = useQuery({ queryKey: ["employees"], queryFn: () => get<{ data: Employee[]; permissions: string[] }>("/employees") });
  const [creating, setCreating] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<Employee | null>(null);
  const [action, setAction] = useState<EmployeeAction | null>(null);
  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => patch(`/employees/${id}`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });
  const run = useMutation({
    mutationFn: async ({ kind, employee }: EmployeeAction) => {
      if (kind === "reset-password") return post<{ temporaryPassword: string }>(`/employees/${employee.id}/reset-password`);
      if (kind === "reset-mfa") return post(`/employees/${employee.id}/reset-mfa`);
      if (kind === "revoke-sessions") return post(`/employees/${employee.id}/revoke-sessions`);
      return patch(`/employees/${employee.id}`, { active: !employee.active });
    },
    onSuccess: async (result) => {
      setAction(null);
      const temporary = (result as { temporaryPassword?: string } | undefined)?.temporaryPassword;
      if (temporary) setPassword(temporary);
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
  const titles = { "reset-password": "إعادة تعيين كلمة المرور", "reset-mfa": "إعادة ضبط التحقق بخطوتين", "revoke-sessions": "إنهاء كل الجلسات", "toggle-active": "تغيير حالة الحساب" };

  return (
    <div className="flex flex-col gap-3">
      <div><Button onClick={() => setCreating(true)}>موظف جديد</Button></div>
      <ErrorMessage error={employees.error ?? changeRole.error} />
      {employees.isPending ? <Loading /> : (
        <Table>
          <thead><tr><th className={th}>الموظف</th><th className={th}>الدور</th><th className={th}>الحالة</th><th className={th}>إجراءات</th></tr></thead>
          <tbody>
            {employees.data?.data.map((employee) => (
              <tr key={employee.id}>
                <td className={td}>
                  <div>{employee.name}</div>
                  <div className="text-xs text-gray-500" dir="ltr">{formatPhone(employee.phone)}</div>
                  {(employee.grants.length > 0 || employee.revokes.length > 0) && (
                    <div className="text-xs text-amber-800">صلاحيات مخصصة: +{employee.grants.length} / −{employee.revokes.length}</div>
                  )}
                </td>
                <td className={td}>
                  <Select aria-label="الدور" value={employee.role} disabled={employee.id === me.employee.id}
                    onChange={(e) => changeRole.mutate({ id: employee.id, role: e.target.value as Role })}>
                    {Object.entries(ROLE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    {employee.active ? <Badge tone="success">نشط</Badge> : <Badge tone="muted">معطّل</Badge>}
                    {employee.locked && <Badge tone="danger">مقفل مؤقتاً</Badge>}
                    {employee.totpEnabled && <Badge tone="info">تحقق بخطوتين</Badge>}
                    {employee.mustChangePassword && <Badge tone="warning">كلمة مرور مؤقتة</Badge>}
                  </div>
                </td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" onClick={() => setPermissionsFor(employee)}>الصلاحيات</Button>
                    <Button variant="ghost" onClick={() => setAction({ kind: "reset-password", employee })}>كلمة مرور مؤقتة</Button>
                    {employee.totpEnabled && <Button variant="ghost" onClick={() => setAction({ kind: "reset-mfa", employee })}>إعادة ضبط التحقق</Button>}
                    <Button variant="ghost" onClick={() => setAction({ kind: "revoke-sessions", employee })}>إنهاء الجلسات</Button>
                    {employee.id !== me.employee.id && (
                      <Button variant="ghost" onClick={() => setAction({ kind: "toggle-active", employee })}>{employee.active ? "تعطيل" : "تفعيل"}</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="موظف جديد">
        <NewEmployeeForm onCreated={(temporary) => { setCreating(false); setPassword(temporary); }} />
      </Modal>
      {password && <TemporaryPassword password={password} onClose={() => setPassword(null)} />}
      <Modal open={permissionsFor !== null} onClose={() => setPermissionsFor(null)} title={`صلاحيات ${permissionsFor?.name ?? ""}`} wide>
        {permissionsFor && <PermissionsEditor employee={permissionsFor} all={employees.data?.permissions ?? []} onDone={() => setPermissionsFor(null)} />}
      </Modal>
      <ConfirmDialog
        open={action !== null}
        title={action ? titles[action.kind] : ""}
        message={action && `${action.employee.name}${action.kind === "reset-password" ? " — ستُنهى جلساته الحالية" : ""}`}
        confirmLabel="تأكيد"
        danger={action?.kind !== "toggle-active" || action.employee.active}
        loading={run.isPending}
        error={run.error}
        onClose={() => { setAction(null); run.reset(); }}
        onConfirm={() => action && run.mutate(action)}
      />
    </div>
  );
}

function SettingsTab() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => get<{ data: Settings }>("/settings") });
  const save = useMutation({
    mutationFn: (changes: Partial<Settings>) => patch<{ data: Settings }>("/settings", changes),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
  if (settings.isPending) return <Loading />;
  const data = settings.data?.data;
  if (!data) return <ErrorMessage error={settings.error} />;
  const option = (key: "sessionIdleMinutes" | "draftArchiveDays" | "alertLeadMinutes", label: string, values: number[], unit: string) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={data[key]} onChange={(e) => save.mutate({ [key]: Number(e.target.value) })}>
          {values.map((value) => <option key={value} value={value}>{value} {unit}</option>)}
        </Select>
      )}
    </Field>
  );
  return (
    <Card>
      <div className="grid max-w-xl grid-cols-1 gap-4">
        {option("sessionIdleMinutes", "إنهاء الجلسة بعد عدم النشاط", [15, 30, 60], "دقيقة")}
        {option("draftArchiveDays", "أرشفة المسودات غير النشطة بعد", [15, 30, 60], "يوماً")}
        {option("alertLeadMinutes", "التنبيه قبل موعد الطلب بـ", [30, 60, 120], "دقيقة")}
        <ErrorMessage error={save.error} />
        <p className="text-xs text-gray-500">آخر تعديل: {formatDateTime(data.updatedAt)}. كل تغيير يُسجَّل في سجل التدقيق.</p>
      </div>
    </Card>
  );
}

const ADMIN_ACTIONS: Record<string, string> = {
  ...AUDIT_ACTIONS,
  "auth.login": "تسجيل دخول", "auth.locked": "قفل الحساب", "auth.password_changed": "تغيير كلمة المرور",
  "auth.mfa_enabled": "تفعيل التحقق بخطوتين", "auth.mfa_disabled": "إيقاف التحقق بخطوتين",
  "employee.create": "إنشاء موظف", "employee.update": "تعديل موظف", "employee.permissions": "تغيير الصلاحيات",
  "employee.password_reset": "إعادة تعيين كلمة المرور", "employee.mfa_reset": "إعادة ضبط التحقق", "employee.sessions_revoked": "إنهاء الجلسات",
  "employee.bootstrap_admin": "إنشاء المدير الأول", "settings.update": "تعديل الإعدادات",
  "customer.create": "إضافة عميل", "customer.update": "تعديل عميل", "customer.phone_change": "تغيير جوال عميل",
  "customer.archive": "أرشفة عميل", "customer.restore": "استعادة عميل",
  "product.create": "إضافة منتج", "product.update": "تعديل منتج", "product.price_change": "تغيير سعر منتج",
  "category.create": "إضافة تصنيف", "category.update": "تعديل تصنيف", "package.create": "إضافة باقة", "package.update": "تعديل باقة",
  "driver.create": "إضافة سائق", "driver.update": "تعديل سائق", "kitchen_report.print": "طباعة تقرير المطبخ",
};

function AuditLogTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const log = useQuery({
    queryKey: ["audit", page, action],
    queryFn: () => get<Page<AuditEntry>>("/audit", { page, pageSize: 50, action }),
  });
  return (
    <div className="flex flex-col gap-3">
      <Select aria-label="نوع العملية" className="max-w-xs" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
        <option value="">كل العمليات</option>
        <option value="auth.">الدخول والحسابات</option>
        <option value="employee.">الموظفون والصلاحيات</option>
        <option value="order.">الطلبات</option>
        <option value="payment.">المدفوعات</option>
        <option value="customer.">العملاء</option>
        <option value="product.">المنتجات</option>
        <option value="settings.">الإعدادات</option>
        <option value="kitchen_report.">تقارير المطبخ</option>
      </Select>
      {log.isPending ? <Loading /> : (
        <Table>
          <thead><tr><th className={th}>الوقت</th><th className={th}>الموظف</th><th className={th}>العملية</th><th className={th}>التفاصيل</th></tr></thead>
          <tbody>
            {log.data?.data.map((entry) => (
              <tr key={entry.id}>
                <td className={td}>{formatDateTime(entry.createdAt)}</td>
                <td className={td}>{entry.actor?.name ?? "النظام"}</td>
                <td className={td}>{ADMIN_ACTIONS[entry.action] ?? entry.action}</td>
                <td className={td}>
                  {entry.reason && <div className="text-xs text-amber-800">السبب: {entry.reason}</div>}
                  <AuditChanges entry={entry} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ErrorMessage error={log.error} />
      <div className="flex justify-center gap-3">
        <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>الأحدث</Button>
        <Button variant="secondary" disabled={!log.data || page * 50 >= log.data.pagination.total} onClick={() => setPage(page + 1)}>الأقدم</Button>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const can = useCan();
  const tabs = [
    ...(can("manage_employees") ? [{ id: "employees" as const, label: "الموظفون" }] : []),
    ...(can("manage_settings") ? [{ id: "settings" as const, label: "الإعدادات" }] : []),
    ...(can("view_audit_log") ? [{ id: "audit" as const, label: "سجل التدقيق" }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.id ?? "audit");
  return (
    <div>
      <PageHeader title="الإدارة" />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === "employees" && <EmployeesTab />}
      {tab === "settings" && <SettingsTab />}
      {tab === "audit" && <AuditLogTab />}
    </div>
  );
}
