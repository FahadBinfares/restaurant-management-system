import { recordAudit } from "../../audit.js";
import type { Permission } from "../../auth/permissions.js";
import type { Tx } from "../../context.js";
import { computeTotals, lineTotal, paymentStatus, type DiscountInput } from "../../domain/pricing.js";
import { formatOrderNumber, riyadhYear } from "../../domain/time.js";
import { EDITABLE_STATUSES, SCHEDULE_LOCKED_STATUSES } from "../../domain/workflow.js";
import type { Order, OrderLine, OrderLineComponent } from "../../generated/prisma/client.js";
import { AppError, conflict, forbidden, notFound } from "../../http/errors.js";
import type { DiscountInputBody, LineInput, OrderFieldsInput } from "./schemas.js";

export type LineWithComponents = OrderLine & { components: OrderLineComponent[] };
export type LockedOrder = Order & { lines: LineWithComponents[] };

export interface Actor {
  id: string;
  has(permission: Permission): boolean;
}

function require(actor: Actor, permission: Permission) {
  if (!actor.has(permission)) throw forbidden();
}

/** Row-locks the order for the rest of the transaction, serialising edits, payments, and delivery changes. */
export async function lockOrder(tx: Tx, id: string): Promise<LockedOrder> {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Order" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (locked.length === 0) throw notFound("Order");
  return tx.order.findUniqueOrThrow({
    where: { id },
    include: { lines: { orderBy: { position: "asc" }, include: { components: { orderBy: { position: "asc" } } } } },
  });
}

export function assertVersion(order: Order, version: number) {
  if (order.version !== version) {
    throw conflict("VERSION_CONFLICT", "This order was changed by someone else; reload to see the latest version", {
      currentVersion: order.version,
    });
  }
}

