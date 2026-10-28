import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import type { AppContext, AuthState } from "../context.js";
import { AppError, conflict, notFound } from "../http/errors.js";
import { rateLimit } from "../http/rate-limit.js";
import { normalizeSaudiMobile } from "../phone.js";
import { burnPasswordCheck, hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from "./password.js";
import { effectivePermissions } from "./permissions.js";
import {
  actorId, authenticate, clearSessionCookie, createSession, setSessionCookie, setupRequirement,
} from "./sessions.js";
import { generateTotpSecret, totpUri, verifyTotp } from "./totp.js";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

const loginInput = z.strictObject({
  phone: z.string().max(32),
  password: z.string().min(1).max(200),
  totpCode: z.string().max(10).optional(),
});

export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200);
const changePasswordInput = z.strictObject({
  currentPassword: z.string().min(1).max(200),
  newPassword: newPasswordSchema,
});

export async function mePayload(context: AppContext, auth: AuthState) {
  const settings = await context.db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const { employee } = auth;
  return {
    employee: {
      id: employee.id, name: employee.name, phone: employee.phone, role: employee.role,
      mustChangePassword: employee.mustChangePassword, totpEnabled: employee.totpEnabled,
    },
    permissions: [...auth.permissions].sort(),
    setupRequired: setupRequirement(context, auth),
    sessionId: auth.session.id,
    settings: { sessionIdleMinutes: settings.sessionIdleMinutes, alertLeadMinutes: settings.alertLeadMinutes },
  };
}

