import { Router, type Request } from "express";
import { z } from "zod";
import { recordAudit } from "../../audit.js";
import { actorId, authenticate, can, requirePermission } from "../../auth/sessions.js";
import type { AppContext } from "../../context.js";
import { riyadhDayRange } from "../../domain/time.js";
import { CANCELLABLE_STATUSES, canTransitionOrder } from "../../domain/workflow.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { AppError, conflict, forbidden, notFound } from "../../http/errors.js";
import { normalizeSaudiMobile } from "../../phone.js";
import { presentAudit } from "../settings.js";
import {
  cancelInput, createOrderInput, listOrdersQuery, statusInput, updateOrderInput, versionInput,
} from "./schemas.js";
import { applyOrderInput, assertVersion, linesSummary, lockOrder, type Actor } from "./service.js";

export const orderDetailInclude = {
  lines: { orderBy: { position: "asc" }, include: { components: { orderBy: { position: "asc" } } } },
  driver: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  confirmedBy: { select: { id: true, name: true } },
  payments: {
    orderBy: { receivedAt: "asc" },
    include: { recordedBy: { select: { id: true, name: true } }, voidedBy: { select: { id: true, name: true } } },
  },
} as const satisfies Prisma.OrderInclude;

const FINANCIAL_FIELDS = ["paidAmount", "paymentStatus", "payments"] as const;

/** Payment details are only visible with view_payments. */
export function presentOrder<T extends { total: number; paidAmount: number; clientRequestId?: string | null }>(request: Request, order: T) {
  const { clientRequestId: _clientRequestId, ...rest } = order;
  if (can(request, "view_payments")) return { ...rest, balance: order.total - order.paidAmount };
  const visible: Record<string, unknown> = { ...rest };
  for (const field of FINANCIAL_FIELDS) delete visible[field];
  return visible;
}

export function actorFrom(request: Request): Actor {
  return { id: actorId(request), has: (permission) => can(request, permission) };
}

function searchFilter(raw: string | undefined): Prisma.OrderWhereInput {
  const q = raw?.trim();
  if (!q) return {};
  const phone = normalizeSaudiMobile(q);
  if (phone) return { OR: [{ customerPhone: phone }, { customer: { phone } }] };
  const digits = q.replace(/[\s\-.()+]/g, "");
  const conditions: Prisma.OrderWhereInput[] = [{ number: { contains: q, mode: "insensitive" } }];
  if (/^[0-9]{3,}$/.test(digits)) {
    conditions.push({ customerPhone: { contains: digits.replace(/^0+/, "") } });
  } else {
    conditions.push({ customerName: { contains: q, mode: "insensitive" } });
    conditions.push({ customer: { name: { contains: q, mode: "insensitive" } } });
  }
  return { OR: conditions };
}

function dateFilter(query: { date?: string; from?: string; to?: string }): Prisma.OrderWhereInput {
  try {
    if (query.date) {
      const { start, end } = riyadhDayRange(query.date);
      return { scheduledAt: { gte: start, lt: end } };
    }
    if (query.from || query.to) {
      return { scheduledAt: {
        ...(query.from ? { gte: riyadhDayRange(query.from).start } : {}),
        ...(query.to ? { lt: riyadhDayRange(query.to).end } : {}),
      } };
    }
  } catch {
    throw new AppError(400, "INVALID_INPUT", "Invalid date");
  }
  return {};
}

