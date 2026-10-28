import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, ErrorMessage, Field, Input, Textarea } from "../../components/ui";
import { ApiError, post } from "../../lib/api";
import type { Customer } from "../../lib/types";

const schema = z.object({
  name: z.string().trim().min(1, "أدخل الاسم").max(120),
  phone: z.string().trim().min(9, "أدخل رقم الجوال"),
  notes: z.string().max(2000).optional(),
  addressLabel: z.string().max(60).optional(),
  addressDetails: z.string().max(500).optional(),
  mapsUrl: z.string().trim().max(1000).refine((value) => !value || value.startsWith("https://"), "يجب أن يبدأ الرابط بـ https://").optional(),
});
type Values = z.infer<typeof schema>;

/** Creates a customer; on a duplicate phone, offers the existing customer instead. */
export default function CustomerForm({ onCreated, onExisting, initialName }: {
  onCreated: (customer: Customer) => void;
  onExisting?: (customerId: string) => void;
  initialName?: string;
}) {
  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema), defaultValues: { name: initialName ?? "" },
  });
  const create = useMutation({
    mutationFn: (values: Values) => post<{ data: Customer }>("/customers", {
      name: values.name, phone: values.phone, notes: values.notes || null,
      ...(values.addressDetails?.trim() ? {
        addresses: [{ label: values.addressLabel?.trim() || "المنزل", details: values.addressDetails.trim(), mapsUrl: values.mapsUrl || null }],
      } : {}),
    }),
    onSuccess: ({ data }) => onCreated(data),
  });
  const existingId = create.error instanceof ApiError && create.error.code === "PHONE_CONFLICT"
    ? (create.error.details as { customerId?: string } | undefined)?.customerId : undefined;

  return (
    <form onSubmit={handleSubmit((values) => create.mutate(values))} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="اسم العميل" error={errors.name?.message}>{(id) => <Input id={id} {...register("name")} />}</Field>
        <Field label="رقم الجوال" error={errors.phone?.message} hint="مثال: 0512345678">
          {(id) => <Input id={id} type="tel" dir="ltr" {...register("phone")} />}
        </Field>
        <Field label="وصف العنوان" hint="مثال: المنزل، قاعة الأفراح">{(id) => <Input id={id} {...register("addressLabel")} />}</Field>
        <Field label="رابط الموقع" error={errors.mapsUrl?.message}>{(id) => <Input id={id} dir="ltr" {...register("mapsUrl")} />}</Field>
        <Field label="العنوان" className="md:col-span-2">{(id) => <Input id={id} {...register("addressDetails")} />}</Field>
        <Field label="ملاحظات" className="md:col-span-2">{(id) => <Textarea id={id} {...register("notes")} />}</Field>
      </div>
      <ErrorMessage error={create.error} />
      {existingId && onExisting && (
        <Button variant="secondary" onClick={() => onExisting(existingId)}>استخدام العميل المسجّل بهذا الرقم</Button>
      )}
      <Button type="submit" loading={create.isPending}>حفظ العميل</Button>
    </form>
  );
}
