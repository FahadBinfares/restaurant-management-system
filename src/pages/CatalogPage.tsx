import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card, ErrorMessage, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Textarea, td, th } from "../components/ui";
import { get, patch, post } from "../lib/api";
import { formatMoney, moneyInputValue, parseMoney } from "../lib/format";
import type { CatalogPackage, Category, Product } from "../lib/types";

function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["catalog"] });
}

function CategoriesTab() {
  const invalidate = useInvalidateCatalog();
  const categories = useQuery({ queryKey: ["catalog", "categories", "all"], queryFn: () => get<{ data: Category[] }>("/catalog/categories", { includeInactive: true }) });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => post("/catalog/categories", { name, sortOrder: categories.data?.data.length ?? 0 }),
    onSuccess: async () => { setName(""); await invalidate(); },
  });
  const toggle = useMutation({
    mutationFn: (category: Category) => patch(`/catalog/categories/${category.id}`, { active: !category.active }),
    onSuccess: invalidate,
  });
  return (
    <div className="flex flex-col gap-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Input aria-label="اسم التصنيف" placeholder="تصنيف جديد" value={name} onChange={(e) => setName(e.target.value)} required className="max-w-xs" />
        <Button type="submit" loading={create.isPending}>إضافة</Button>
      </form>
      <ErrorMessage error={create.error ?? toggle.error} />
      {categories.isPending ? <Loading /> : (
        <Table>
          <thead><tr><th className={th}>التصنيف</th><th className={th}>الحالة</th><th className={th} /></tr></thead>
          <tbody>
            {categories.data?.data.map((category) => (
              <tr key={category.id}>
                <td className={td}>{category.name}</td>
                <td className={td}>{category.active ? <Badge tone="success">نشط</Badge> : <Badge tone="muted">مخفي</Badge>}</td>
                <td className={td}><Button variant="ghost" onClick={() => toggle.mutate(category)}>{category.active ? "إخفاء" : "إظهار"}</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function ProductForm({ product, categories, onDone }: { product?: Product; categories: Category[]; onDone: () => void }) {
  const invalidate = useInvalidateCatalog();
  const [name, setName] = useState(product?.name ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [price, setPrice] = useState(product ? moneyInputValue(product.price) : "");
  const [description, setDescription] = useState(product?.description ?? "");
  const parsed = parseMoney(price);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, categoryId, price: parsed, description: description || null };
      return product ? patch(`/catalog/products/${product.id}`, body) : post("/catalog/products", body);
    },
    onSuccess: async () => { await invalidate(); onDone(); },
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (parsed !== null) save.mutate(); }}>
      <Field label="اسم المنتج">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
      <Field label="التصنيف">
        {(id) => <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
      </Field>
      <Field label="سعر البيع شامل الضريبة (ر.س)" error={price && parsed === null ? "سعر غير صحيح" : undefined}
        hint={product ? "تغيير السعر لا يؤثر على الطلبات السابقة" : undefined}>
        {(id) => <Input id={id} dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />}
      </Field>
      <Field label="الوصف">{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <ErrorMessage error={save.error} />
      <Button type="submit" loading={save.isPending} disabled={parsed === null}>حفظ</Button>
    </form>
  );
}

function ProductsTab() {
  const invalidate = useInvalidateCatalog();
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const products = useQuery({ queryKey: ["catalog", "products", "all"], queryFn: () => get<{ data: Product[] }>("/catalog/products", { includeInactive: true }) });
  const categories = useQuery({ queryKey: ["catalog", "categories", "all"], queryFn: () => get<{ data: Category[] }>("/catalog/categories", { includeInactive: true }) });
  const toggle = useMutation({
    mutationFn: (product: Product) => patch(`/catalog/products/${product.id}`, { active: !product.active }),
    onSuccess: invalidate,
  });
  return (
    <div className="flex flex-col gap-3">
      <div><Button onClick={() => setEditing("new")} disabled={!categories.data?.data.length}>منتج جديد</Button></div>
      <ErrorMessage error={products.error ?? toggle.error} />
      {products.isPending ? <Loading /> : (
        <Table>
          <thead><tr><th className={th}>المنتج</th><th className={th}>التصنيف</th><th className={th}>السعر</th><th className={th}>الحالة</th><th className={th} /></tr></thead>
          <tbody>
            {products.data?.data.map((product) => (
              <tr key={product.id}>
                <td className={td}>{product.name}</td>
                <td className={td}>{product.category?.name}</td>
                <td className={td}>{formatMoney(product.price)}</td>
                <td className={td}>{product.active ? <Badge tone="success">متاح</Badge> : <Badge tone="muted">غير متاح</Badge>}</td>
                <td className={td}>
                  <Button variant="ghost" onClick={() => setEditing(product)}>تعديل</Button>
                  <Button variant="ghost" onClick={() => toggle.mutate(product)}>{product.active ? "إيقاف" : "تفعيل"}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "منتج جديد" : "تعديل المنتج"}>
        {editing && <ProductForm product={editing === "new" ? undefined : editing} categories={categories.data?.data ?? []} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function PackageForm({ pkg, products, onDone }: { pkg?: CatalogPackage; products: Product[]; onDone: () => void }) {
  const invalidate = useInvalidateCatalog();
  const [name, setName] = useState(pkg?.name ?? "");
  const [price, setPrice] = useState(pkg ? moneyInputValue(pkg.price) : "");
  const [guestCount, setGuestCount] = useState(pkg?.guestCount ? String(pkg.guestCount) : "");
  const [description, setDescription] = useState(pkg?.description ?? "");
  const [items, setItems] = useState(pkg?.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) ?? []);
  const parsed = parseMoney(price);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, price: parsed, guestCount: guestCount ? Number(guestCount) : null, description: description || null, items };
      return pkg ? patch(`/catalog/packages/${pkg.id}`, body) : post("/catalog/packages", body);
    },
    onSuccess: async () => { await invalidate(); onDone(); },
  });
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? "منتج غير متاح";
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (parsed !== null && items.length) save.mutate(); }}>
      <Field label="اسم الباقة">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="السعر شامل الضريبة (ر.س)">{(id) => <Input id={id} dir="ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />}</Field>
        <Field label="عدد الأشخاص">{(id) => <Input id={id} type="number" min={1} value={guestCount} onChange={(e) => setGuestCount(e.target.value)} />}</Field>
      </div>
      <Field label="الوصف">{(id) => <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      <div>
        <div className="mb-1 text-sm font-medium text-Text">المحتويات</div>
        <ul className="mb-2 flex flex-col gap-1">
          {items.map((item, index) => (
            <li key={item.productId} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{productName(item.productId)}</span>
              <Input type="number" min={1} className="w-20" aria-label="الكمية" value={item.quantity}
                onChange={(e) => setItems(items.map((it, i) => i === index ? { ...it, quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : it))} />
              <button type="button" className="text-xs text-red-700" onClick={() => setItems(items.filter((_, i) => i !== index))}>حذف</button>
            </li>
          ))}
        </ul>
        <Select aria-label="إضافة منتج" value="" onChange={(e) => {
          if (e.target.value && !items.some((item) => item.productId === e.target.value)) setItems([...items, { productId: e.target.value, quantity: 1 }]);
        }}>
          <option value="">+ إضافة منتج</option>
          {products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <p className="text-xs text-gray-600">تعديل الباقة لا يغيّر الطلبات التي أُضيفت إليها مسبقاً.</p>
      <ErrorMessage error={save.error} />
      <Button type="submit" loading={save.isPending} disabled={parsed === null || items.length === 0}>حفظ</Button>
    </form>
  );
}

function PackagesTab() {
  const invalidate = useInvalidateCatalog();
  const [editing, setEditing] = useState<CatalogPackage | "new" | null>(null);
  const packages = useQuery({ queryKey: ["catalog", "packages", "all"], queryFn: () => get<{ data: CatalogPackage[] }>("/catalog/packages", { includeInactive: true }) });
  const products = useQuery({ queryKey: ["catalog", "products", "all"], queryFn: () => get<{ data: Product[] }>("/catalog/products", { includeInactive: true }) });
  const toggle = useMutation({
    mutationFn: (pkg: CatalogPackage) => patch(`/catalog/packages/${pkg.id}`, { active: !pkg.active }),
    onSuccess: invalidate,
  });
  return (
    <div className="flex flex-col gap-3">
      <div><Button onClick={() => setEditing("new")}>باقة جديدة</Button></div>
      <ErrorMessage error={packages.error ?? toggle.error} />
      {packages.isPending ? <Loading /> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {packages.data?.data.map((pkg) => (
            <Card key={pkg.id} title={pkg.name} actions={pkg.active ? <Badge tone="success">متاحة</Badge> : <Badge tone="muted">غير متاحة</Badge>}>
              <p className="text-sm">{formatMoney(pkg.price)}{pkg.guestCount && ` · ${pkg.guestCount} شخص`}</p>
              <ul className="my-2 text-sm text-gray-700">{pkg.items.map((item) => <li key={item.id}>• {item.product.name} × {item.quantity}</li>)}</ul>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setEditing(pkg)}>تعديل</Button>
                <Button variant="ghost" onClick={() => toggle.mutate(pkg)}>{pkg.active ? "إيقاف" : "تفعيل"}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "باقة جديدة" : "تعديل الباقة"} wide>
        {editing && <PackageForm pkg={editing === "new" ? undefined : editing} products={products.data?.data ?? []} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

export default function CatalogPage() {
  const [tab, setTab] = useState<"products" | "packages" | "categories">("products");
  return (
    <div>
      <PageHeader title="المنتجات والباقات" />
      <Tabs tabs={[{ id: "products", label: "المنتجات" }, { id: "packages", label: "الباقات" }, { id: "categories", label: "التصنيفات" }]} active={tab} onChange={setTab} />
      {tab === "products" && <ProductsTab />}
      {tab === "packages" && <PackagesTab />}
      {tab === "categories" && <CategoriesTab />}
    </div>
  );
}
