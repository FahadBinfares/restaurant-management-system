import { useState } from "react";
import { useCan } from "../../auth/hooks";
import { Button, Input, Select } from "../../components/ui";
import { formatMoney, moneyInputValue, parseMoney } from "../../lib/format";
import type { CatalogPackage, Product } from "../../lib/types";
import { customLine, lineFromPackage, lineFromProduct, type EditorLine } from "./editorModel";

function PriceEditor({ line, onChange }: { line: EditorLine; onChange: (patch: Partial<EditorLine>) => void }) {
  const can = useCan();
  const [text, setText] = useState(moneyInputValue(line.unitPrice));
  const [editing, setEditing] = useState(line.kind === "custom");
  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <span>{formatMoney(line.unitPrice)}</span>
        {can("override_order_price") && (
          <button type="button" className="text-xs text-secondary underline" onClick={() => setEditing(true)}>تعديل السعر</button>
        )}
      </div>
    );
  }
  const parsed = parseMoney(text);
  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label="سعر الوحدة"
        dir="ltr"
        inputMode="decimal"
        className={parsed === null ? "border-red-500" : ""}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const value = parseMoney(event.target.value);
          if (value !== null) onChange({ unitPrice: value, priceEdited: true });
        }}
      />
      {line.kind !== "custom" && line.unitPrice !== line.catalogPrice && (
        <Input
          aria-label="سبب تعديل السعر"
          placeholder="سبب تعديل السعر (إلزامي)"
          value={line.priceOverrideReason}
          onChange={(event) => onChange({ priceOverrideReason: event.target.value })}
        />
      )}
    </div>
  );
}

function ComponentsEditor({ line, products, onChange }: {
  line: EditorLine; products: Product[]; onChange: (patch: Partial<EditorLine>) => void;
}) {
  const [extra, setExtra] = useState("");
  const update = (components: EditorLine["components"]) => onChange({ components, componentsEdited: true });
  return (
    <div className="mt-2 rounded-lg bg-main/30 p-2">
      <div className="mb-1 text-xs font-medium text-Text">محتويات الباقة لهذا الطلب (التعديل لا يغيّر الباقة الأصلية)</div>
      <ul className="flex flex-col gap-1">
        {line.components.map((component, index) => (
          <li key={index} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{component.name}</span>
            <Input
              aria-label={`كمية ${component.name}`}
              type="number"
              min={1}
              className="w-20"
              value={component.quantity}
              onChange={(event) => {
                const quantity = Math.max(1, Math.floor(Number(event.target.value) || 1));
                update(line.components.map((c, i) => (i === index ? { ...c, quantity } : c)));
              }}
            />
            <button type="button" className="text-xs text-red-700" onClick={() => update(line.components.filter((_, i) => i !== index))}>حذف</button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Select aria-label="إضافة منتج للباقة" value="" onChange={(event) => {
          const product = products.find((p) => p.id === event.target.value);
          if (product) update([...line.components, { productId: product.id, name: product.name, quantity: 1 }]);
        }}>
          <option value="">+ إضافة منتج للباقة</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </Select>
        <Input placeholder="أو صنف بالاسم" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="صنف إضافي بالاسم" />
        <Button variant="secondary" disabled={!extra.trim()} onClick={() => {
          update([...line.components, { productId: null, name: extra.trim(), quantity: 1 }]);
          setExtra("");
        }}>إضافة</Button>
      </div>
    </div>
  );
}

export default function LinesEditor({ lines, products, packages, onChange }: {
  lines: EditorLine[]; products: Product[]; packages: CatalogPackage[]; onChange: (lines: EditorLine[]) => void;
}) {
  const can = useCan();
  const patchLine = (key: string, patch: Partial<EditorLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <div className="flex flex-col gap-3">
      {lines.length === 0 && <p className="text-sm text-gray-600">لم تُضف أصناف بعد.</p>}
      {lines.map((line) => (
        <div key={line.key} className="rounded-xl border border-Text/15 bg-white p-3">
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[1fr_6rem_12rem_8rem_auto]">
            <div>
              {line.kind === "custom" ? (
                <Input aria-label="اسم الصنف المخصص" placeholder="اسم الصنف المخصص" value={line.name}
                  onChange={(e) => patchLine(line.key, { name: e.target.value })} />
              ) : <div className="font-medium">{line.name}</div>}
              <div className="text-xs text-gray-500">
                {line.kind === "package" ? "باقة" : line.kind === "custom" ? "صنف مخصص" : "منتج"}
                {line.id && line.catalogPrice !== null && " · السعر محفوظ من وقت الإضافة"}
              </div>
            </div>
            <Input
              aria-label={`كمية ${line.name}`}
              type="number"
              min={1}
              value={line.quantity}
              onChange={(e) => patchLine(line.key, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            />
            <PriceEditor line={line} onChange={(patch) => patchLine(line.key, patch)} />
            <div className="pt-2 font-medium">{formatMoney(line.unitPrice * line.quantity)}</div>
            <Button variant="ghost" onClick={() => onChange(lines.filter((l) => l.key !== line.key))} aria-label={`حذف ${line.name}`}>حذف</Button>
          </div>
          <Input
            className="mt-2"
            placeholder="ملاحظة على هذا الصنف (اختياري)"
            aria-label="ملاحظة الصنف"
            value={line.notes}
            onChange={(e) => patchLine(line.key, { notes: e.target.value })}
          />
          {line.kind === "package" && (
            <ComponentsEditor line={line} products={products} onChange={(patch) => patchLine(line.key, patch)} />
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Select aria-label="إضافة منتج" className="max-w-xs" value="" onChange={(event) => {
          const product = products.find((p) => p.id === event.target.value);
          if (product) onChange([...lines, lineFromProduct(product)]);
        }}>
          <option value="">+ إضافة منتج</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>{product.category?.name ? `${product.category.name} — ` : ""}{product.name} ({formatMoney(product.price)})</option>
          ))}
        </Select>
        <Select aria-label="إضافة باقة" className="max-w-xs" value="" onChange={(event) => {
          const pkg = packages.find((p) => p.id === event.target.value);
          if (pkg) onChange([...lines, lineFromPackage(pkg)]);
        }}>
          <option value="">+ إضافة باقة</option>
          {packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name} ({formatMoney(pkg.price)})</option>)}
        </Select>
        {can("override_order_price") && <Button variant="secondary" onClick={() => onChange([...lines, customLine()])}>+ صنف مخصص</Button>}
      </div>
    </div>
  );
}
