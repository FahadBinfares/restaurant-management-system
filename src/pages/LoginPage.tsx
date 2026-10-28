import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import logo from "../assets/App-Logo.png";
import { ME_QUERY_KEY, useMeQuery } from "../auth/hooks";
import { Button, ErrorMessage, Field, Input, Loading } from "../components/ui";
import { ApiError, post } from "../lib/api";
import type { Me } from "../lib/types";

const schema = z.object({
  phone: z.string().trim().min(9, "أدخل رقم الجوال"),
  password: z.string().min(1, "أدخل كلمة المرور"),
  totpCode: z.string().trim().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { data: me, isPending } = useMeQuery();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [needsMfa, setNeedsMfa] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const login = useMutation({
    mutationFn: (values: FormValues) => post<{ data: Me }>("/auth/login", {
      phone: values.phone, password: values.password, ...(needsMfa && values.totpCode ? { totpCode: values.totpCode } : {}),
    }),
    onSuccess: ({ data }) => {
      queryClient.setQueryData(ME_QUERY_KEY, data);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(data.setupRequired ? "/account/setup" : from ?? "/", { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "MFA_REQUIRED") setNeedsMfa(true);
    },
  });

  if (isPending) return <Loading />;
  if (me) return <Navigate to="/" replace />;
  const visibleError = login.error instanceof ApiError && login.error.code === "MFA_REQUIRED" ? null : login.error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-primary p-4">
      <form
        onSubmit={handleSubmit((values) => login.mutate(values))}
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-8 shadow-lg"
        noValidate
      >
        <img src={logo} alt="شعار المطعم" className="mx-auto h-24 object-contain" />
        <h1 className="text-center text-xl font-bold text-Text">تسجيل دخول الموظفين</h1>
        <Field label="رقم الجوال" error={errors.phone?.message}>
          {(id) => <Input id={id} type="tel" inputMode="tel" autoComplete="username" dir="ltr" placeholder="05XXXXXXXX" {...register("phone")} />}
        </Field>
        <Field label="كلمة المرور" error={errors.password?.message}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" {...register("password")} />}
        </Field>
        {needsMfa && (
          <Field label="رمز التحقق (تطبيق المصادقة)">
            {(id) => <Input id={id} inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} autoFocus {...register("totpCode")} />}
          </Field>
        )}
        <ErrorMessage error={visibleError} />
        <Button type="submit" loading={login.isPending}>دخول</Button>
      </form>
    </div>
  );
}
