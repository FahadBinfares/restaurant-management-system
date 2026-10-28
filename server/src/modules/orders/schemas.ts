import { z } from "zod";
import { httpsUrl, isoDate, optionalText, pageQuery } from "../../http/schemas.js";
import { halalas } from "../catalog.js";

const quantity = z.number().int().min(1).max(100_000);
const reason = z.string().trim().min(3).max(500);

const component = z.strictObject({
  productId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  quantity,
}).refine((value) => Boolean(value.productId) !== Boolean(value.name), "Give either productId or name");

const lineBase = {
  /** Existing line to keep (its price snapshot is preserved). */
  id: z.uuid().optional(),
  quantity,
  notes: optionalText(1000),
};

export const lineInput = z.discriminatedUnion("kind", [
  z.strictObject({
    ...lineBase,
    kind: z.literal("product"),
    productId: z.uuid(),
    unitPrice: halalas.optional(),
    priceOverrideReason: reason.optional(),
  }),
  z.strictObject({
    ...lineBase,
    kind: z.literal("package"),
    packageId: z.uuid(),
    unitPrice: halalas.optional(),
    priceOverrideReason: reason.optional(),
    /** Order-specific contents; omitted = catalog contents (new line) or unchanged (existing line). */
    components: z.array(component).min(1).max(100).optional(),
  }),
  z.strictObject({
    ...lineBase,
    kind: z.literal("custom"),
    name: z.string().trim().min(1).max(120),
    unitPrice: halalas,
  }),
]);
export type LineInput = z.infer<typeof lineInput>;

export const discountInput = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none") }),
  z.strictObject({ type: z.literal("fixed"), amount: halalas.min(1), reason }),
  z.strictObject({ type: z.literal("percent"), basisPoints: z.number().int().min(1).max(10_000), reason }),
]);
export type DiscountInputBody = z.infer<typeof discountInput>;

/** ISO 8601 with an explicit offset, so the browser's timezone can never shift a schedule. */
const scheduledAt = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const orderFields = {
  orderType: z.enum(["banquet", "individual"]).optional(),
  guestCount: z.number().int().min(1).max(100_000).nullable().optional(),
  fulfillmentType: z.enum(["delivery", "pickup"]).optional(),
  scheduledAt: scheduledAt.nullable().optional(),
  /** Copies a saved customer address into the order (snapshot). */
  addressId: z.uuid().optional(),
  deliveryAddress: optionalText(500),
  deliveryMapsUrl: httpsUrl.nullable().optional(),
  deliveryNotes: optionalText(1000),
  kitchenNotes: optionalText(2000),
  deliveryFee: halalas.optional(),
  discount: discountInput.optional(),
  lines: z.array(lineInput).max(200).optional(),
};

export const createOrderInput = z.strictObject({ ...orderFields, customerId: z.uuid() });
export const updateOrderInput = z.strictObject({ ...orderFields, customerId: z.uuid().optional(), version: z.number().int().min(1) });
export type OrderFieldsInput = z.infer<typeof updateOrderInput>;

export const versionInput = z.strictObject({ version: z.number().int().min(1) });
export const statusInput = z.strictObject({
  version: z.number().int().min(1),
  status: z.enum(["confirmed", "preparing", "ready", "completed"]),
  reason: reason.optional(),
});
export const cancelInput = z.strictObject({ version: z.number().int().min(1), reason });

const csv = <T extends string>(values: readonly [T, ...T[]]) => z.string().max(200)
  .transform((value) => value.split(",").filter(Boolean))
  .pipe(z.array(z.enum(values)).min(1));

export const listOrdersQuery = z.strictObject({
  ...pageQuery,
  q: z.string().trim().max(120).optional(),
  date: isoDate.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: csv(["draft", "confirmed", "preparing", "ready", "completed", "cancelled"]).optional(),
  paymentStatus: csv(["unpaid", "partially_paid", "paid"]).optional(),
  deliveryStatus: csv(["unassigned", "assigned", "out_for_delivery", "delivered", "failed"]).optional(),
  fulfillmentType: z.enum(["delivery", "pickup"]).optional(),
  orderType: z.enum(["banquet", "individual"]).optional(),
  customerId: z.uuid().optional(),
  driverId: z.uuid().optional(),
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
});
