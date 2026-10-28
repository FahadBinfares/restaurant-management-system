import { Router } from "express";
import { z } from "zod";
import { diff, recordAudit } from "../audit.js";
import { actorId, authenticate, requirePermission } from "../auth/sessions.js";
import type { AppContext } from "../context.js";
import { riyadhDayRange } from "../domain/time.js";
import { ASSIGNABLE_DELIVERY_STATUSES, canTransitionDelivery } from "../domain/workflow.js";
import { AppError, conflict, notFound } from "../http/errors.js";
import { isoDate, optionalText, phoneSchema } from "../http/schemas.js";
import { lockOrder } from "./orders/service.js";

/** Two deliveries for one driver closer than this are a scheduling conflict. */
export const DRIVER_CONFLICT_WINDOW_MINUTES = 60;

const driverInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  notes: optionalText(500),
  active: z.boolean().optional(),
});
const assignInput = z.strictObject({ driverId: z.uuid().nullable(), force: z.boolean().default(false) });
const statusInput = z.strictObject({
  status: z.enum(["out_for_delivery", "delivered", "failed"]),
  reason: z.string().trim().min(3).max(500).optional(),
});

const scheduleSelect = {
  id: true, number: true, scheduledAt: true, status: true, deliveryStatus: true,
  customerName: true, deliveryAddress: true, deliveryMapsUrl: true,
} as const;

