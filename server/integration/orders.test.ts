import { randomUUID } from "node:crypto";
import type { Agent } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveStaleDrafts } from "../src/modules/drafts.js";
import { createConfirmedOrder, riyadhTime, seedCatalog, seedCustomer } from "./fixtures.js";
import { createHarness, type Harness } from "./harness.js";

let h: Harness;
let admin: Agent;
let reception: Agent;
let operations: Agent;
let catalog: Awaited<ReturnType<typeof seedCatalog>>;

beforeAll(async () => {
  h = await createHarness();
  h.setNow(new Date("2026-10-28T09:00:00Z"));
  admin = (await h.signIn("admin")).agent;
  reception = (await h.signIn("reception")).agent;
  operations = (await h.signIn("operations")).agent;
  catalog = await seedCatalog(h);
});
afterAll(async () => { await h?.cleanup(); });

async function draft(agent: Agent, extra: Record<string, unknown> = {}) {
  const customer = await seedCustomer(h);
  const response = await agent.post("/api/orders").send({
    customerId: customer.id,
    scheduledAt: riyadhTime(h, 19),
    addressId: customer.addresses[0]!.id,
    lines: [{ kind: "product", productId: catalog.rice.id, quantity: 2 }],
    ...extra,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data;
}

describe("order creation", () => {
  it("assigns a sequential, unique order number in the backend and computes totals there", async () => {
    const first = await draft(reception, { deliveryFee: 2_500 });
    const second = await draft(reception);
    expect(first.number).toMatch(/^ORD-2026-\d{4}$/);
    expect(Number(second.number.slice(-4))).toBe(Number(first.number.slice(-4)) + 1);
    expect(first).toMatchObject({ status: "draft", subtotal: 10_000, deliveryFee: 2_500, total: 12_500, vatAmount: 1_630 });
    expect(first.deliveryAddress).toBe("الرياض، حي الملقا");
    expect(first.deliveryStatus).toBe("unassigned");
  });

  it("rejects client-supplied totals or order numbers", async () => {
    const customer = await seedCustomer(h);
    await reception.post("/api/orders").send({ customerId: customer.id, total: 1 }).expect(400);
    await reception.post("/api/orders").send({ customerId: customer.id, number: "ORD-2026-9999" }).expect(400);
  });

  it("treats duplicate submissions with the same idempotency key as one order", async () => {
    const customer = await seedCustomer(h);
    const key = randomUUID();
    const body = { customerId: customer.id, lines: [{ kind: "product", productId: catalog.rice.id, quantity: 1 }] };
    const responses = await Promise.all([1, 2, 3].map(() => reception.post("/api/orders").set("Idempotency-Key", key).send(body)));
    const ids = new Set(responses.map((response) => response.body.data.id));
    expect(ids.size).toBe(1);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);
    expect(await h.db.order.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it("restarts numbering each Riyadh calendar year", async () => {
    h.setNow(new Date("2026-12-31T21:30:00Z")); // 00:30 on 1 January 2027 in Riyadh.
    try {
      // A fresh session: the shared ones would hit their absolute expiry after this clock jump.
      const { agent } = await h.signIn("reception");
      const order = await draft(agent, { scheduledAt: "2027-01-02T12:00:00+03:00" });
      expect(order.number).toBe("ORD-2027-0001");
    } finally {
      h.setNow(new Date("2026-10-28T09:00:00Z"));
    }
  });

  it("forbids order creation without create_orders", async () => {
    const customer = await seedCustomer(h);
    await operations.post("/api/orders").send({ customerId: customer.id }).expect(403);
  });
});

describe("pricing integrity", () => {
  it("keeps historical prices when catalog prices change", async () => {
    const order = await draft(reception);
    await admin.patch(`/api/catalog/products/${catalog.rice.id}`).send({ price: 6_000 }).expect(200);
    try {
      const reloaded = await reception.get(`/api/orders/${order.id}`).expect(200);
      expect(reloaded.body.data.lines[0]).toMatchObject({ unitPrice: 5_000, catalogPrice: 5_000 });
      // Editing while keeping the line by id preserves its snapshot; a new line uses today's price.
      const edited = await reception.patch(`/api/orders/${order.id}`).send({
        version: order.version,
        lines: [
          { id: order.lines[0].id, kind: "product", productId: catalog.rice.id, quantity: 3 },
          { kind: "product", productId: catalog.rice.id, quantity: 1 },
        ],
      }).expect(200);
      expect(edited.body.data.lines.map((line: { unitPrice: number }) => line.unitPrice)).toEqual([5_000, 6_000]);
      expect(edited.body.data.subtotal).toBe(21_000);
    } finally {
      await h.db.product.update({ where: { id: catalog.rice.id }, data: { price: 5_000 } });
    }
  });

  it("keeps deactivated products on existing orders but refuses them on new lines", async () => {
    const order = await draft(reception);
    await admin.patch(`/api/catalog/products/${catalog.rice.id}`).send({ active: false }).expect(200);
    try {
      expect((await reception.get(`/api/orders/${order.id}`)).body.data.lines[0].name).toBe("رز");
      const response = await reception.patch(`/api/orders/${order.id}`).send({
        version: order.version, lines: [{ kind: "product", productId: catalog.rice.id, quantity: 1 }],
      });
      expect(response.body.error.code).toBe("PRODUCT_INACTIVE");
    } finally {
      await h.db.product.update({ where: { id: catalog.rice.id }, data: { active: true } });
    }
  });

  it("customizes a package per order without modifying the catalog package", async () => {
    const order = await draft(reception, {
      orderType: "banquet", guestCount: 25,
      lines: [{
        kind: "package", packageId: catalog.feast.id, quantity: 1,
        components: [
          { productId: catalog.lamb.id, quantity: 2 },
          { productId: catalog.salad.id, quantity: 5 },
          { name: "تمر سكري", quantity: 1 },
        ],
      }],
    });
    expect(order.lines[0]).toMatchObject({ kind: "package", unitPrice: 200_000, name: catalog.feast.name });
    expect(order.lines[0].components.map((c: { name: string; quantity: number }) => [c.name, c.quantity]))
      .toEqual([["خروف كامل", 2], ["سلطة", 5], ["تمر سكري", 1]]);
    const catalogItems = await h.db.packageItem.findMany({ where: { packageId: catalog.feast.id }, orderBy: { position: "asc" } });
    expect(catalogItems.map((item) => [item.productId, item.quantity])).toEqual([[catalog.lamb.id, 1], [catalog.rice.id, 4]]);
  });

  it("uses catalog package contents by default", async () => {
    const order = await draft(reception, { lines: [{ kind: "package", packageId: catalog.feast.id, quantity: 1 }] });
    expect(order.lines[0].components.map((c: { name: string }) => c.name)).toEqual(["خروف كامل", "رز"]);
  });

  it("requires override_order_price and a reason to change a price, and audits it", async () => {
    const customer = await seedCustomer(h);
    const body = (reason?: string) => ({
      customerId: customer.id,
      lines: [{ kind: "package", packageId: catalog.feast.id, quantity: 1, unitPrice: 180_000, priceOverrideReason: reason }],
    });
    await reception.post("/api/orders").send(body("عميل دائم")).expect(403);
    const missingReason = await admin.post("/api/orders").send(body());
    expect(missingReason.body.error.code).toBe("OVERRIDE_REASON_REQUIRED");
    const created = await admin.post("/api/orders").send(body("عميل دائم")).expect(201);
    expect(created.body.data.lines[0]).toMatchObject({ unitPrice: 180_000, catalogPrice: 200_000, priceOverrideReason: "عميل دائم" });
    const audit = await h.db.auditLog.findFirstOrThrow({ where: { action: "order.price_override", entityId: created.body.data.id } });
    expect(audit.reason).toBe("عميل دائم");
    expect(audit.after).toEqual({ unitPrice: 180_000 });
    // Later edits by staff without the permission keep the override intact.
    const edited = await reception.patch(`/api/orders/${created.body.data.id}`).send({
      version: created.body.data.version, kitchenNotes: "بدون بصل",
      lines: [{ id: created.body.data.lines[0].id, kind: "package", packageId: catalog.feast.id, quantity: 1 }],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.data.lines[0].unitPrice).toBe(180_000);
  });

  it("requires override_order_price for custom items", async () => {
    const customer = await seedCustomer(h);
    const body = { customerId: customer.id, lines: [{ kind: "custom", name: "كيكة خاصة", unitPrice: 25_000, quantity: 1 }] };
    await reception.post("/api/orders").send(body).expect(403);
    const created = await admin.post("/api/orders").send(body).expect(201);
    expect(created.body.data.lines[0]).toMatchObject({ kind: "custom", catalogPrice: null, lineTotal: 25_000 });
  });

  it("requires apply_discount and a reason, and never discounts beyond the subtotal", async () => {
    const order = await draft(reception);
    const discount = { type: "percent", basisPoints: 1_000, reason: "عرض افتتاح" };
    await reception.patch(`/api/orders/${order.id}`).send({ version: order.version, discount }).expect(403);
    await admin.patch(`/api/orders/${order.id}`).send({ version: order.version, discount: { type: "percent", basisPoints: 1_000 } }).expect(400);
    const discounted = await admin.patch(`/api/orders/${order.id}`).send({ version: order.version, discount }).expect(200);
    expect(discounted.body.data).toMatchObject({ subtotal: 10_000, discountAmount: 1_000, total: 9_000 });
    const tooMuch = await admin.patch(`/api/orders/${order.id}`)
      .send({ version: discounted.body.data.version, discount: { type: "fixed", amount: 10_001, reason: "خطأ" } });
    expect(tooMuch.body.error.code).toBe("INVALID_TOTALS");
    expect(await h.db.auditLog.count({ where: { action: "order.discount", entityId: order.id } })).toBe(1);
  });
});

describe("confirmation and workflow", () => {
  it("lists exactly what is missing before confirmation", async () => {
    const customer = await seedCustomer(h);
    const empty = await reception.post("/api/orders").send({ customerId: customer.id }).expect(201);
    const response = await reception.post(`/api/orders/${empty.body.data.id}/confirm`).send({ version: 1 });
    expect(response.status).toBe(422);
    expect(response.body.error.details.problems).toEqual(["lines", "scheduledAt", "deliveryAddress"]);
  });

  it("confirms without payment and snapshots pricing in the audit trail", async () => {
    const order = await draft(reception);
    const confirmed = await reception.post(`/api/orders/${order.id}/confirm`).send({ version: order.version }).expect(200);
    expect(confirmed.body.data).toMatchObject({ status: "confirmed", paymentStatus: "unpaid", version: order.version + 1 });
    const audit = await h.db.auditLog.findFirstOrThrow({ where: { action: "order.confirm", entityId: order.id } });
    expect(audit.after).toMatchObject({ total: 10_000, lines: [{ name: "رز", quantity: 2, unitPrice: 5_000 }] });
  });

  it("rejects stale concurrent edits instead of overwriting them", async () => {
    const order = await draft(reception);
    const [a, b] = await Promise.all([
      reception.patch(`/api/orders/${order.id}`).send({ version: order.version, kitchenNotes: "A" }),
      admin.patch(`/api/orders/${order.id}`).send({ version: order.version, kitchenNotes: "B" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error).toMatchObject({ code: "VERSION_CONFLICT", details: { currentVersion: order.version + 1 } });
    const winnerNote = a.status === 200 ? "A" : "B";
    expect((await reception.get(`/api/orders/${order.id}`)).body.data.kitchenNotes).toBe(winnerNote);
  });

  it("enforces the status machine and its permissions", async () => {
    const order = await createConfirmedOrder(h, reception, { ...(await draftBody()) });
    await reception.post(`/api/orders/${order.id}/status`).send({ version: order.version, status: "preparing" }).expect(403);
    const skip = await operations.post(`/api/orders/${order.id}/status`).send({ version: order.version, status: "ready" });
    expect(skip.body.error.code).toBe("INVALID_TRANSITION");
    const preparing = await operations.post(`/api/orders/${order.id}/status`).send({ version: order.version, status: "preparing" }).expect(200);
    const back = await operations.post(`/api/orders/${order.id}/status`).send({ version: preparing.body.data.version, status: "confirmed" });
    expect(back.body.error.code).toBe("REASON_REQUIRED");
    const ready = await operations.post(`/api/orders/${order.id}/status`)
      .send({ version: preparing.body.data.version, status: "ready" }).expect(200);
    const completed = await operations.post(`/api/orders/${order.id}/status`)
      .send({ version: ready.body.data.version, status: "completed" }).expect(200);
    expect(completed.body.data.completedAt).not.toBeNull();
    const locked = await admin.patch(`/api/orders/${order.id}`).send({ version: completed.body.data.version, kitchenNotes: "x" });
    expect(locked.body.error.code).toBe("ORDER_LOCKED");
  });

  it("requires override_order_schedule to move an order once preparation started", async () => {
    const order = await createConfirmedOrder(h, reception, await draftBody());
    const moved = await reception.patch(`/api/orders/${order.id}`)
      .send({ version: order.version, scheduledAt: riyadhTime(h, 20) }).expect(200);
    const preparing = await operations.post(`/api/orders/${order.id}/status`)
      .send({ version: moved.body.data.version, status: "preparing" }).expect(200);
    await reception.patch(`/api/orders/${order.id}`)
      .send({ version: preparing.body.data.version, scheduledAt: riyadhTime(h, 21) }).expect(403);
    await admin.patch(`/api/orders/${order.id}`)
      .send({ version: preparing.body.data.version, scheduledAt: riyadhTime(h, 21) }).expect(200);
    const audit = await h.db.auditLog.findMany({ where: { action: "order.edit_confirmed", entityId: order.id } });
    expect(audit.some((row) => (row.before as Record<string, unknown>).scheduledAt !== undefined)).toBe(true);
  });

  it("cancels only with permission and a reason, without refunding automatically", async () => {
    const order = await createConfirmedOrder(h, reception, await draftBody());
    await reception.post(`/api/orders/${order.id}/cancel`).send({ version: order.version, reason: "طلب العميل" }).expect(403);
    await admin.post(`/api/orders/${order.id}/cancel`).send({ version: order.version }).expect(400);
    const cancelled = await admin.post(`/api/orders/${order.id}/cancel`).send({ version: order.version, reason: "طلب العميل" }).expect(200);
    expect(cancelled.body.data).toMatchObject({ status: "cancelled", cancelReason: "طلب العميل" });
  });

  it("archives inactive drafts automatically and restores them with permission", async () => {
    const order = await draft(reception);
    await h.db.order.update({ where: { id: order.id }, data: { updatedAt: new Date(h.context.now().getTime() - 31 * 86_400_000) } });
    expect(await archiveStaleDrafts(h.context)).toBeGreaterThanOrEqual(1);
    const archived = (await reception.get(`/api/orders/${order.id}`)).body.data;
    expect(archived.archivedAt).not.toBeNull();
    expect((await reception.get("/api/orders").query({ q: order.number })).body.data).toEqual([]);
    await reception.patch(`/api/orders/${order.id}`).send({ version: archived.version, kitchenNotes: "x" }).expect(409);
    await reception.post(`/api/orders/${order.id}/restore`).send({ version: archived.version }).expect(403);
    await admin.post(`/api/orders/${order.id}/restore`).send({ version: archived.version }).expect(200);
  });
});

async function draftBody() {
  const customer = await seedCustomer(h);
  return {
    customerId: customer.id, scheduledAt: riyadhTime(h, 13), addressId: customer.addresses[0]!.id,
    lines: [{ kind: "product", productId: catalog.lamb.id, quantity: 1 }],
  };
}

describe("order list", () => {
  it("searches by number, customer name, and phone, and filters by date, status, and fulfillment", async () => {
    const customer = await seedCustomer(h, "فهد المطيري");
    const evening = await reception.post("/api/orders").send({
      customerId: customer.id, scheduledAt: riyadhTime(h, 21, 0, 5), fulfillmentType: "pickup",
      lines: [{ kind: "product", productId: catalog.rice.id, quantity: 1 }],
    }).expect(201);
    const morning = await reception.post("/api/orders").send({
      customerId: customer.id, scheduledAt: riyadhTime(h, 8, 0, 5), addressId: customer.addresses[0]!.id,
      lines: [{ kind: "product", productId: catalog.rice.id, quantity: 1 }],
    }).expect(201);
    const numbers = async (query: Record<string, string>) =>
      (await reception.get("/api/orders").query(query)).body.data.map((o: { number: string }) => o.number);

    expect(await numbers({ q: evening.body.data.number })).toEqual([evening.body.data.number]);
    expect(await numbers({ q: "المطيري" })).toEqual([morning.body.data.number, evening.body.data.number]);
    expect(await numbers({ q: `0${customer.phone.slice(4)}` })).toHaveLength(2);
    const date = riyadhTime(h, 0, 0, 5).slice(0, 10);
    expect(await numbers({ date, fulfillmentType: "pickup" })).toEqual([evening.body.data.number]);
    expect(await numbers({ date, status: "confirmed" })).toEqual([]);
    expect(await numbers({ date, status: "draft,confirmed" })).toHaveLength(2);
  });

  it("hides payment details and payment filters from staff without view_payments", async () => {
    const list = await operations.get("/api/orders").expect(200);
    expect(list.body.data[0]).not.toHaveProperty("paidAmount");
    expect(list.body.data[0]).not.toHaveProperty("paymentStatus");
    await operations.get("/api/orders?paymentStatus=unpaid").expect(403);
    const visible = await reception.get("/api/orders").expect(200);
    expect(visible.body.data[0]).toHaveProperty("paymentStatus");
  });

  it("returns an order's audit history", async () => {
    const order = await draft(reception);
    const history = await reception.get(`/api/orders/${order.id}/audit`).expect(200);
    expect(history.body.data[0]).toMatchObject({ action: "order.create", actor: { name: expect.any(String) } });
  });
});
