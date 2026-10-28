import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { totpCode } from "../src/auth/totp.js";
import { createHarness, PASSWORD, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h?.cleanup(); });

describe("login", () => {
  it("signs in with any phone format, sets a hardened cookie, and stores only a token hash", async () => {
    const user = await h.employee("reception");
    const local = `0${user.phone.slice(4)}`;
    const response = await h.client().post("/api/auth/login").send({ phone: local, password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.data.employee).toMatchObject({ id: user.id, role: "reception" });
    expect(response.body.data.permissions).toContain("create_orders");
    expect(response.body.data.employee).not.toHaveProperty("passwordHash");
    const cookie = response.headers["set-cookie"]![0]!;
    expect(cookie).toMatch(/^rms_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const token = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
    const sessions = await h.db.session.findMany({ where: { employeeId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).not.toContain(token);
  });

  it("returns the same error for unknown phones, wrong passwords, and inactive accounts", async () => {
    const inactive = await h.employee("reception");
    await h.db.employee.update({ where: { id: inactive.id }, data: { active: false } });
    const active = await h.employee("reception");
    for (const body of [
      { phone: "0599999999", password: PASSWORD },
      { phone: active.phone, password: "wrong-password" },
      { phone: inactive.phone, password: PASSWORD },
    ]) {
      const response = await h.client().post("/api/auth/login").send(body);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
    }
  });

  it("locks an account after five failures and audits the lockout", async () => {
    const user = await h.employee("operations");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await h.client().post("/api/auth/login").send({ phone: user.phone, password: "wrong" }).expect(401);
    }
    const locked = await h.client().post("/api/auth/login").send({ phone: user.phone, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("ACCOUNT_LOCKED");
    expect(await h.db.auditLog.count({ where: { action: "auth.locked", entityId: user.id } })).toBe(1);
    h.advance(16 * 60_000);
    await h.client().post("/api/auth/login").send({ phone: user.phone, password: PASSWORD }).expect(200);
  });

  it("rejects state-changing requests without the API client header", async () => {
    const user = await h.employee("reception");
    const response = await request(h.app).post("/api/auth/login").send({ phone: user.phone, password: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CSRF_REJECTED");
  });
});

describe("sessions", () => {
  it("requires authentication for protected endpoints", async () => {
    const response = await h.client().get("/api/customers");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("expires after the configured idle timeout, enforced by the server", async () => {
    const { agent } = await h.signIn("reception");
    await h.db.settings.update({ where: { id: 1 }, data: { sessionIdleMinutes: 15 } });
    h.advance(14 * 60_000);
    await agent.get("/api/auth/me").expect(200);
    h.advance(14 * 60_000); // Activity above reset the idle window.
    await agent.get("/api/auth/me").expect(200);
    h.advance(16 * 60_000);
    await agent.get("/api/auth/me").expect(401);
    await h.db.settings.update({ where: { id: 1 }, data: { sessionIdleMinutes: 30 } });
  });

  it("expires at the absolute maximum lifetime even when active", async () => {
    const { agent } = await h.signIn("reception");
    for (let elapsed = 0; elapsed < 12 * 60; elapsed += 20) {
      h.advance(20 * 60_000);
      if (elapsed + 20 < 12 * 60) await agent.get("/api/auth/me").expect(200);
    }
    await agent.get("/api/auth/me").expect(401);
  });

  it("lists sessions, revokes one, and logs out", async () => {
    const user = await h.employee("reception");
    const first = h.client();
    const second = h.client();
    await first.post("/api/auth/login").send({ phone: user.phone, password: PASSWORD }).expect(200);
    await second.post("/api/auth/login").send({ phone: user.phone, password: PASSWORD }).expect(200);
    const list = await first.get("/api/auth/sessions").expect(200);
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((session: { current: boolean }) => !session.current);
    await first.delete(`/api/auth/sessions/${other.id}`).expect(204);
    await second.get("/api/auth/me").expect(401);
    await first.post("/api/auth/logout").expect(204);
    await first.get("/api/auth/me").expect(401);
  });

  it("revokes sessions immediately when an employee is deactivated", async () => {
    const { agent: admin } = await h.signIn("admin");
    const { agent, user } = await h.signIn("reception");
    await admin.patch(`/api/employees/${user.id}`).send({ active: false }).expect(200);
    await agent.get("/api/auth/me").expect(401);
  });
});

describe("password changes and resets", () => {
  it("restricts a temporary-password session to account setup until the password changes", async () => {
    const { agent: admin } = await h.signIn("admin");
    const created = await admin.post("/api/employees")
      .send({ name: "موظف جديد", phone: "0550000001", role: "reception" }).expect(201);
    const temporaryPassword = created.body.temporaryPassword as string;
    expect(JSON.stringify(created.body.data)).not.toContain(temporaryPassword);

    const agent = h.client();
    const login = await agent.post("/api/auth/login").send({ phone: "0550000001", password: temporaryPassword });
    expect(login.body.data.setupRequired).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await agent.get("/api/customers")).body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    await agent.post("/api/auth/password").send({ currentPassword: temporaryPassword, newPassword: "short" }).expect(400);
    await agent.post("/api/auth/password")
      .send({ currentPassword: temporaryPassword, newPassword: "a-much-better-password" }).expect(204);
    await agent.get("/api/customers").expect(200);
  });

  it("lets an admin reset a password without reading it, revoking existing sessions", async () => {
    const { agent: admin, user: adminUser } = await h.signIn("admin");
    const { agent, user } = await h.signIn("operations");
    const reset = await admin.post(`/api/employees/${user.id}/reset-password`).expect(200);
    expect(reset.body.temporaryPassword).toMatch(/^[A-Za-z2-9]{14}$/);
    await agent.get("/api/auth/me").expect(401);
    const stored = await h.db.employee.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.mustChangePassword).toBe(true);
    expect(stored.passwordHash).not.toContain(reset.body.temporaryPassword);
    const audit = await h.db.auditLog.findFirstOrThrow({ where: { action: "employee.password_reset", entityId: user.id } });
    expect(audit.actorId).toBe(adminUser.id);
    expect(JSON.stringify([audit.before, audit.after, audit.reason])).not.toContain(reset.body.temporaryPassword);
  });
});

describe("MFA", () => {
  it("enrols TOTP and then requires a valid code at login", async () => {
    const { agent, user } = await h.signIn("admin");
    const setup = await agent.post("/api/auth/mfa/setup").expect(200);
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.uri).toMatch(/^otpauth:\/\/totp\//);
    await agent.post("/api/auth/mfa/enable").send({ code: "000000" }).expect(400);
    await agent.post("/api/auth/mfa/enable").send({ code: totpCode(secret, h.context.now()) }).expect(204);

    const fresh = h.client();
    const missing = await fresh.post("/api/auth/login").send({ phone: user.phone, password: PASSWORD });
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe("MFA_REQUIRED");
    await fresh.post("/api/auth/login").send({ phone: user.phone, password: PASSWORD, totpCode: "123456" }).expect(401);
    await fresh.post("/api/auth/login")
      .send({ phone: user.phone, password: PASSWORD, totpCode: totpCode(secret, h.context.now()) }).expect(200);
  });

  it("forces administrators to enrol MFA when the policy is enabled", async () => {
    h.context.config.requireAdminMfa = true;
    try {
      const { agent } = await h.signIn("admin");
      const me = await agent.get("/api/auth/me").expect(200);
      expect(me.body.data.setupRequired).toBe("MFA_SETUP_REQUIRED");
      expect((await agent.get("/api/employees")).body.error.code).toBe("MFA_SETUP_REQUIRED");
      const { agent: reception } = await h.signIn("reception");
      await reception.get("/api/customers").expect(200);
    } finally {
      h.context.config.requireAdminMfa = false;
    }
  });
});
