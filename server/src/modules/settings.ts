import { Router } from "express";
import { z } from "zod";
import { diff, recordAudit } from "../audit.js";
import { actorId, authenticate, requirePermission } from "../auth/sessions.js";
import type { AppContext } from "../context.js";
import { pageQuery } from "../http/schemas.js";

const settingsInput = z.strictObject({
  sessionIdleMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  draftArchiveDays: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  alertLeadMinutes: z.union([z.literal(30), z.literal(60), z.literal(120)]).optional(),
});

const present = ({ sessionIdleMinutes, draftArchiveDays, alertLeadMinutes, updatedAt }: {
  sessionIdleMinutes: number; draftArchiveDays: number; alertLeadMinutes: number; updatedAt: Date;
}) => ({ sessionIdleMinutes, draftArchiveDays, alertLeadMinutes, updatedAt });

export function createSettingsRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  router.use(authenticate(context));

  router.get("/", async (_request, response) => {
    response.json({ data: present(await db.settings.findUniqueOrThrow({ where: { id: 1 } })) });
  });

  router.patch("/", requirePermission("manage_settings"), async (request, response) => {
    const input = settingsInput.parse(request.body);
    const updated = await db.$transaction(async (tx) => {
      const current = await tx.settings.findUniqueOrThrow({ where: { id: 1 } });
      const changes = diff(current, input);
      if (!changes.changed) return current;
      await recordAudit(tx, { actorId: actorId(request), action: "settings.update", entityType: "settings", entityId: "1", ...changes });
      return tx.settings.update({ where: { id: 1 }, data: input });
    });
    response.json({ data: present(updated) });
  });

  return router;
}

const auditQuery = z.strictObject({
  ...pageQuery,
  entityType: z.string().max(32).optional(),
  entityId: z.string().max(64).optional(),
  action: z.string().max(64).optional(),
});

export function createAuditRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  router.use(authenticate(context), requirePermission("view_audit_log"));

  router.get("/", async (request, response) => {
    const { page, pageSize, ...filters } = auditQuery.parse(request.query);
    const where = {
      entityType: filters.entityType, entityId: filters.entityId,
      action: filters.action ? { startsWith: filters.action } : undefined,
    };
    const [rows, total] = await db.$transaction([
      db.auditLog.findMany({
        where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
        include: { actor: { select: { id: true, name: true } } },
      }),
      db.auditLog.count({ where }),
    ]);
    response.json({ data: rows.map(presentAudit), pagination: { page, pageSize, total } });
  });

  return router;
}

export function presentAudit(row: {
  id: bigint; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown;
  reason: string | null; createdAt: Date; actor: { id: string; name: string } | null;
}) {
  return { ...row, id: row.id.toString() };
}
