import { randomUUID } from "node:crypto";
import type { Agent } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createConfirmedOrder, riyadhTime, seedCatalog, seedCustomer } from "./fixtures.js";
import { createHarness, type Harness } from "./harness.js";

let h: Harness;
let admin: Agent;
let reception: Agent;
let operations: Agent;
let catalog: Awaited<ReturnType<typeof seedCatalog>>;

beforeAll(async () => {
  h = await createHarness();
  h.setNow(new Date("2026-10-28T06:00:00Z")); // 09:00 Riyadh
  admin = (await h.signIn("admin")).agent;
  reception = (await h.signIn("reception")).agent;
  operations = (await h.signIn("operations")).agent;
  catalog = await seedCatalog(h);
});
afterAll(async () => { await h?.cleanup(); });

/** A confirmed delivery order for 100.00 SAR (two rice at 50.00). */
async function confirmed(options: { hour?: number; dayOffset?: number; pickup?: boolean } = {}) {
  const customer = await seedCustomer(h);
  return createConfirmedOrder(h, reception, {
    customerId: customer.id,
    scheduledAt: riyadhTime(h, options.hour ?? 19, 0, options.dayOffset ?? 1),
    ...(options.pickup ? { fulfillmentType: "pickup" } : { addressId: customer.addresses[0]!.id }),
    lines: [{ kind: "product", productId: catalog.rice.id, quantity: 2 }],
  });
}

