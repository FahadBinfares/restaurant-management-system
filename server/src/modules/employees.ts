import { Router } from "express";
import { z } from "zod";
import { diff, recordAudit } from "../audit.js";
import { generateTemporaryPassword, hashPassword } from "../auth/password.js";
import { effectivePermissions, PERMISSIONS } from "../auth/permissions.js";
import { actorId, authenticate, requirePermission } from "../auth/sessions.js";
import type { AppContext } from "../context.js";
import type { Employee, PermissionOverride } from "../generated/prisma/client.js";
import { conflict, notFound } from "../http/errors.js";
import { phoneSchema } from "../http/schemas.js";

const role = z.enum(["admin", "reception", "operations"]);
const createInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  role,
});
const updateInput = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  role: role.optional(),
  active: z.boolean().optional(),
});
const permission = z.enum(PERMISSIONS);
const permissionsInput = z.strictObject({
  grants: z.array(permission).max(PERMISSIONS.length),
  revokes: z.array(permission).max(PERMISSIONS.length),
});

/** Never expose password hashes or TOTP secrets. */
function present(employee: Employee & { permissionOverrides: PermissionOverride[] }) {
  return {
    id: employee.id,
    name: employee.name,
    phone: employee.phone,
    role: employee.role,
    active: employee.active,
    mustChangePassword: employee.mustChangePassword,
    totpEnabled: employee.totpEnabled,
    locked: employee.lockedUntil !== null && employee.lockedUntil > new Date(),
    grants: employee.permissionOverrides.filter((o) => o.granted).map((o) => o.permission).sort(),
    revokes: employee.permissionOverrides.filter((o) => !o.granted).map((o) => o.permission).sort(),
    permissions: [...effectivePermissions(employee.role, employee.permissionOverrides)].sort(),
    createdAt: employee.createdAt,
  };
}

export function createEmployeesRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  router.use(authenticate(context), requirePermission("manage_employees"));
  const include = { permissionOverrides: true } as const;

  const load = async (id: unknown) => {
    const employee = await db.employee.findUnique({ where: { id: z.uuid().parse(id) }, include });
    if (!employee) throw notFound("Employee");
    return employee;
  };

  router.get("/", async (_request, response) => {
    const employees = await db.employee.findMany({ include, orderBy: [{ active: "desc" }, { name: "asc" }] });
    response.json({ data: employees.map(present), permissions: PERMISSIONS });
  });

  router.post("/", async (request, response) => {
    const input = createInput.parse(request.body);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const employee = await db.$transaction(async (tx) => {
      const created = await tx.employee.create({ data: { ...input, passwordHash, mustChangePassword: true }, include });
      await recordAudit(tx, {
        actorId: actorId(request), action: "employee.create", entityType: "employee", entityId: created.id,
        after: { name: created.name, phone: created.phone, role: created.role },
      });
      return created;
    });
    // The temporary password is shown exactly once; only its hash is stored.
    response.status(201).json({ data: present(employee), temporaryPassword });
  });

  router.patch("/:id", async (request, response) => {
    const input = updateInput.parse(request.body);
    const employee = await load(request.params.id);
    if (employee.id === actorId(request) && (input.active === false || (input.role && input.role !== "admin"))) {
      throw conflict("SELF_LOCKOUT", "You cannot deactivate or demote your own account");
    }
    const changes = diff(employee, input);
    if (!changes.changed) { response.json({ data: present(employee) }); return; }
    const updated = await db.$transaction(async (tx) => {
      const result = await tx.employee.update({ where: { id: employee.id }, data: input, include });
      if (input.active === false) {
        await tx.session.updateMany({ where: { employeeId: employee.id, revokedAt: null }, data: { revokedAt: context.now() } });
      }
      await recordAudit(tx, {
        actorId: actorId(request), action: "employee.update", entityType: "employee", entityId: employee.id, ...changes,
      });
      return result;
    });
    response.json({ data: present(updated) });
  });

  router.put("/:id/permissions", async (request, response) => {
    const input = permissionsInput.parse(request.body);
    const employee = await load(request.params.id);
    if (input.grants.some((p) => input.revokes.includes(p))) {
      throw conflict("CONTRADICTORY_OVERRIDES", "A permission cannot be both granted and revoked");
    }
    if (employee.id === actorId(request) && input.revokes.includes("manage_employees")) {
      throw conflict("SELF_LOCKOUT", "You cannot revoke your own employee-management permission");
    }
    const updated = await db.$transaction(async (tx) => {
      await tx.permissionOverride.deleteMany({ where: { employeeId: employee.id } });
      await tx.permissionOverride.createMany({ data: [
        ...input.grants.map((p) => ({ employeeId: employee.id, permission: p, granted: true })),
        ...input.revokes.map((p) => ({ employeeId: employee.id, permission: p, granted: false })),
      ] });
      const before = present(employee);
      await recordAudit(tx, {
        actorId: actorId(request), action: "employee.permissions", entityType: "employee", entityId: employee.id,
        before: { grants: before.grants, revokes: before.revokes },
        after: { grants: [...input.grants].sort(), revokes: [...input.revokes].sort() },
      });
      return tx.employee.findUniqueOrThrow({ where: { id: employee.id }, include });
    });
    response.json({ data: present(updated) });
  });

  router.post("/:id/reset-password", async (request, response) => {
    const employee = await load(request.params.id);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await db.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employee.id },
        data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.updateMany({ where: { employeeId: employee.id, revokedAt: null }, data: { revokedAt: context.now() } });
      await recordAudit(tx, { actorId: actorId(request), action: "employee.password_reset", entityType: "employee", entityId: employee.id });
    });
    response.json({ temporaryPassword });
  });

  router.post("/:id/reset-mfa", async (request, response) => {
    const employee = await load(request.params.id);
    await db.$transaction(async (tx) => {
      await tx.employee.update({ where: { id: employee.id }, data: { totpEnabled: false, totpSecret: null } });
      await tx.session.updateMany({ where: { employeeId: employee.id, revokedAt: null }, data: { revokedAt: context.now() } });
      await recordAudit(tx, { actorId: actorId(request), action: "employee.mfa_reset", entityType: "employee", entityId: employee.id });
    });
    response.status(204).end();
  });

  router.get("/:id/sessions", async (request, response) => {
    const employee = await load(request.params.id);
    const sessions = await db.session.findMany({
      where: { employeeId: employee.id, revokedAt: null, expiresAt: { gt: context.now() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, createdAt: true, lastSeenAt: true, userAgent: true, ipAddress: true },
    });
    response.json({ data: sessions });
  });

  router.post("/:id/revoke-sessions", async (request, response) => {
    const employee = await load(request.params.id);
    await db.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { employeeId: employee.id, revokedAt: null }, data: { revokedAt: context.now() },
      });
      await recordAudit(tx, {
        actorId: actorId(request), action: "employee.sessions_revoked", entityType: "employee", entityId: employee.id,
        after: { revoked: count },
      });
    });
    response.status(204).end();
  });

  return router;
}
