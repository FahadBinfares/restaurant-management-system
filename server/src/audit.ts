import type { Prisma } from "./generated/prisma/client.js";
import type { Db, Tx } from "./context.js";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}

const toJson = (value: unknown) => value === undefined || value === null
  ? undefined : JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Append an audit entry; call inside the same transaction as the audited change. */
export async function recordAudit(db: Db | Tx, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason ?? null,
    },
  });
}

/** Keep only the fields that changed, so audit rows show a readable diff. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const previous = before[key];
    const next = after[key];
    const same = previous instanceof Date && next instanceof Date
      ? previous.getTime() === next.getTime() : JSON.stringify(previous) === JSON.stringify(next);
    if (next !== undefined && !same) {
      changedBefore[key] = previous;
      changedAfter[key] = next;
    }
  }
  return { before: changedBefore, after: changedAfter, changed: Object.keys(changedAfter).length > 0 };
}