describe("payments", () => {
  it("records partial and full payments and derives the payment status", async () => {
    const order = await confirmed();
    const pay = (amount: number) => reception.post(`/api/orders/${order.id}/payments`).send({ method: "cash", amount });
    expect((await pay(4_000)).status).toBe(201);
    let summary = (await reception.get(`/api/orders/${order.id}/payments`)).body.summary;
    expect(summary).toEqual({ total: 10_000, paidAmount: 4_000, paymentStatus: "partially_paid", balance: 6_000 });
    const tooMuch = await pay(6_001);
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error).toMatchObject({ code: "AMOUNT_EXCEEDS_BALANCE", details: { balance: 6_000 } });
    expect((await pay(6_000)).status).toBe(201);
    summary = (await reception.get(`/api/orders/${order.id}/payments`)).body.summary;
    expect(summary.paymentStatus).toBe("paid");
  });

  it("refuses payments on drafts and never overpays under concurrent submissions", async () => {
    const customer = await seedCustomer(h);
    const draftOrder = await reception.post("/api/orders").send({ customerId: customer.id }).expect(201);
    const draftPay = await reception.post(`/api/orders/${draftOrder.body.data.id}/payments`).send({ method: "cash", amount: 100 });
    expect(draftPay.body.error.code).toBe("ORDER_NOT_CONFIRMED");

    const order = await confirmed();
    const results = await Promise.all([1, 2, 3].map(() =>
      reception.post(`/api/orders/${order.id}/payments`).send({ method: "card_pos", amount: 10_000 })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 422, 422]);
    expect((await h.db.order.findUniqueOrThrow({ where: { id: order.id } })).paidAmount).toBe(10_000);
  });

  it("is idempotent for a repeated client request id", async () => {
    const order = await confirmed();
    const body = { method: "bank_transfer", amount: 2_000, reference: "TRX-1", clientRequestId: randomUUID() };
    const first = await reception.post(`/api/orders/${order.id}/payments`).send(body).expect(201);
    const second = await reception.post(`/api/orders/${order.id}/payments`).send(body).expect(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await h.db.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("corrects mistakes by voiding with a reason, keeping the ledger intact", async () => {
    const order = await confirmed();
    const payment = await reception.post(`/api/orders/${order.id}/payments`).send({ method: "cash", amount: 10_000 }).expect(201);
    await reception.post(`/api/payments/${payment.body.data.id}/void`).send({ reason: "مبلغ خاطئ" }).expect(403);
    const voided = await admin.post(`/api/payments/${payment.body.data.id}/void`).send({ reason: "مبلغ خاطئ" }).expect(200);
    expect(voided.body.data).toMatchObject({ voidReason: "مبلغ خاطئ", voidedBy: { id: expect.any(String) } });
    await admin.post(`/api/payments/${payment.body.data.id}/void`).send({ reason: "مرة أخرى" }).expect(409);
    const stored = await h.db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored).toMatchObject({ paidAmount: 0, paymentStatus: "unpaid" });
    expect(await h.db.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await h.db.auditLog.count({ where: { action: "payment.void", entityId: order.id } })).toBe(1);
  });

  it("blocks deleting or rewriting payment rows at the database level", async () => {
    const order = await confirmed();
    const payment = await reception.post(`/api/orders/${order.id}/payments`).send({ method: "cash", amount: 1_000 }).expect(201);
    await expect(h.db.payment.delete({ where: { id: payment.body.data.id } })).rejects.toThrow();
    await expect(h.db.payment.update({ where: { id: payment.body.data.id }, data: { amount: 1 } })).rejects.toThrow();
  });

  it("settles cancelled orders only through permissioned refunds", async () => {
    const order = await confirmed();
    await reception.post(`/api/orders/${order.id}/payments`).send({ method: "cash", amount: 6_000 }).expect(201);
    const cancelled = await admin.post(`/api/orders/${order.id}/cancel`).send({ version: order.version, reason: "إلغاء المناسبة" }).expect(200);
    expect(cancelled.body.data).toMatchObject({ paidAmount: 6_000 }); // No automatic refund.
    const more = await reception.post(`/api/orders/${order.id}/payments`).send({ method: "cash", amount: 100 });
    expect(more.body.error.code).toBe("ORDER_CANCELLED");
    await reception.post(`/api/orders/${order.id}/payments`).send({ kind: "refund", method: "cash", amount: 1_000 }).expect(403);
    const excessive = await admin.post(`/api/orders/${order.id}/payments`).send({ kind: "refund", method: "cash", amount: 6_001 });
    expect(excessive.body.error.code).toBe("AMOUNT_EXCEEDS_REFUNDABLE");
    await admin.post(`/api/orders/${order.id}/payments`).send({ kind: "refund", method: "cash", amount: 3_000 }).expect(201);
    expect((await h.db.order.findUniqueOrThrow({ where: { id: order.id } })).paidAmount).toBe(3_000);
  });

  it("lets an order be completed while money is still owed", async () => {
    const order = await confirmed();
    let version = order.version;
    for (const status of ["preparing", "ready", "completed"]) {
      version = (await operations.post(`/api/orders/${order.id}/status`).send({ version, status }).expect(200)).body.data.version;
    }
    const balance = await reception.get(`/api/customers/${order.customerId}/balance`).expect(200);
    expect(balance.body.data).toMatchObject({ orders: 1, outstanding: 10_000 });
  });
});

describe("delivery", () => {
  async function driver(name = "سائق") {
    const phone = `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    return (await operations.post("/api/drivers").send({ name, phone }).expect(201)).body.data;
  }

  it("assigns drivers and detects scheduling conflicts within an hour", async () => {
    const ahmed = await driver("أحمد");
    const first = await confirmed({ hour: 18 });
    const second = await confirmed({ hour: 18, dayOffset: 1 });
    await reception.post(`/api/orders/${first.id}/delivery/assign`).send({ driverId: ahmed.id }).expect(403);
    await operations.post(`/api/orders/${first.id}/delivery/assign`).send({ driverId: ahmed.id }).expect(200);
    const clash = await operations.post(`/api/orders/${second.id}/delivery/assign`).send({ driverId: ahmed.id });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("DRIVER_CONFLICT");
    expect(clash.body.error.details.conflicts[0].number).toBe(first.number);
    const forced = await operations.post(`/api/orders/${second.id}/delivery/assign`).send({ driverId: ahmed.id, force: true }).expect(200);
    expect(forced.body.conflicts).toHaveLength(1);
    const schedule = await operations.get(`/api/drivers/${ahmed.id}/schedule`).query({ date: riyadhTime(h, 0).slice(0, 10) }).expect(200);
    expect(schedule.body.data.map((o: { number: string }) => o.number)).toEqual(expect.arrayContaining([first.number, second.number]));
  });

  it("runs an independent delivery state machine", async () => {
    const order = await confirmed({ hour: 10, dayOffset: 2 });
    const sami = await driver("سامي");
    const early = await operations.post(`/api/orders/${order.id}/delivery/status`).send({ status: "out_for_delivery" });
    expect(early.body.error.code).toBe("INVALID_TRANSITION");
    await operations.post(`/api/orders/${order.id}/delivery/assign`).send({ driverId: sami.id }).expect(200);
    await operations.post(`/api/orders/${order.id}/delivery/status`).send({ status: "out_for_delivery" }).expect(200);
    await operations.post(`/api/orders/${order.id}/delivery/assign`).send({ driverId: null }).expect(409);
    await operations.post(`/api/orders/${order.id}/delivery/status`).send({ status: "failed" }).expect(400);
    const failed = await operations.post(`/api/orders/${order.id}/delivery/status`).send({ status: "failed", reason: "العميل لا يرد" }).expect(200);
    expect(failed.body.data).toMatchObject({ deliveryStatus: "failed", deliveryFailureReason: "العميل لا يرد" });
    // A failed delivery can be retried with a (re)assignment.
    await operations.post(`/api/orders/${order.id}/delivery/assign`).send({ driverId: sami.id }).expect(200);
    await operations.post(`/api/orders/${order.id}/delivery/status`).send({ status: "out_for_delivery" }).expect(200);
    const delivered = await operations.post(`/api/orders/${order.id}/delivery/status`).send({ status: "delivered" }).expect(200);
    expect(delivered.body.data.deliveredAt).not.toBeNull();
    // The order status itself was untouched.
    expect(delivered.body.data.status).toBe("confirmed");
  });

  it("keeps pickup orders out of the driver workflow", async () => {
    const order = await confirmed({ pickup: true });
    expect(order.deliveryStatus).toBeNull();
    const sami = await driver();
    const response = await operations.post(`/api/orders/${order.id}/delivery/assign`).send({ driverId: sami.id });
    expect(response.body.error.code).toBe("NOT_DELIVERY");
  });
});

describe("kitchen report", () => {
  it("includes confirmed, preparing, and ready orders for the day, sorted by time, regardless of payment", async () => {
    const dayOffset = 7;
    const date = riyadhTime(h, 0, 0, dayOffset).slice(0, 10);
    const late = await confirmed({ hour: 20, dayOffset });
    const early = await confirmed({ hour: 11, dayOffset });
    const preparing = await confirmed({ hour: 15, dayOffset });
    await operations.post(`/api/orders/${preparing.id}/status`).send({ version: preparing.version, status: "preparing" }).expect(200);
    const done = await confirmed({ hour: 12, dayOffset });
    let version = done.version;
    for (const status of ["preparing", "ready", "completed"]) {
      version = (await operations.post(`/api/orders/${done.id}/status`).send({ version, status })).body.data.version;
    }
    const cancelled = await confirmed({ hour: 13, dayOffset });
    await admin.post(`/api/orders/${cancelled.id}/cancel`).send({ version: cancelled.version, reason: "إلغاء" }).expect(200);
    const customer = await seedCustomer(h);
    await reception.post("/api/orders").send({
      customerId: customer.id, scheduledAt: riyadhTime(h, 14, 0, dayOffset),
      lines: [{ kind: "product", productId: catalog.rice.id, quantity: 1 }],
    }).expect(201);
    const nextDay = await confirmed({ hour: 1, dayOffset: dayOffset + 1 });

    const report = await reception.get("/api/reports/kitchen").query({ date }).expect(200);
    const numbers = report.body.data.map((o: { number: string }) => o.number);
    expect(numbers).toEqual([early.number, preparing.number, late.number]);
    expect(numbers).not.toContain(nextDay.number);
    expect(report.body.data[0].lines[0]).toMatchObject({ name: "رز", quantity: 2 });
    expect(report.body.data[0]).not.toHaveProperty("total");
  });

  it("audits every print and requires print permission", async () => {
    const date = riyadhTime(h, 0).slice(0, 10);
    await reception.post("/api/reports/kitchen/print").send({ date }).expect(403);
    await operations.post("/api/reports/kitchen/print").send({ date }).expect(204);
    const audit = await h.db.auditLog.findFirstOrThrow({ where: { action: "kitchen_report.print", entityId: date } });
    expect(audit.actorId).not.toBeNull();
  });
});

describe("dashboard", () => {
  it("shows operational data to everyone but financial figures only with permission", async () => {
    const operational = await operations.get("/api/dashboard").expect(200);
    expect(operational.body.data.financial).toBeUndefined();
    expect(operational.body.data.today).toHaveProperty("confirmed");
    const financial = await admin.get("/api/dashboard").expect(200);
    expect(financial.body.data.financial).toMatchObject({ outstandingAmount: expect.any(Number), receivedToday: expect.any(Number) });
  });

  it("alerts on upcoming orders, unassigned deliveries, and delays", async () => {
    // Now is 09:00 Riyadh; the order is due at 09:45, inside the default 60-minute lead time.
    const order = await confirmed({ hour: 9, dayOffset: 0 });
    const due = await h.db.order.update({
      where: { id: order.id }, data: { scheduledAt: new Date(riyadhTime(h, 9, 45, 0)) },
    });
    const numbers = (list: { number: string }[]) => list.map((o) => o.number);
    let data = (await operations.get("/api/dashboard").expect(200)).body.data;
    expect(numbers(data.upcoming)).toContain(due.number);
    expect(numbers(data.deliveryProblems)).toContain(due.number);
    expect(numbers(data.delayed)).not.toContain(due.number);
    // Advance in steps shorter than the idle timeout so the session stays alive.
    h.advance(25 * 60_000);
    await operations.get("/api/auth/me").expect(200);
    h.advance(25 * 60_000); // 09:50
    data = (await operations.get("/api/dashboard").expect(200)).body.data;
    expect(numbers(data.delayed)).toContain(due.number);
  });
});