export async function nextOrderNumber(tx: Tx, now: Date) {
  const year = riyadhYear(now);
  const [row] = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "OrderSequence" ("year", "lastValue") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "lastValue" = "OrderSequence"."lastValue" + 1
    RETURNING "lastValue"`;
  return formatOrderNumber(year, row!.lastValue);
}

interface BuiltLine {
  id?: string;
  kind: LineInput["kind"];
  productId: string | null;
  packageId: string | null;
  name: string;
  catalogPrice: number | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  priceOverrideReason: string | null;
  notes: string | null;
  components: { productId: string | null; name: string; quantity: number }[];
}

export interface PriceOverride {
  name: string;
  catalogPrice: number | null;
  unitPrice: number;
  reason: string | null;
}

/**
 * Turns submitted lines into snapshot rows. Existing lines (matched by id) keep the
 * name and catalog price captured when they were first added; only new lines read
 * the current catalog. Changing a price away from the catalog needs override_order_price.
 */
export async function buildLines(tx: Tx, inputs: LineInput[], existing: LineWithComponents[], actor: Actor) {
  const existingById = new Map(existing.map((line) => [line.id, line]));
  const productIds = new Set<string>();
  const packageIds = new Set<string>();
  for (const input of inputs) {
    if (input.kind === "product") productIds.add(input.productId);
    if (input.kind === "package") {
      packageIds.add(input.packageId);
      for (const component of input.components ?? []) if (component.productId) productIds.add(component.productId);
    }
  }
  const products = new Map((await tx.product.findMany({ where: { id: { in: [...productIds] } } })).map((p) => [p.id, p]));
  const packages = new Map((await tx.package.findMany({
    where: { id: { in: [...packageIds] } },
    include: { items: { orderBy: { position: "asc" }, include: { product: true } } },
  })).map((p) => [p.id, p]));

  const overrides: PriceOverride[] = [];
  const seenIds = new Set<string>();
  const built: BuiltLine[] = inputs.map((input) => {
    const previous = input.id ? existingById.get(input.id) : undefined;
    if (input.id) {
      if (!previous || seenIds.has(input.id)) throw new AppError(400, "INVALID_LINE", "Unknown or duplicate line id");
      seenIds.add(input.id);
      const sameItem = previous.kind === input.kind
        && (input.kind !== "product" || previous.productId === input.productId)
        && (input.kind !== "package" || previous.packageId === input.packageId);
      if (!sameItem) throw new AppError(400, "INVALID_LINE", "A kept line cannot change its item; remove it and add a new line");
    }

    const resolveComponent = (component: { productId?: string; name?: string; quantity: number }) => {
      if (!component.productId) return { productId: null, name: component.name!, quantity: component.quantity };
      const product = products.get(component.productId);
      if (!product) throw notFound("Product");
      return { productId: product.id, name: product.name, quantity: component.quantity };
    };

    let name: string;
    let catalogPrice: number | null;
    let components: BuiltLine["components"] = [];
    if (input.kind === "custom") {
      name = input.name;
      catalogPrice = null;
    } else if (previous) {
      name = previous.name;
      catalogPrice = previous.catalogPrice;
    } else if (input.kind === "product") {
      const product = products.get(input.productId);
      if (!product) throw notFound("Product");
      if (!product.active) throw new AppError(422, "PRODUCT_INACTIVE", `"${product.name}" is no longer available`);
      name = product.name;
      catalogPrice = product.price;
    } else {
      const catalogPackage = packages.get(input.packageId);
      if (!catalogPackage) throw notFound("Package");
      if (!catalogPackage.active) throw new AppError(422, "PACKAGE_INACTIVE", `"${catalogPackage.name}" is no longer available`);
      name = catalogPackage.name;
      catalogPrice = catalogPackage.price;
    }
    if (input.kind === "package") {
      if (input.components) {
        components = input.components.map(resolveComponent);
      } else if (previous) {
        components = previous.components.map(({ productId, name: componentName, quantity: q }) => ({ productId, name: componentName, quantity: q }));
      } else {
        components = packages.get(input.packageId)!.items
          .map((item) => ({ productId: item.productId, name: item.product.name, quantity: item.quantity }));
      }
    }

    const unitPrice = input.unitPrice ?? previous?.unitPrice ?? catalogPrice!;
    const priceChanged = !previous || previous.unitPrice !== unitPrice || previous.name !== name;
    let priceOverrideReason: string | null = null;
    if (input.kind === "custom") {
      // Custom items carry an employee-entered price, so they need the override permission.
      if (priceChanged) {
        require(actor, "override_order_price");
        overrides.push({ name, catalogPrice: null, unitPrice, reason: null });
      }
    } else if (unitPrice !== catalogPrice) {
      priceOverrideReason = input.priceOverrideReason ?? previous?.priceOverrideReason ?? null;
      if (priceChanged) {
        require(actor, "override_order_price");
        if (!input.priceOverrideReason) {
          throw new AppError(400, "OVERRIDE_REASON_REQUIRED", `A reason is required to change the price of "${name}"`);
        }
        priceOverrideReason = input.priceOverrideReason;
        overrides.push({ name, catalogPrice, unitPrice, reason: priceOverrideReason });
      }
    }
    return {
      id: previous?.id,
      kind: input.kind,
      productId: input.kind === "product" ? input.productId : null,
      packageId: input.kind === "package" ? input.packageId : null,
      name, catalogPrice, unitPrice,
      quantity: input.quantity,
      lineTotal: lineTotal({ unitPrice, quantity: input.quantity }),
      priceOverrideReason,
      notes: input.notes === undefined ? previous?.notes ?? null : input.notes,
      components,
    };
  });
  return { lines: built, overrides };
}

export async function replaceLines(tx: Tx, orderId: string, lines: BuiltLine[]) {
  await tx.orderLine.deleteMany({ where: { orderId } });
  for (const [position, { components, ...line }] of lines.entries()) {
    await tx.orderLine.create({
      data: {
        ...line, orderId, position,
        components: { create: components.map((component, index) => ({ ...component, position: index })) },
      },
    });
  }
}

function toDiscount(type: Order["discountType"], value: number): DiscountInput {
  if (type === "fixed") return { type, amount: value };
  if (type === "percent") return { type, basisPoints: value };
  return { type: "none" };
}

function discountColumns(input: DiscountInputBody) {
  if (input.type === "fixed") return { discountType: "fixed" as const, discountValue: input.amount, discountReason: input.reason };
  if (input.type === "percent") return { discountType: "percent" as const, discountValue: input.basisPoints, discountReason: input.reason };
  return { discountType: "none" as const, discountValue: 0, discountReason: null };
}

const linesSummary = (lines: { name: string; quantity: number; unitPrice: number; components?: { name: string; quantity: number }[] }[]) =>
  lines.map((line) => ({
    name: line.name, quantity: line.quantity, unitPrice: line.unitPrice,
    ...(line.components?.length ? { components: line.components.map((c) => `${c.name} × ${c.quantity}`) } : {}),
  }));

const AUDITED_FIELDS = [
  "orderType", "customerId", "guestCount", "fulfillmentType", "scheduledAt", "deliveryAddress", "deliveryMapsUrl",
  "deliveryNotes", "kitchenNotes", "deliveryFee", "discountType", "discountValue", "discountReason",
  "subtotal", "discountAmount", "total",
] as const;

/**
 * Applies create/update input to an order inside a transaction. `current` is the
 * locked order for updates, or null for a new draft.
 */
export async function applyOrderInput(
  tx: Tx,
  input: Omit<OrderFieldsInput, "version"> & { customerId?: string },
  current: LockedOrder | null,
  actor: Actor,
  now: Date,
  options: { clientRequestId?: string } = {},
) {
  const status = current?.status ?? "draft";
  if (current) {
    if (!EDITABLE_STATUSES.includes(status)) throw conflict("ORDER_LOCKED", "Completed and cancelled orders cannot be edited");
    if (current.archivedAt) throw conflict("ORDER_ARCHIVED", "Restore this draft before editing it");
  }
  require(actor, status === "draft" ? "create_orders" : "edit_confirmed_orders");

  // Customer snapshot.
  const customerId = input.customerId ?? current?.customerId;
  let customerSnapshot: { customerName: string; customerPhone: string } | undefined;
  let customerAddresses: { id: string; details: string; mapsUrl: string | null }[] = [];
  if (!current || input.customerId !== undefined || input.addressId) {
    const customer = await tx.customer.findUnique({ where: { id: customerId! }, include: { addresses: { where: { archivedAt: null } } } });
    if (!customer) throw notFound("Customer");
    if (customer.archivedAt && customer.id !== current?.customerId) throw conflict("CUSTOMER_ARCHIVED", "This customer is archived");
    customerSnapshot = { customerName: customer.name, customerPhone: customer.phone };
    customerAddresses = customer.addresses;
  }

  // Address snapshot from a saved address, unless explicit text was supplied.
  let deliveryAddress = input.deliveryAddress;
  let deliveryMapsUrl = input.deliveryMapsUrl;
  if (input.addressId) {
    const address = customerAddresses.find((row) => row.id === input.addressId);
    if (!address) throw notFound("Address");
    deliveryAddress ??= address.details;
    deliveryMapsUrl ??= address.mapsUrl;
  }

  // Schedule: after preparation starts, moving it requires override_order_schedule.
  const scheduleChanged = input.scheduledAt !== undefined
    && (input.scheduledAt?.getTime() ?? null) !== (current?.scheduledAt?.getTime() ?? null);
  if (current && scheduleChanged && SCHEDULE_LOCKED_STATUSES.includes(status)) require(actor, "override_order_schedule");
  if (status !== "draft" && input.scheduledAt === null) throw new AppError(400, "SCHEDULE_REQUIRED", "Confirmed orders need a scheduled time");

  // Fulfillment and delivery state stay consistent.
  const fulfillmentType = input.fulfillmentType ?? current?.fulfillmentType ?? "delivery";
  let deliveryState: { deliveryStatus?: "unassigned" | null; driverId?: null; deliveryFailureReason?: null } = {};
  if (!current || fulfillmentType !== current.fulfillmentType) {
    if (current && ["out_for_delivery", "delivered"].includes(current.deliveryStatus ?? "")) {
      throw conflict("DELIVERY_IN_PROGRESS", "Delivery is already under way");
    }
    deliveryState = fulfillmentType === "pickup"
      ? { deliveryStatus: null, driverId: null, deliveryFailureReason: null }
      : { deliveryStatus: "unassigned" };
  }

  // Discount changes always need permission and a reason.
  let discount = current ? toDiscount(current.discountType, current.discountValue) : { type: "none" } as DiscountInput;
  let discountData: ReturnType<typeof discountColumns> | undefined;
  if (input.discount) {
    const next = discountColumns(input.discount);
    const changed = !current || next.discountType !== current.discountType || next.discountValue !== current.discountValue;
    if (changed && !(next.discountType === "none" && !current)) {
      require(actor, "apply_discount");
      discountData = next;
      discount = toDiscount(next.discountType, next.discountValue);
    }
  }

  // Lines and totals.
  const built = input.lines ? await buildLines(tx, input.lines, current?.lines ?? [], actor) : undefined;
  const pricedLines = built?.lines ?? current?.lines ?? [];
  const deliveryFee = fulfillmentType === "pickup" ? 0 : input.deliveryFee ?? current?.deliveryFee ?? 0;
  let totals;
  try {
    totals = computeTotals(pricedLines, discount, deliveryFee, current?.vatRateBp);
  } catch (error) {
    if (error instanceof RangeError) throw new AppError(422, "INVALID_TOTALS", "Discount cannot exceed the items subtotal");
    throw error;
  }

  const data = {
    orderType: input.orderType,
    customerId,
    ...customerSnapshot,
    guestCount: input.guestCount,
    fulfillmentType,
    scheduledAt: input.scheduledAt,
    deliveryAddress: fulfillmentType === "pickup" ? null : deliveryAddress,
    deliveryMapsUrl: fulfillmentType === "pickup" ? null : deliveryMapsUrl,
    deliveryNotes: input.deliveryNotes,
    kitchenNotes: input.kitchenNotes,
    ...deliveryState,
    ...discountData,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    vatAmount: totals.vatAmount,
    paymentStatus: paymentStatus(totals.total, current?.paidAmount ?? 0),
    updatedById: actor.id,
  };

  let order: Order;
  if (current) {
    order = await tx.order.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } });
  } else {
    order = await tx.order.create({
      data: {
        ...data,
        customerId: customerId!,
        customerName: customerSnapshot!.customerName,
        customerPhone: customerSnapshot!.customerPhone,
        number: await nextOrderNumber(tx, now),
        clientRequestId: options.clientRequestId,
        createdById: actor.id,
        deliveryStatus: fulfillmentType === "delivery" ? "unassigned" : null,
      },
    });
  }
  if (built) await replaceLines(tx, order.id, built.lines);

  // Audit: field-level diff plus explicit entries for price overrides and discounts.
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const field of AUDITED_FIELDS) {
    const previous = current?.[field] ?? null;
    const next = order[field] ?? null;
    const same = previous instanceof Date && next instanceof Date ? previous.getTime() === next.getTime() : previous === next;
    if (!same) { before[field] = previous; after[field] = next; }
  }
  if (built) {
    const previousLines = JSON.stringify(linesSummary(current?.lines ?? []));
    const nextLines = linesSummary(built.lines);
    if (previousLines !== JSON.stringify(nextLines)) {
      before.lines = current ? linesSummary(current.lines) : [];
      after.lines = nextLines;
    }
  }
  const action = !current ? "order.create" : status === "draft" ? "order.update_draft" : "order.edit_confirmed";
  if (!current || Object.keys(after).length > 0) {
    await recordAudit(tx, { actorId: actor.id, action, entityType: "order", entityId: order.id, before: current ? before : undefined, after });
  }
  for (const override of built?.overrides ?? []) {
    await recordAudit(tx, {
      actorId: actor.id, action: "order.price_override", entityType: "order", entityId: order.id,
      before: { name: override.name, catalogPrice: override.catalogPrice }, after: { unitPrice: override.unitPrice },
      reason: override.reason,
    });
  }
  if (discountData) {
    await recordAudit(tx, {
      actorId: actor.id, action: "order.discount", entityType: "order", entityId: order.id,
      before: current ? { type: current.discountType, value: current.discountValue } : undefined,
      after: { type: discountData.discountType, value: discountData.discountValue },
      reason: discountData.discountReason,
    });
  }
  return order;
}

export { linesSummary };
