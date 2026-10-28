import calculateOrderTotal from "../../utils/calculateOrderTotal";
import { fromRiyadhLocalInput, moneyInputValue, parseMoney, toRiyadhLocalInput } from "../../lib/format";
import type { CatalogPackage, Customer, FulfillmentType, Order, OrderType, Product } from "../../lib/types";

export interface EditorComponent { productId: string | null; name: string; quantity: number }

export interface EditorLine {
  key: string;
  /** Existing line id: keeps the price snapshot taken when it was first added. */
  id?: string;
  kind: "product" | "package" | "custom";
  productId?: string;
  packageId?: string;
  name: string;
  catalogPrice: number | null;
  unitPrice: number;
  /** Set when the employee typed a price; only then is unitPrice sent. */
  priceEdited: boolean;
  priceOverrideReason: string;
  quantity: number;
  notes: string;
  components: EditorComponent[];
  componentsEdited: boolean;
}

export interface EditorState {
  customer: Pick<Customer, "id" | "name" | "phone" | "addresses"> | null;
  orderType: OrderType;
  guestCount: string;
  fulfillmentType: FulfillmentType;
  scheduledAt: string;
  deliveryAddress: string;
  deliveryMapsUrl: string;
  deliveryNotes: string;
  kitchenNotes: string;
  deliveryFee: string;
  discountType: "none" | "fixed" | "percent";
  discountValue: string;
  discountReason: string;
  discountEdited: boolean;
  lines: EditorLine[];
}

let keySeed = 0;
export const newKey = () => `line-${++keySeed}`;

export function emptyState(): EditorState {
  return {
    customer: null, orderType: "individual", guestCount: "", fulfillmentType: "delivery", scheduledAt: "",
    deliveryAddress: "", deliveryMapsUrl: "", deliveryNotes: "", kitchenNotes: "", deliveryFee: "0",
    discountType: "none", discountValue: "", discountReason: "", discountEdited: false, lines: [],
  };
}

export function stateFromOrder(order: Order): EditorState {
  return {
    customer: { id: order.customerId, name: order.customerName, phone: order.customerPhone, addresses: [] },
    orderType: order.orderType,
    guestCount: order.guestCount ? String(order.guestCount) : "",
    fulfillmentType: order.fulfillmentType,
    scheduledAt: toRiyadhLocalInput(order.scheduledAt),
    deliveryAddress: order.deliveryAddress ?? "",
    deliveryMapsUrl: order.deliveryMapsUrl ?? "",
    deliveryNotes: order.deliveryNotes ?? "",
    kitchenNotes: order.kitchenNotes ?? "",
    deliveryFee: moneyInputValue(order.deliveryFee),
    discountType: order.discountType,
    discountValue: order.discountType === "fixed" ? moneyInputValue(order.discountValue)
      : order.discountType === "percent" ? String(order.discountValue / 100) : "",
    discountReason: order.discountReason ?? "",
    discountEdited: false,
    lines: order.lines.map((line) => ({
      key: newKey(),
      id: line.id,
      kind: line.kind,
      productId: line.productId ?? undefined,
      packageId: line.packageId ?? undefined,
      name: line.name,
      catalogPrice: line.catalogPrice,
      unitPrice: line.unitPrice,
      priceEdited: false,
      priceOverrideReason: line.priceOverrideReason ?? "",
      quantity: line.quantity,
      notes: line.notes ?? "",
      components: line.components.map(({ productId, name, quantity }) => ({ productId, name, quantity })),
      componentsEdited: false,
    })),
  };
}

export function lineFromProduct(product: Product): EditorLine {
  return {
    key: newKey(), kind: "product", productId: product.id, name: product.name, catalogPrice: product.price,
    unitPrice: product.price, priceEdited: false, priceOverrideReason: "", quantity: 1, notes: "", components: [], componentsEdited: false,
  };
}

export function lineFromPackage(pkg: CatalogPackage): EditorLine {
  return {
    key: newKey(), kind: "package", packageId: pkg.id, name: pkg.name, catalogPrice: pkg.price, unitPrice: pkg.price,
    priceEdited: false, priceOverrideReason: "", quantity: 1, notes: "",
    components: pkg.items.map((item) => ({ productId: item.productId, name: item.product.name, quantity: item.quantity })),
    componentsEdited: false,
  };
}

export function customLine(): EditorLine {
  return {
    key: newKey(), kind: "custom", name: "", catalogPrice: null, unitPrice: 0, priceEdited: true,
    priceOverrideReason: "", quantity: 1, notes: "", components: [], componentsEdited: false,
  };
}

