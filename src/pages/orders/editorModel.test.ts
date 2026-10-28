import { describe, expect, it } from "vitest";
import type { CatalogPackage, Product } from "../../lib/types";
import { emptyState, estimateTotals, lineFromPackage, lineFromProduct, toPayload, validate, type EditorState } from "./editorModel";

const rice: Product = { id: "p1", categoryId: "c1", name: "رز", description: null, price: 5_000, active: true };
const feast: CatalogPackage = {
  id: "k1", name: "وليمة", description: null, guestCount: 20, price: 200_000, active: true,
  items: [{ id: "i1", productId: "p1", quantity: 4, product: { id: "p1", name: "رز", active: true } }],
};

function state(overrides: Partial<EditorState>): EditorState {
  return { ...emptyState(), customer: { id: "c1", name: "محمد", phone: "+966512345678", addresses: [] }, ...overrides };
}

describe("order editor payload", () => {
  it("never sends a unit price the employee did not change, so catalog changes cannot look like overrides", () => {
    const payload = toPayload(state({ lines: [lineFromProduct(rice)] }));
    expect(payload.lines[0]).toEqual({ quantity: 1, notes: null, kind: "product", productId: "p1" });
  });

  it("sends an edited price with its reason", () => {
    const line = { ...lineFromProduct(rice), unitPrice: 4_500, priceEdited: true, priceOverrideReason: "عميل دائم" };
    expect(toPayload(state({ lines: [line] })).lines[0]).toMatchObject({ unitPrice: 4_500, priceOverrideReason: "عميل دائم" });
  });

  it("sends package contents for new packages and only edited contents for existing ones", () => {
    const fresh = lineFromPackage(feast);
    expect(toPayload(state({ lines: [fresh] })).lines[0]).toMatchObject({ components: [{ productId: "p1", quantity: 4 }] });
    const kept = { ...fresh, id: "line-1" };
    expect(toPayload(state({ lines: [kept] })).lines[0]).not.toHaveProperty("components");
    const customised = { ...kept, componentsEdited: true, components: [...kept.components, { productId: null, name: "تمر", quantity: 1 }] };
    expect(toPayload(state({ lines: [customised] })).lines[0]).toMatchObject({
      components: [{ productId: "p1", quantity: 4 }, { name: "تمر", quantity: 1 }],
    });
  });

  it("only sends a discount the employee changed, converting percentages to basis points", () => {
    expect(toPayload(state({ discountType: "percent", discountValue: "10" }))).not.toHaveProperty("discount");
    expect(toPayload(state({ discountType: "percent", discountValue: "12.5", discountReason: "عرض", discountEdited: true })).discount)
      .toEqual({ type: "percent", basisPoints: 1_250, reason: "عرض" });
  });

  it("sends Riyadh schedule times with an explicit offset and drops delivery fields for pickup", () => {
    const payload = toPayload(state({ scheduledAt: "2026-10-30T19:30", fulfillmentType: "pickup", deliveryAddress: "x", deliveryFee: "25" }));
    expect(payload).toMatchObject({ scheduledAt: "2026-10-30T19:30:00+03:00", deliveryAddress: null, deliveryFee: 0 });
  });

  it("estimates totals in halalas", () => {
    expect(estimateTotals(state({ lines: [{ ...lineFromProduct(rice), quantity: 3 }], deliveryFee: "25", discountType: "fixed", discountValue: "10", discountEdited: true })))
      .toEqual({ subtotal: 15_000, discountAmount: 1_000, deliveryFee: 2_500, total: 16_500 });
  });

  it("lists what is missing before confirmation", () => {
    expect(validate(state({ customer: null }), { forConfirm: true }))
      .toEqual(["اختر العميل", "أضف صنفاً واحداً على الأقل", "حدد موعد التسليم", "أدخل عنوان التوصيل"]);
  });
});
