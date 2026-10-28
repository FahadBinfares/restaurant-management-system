import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { actorId, authenticate, can, requirePermission } from "../auth/sessions.js";
import type { AppContext } from "../context.js";
import { riyadhDate, riyadhDayRange } from "../domain/time.js";
import { ACTIVE_STATUSES, KITCHEN_STATUSES } from "../domain/workflow.js";
import { AppError } from "../http/errors.js";
import { isoDate } from "../http/schemas.js";

function dayRange(date: string) {
  try { return riyadhDayRange(date); } catch { throw new AppError(400, "INVALID_INPUT", "Invalid date"); }
}

/** Orders the kitchen must prepare on a Riyadh calendar day, regardless of payment status. */
export async function kitchenOrders(context: AppContext, date: string) {
  const { start, end } = dayRange(date);
  return context.db.order.findMany({
    where: { status: { in: [...KITCHEN_STATUSES] }, scheduledAt: { gte: start, lt: end } },
    orderBy: [{ scheduledAt: "asc" }, { number: "asc" }],
    select: {
      id: true, number: true, status: true, orderType: true, scheduledAt: true, fulfillmentType: true,
      customerName: true, guestCount: true, deliveryAddress: true, kitchenNotes: true, updatedAt: true,
      driver: { select: { name: true } },
      lines: {
        orderBy: { position: "asc" },
        select: {
          kind: true, name: true, quantity: true, notes: true,
          components: { orderBy: { position: "asc" }, select: { name: true, quantity: true } },
        },
      },
    },
  });
}

export function createReportsRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  router.use(authenticate(context));

  router.get("/reports/kitchen", requirePermission("view_kitchen_reports"), async (request, response) => {
    const { date } = z.strictObject({ date: isoDate }).parse(request.query);
    response.json({ data: await kitchenOrders(context, date), date, generatedAt: context.now() });
  });

  router.post("/reports/kitchen/print", requirePermission("print_kitchen_reports"), async (request, response) => {
    const { date } = z.strictObject({ date: isoDate }).parse(request.body);
    const orders = await kitchenOrders(context, date);
    await recordAudit(db, {
      actorId: actorId(request), action: "kitchen_report.print", entityType: "kitchen_report", entityId: date,
      after: { orders: orders.map((order) => order.number) },
    });
    response.status(204).end();
  });

  router.get("/dashboard", async (request, response) => {
    const now = context.now();
    const today = riyadhDate(now);
    const { start, end } = dayRange(today);
    const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
    const leadEnd = new Date(now.getTime() + settings.alertLeadMinutes * 60_000);
    const alertSelect = {
      id: true, number: true, customerName: true, scheduledAt: true, status: true,
      fulfillmentType: true, deliveryStatus: true, deliveryFailureReason: true, driver: { select: { name: true } },
    } as const;

    const [todayByStatus, upcoming, delayed, deliveryProblems] = await Promise.all([
      db.order.groupBy({
        by: ["status"], where: { scheduledAt: { gte: start, lt: end }, archivedAt: null }, _count: { _all: true },
      }),
      db.order.findMany({
        where: { status: { in: [...ACTIVE_STATUSES] }, scheduledAt: { gte: now, lte: leadEnd } },
        orderBy: { scheduledAt: "asc" }, select: alertSelect, take: 50,
      }),
      db.order.findMany({
        where: { status: { in: [...ACTIVE_STATUSES] }, scheduledAt: { lt: now } },
        orderBy: { scheduledAt: "asc" }, select: alertSelect, take: 50,
      }),
      db.order.findMany({
        where: {
          status: { in: [...ACTIVE_STATUSES] },
          OR: [
            { deliveryStatus: "failed" },
            { deliveryStatus: "unassigned", scheduledAt: { lte: leadEnd } },
          ],
        },
        orderBy: { scheduledAt: "asc" }, select: alertSelect, take: 50,
      }),
    ]);
    const counts = Object.fromEntries(todayByStatus.map((row) => [row.status, row._count._all]));

    let financial;
    if (can(request, "view_financial_reports")) {
      const [outstanding, received] = await Promise.all([
        db.$queryRaw<{ count: bigint; amount: bigint | null }[]>`
          SELECT COUNT(*) AS "count", SUM("total" - "paidAmount") AS "amount" FROM "Order"
          WHERE "status" NOT IN ('draft', 'cancelled') AND "paidAmount" < "total"`,
        db.payment.groupBy({
          by: ["kind"], where: { voidedAt: null, receivedAt: { gte: start, lt: end } }, _sum: { amount: true },
        }),
      ]);
      const sum = (kind: string) => received.find((row) => row.kind === kind)?._sum.amount ?? 0;
      financial = {
        outstandingOrders: Number(outstanding[0]?.count ?? 0),
        outstandingAmount: Number(outstanding[0]?.amount ?? 0),
        receivedToday: sum("payment") - sum("refund"),
      };
    }

    response.json({
      data: {
        date: today,
        alertLeadMinutes: settings.alertLeadMinutes,
        today: {
          total: Object.entries(counts).filter(([status]) => status !== "draft").reduce((sum, [, count]) => sum + count, 0),
          confirmed: counts.confirmed ?? 0,
          preparing: counts.preparing ?? 0,
          ready: counts.ready ?? 0,
          completed: counts.completed ?? 0,
          cancelled: counts.cancelled ?? 0,
          drafts: counts.draft ?? 0,
        },
        upcoming, delayed, deliveryProblems, financial,
      },
    });
  });

  return router;
}
