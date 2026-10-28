import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h?.cleanup(); });

describe("employee administration", () => {
  it("is limited to manage_employees", async () => {
    const { agent } = await h.signIn("reception");
    const response = await agent.get("/api/employees");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("grants and revokes individual permissions with an audit trail", async () => {
    const { agent: admin } = await h.signIn("admin");
    const { agent, user } = await h.signIn("reception");
    await agent.get("/api/audit").expect(403);
    const updated = await admin.put(`/api/employees/${user.id}/permissions`)
      .send({ grants: ["view_audit_log"], revokes: ["manage_customers"] }).expect(200);
    expect(updated.body.data.permissions).toContain("view_audit_log");
    expect(updated.body.data.permissions).not.toContain("manage_customers");
    await agent.get("/api/audit").expect(200);
    await agent.post("/api/customers").send({ name: "x", phone: "0512345678" }).expect(403);
    const audit = await h.db.auditLog.findFirstOrThrow({ where: { action: "employee.permissions", entityId: user.id } });
    expect(audit.after).toEqual({ grants: ["view_audit_log"], revokes: ["manage_customers"] });
  });

  it("rejects unknown permissions and self-lockout", async () => {
    const { agent: admin, user } = await h.signIn("admin");
    await admin.put(`/api/employees/${user.id}/permissions`).send({ grants: ["superuser"], revokes: [] }).expect(400);
    const lockout = await admin.put(`/api/employees/${user.id}/permissions`)
      .send({ grants: [], revokes: ["manage_employees"] });
    expect(lockout.body.error.code).toBe("SELF_LOCKOUT");
    expect((await admin.patch(`/api/employees/${user.id}`).send({ active: false })).body.error.code).toBe("SELF_LOCKOUT");
  });

  it("never returns password hashes or TOTP secrets", async () => {
    const { agent: admin } = await h.signIn("admin");
    const list = await admin.get("/api/employees").expect(200);
    const serialized = JSON.stringify(list.body);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("scrypt$");
    expect(serialized).not.toContain("totpSecret");
  });
});

describe("settings", () => {
  it("accepts only the approved option values and audits changes", async () => {
    const { agent: admin } = await h.signIn("admin");
    const current = await admin.get("/api/settings").expect(200);
    expect(current.body.data).toMatchObject({ sessionIdleMinutes: 30, draftArchiveDays: 30, alertLeadMinutes: 60 });
    await admin.patch("/api/settings").send({ sessionIdleMinutes: 45 }).expect(400);
    const updated = await admin.patch("/api/settings").send({ alertLeadMinutes: 120 }).expect(200);
    expect(updated.body.data.alertLeadMinutes).toBe(120);
    const audit = await h.db.auditLog.findFirstOrThrow({ where: { action: "settings.update" } });
    expect(audit.before).toEqual({ alertLeadMinutes: 60 });
    expect(audit.after).toEqual({ alertLeadMinutes: 120 });
  });

  it("is readable by every employee but writable only with manage_settings", async () => {
    const { agent } = await h.signIn("operations");
    await agent.get("/api/settings").expect(200);
    await agent.patch("/api/settings").send({ alertLeadMinutes: 30 }).expect(403);
  });

  it("enforces allowed values in the database too", async () => {
    await expect(h.db.settings.update({ where: { id: 1 }, data: { draftArchiveDays: 7 } })).rejects.toThrow();
  });
});

describe("audit log", () => {
  it("is append-only at the database level", async () => {
    const entry = await h.db.auditLog.findFirstOrThrow();
    await expect(h.db.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(h.db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
  });
});

describe("catalog", () => {
  it("is readable by staff but managed only with manage_products, with audited price changes", async () => {
    const { agent: admin } = await h.signIn("admin");
    const { agent: reception } = await h.signIn("reception");
    await reception.post("/api/catalog/categories").send({ name: "مشروبات" }).expect(403);
    const category = await admin.post("/api/catalog/categories").send({ name: "مشروبات" }).expect(201);
    await admin.post("/api/catalog/categories").send({ name: "مشروبات" }).expect(409);
    const product = await admin.post("/api/catalog/products")
      .send({ categoryId: category.body.data.id, name: "لبن", price: 300 }).expect(201);
    await admin.post("/api/catalog/products")
      .send({ categoryId: category.body.data.id, name: "عصير", price: 1.5 }).expect(400);
    await admin.patch(`/api/catalog/products/${product.body.data.id}`).send({ price: 350 }).expect(200);
    const audit = await h.db.auditLog.findFirstOrThrow({ where: { action: "product.price_change", entityId: product.body.data.id } });
    expect(audit.before).toEqual({ price: 300 });
    expect(audit.after).toEqual({ price: 350 });
    const visible = await reception.get("/api/catalog/products").expect(200);
    expect(visible.body.data.map((p: { name: string }) => p.name)).toContain("لبن");
    await admin.patch(`/api/catalog/products/${product.body.data.id}`).send({ active: false }).expect(200);
    const hidden = await reception.get("/api/catalog/products").expect(200);
    expect(hidden.body.data.map((p: { name: string }) => p.name)).not.toContain("لبن");
  });

  it("validates package contents", async () => {
    const { agent: admin } = await h.signIn("admin");
    const category = await admin.post("/api/catalog/categories").send({ name: "رئيسي" }).expect(201);
    const product = await admin.post("/api/catalog/products")
      .send({ categoryId: category.body.data.id, name: "مندي", price: 9_000 }).expect(201);
    const id = product.body.data.id;
    await admin.post("/api/catalog/packages").send({ name: "باقة", price: 1, items: [] }).expect(400);
    await admin.post("/api/catalog/packages")
      .send({ name: "باقة", price: 1, items: [{ productId: id, quantity: 1 }, { productId: id, quantity: 2 }] }).expect(400);
    const created = await admin.post("/api/catalog/packages")
      .send({ name: "باقة 10", guestCount: 10, price: 80_000, items: [{ productId: id, quantity: 3 }] }).expect(201);
    expect(created.body.data.items[0]).toMatchObject({ quantity: 3, product: { name: "مندي" } });
  });
});