export function createDeliveryRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  router.use(authenticate(context));

  router.get("/drivers", requirePermission("view_orders"), async (request, response) => {
    const includeInactive = request.query.includeInactive === "true";
    const data = await db.driver.findMany({ where: includeInactive ? {} : { active: true }, orderBy: { name: "asc" } });
    response.json({ data });
  });

  router.post("/drivers", requirePermission("manage_drivers"), async (request, response) => {
    const input = driverInput.parse(request.body);
    const driver = await db.$transaction(async (tx) => {
      const created = await tx.driver.create({ data: input });
      await recordAudit(tx, { actorId: actorId(request), action: "driver.create", entityType: "driver", entityId: created.id, after: input });
      return created;
    });
    response.status(201).json({ data: driver });
  });

  router.patch("/drivers/:id", requirePermission("manage_drivers"), async (request, response) => {
    const input = driverInput.partial().parse(request.body);
    const existing = await db.driver.findUnique({ where: { id: z.uuid().parse(request.params.id) } });
    if (!existing) throw notFound("Driver");
    const changes = diff(existing, input);
    const driver = await db.$transaction(async (tx) => {
      const updated = await tx.driver.update({ where: { id: existing.id }, data: input });
      if (changes.changed) {
        await recordAudit(tx, { actorId: actorId(request), action: "driver.update", entityType: "driver", entityId: existing.id, ...changes });
      }
      return updated;
    });
    response.json({ data: driver });
  });

  router.get("/drivers/:id/schedule", requirePermission("view_orders"), async (request, response) => {
    const id = z.uuid().parse(request.params.id);
    const { date } = z.strictObject({ date: isoDate }).parse(request.query);
    let range;
    try { range = riyadhDayRange(date); } catch { throw new AppError(400, "INVALID_INPUT", "Invalid date"); }
    const orders = await db.order.findMany({
      where: { driverId: id, scheduledAt: { gte: range.start, lt: range.end }, status: { not: "cancelled" } },
      orderBy: { scheduledAt: "asc" },
      select: scheduleSelect,
    });
    response.json({ data: orders });
  });

  router.post("/orders/:id/delivery/assign", requirePermission("assign_drivers"), async (request, response) => {
    const input = assignInput.parse(request.body);
    const orderId = z.uuid().parse(request.params.id);
    const result = await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      if (order.fulfillmentType !== "delivery") throw conflict("NOT_DELIVERY", "Pickup orders have no driver");
      if (["draft", "cancelled", "completed"].includes(order.status)) {
        throw conflict("ORDER_NOT_ACTIVE", "Drivers can only be assigned to confirmed, active orders");
      }
      if (!ASSIGNABLE_DELIVERY_STATUSES.includes(order.deliveryStatus!)) {
        throw conflict("INVALID_TRANSITION", "The driver cannot be changed once the order is out for delivery");
      }
      if (input.driverId === null) {
        await tx.order.update({ where: { id: orderId }, data: { driverId: null, deliveryStatus: "unassigned" } });
        await recordAudit(tx, {
          actorId: actorId(request), action: "delivery.unassign", entityType: "order", entityId: orderId,
          before: { driverId: order.driverId, deliveryStatus: order.deliveryStatus },
        });
        return { conflicts: [] };
      }
      const driver = await tx.driver.findUnique({ where: { id: input.driverId } });
      if (!driver || !driver.active) throw notFound("Driver");
      const windowMs = DRIVER_CONFLICT_WINDOW_MINUTES * 60_000;
      const scheduled = order.scheduledAt!;
      const conflicts = await tx.order.findMany({
        where: {
          id: { not: orderId }, driverId: driver.id,
          status: { notIn: ["cancelled", "completed"] },
          deliveryStatus: { in: ["assigned", "out_for_delivery"] },
          scheduledAt: { gt: new Date(scheduled.getTime() - windowMs), lt: new Date(scheduled.getTime() + windowMs) },
        },
        select: scheduleSelect,
      });
      if (conflicts.length > 0 && !input.force) {
        throw conflict("DRIVER_CONFLICT", "The driver has another delivery close to this time", { conflicts });
      }
      await tx.order.update({
        where: { id: orderId },
        data: { driverId: driver.id, deliveryStatus: "assigned", deliveryFailureReason: null },
      });
      await recordAudit(tx, {
        actorId: actorId(request), action: "delivery.assign", entityType: "order", entityId: orderId,
        before: { driverId: order.driverId, deliveryStatus: order.deliveryStatus },
        after: { driverId: driver.id, driverName: driver.name, overrodeConflicts: conflicts.map((c) => c.number) },
      });
      return { conflicts };
    });
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId }, select: { ...scheduleSelect, driver: { select: { id: true, name: true, phone: true } } },
    });
    response.json({ data: order, conflicts: result.conflicts });
  });

  router.post("/orders/:id/delivery/status", requirePermission("update_delivery_status"), async (request, response) => {
    const input = statusInput.parse(request.body);
    const orderId = z.uuid().parse(request.params.id);
    await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      if (order.fulfillmentType !== "delivery" || !order.deliveryStatus) throw conflict("NOT_DELIVERY", "Pickup orders have no delivery status");
      if (["draft", "cancelled"].includes(order.status)) throw conflict("ORDER_NOT_ACTIVE", "This order is not active");
      if (!canTransitionDelivery(order.deliveryStatus, input.status)) {
        throw conflict("INVALID_TRANSITION", `Cannot move delivery from ${order.deliveryStatus} to ${input.status}`);
      }
      if (input.status === "failed" && !input.reason) throw new AppError(400, "REASON_REQUIRED", "Describe why the delivery failed");
      await tx.order.update({
        where: { id: orderId },
        data: {
          deliveryStatus: input.status,
          deliveredAt: input.status === "delivered" ? context.now() : undefined,
          deliveryFailureReason: input.status === "failed" ? input.reason : null,
        },
      });
      await recordAudit(tx, {
        actorId: actorId(request), action: "delivery.status", entityType: "order", entityId: orderId,
        before: { deliveryStatus: order.deliveryStatus }, after: { deliveryStatus: input.status }, reason: input.reason,
      });
    });
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { ...scheduleSelect, deliveredAt: true, deliveryFailureReason: true, driver: { select: { id: true, name: true } } },
    });
    response.json({ data: order });
  });

  return router;
}
