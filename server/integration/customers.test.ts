import { randomUUID } from "node:crypto";
import type { Agent } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/database.js";
import { createHarness, type Harness } from "./harness.js";

let h: Harness;
let reception: Agent;
beforeAll(async () => {
  h = await createHarness();
  reception = (await h.signIn("reception")).agent;
});
beforeEach(async () => {
  await h.db.customerAddress.deleteMany();
  await h.db.customer.deleteMany();
});
afterAll(async () => { await h?.cleanup(); });

describe("customer creation and lookup", () => {
  it("returns an empty page with defaults before any customers are created", async () => {
    const response = await reception.get("/api/customers");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [], pagination: { page: 1, pageSize: 20, total: 0 } });
  });

  it("creates a customer with addresses, persists it, and audits the creation", async () => {
    const response = await reception.post("/api/customers").send({
      name: " عميل اختبار ", phone: "051 234 5678", notes: " synthetic ",
      addresses: [{ label: "المنزل", details: "حي النخيل، شارع 5", mapsUrl: "https://maps.google.com/?q=24.7,46.6" }],
    });
    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`/api/customers/${response.body.data.id}`);
    expect(response.body.data).toMatchObject({ name: "عميل اختبار", phone: "+966512345678", notes: "synthetic", archivedAt: null });
    expect(response.body.data.addresses).toHaveLength(1);
    const fetched = await reception.get(`/api/customers/${response.body.data.id}`).expect(200);
    expect(fetched.body).toEqual(response.body);
    expect(await h.db.auditLog.count({ where: { action: "customer.create", entityId: response.body.data.id } })).toBe(1);
  });

  it("enforces phone uniqueness across formats and concurrent requests", async () => {
    const responses = await Promise.all(["0512345678", "+966512345678", "٠٥١٢٣٤٥٦٧٨"].map((phone) =>
      reception.post("/api/customers").send({ name: "Synthetic", phone })));
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const conflictResponse = responses.find((r) => r.status === 409)!;
    expect(conflictResponse.body.error.code).toBe("PHONE_CONFLICT");
    expect(conflictResponse.body.error.details.customerId).toBe(responses.find((r) => r.status === 201)!.body.data.id);
    expect(await h.db.customer.count()).toBe(1);
  });

  it("rejects malformed input without inserting rows", async () => {
    await reception.post("/api/customers").send({ name: " ", phone: "0512345678" }).expect(400);
    await reception.post("/api/customers").send({ name: "x", phone: "0412345678" }).expect(400);
    await reception.post("/api/customers").send({ name: "x", phone: "0512345678", id: randomUUID() }).expect(400);
    await reception.post("/api/customers")
      .send({ name: "x", phone: "0512345678", addresses: [{ label: "a", details: "b", mapsUrl: "javascript:alert(1)" }] })
      .expect(400);
    await reception.get("/api/customers/not-a-uuid").expect(400);
    await reception.get(`/api/customers/${randomUUID()}`).expect(404);
    expect(await h.db.customer.count()).toBe(0);
  });

  it("returns validation details without echoing submitted values", async () => {
    const response = await reception.post("/api/customers").send({ name: "سر", phone: "0412345678" });
    expect(response.body.error.code).toBe("INVALID_INPUT");
    expect(response.body.error.details).toEqual([{ path: "phone", message: "Invalid Saudi mobile number" }]);
    expect(JSON.stringify(response.body)).not.toContain("0412345678");
  });

  it("paginates deterministically even when creation timestamps tie", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003"];
    await h.db.customer.createMany({ data: ids.map((id, index) => ({
      id, name: "Synthetic", phone: `+96650000000${index}`, createdAt,
    })) });
    const first = await reception.get("/api/customers?page=1&pageSize=2").expect(200);
    const second = await reception.get("/api/customers?page=2&pageSize=2").expect(200);
    expect(first.body.pagination).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(first.body.data.map((row: { id: string }) => row.id)).toEqual([ids[2], ids[1]]);
    expect(second.body.data.map((row: { id: string }) => row.id)).toEqual([ids[0]]);
    await reception.get("/api/customers?pageSize=101").expect(400);
  });

  it("searches by name fragment, full phone in any format, and phone digits", async () => {
    await h.db.customer.createMany({ data: [
      { name: "محمد العتيبي", phone: "+966512345678" },
      { name: "Sara Ahmed", phone: "+966598765432" },
    ] });
    const names = async (q: string) => (await reception.get("/api/customers").query({ q }))
      .body.data.map((row: { name: string }) => row.name);
    expect(await names("العتيبي")).toEqual(["محمد العتيبي"]);
    expect(await names("sara")).toEqual(["Sara Ahmed"]);
    expect(await names("051 234 5678")).toEqual(["محمد العتيبي"]);
    expect(await names("٠٥٩٨٧٦٥٤٣٢")).toEqual(["Sara Ahmed"]);
    expect(await names("7654")).toEqual(["Sara Ahmed"]);
    expect(await names("nobody")).toEqual([]);
  });
});