export function createAuthRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  const setupAllowed = authenticate(context, { allowSetup: true });

  router.post("/login", rateLimit({ windowMs: 15 * 60_000, max: 30 }), async (request, response) => {
    const input = loginInput.parse(request.body);
    const invalid = new AppError(401, "INVALID_CREDENTIALS", "Incorrect phone number or password");
    const phone = normalizeSaudiMobile(input.phone);
    const employee = phone ? await db.employee.findUnique({ where: { phone } }) : null;
    if (!employee || !employee.active) {
      await burnPasswordCheck(input.password);
      throw invalid;
    }
    const now = context.now();
    if (employee.lockedUntil && employee.lockedUntil > now) {
      throw new AppError(429, "ACCOUNT_LOCKED", "Too many failed attempts; try again later");
    }

    const recordFailure = async () => {
      const failures = employee.failedLoginCount + 1;
      const locked = failures >= MAX_FAILED_LOGINS;
      await db.$transaction(async (tx) => {
        await tx.employee.update({
          where: { id: employee.id },
          data: locked
            ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) }
            : { failedLoginCount: failures },
        });
        if (locked) {
          await recordAudit(tx, { actorId: null, action: "auth.locked", entityType: "employee", entityId: employee.id });
        }
      });
    };

    if (!(await verifyPassword(input.password, employee.passwordHash))) {
      await recordFailure();
      throw invalid;
    }
    if (employee.totpEnabled) {
      if (!input.totpCode) throw new AppError(401, "MFA_REQUIRED", "Enter the code from your authenticator app");
      if (!employee.totpSecret || !verifyTotp(employee.totpSecret, input.totpCode, now)) {
        await recordFailure();
        throw new AppError(401, "INVALID_MFA_CODE", "Incorrect authenticator code");
      }
    }

    const { token, session } = await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: employee.id }, data: { failedLoginCount: 0, lockedUntil: null } });
      await recordAudit(tx, { actorId: employee.id, action: "auth.login", entityType: "employee", entityId: employee.id });
      return createSession(tx, context, employee.id, {
        userAgent: request.get("user-agent"), ipAddress: request.ip,
      });
    });
    setSessionCookie(context, response, token);
    const overrides = await db.permissionOverride.findMany({ where: { employeeId: employee.id } });
    const auth: AuthState = {
      employee: { ...employee, failedLoginCount: 0, lockedUntil: null },
      session,
      permissions: effectivePermissions(employee.role, overrides),
    };
    response.json({ data: await mePayload(context, auth) });
  });

  router.post("/logout", setupAllowed, async (request, response) => {
    await db.session.update({ where: { id: request.auth!.session.id }, data: { revokedAt: context.now() } });
    clearSessionCookie(context, response);
    response.status(204).end();
  });

  router.get("/me", setupAllowed, async (request, response) => {
    response.json({ data: await mePayload(context, request.auth!) });
  });

  router.post("/password", setupAllowed, async (request, response) => {
    const input = changePasswordInput.parse(request.body);
    const { employee, session } = request.auth!;
    if (!(await verifyPassword(input.currentPassword, employee.passwordHash))) {
      throw new AppError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect");
    }
    if (input.newPassword === input.currentPassword) {
      throw new AppError(400, "PASSWORD_REUSED", "Choose a password different from the current one");
    }
    const passwordHash = await hashPassword(input.newPassword);
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: employee.id }, data: { passwordHash, mustChangePassword: false } });
      // Other devices must sign in again with the new password.
      await tx.session.updateMany({
        where: { employeeId: employee.id, revokedAt: null, id: { not: session.id } },
        data: { revokedAt: context.now() },
      });
      await recordAudit(tx, { actorId: employee.id, action: "auth.password_changed", entityType: "employee", entityId: employee.id });
    });
    response.status(204).end();
  });

  router.get("/sessions", setupAllowed, async (request, response) => {
    const sessions = await db.session.findMany({
      where: { employeeId: actorId(request), revokedAt: null, expiresAt: { gt: context.now() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, userAgent: true, ipAddress: true },
    });
    response.json({ data: sessions.map((session) => ({ ...session, current: session.id === request.auth!.session.id })) });
  });

  router.delete("/sessions/:id", setupAllowed, async (request, response) => {
    const id = z.uuid().parse(request.params.id);
    const result = await db.session.updateMany({
      where: { id, employeeId: actorId(request), revokedAt: null },
      data: { revokedAt: context.now() },
    });
    if (result.count === 0) throw notFound("Session");
    if (id === request.auth!.session.id) clearSessionCookie(context, response);
    response.status(204).end();
  });

  router.post("/mfa/setup", setupAllowed, async (request, response) => {
    const { employee } = request.auth!;
    if (employee.totpEnabled) throw conflict("MFA_ALREADY_ENABLED", "Two-factor authentication is already enabled");
    const secret = generateTotpSecret();
    await db.employee.update({ where: { id: employee.id }, data: { totpSecret: secret } });
    response.json({ data: { secret, uri: totpUri(secret, employee.phone) } });
  });

  router.post("/mfa/enable", setupAllowed, async (request, response) => {
    const { code } = z.strictObject({ code: z.string().max(10) }).parse(request.body);
    const employee = await db.employee.findUniqueOrThrow({ where: { id: actorId(request) } });
    if (employee.totpEnabled) throw conflict("MFA_ALREADY_ENABLED", "Two-factor authentication is already enabled");
    if (!employee.totpSecret || !verifyTotp(employee.totpSecret, code, context.now())) {
      throw new AppError(400, "INVALID_MFA_CODE", "Incorrect authenticator code");
    }
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: employee.id }, data: { totpEnabled: true } });
      await recordAudit(tx, { actorId: employee.id, action: "auth.mfa_enabled", entityType: "employee", entityId: employee.id });
    });
    response.status(204).end();
  });

  router.post("/mfa/disable", authenticate(context), async (request, response) => {
    const input = z.strictObject({ password: z.string().max(200), code: z.string().max(10) }).parse(request.body);
    const { employee } = request.auth!;
    if (context.config.requireAdminMfa && employee.role === "admin") {
      throw conflict("MFA_REQUIRED_FOR_ROLE", "Administrators must keep two-factor authentication enabled");
    }
    if (!employee.totpEnabled || !employee.totpSecret) throw conflict("MFA_NOT_ENABLED", "Two-factor authentication is not enabled");
    if (!(await verifyPassword(input.password, employee.passwordHash))
      || !verifyTotp(employee.totpSecret, input.code, context.now())) {
      throw new AppError(400, "INVALID_CREDENTIALS", "Incorrect password or authenticator code");
    }
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: employee.id }, data: { totpEnabled: false, totpSecret: null } });
      await recordAudit(tx, { actorId: employee.id, action: "auth.mfa_disabled", entityType: "employee", entityId: employee.id });
    });
    response.status(204).end();
  });

  return router;
}
