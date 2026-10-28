import { recordAudit } from "../audit.js";
import type { AppContext } from "../context.js";

/**
 * Archives drafts untouched for longer than the configured period. Archived drafts
 * are hidden from normal lists but kept, and can be restored with restore_draft_orders.
 */
export async function archiveStaleDrafts(context: AppContext) {
  const { db } = context;
  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  const cutoff = new Date(context.now().getTime() - settings.draftArchiveDays * 86_400_000);
  return db.$transaction(async (tx) => {
    const stale = await tx.order.findMany({
      where: { status: "draft", archivedAt: null, updatedAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const { id } of stale) {
      await tx.order.update({ where: { id }, data: { archivedAt: context.now(), version: { increment: 1 } } });
      await recordAudit(tx, {
        actorId: null, action: "order.auto_archive", entityType: "order", entityId: id,
        reason: `Inactive for more than ${settings.draftArchiveDays} days`,
      });
    }
    return stale.length;
  });
}