describe("customer editing", () => {
  async function createCustomer() {
    return (await reception.post("/api/customers").send({ name: "Before", phone: "0512345678" })).body.data;
  }

  it("lets reception edit basic fields with an audited diff", async () => {
    const customer = await createCustomer();
    const updated = await reception.patch(`/api/customers/${customer.id}`).send({ name: "After", notes: "VIP" }).expect(200);
    expect(updated.body.data).toMatchObject({ name: "After", notes: "VIP" });
    const audit = await h.db.auditLog.findFirstOrThrow({ where: { action: "customer.update", entityId: customer.id } });
    expect(audit.before).toEqual({ name: "Before", notes: null });
    expect(audit.after).toEqual({ name: "After", notes: "VIP" });
  });

  it("requires change_customer_phone to change the phone number", async () => {
    const customer = await createCustomer();
    await reception.patch(`/api/customers/${customer.id}`).send({ phone: "0598765432" }).expect(403);
    // Re-submitting the same number in another format is not a change.
    await reception.patch(`/api/customers/${customer.id}`).send({ phone: "+966512345678" }).expect(200);
    const { agent } = await h.signIn("reception", { grants: ["change_customer_phone"] });
    const updated = await agent.patch(`/api/customers/${customer.id}`).send({ phone: "0598765432" }).expect(200);
    expect(updated.body.data.phone).toBe("+966598765432");
    expect(await h.db.auditLog.count({ where: { action: "customer.phone_change", entityId: customer.id } })).toBe(1);
  });

  it("archives and restores instead of deleting, hiding archived customers by default", async () => {
    const customer = await createCustomer();
    await reception.post(`/api/customers/${customer.id}/archive`).expect(403);
    const { agent: admin } = await h.signIn("admin");
    await admin.post(`/api/customers/${customer.id}/archive`).expect(200);
    expect((await reception.get("/api/customers")).body.data).toEqual([]);
    expect((await reception.get("/api/customers?archived=only")).body.data).toHaveLength(1);
    await reception.patch(`/api/customers/${customer.id}`).send({ name: "x" }).expect(409);
    await admin.post(`/api/customers/${customer.id}/restore`).expect(200);
    expect((await reception.get("/api/customers")).body.data).toHaveLength(1);
  });

  it("adds, edits, and archives addresses", async () => {
    const customer = await createCustomer();
    const address = await reception.post(`/api/customers/${customer.id}/addresses`)
      .send({ label: "قاعة", details: "قاعة الأفراح" }).expect(201);
    await reception.patch(`/api/customers/${customer.id}/addresses/${address.body.data.id}`)
      .send({ label: "قاعة المناسبات" }).expect(200);
    expect((await reception.get(`/api/customers/${customer.id}`)).body.data.addresses[0].label).toBe("قاعة المناسبات");
    await reception.delete(`/api/customers/${customer.id}/addresses/${address.body.data.id}`).expect(204);
    expect((await reception.get(`/api/customers/${customer.id}`)).body.data.addresses).toEqual([]);
    expect(await h.db.customerAddress.count()).toBe(1);
  });

  it("does not allow operations staff to create customers", async () => {
    const { agent } = await h.signIn("operations");
    await agent.get("/api/customers").expect(200);
    await agent.post("/api/customers").send({ name: "x", phone: "0512345678" }).expect(403);
  });
});

describe("database failures", () => {
  it("returns a safe 503 when actual database authentication fails", async () => {
    const unavailableUrl = new URL(h.url);
    unavailableUrl.password = randomUUID();
    const unavailable = createDatabase(unavailableUrl.href);
    try {
      const app = createApp(unavailable.check, { ...h.context, db: unavailable.client });
      const response = await (await import("supertest")).default(app).get("/api/customers").set("Cookie", "rms_session=x");
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: { code: "DATABASE_UNAVAILABLE", message: "Storage unavailable" } });
    } finally { await unavailable.disconnect(); }
  });
});
