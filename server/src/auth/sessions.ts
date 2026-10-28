import { createHash, randomBytes } from "node:crypto";
import type { RequestHandler, Response } from "express";
import type { AppContext, AuthState, Db, Tx } from "../context.js";
import { AppError, forbidden } from "../http/errors.js";
import { effectivePermissions, type Permission } from "./permissions.js";

export const SESSION_COOKIE = "rms_session";
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(
  db: Db | Tx,
  context: AppContext,
  employeeId: string,
  meta: { userAgent?: string; ipAddress?: string },
) {
  const token = randomBytes(32).toString("base64url");
  const now = context.now();
  const session = await db.session.create({
    data: {
      employeeId,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + context.config.sessionMaxHours * 3_600_000),
      userAgent: meta.userAgent?.slice(0, 255),
      ipAddress: meta.ipAddress?.slice(0, 64),
    },
  });
  return { token, session };
}

export function setSessionCookie(context: AppContext, response: Response, token: string) {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: context.config.secureCookies,
    sameSite: "strict",
    path: "/api",
    maxAge: context.config.sessionMaxHours * 3_600_000,
  });
}

export function clearSessionCookie(context: AppContext, response: Response) {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true, secure: context.config.secureCookies, sameSite: "strict", path: "/api",
  });
}

function readCookie(header: string | undefined, name: string) {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/** Resolves a session token, enforcing revocation, idle timeout, absolute expiry, and deactivation. */
export async function resolveSession(context: AppContext, token: string): Promise<AuthState | null> {
  const session = await context.db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { employee: { include: { permissionOverrides: true } } },
  });
  if (!session || session.revokedAt || !session.employee.active) return null;
  const now = context.now();
  const settings = await context.db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const idleDeadline = session.lastSeenAt.getTime() + settings.sessionIdleMinutes * 60_000;
  if (now >= session.expiresAt || now.getTime() >= idleDeadline) {
    await context.db.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() >= LAST_SEEN_WRITE_INTERVAL_MS) {
    await context.db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    session.lastSeenAt = now;
  }
  const { employee } = session;
  const { permissionOverrides, ...employeeFields } = employee;
  return {
    employee: { ...employeeFields } as AuthState["employee"],
    session,
    permissions: effectivePermissions(employee.role, permissionOverrides),
  };
}

/** Why a signed-in employee may only use account-setup endpoints right now. */
export function setupRequirement(context: AppContext, auth: AuthState) {
  if (auth.employee.mustChangePassword) return "PASSWORD_CHANGE_REQUIRED" as const;
  if (context.config.requireAdminMfa && auth.employee.role === "admin" && !auth.employee.totpEnabled) {
    return "MFA_SETUP_REQUIRED" as const;
  }
  return null;
}

/** Requires a valid session. With `allowSetup`, permits sessions that still need password/MFA setup. */
export function authenticate(context: AppContext, options: { allowSetup?: boolean } = {}): RequestHandler {
  return async (request, _response, next) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const auth = token ? await resolveSession(context, token) : null;
    if (!auth) throw new AppError(401, "UNAUTHENTICATED", "Sign-in required");
    const requirement = setupRequirement(context, auth);
    if (requirement && !options.allowSetup) {
      throw new AppError(403, requirement, "Complete account setup before continuing");
    }
    request.auth = auth;
    next();
  };
}

export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth || !permissions.every((permission) => request.auth!.permissions.has(permission))) {
      throw forbidden();
    }
    next();
  };
}

export function can(request: { auth?: AuthState }, permission: Permission) {
  return request.auth?.permissions.has(permission) ?? false;
}

export function actorId(request: { auth?: AuthState }) {
  if (!request.auth) throw new AppError(401, "UNAUTHENTICATED", "Sign-in required");
  return request.auth.employee.id;
}