export function createOrdersRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  router.use(authenticate(context));

  const loadDetail = async (id: string) => {
    const order = await db.order.findUnique({ where: { id }, include: orderDetailInclude });
    if (!order) throw notFound("Order");
    return order;
  };
  const parseId = (id: unknown) => z.uuid().parse(id);

  router.get("/", requirePermission("view_orders"), async (request, response) => {
    const query = listOrdersQuery.parse(request.query);
    if (query.paymentStatus && !can(request, "view_payments")) throw forbidden();
    const where: Prisma.OrderWhereInput = {
      AND: [
        searchFilter(query.q),
        dateFilter(query),
        query.status ? { status: { in: query.status } } : {},
        query.paymentStatus ? { paymentStatus: { in: query.paymentStatus }, status: { not: "draft" } } : {},
        query.deliveryStatus ? { deliveryStatus: { in: query.deliveryStatus } } : {},
        query.fulfillmentType ? { fulfillmentType: query.fulfillmentType } : {},
        query.orderType ? { orderType: query.orderType } : {},
        query.customerId ? { customerId: query.customerId } : {},
        query.driverId ? { driverId: query.driverId } : {},
        query.archived === "exclude" ? { archivedAt: null } : query.archived === "only" ? { archivedAt: { not: null } } : {},
      ],
    };
    const [orders, total] = await db.$transaction([
      db.order.findMany({
        where,
        include: { driver: { select: { id: true, name: true } } },
        // Earliest scheduled first; unscheduled drafts last.
        orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { number: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.order.count({ where }),
    ]);
    response.json({
      data: orders.map((order) => presentOrder(request, order)),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    });
  });

  router.post("/", requirePermission("create_orders"), async (request, response) => {
    const input = createOrderInput.parse(request.body);
    const key = request.get("idempotency-key");
    const clientRequestId = key === undefined ? undefined : z.uuid().parse(key);
    if (clientRequestId) {
      const existing = await db.order.findUnique({ where: { clientRequestId } });
      if (existing) { response.status(200).json({ data: presentOrder(request, await loadDetail(existing.id)) }); return; }
    }
    let order;
    try {
      order = await db.$transaction((tx) => applyOrderInput(tx, input, null, actorFrom(request), context.now(), { clientRequestId }));
    } catch (error) {
      // A concurrent duplicate submit with the same key lost the race: return the winner.
      if (clientRequestId && typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        const existing = await db.order.findUnique({ where: { clientRequestId } });
        if (existing) { response.status(200).json({ data: presentOrder(request, await loadDetail(existing.id)) }); return; }
      }
      throw error;
    }
    response.location(`/api/orders/${order.id}`).status(201).json({ data: presentOrder(request, await loadDetail(order.id)) });
  });

  router.get("/:id", requirePermission("view_orders"), async (request, response) => {
    response.json({ data: presentOrder(request, await loadDetail(parseId(request.params.id))) });
  });

  router.patch("/:id", async (request, response) => {
    const { version, ...input } = updateOrderInput.parse(request.body);
    const id = parseId(request.params.id);
    await db.$transaction(async (tx) => {
      const current = await lockOrder(tx, id);
      assertVersion(current, version);
      return applyOrderInput(tx, input, current, actorFrom(request), context.now());
    });
    response.json({ data: presentOrder(request, await loadDetail(id)) });
  });

  router.post("/:id/confirm", requirePermission("confirm_orders"), async (request, response) => {
    const { version } = versionInput.parse(request.body);
    const id = parseId(request.params.id);
    const now = context.now();
    await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      assertVersion(order, version);
      if (order.status !== "draft") throw conflict("INVALID_TRANSITION", "Only drafts can be confirmed");
      if (order.archivedAt) throw conflict("ORDER_ARCHIVED", "Restore this draft before confirming it");
      const problems: string[] = [];
      if (order.lines.length === 0) problems.push("lines");
      if (!order.scheduledAt) problems.push("scheduledAt");
      else if (order.scheduledAt.getTime() < now.getTime() - 24 * 3_600_000) problems.push("scheduledAt_past");
      if (order.fulfillmentType === "delivery" && !order.deliveryAddress) problems.push("deliveryAddress");
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: order.customerId } });
      if (customer.archivedAt) problems.push("customer_archived");
      if (problems.length) throw new AppError(422, "ORDER_INCOMPLETE", "The order is not ready to confirm", { problems });
      await tx.order.update({
        where: { id },
        data: {
          status: "confirmed", confirmedAt: now, confirmedById: actorId(request), updatedById: actorId(request),
          customerName: customer.name, customerPhone: customer.phone, version: { increment: 1 },
        },
      });
      // The confirmed pricing snapshot, kept immutably in the audit trail.
      await recordAudit(tx, {
        actorId: actorId(request), action: "order.confirm", entityType: "order", entityId: id,
        after: {
          lines: linesSummary(order.lines), subtotal: order.subtotal, discountAmount: order.discountAmount,
          deliveryFee: order.deliveryFee, total: order.total, vatAmount: order.vatAmount, vatRateBp: order.vatRateBp,
          scheduledAt: order.scheduledAt,
        },
      });
    });
    response.json({ data: presentOrder(request, await loadDetail(id)) });
  });

  router.post("/:id/status", requirePermission("update_order_status"), async (request, response) => {
    const input = statusInput.parse(request.body);
    const id = parseId(request.params.id);
    await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      assertVersion(order, input.version);
      if (!canTransitionOrder(order.status, input.status)) {
        throw conflict("INVALID_TRANSITION", `Cannot move an order from ${order.status} to ${input.status}`);
      }
      const backwards = ["confirmed", "preparing"].includes(input.status) && order.status !== "confirmed";
      if (backwards && !input.reason) throw new AppError(400, "REASON_REQUIRED", "A reason is required to move an order back");
      await tx.order.update({
        where: { id },
        data: {
          status: input.status, updatedById: actorId(request), version: { increment: 1 },
          completedAt: input.status === "completed" ? context.now() : undefined,
        },
      });
      await recordAudit(tx, {
        actorId: actorId(request), action: "order.status", entityType: "order", entityId: id,
        before: { status: order.status }, after: { status: input.status }, reason: input.reason,
      });
    });
    response.json({ data: presentOrder(request, await loadDetail(id)) });
  });

  router.post("/:id/cancel", requirePermission("cancel_order"), async (request, response) => {
    const input = cancelInput.parse(request.body);
    const id = parseId(request.params.id);
    await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      assertVersion(order, input.version);
      if (!CANCELLABLE_STATUSES.includes(order.status)) {
        throw conflict("INVALID_TRANSITION", order.status === "draft" ? "Archive drafts instead of cancelling them" : "This order cannot be cancelled");
      }
      const releaseDriver = order.deliveryStatus && ["unassigned", "assigned", "failed"].includes(order.deliveryStatus);
      await tx.order.update({
        where: { id },
        data: {
          status: "cancelled", cancelledAt: context.now(), cancelReason: input.reason,
          updatedById: actorId(request), version: { increment: 1 },
          ...(releaseDriver ? { driverId: null, deliveryStatus: "unassigned" } : {}),
        },
      });
      // Cancelling never refunds automatically; settlement is a separate, permissioned step.
      await recordAudit(tx, {
        actorId: actorId(request), action: "order.cancel", entityType: "order", entityId: id,
        before: { status: order.status, paidAmount: order.paidAmount }, after: { status: "cancelled" }, reason: input.reason,
      });
    });
    response.json({ data: presentOrder(request, await loadDetail(id)) });
  });

  router.post("/:id/archive", requirePermission("create_orders"), async (request, response) => {
    const { version } = versionInput.parse(request.body);
    const id = parseId(request.params.id);
    await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      assertVersion(order, version);
      if (order.status !== "draft") throw conflict("INVALID_TRANSITION", "Only drafts can be archived");
      if (order.archivedAt) return;
      await tx.order.update({ where: { id }, data: { archivedAt: context.now(), updatedById: actorId(request), version: { increment: 1 } } });
      await recordAudit(tx, { actorId: actorId(request), action: "order.archive", entityType: "order", entityId: id });
    });
    response.json({ data: presentOrder(request, await loadDetail(id)) });
  });

  router.post("/:id/restore", requirePermission("restore_draft_orders"), async (request, response) => {
    const { version } = versionInput.parse(request.body);
    const id = parseId(request.params.id);
    await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      assertVersion(order, version);
      if (!order.archivedAt) return;
      await tx.order.update({ where: { id }, data: { archivedAt: null, updatedById: actorId(request), version: { increment: 1 } } });
      await recordAudit(tx, { actorId: actorId(request), action: "order.restore", entityType: "order", entityId: id });
    });
    response.json({ data: presentOrder(request, await loadDetail(id)) });
  });

  router.get("/:id/audit", requirePermission("view_orders"), async (request, response) => {
    const id = parseId(request.params.id);
    if (!(await db.order.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Order");
    const rows = await db.auditLog.findMany({
      where: { entityType: "order", entityId: id,
        // Payment entries reveal amounts, so they follow the payment permission.
        ...(can(request, "view_payments") ? {} : { NOT: { action: { startsWith: "payment." } } }) },
      orderBy: { id: "asc" },
      include: { actor: { select: { id: true, name: true } } },
    });
    response.json({ data: rows.map(presentAudit) });
  });

  return router;
}
