import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";
import { ME_QUERY_KEY, useMe } from "../auth/hooks";
import { Badge, Button, Card, ErrorMessage, Field, Input, Loading, PageHeader, Table, td, th } from "../components/ui";
import { del, get, post } from "../lib/api";
import { formatDateTime } from "../lib/format";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "أدخل كلمة المرور الحالية"),
  newPassword: z.string().min(10, "10 أحرف على الأقل"),
  confirm: z.string(),
}).refine((values) => values.newPassword === values.confirm, { path: ["confirm"], message: "كلمتا المرور غير متطابقتين" });

function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
  });
  const change = useMutation({
    mutationFn: (values: z.infer<typeof passwordSchema>) =>
      post("/auth/password", { currentPassword: values.currentPassword, newPassword: values.newPassword }),
    onSuccess: async () => {
      reset();
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      onDone?.();
    },
  });
  return (
    <form onSubmit={handleSubmit((values) => change.mutate(values))} className="flex max-w-sm flex-col gap-3" noValidate>
      <Field label="كلمة المرور الحالية" error={errors.currentPassword?.message}>
        {(id) => <Input id={id} type="password" autoComplete="current-password" {...register("currentPassword")} />}
      </Field>
      <Field label="كلمة المرور الجديدة" error={errors.newPassword?.message} hint="10 أحرف على الأقل">
        {(id) => <Input id={id} type="password" autoComplete="new-password" {...register("newPassword")} />}
      </Field>
      <Field label="تأكيد كلمة المرور" error={errors.confirm?.message}>
        {(id) => <Input id={id} type="password" autoComplete="new-password" {...register("confirm")} />}
      </Field>
      <ErrorMessage error={change.error} />
      {change.isSuccess && <p className="text-sm text-green-700">تم تغيير كلمة المرور، وتم إنهاء الجلسات الأخرى.</p>}
      <Button type="submit" loading={change.isPending}>حفظ كلمة المرور</Button>
    </form>
  );
}

function MfaSetup({ onDone }: { onDone?: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const setup = useMutation({ mutationFn: () => post<{ data: { secret: string; uri: string } }>("/auth/mfa/setup") });
  const enable = useMutation({
    mutationFn: () => post("/auth/mfa/enable", { code }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      onDone?.();
    },
  });
  if (!setup.data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-gray-700">استخدم تطبيق مصادقة مثل Google Authenticator أو Microsoft Authenticator.</p>
        <ErrorMessage error={setup.error} />
        <Button onClick={() => setup.mutate()} loading={setup.isPending}>بدء التفعيل</Button>
      </div>
    );
  }
  return (
    <div className="flex max-w-md flex-col gap-3">
      <p className="text-sm text-gray-700">أضف حساباً جديداً في التطبيق وأدخل هذا المفتاح يدوياً (نوع: حسب الوقت):</p>
      <code dir="ltr" className="select-all rounded-lg bg-main p-3 text-center font-mono text-lg tracking-widest">
        {setup.data.data.secret.match(/.{1,4}/g)?.join(" ")}
      </code>
      <Field label="الرمز المكون من 6 أرقام">
        {(id) => <Input id={id} dir="ltr" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.trim())} />}
      </Field>
      <ErrorMessage error={enable.error} />
      <Button onClick={() => enable.mutate()} loading={enable.isPending} disabled={code.length !== 6}>تفعيل</Button>
    </div>
  );
}

/** Forced first-login flow: temporary password change, then administrator MFA enrolment. */
export function AccountSetupPage() {
  const me = useMe();
  const navigate = useNavigate();
  const done = () => navigate("/", { replace: true });
  return (
    <div className="mx-auto max-w-lg py-8">
      {me.setupRequired === "PASSWORD_CHANGE_REQUIRED" && (
        <Card title="غيّر كلمة المرور المؤقتة">
          <p className="mb-4 text-sm text-gray-700">قبل المتابعة اختر كلمة مرور جديدة خاصة بك.</p>
          <ChangePasswordForm />
        </Card>
      )}
      {me.setupRequired === "MFA_SETUP_REQUIRED" && (
        <Card title="فعّل التحقق بخطوتين">
          <p className="mb-4 text-sm text-gray-700">حسابات المدراء تتطلب التحقق بخطوتين لحماية بيانات المطعم.</p>
          <MfaSetup onDone={done} />
        </Card>
      )}
      {!me.setupRequired && <Button onClick={done}>متابعة</Button>}
    </div>
  );
}

interface SessionRow { id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; ipAddress: string | null; current: boolean }

export default function AccountPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["auth", "sessions"], queryFn: () => get<{ data: SessionRow[] }>("/auth/sessions") });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/auth/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] }),
  });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="حسابي" />
      <Card title="كلمة المرور"><ChangePasswordForm /></Card>
      <Card title="التحقق بخطوتين">
        {me.employee.totpEnabled ? <Badge tone="success">مفعّل</Badge> : <MfaSetup />}
      </Card>
      <Card title="الجلسات النشطة">
        {sessions.isPending ? <Loading /> : (
          <Table>
            <thead><tr><th className={th}>الجهاز</th><th className={th}>بدأت</th><th className={th}>آخر نشاط</th><th className={th} /></tr></thead>
            <tbody>
              {sessions.data?.data.map((session) => (
                <tr key={session.id}>
                  <td className={td}><span className="line-clamp-1 text-xs" dir="ltr">{session.userAgent ?? "—"}</span></td>
                  <td className={td}>{formatDateTime(session.createdAt)}</td>
                  <td className={td}>{formatDateTime(session.lastSeenAt)}</td>
                  <td className={td}>
                    {session.current ? <Badge tone="info">هذا الجهاز</Badge> : (
                      <Button variant="ghost" onClick={() => revoke.mutate(session.id)}>إنهاء</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <ErrorMessage error={sessions.error ?? revoke.error} />
      </Card>
    </div>
  );
}
