import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Can } from "../../auth/auth";
import { Button, Input, Modal, Spinner } from "../../components/ui";
import { useDebouncedValue } from "../../lib/hooks";
import { get } from "../../lib/api";
import { formatPhone } from "../../lib/format";
import type { Customer, Page } from "../../lib/types";
import CustomerForm from "../customers/CustomerForm";

export default function CustomerPicker({ value, onChange, disabled }: {
  value: Pick<Customer, "id" | "name" | "phone"> | null;
  onChange: (customer: Customer) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const query = useDebouncedValue(search.trim(), 300);
  const results = useQuery({
    queryKey: ["customers", { q: query, pageSize: 8 }],
    queryFn: () => get<Page<Customer>>("/customers", { q: query, pageSize: 8 }),
    enabled: query.length >= 2,
  });
  const selectById = async (id: string) => {
    onChange((await get<{ data: Customer }>(`/customers/${id}`)).data);
    setCreating(false);
  };

  if (value && disabled) {
    return <div className="rounded-lg bg-main/40 px-3 py-2">{value.name} — <span dir="ltr">{formatPhone(value.phone)}</span></div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {value && (
        <div className="flex items-center justify-between rounded-lg bg-Light-green px-3 py-2">
          <span>{value.name} — <span dir="ltr">{formatPhone(value.phone)}</span></span>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          type="search"
          placeholder={value ? "تغيير العميل: ابحث بالاسم أو الجوال" : "ابحث بالاسم أو رقم الجوال"}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="بحث عن عميل"
        />
        <Can permission="manage_customers">
          <Button variant="secondary" onClick={() => setCreating(true)}>عميل جديد</Button>
        </Can>
      </div>
      {query.length >= 2 && (
        <div className="rounded-lg border border-Text/15 bg-white">
          {results.isPending ? <div className="p-3"><Spinner small /></div> : results.data?.data.length === 0 ? (
            <p className="p-3 text-sm text-gray-600">لا يوجد عميل بهذا الاسم أو الرقم.</p>
          ) : (
            <ul>
              {results.data?.data.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between px-3 py-2 text-right text-sm hover:bg-main/40"
                    onClick={() => { onChange(customer); setSearch(""); }}
                  >
                    <span>{customer.name}</span>
                    <span dir="ltr" className="text-gray-600">{formatPhone(customer.phone)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="عميل جديد" wide>
        <CustomerForm
          initialName={/\d/.test(search) ? "" : search}
          onCreated={(customer) => { onChange(customer); setCreating(false); setSearch(""); }}
          onExisting={selectById}
        />
      </Modal>
    </div>
  );
}
