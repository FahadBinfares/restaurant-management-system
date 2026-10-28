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