/** Parses the discount inputs; percent is entered as "10" or "12.5" and sent as basis points. */
export function parseDiscount(state: EditorState): { type: "none" } | { type: "fixed"; amount: number } | { type: "percent"; basisPoints: number } | null {
  if (state.discountType === "none") return { type: "none" };
  if (state.discountType === "fixed") {
    const amount = parseMoney(state.discountValue);
    return amount && amount > 0 ? { type: "fixed", amount } : null;
  }
  const basisPoints = parseMoney(state.discountValue); // Same 2-decimal parsing: "12.5" → 1250.
  return basisPoints && basisPoints > 0 && basisPoints <= 10_000 ? { type: "percent", basisPoints } : null;
}

/** Client-side estimate for display only; the backend computes the authoritative totals. */
export function estimateTotals(state: EditorState) {
  const subtotal = calculateOrderTotal(state.lines);
  const discount = parseDiscount(state);
  let discountAmount = 0;
  if (discount?.type === "fixed") discountAmount = discount.amount;
  if (discount?.type === "percent") discountAmount = Math.floor((subtotal * discount.basisPoints + 5_000) / 10_000);
  const deliveryFee = state.fulfillmentType === "delivery" ? parseMoney(state.deliveryFee) ?? 0 : 0;
  return { subtotal, discountAmount, deliveryFee, total: Math.max(0, subtotal - discountAmount) + deliveryFee };
}

export function toPayload(state: EditorState) {
  const guestCount = state.guestCount.trim() ? Number(state.guestCount) : null;
  const discount = parseDiscount(state);
  return {
    ...(state.customer ? { customerId: state.customer.id } : {}),
    orderType: state.orderType,
    guestCount: Number.isInteger(guestCount) && guestCount! > 0 ? guestCount : null,
    fulfillmentType: state.fulfillmentType,
    scheduledAt: fromRiyadhLocalInput(state.scheduledAt),
    deliveryAddress: state.fulfillmentType === "delivery" ? state.deliveryAddress.trim() || null : null,
    deliveryMapsUrl: state.fulfillmentType === "delivery" ? state.deliveryMapsUrl.trim() || null : null,
    deliveryNotes: state.deliveryNotes.trim() || null,
    kitchenNotes: state.kitchenNotes.trim() || null,
    deliveryFee: state.fulfillmentType === "delivery" ? parseMoney(state.deliveryFee) ?? 0 : 0,
    ...(state.discountEdited && discount ? {
      discount: discount.type === "none" ? discount : { ...discount, reason: state.discountReason.trim() },
    } : {}),
    lines: state.lines.map((line) => {
      const common = { ...(line.id ? { id: line.id } : {}), quantity: line.quantity, notes: line.notes.trim() || null };
      if (line.kind === "custom") return { ...common, kind: "custom" as const, name: line.name.trim(), unitPrice: line.unitPrice };
      const price = line.priceEdited
        ? { unitPrice: line.unitPrice, ...(line.priceOverrideReason.trim() ? { priceOverrideReason: line.priceOverrideReason.trim() } : {}) }
        : {};
      if (line.kind === "product") return { ...common, kind: "product" as const, productId: line.productId!, ...price };
      return {
        ...common, kind: "package" as const, packageId: line.packageId!, ...price,
        ...(line.componentsEdited || !line.id ? {
          components: line.components.map((component) => component.productId
            ? { productId: component.productId, quantity: component.quantity }
            : { name: component.name, quantity: component.quantity }),
        } : {}),
      };
    }),
  };
}

/** Problems the employee can fix before saving; the server validates again regardless. */
export function validate(state: EditorState, options: { forConfirm: boolean }) {
  const problems: string[] = [];
  if (!state.customer) problems.push("اختر العميل");
  for (const line of state.lines) {
    if (line.kind === "custom" && !line.name.trim()) problems.push("أدخل اسم الصنف المخصص");
    if (line.priceEdited && line.kind !== "custom" && line.unitPrice !== line.catalogPrice && line.priceOverrideReason.trim().length < 3) {
      problems.push(`اكتب سبب تعديل سعر "${line.name}"`);
    }
    if (line.kind === "package" && line.components.length === 0) problems.push(`الباقة "${line.name}" فارغة`);
  }
  if (state.discountEdited && state.discountType !== "none") {
    if (!parseDiscount(state)) problems.push("قيمة الخصم غير صحيحة");
    if (state.discountReason.trim().length < 3) problems.push("اكتب سبب الخصم");
  }
  if (state.fulfillmentType === "delivery" && parseMoney(state.deliveryFee) === null) problems.push("رسوم التوصيل غير صحيحة");
  if (options.forConfirm) {
    if (state.lines.length === 0) problems.push("أضف صنفاً واحداً على الأقل");
    if (!state.scheduledAt) problems.push("حدد موعد التسليم");
    if (state.fulfillmentType === "delivery" && !state.deliveryAddress.trim()) problems.push("أدخل عنوان التوصيل");
  }
  return problems;
}
