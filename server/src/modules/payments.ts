import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../audit.js";
import { actorId, authenticate, can, requirePermission } from "../auth/sessions.js";
import type { AppContext, Tx } from "../context.js";
import { paymentStatus } from "../domain/pricing.js";
import { riyadhDayRange } from "../domain/time.js";
import { AppError, conflict, forbidden, notFound } from "../http/errors.js";
import { isoDate, optionalText } from "../http/schemas.js";
import { halalas } from "./catalog.js";
import { lockOrder } from "./orders/service.js";

const paymentInput = z.strictObject({
  kind: z.enum(["payment", "refund"]).default("payment"),
  method: z.enum(["cash", "bank_transfer", "card_pos", "payment_link"]),
  amount: halalas.min(1),
  reference: optionalText(120),
  notes: optionalText(500),
  receivedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  /** Client-generated key so a double-clicked "save" records one payment. */
  clientRequestId: z.uuid().optional(),
});
const voidInput = z.strictObject({ reason: z.string().trim().min(3).max(500) });

const paymentInclude = {
  recordedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
} as const;

/** Recomputes the order's net paid amount from the ledger; call with the order row locked. */
async function refreshPaid(tx: Tx, orderId: string, total: number) {
  const rows = await tx.payment.groupBy({
    by: ["kind"], where: { orderId, voidedAt: null }, _sum: { amount: true },
  });
  const sum = (kind: string) => rows.find((row) => row.kind === kind)?._sum.amount ?? 0;
  const paidAmount = sum("payment") - sum("refund");
  await tx.order.update({ where: { id: orderId }, data: { paidAmount, paymentStatus: paymentStatus(total, paidAmount) } });
  return paidAmount;
}

export function createPaymentsRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  router.use(authenticate(context));

  router.get("/orders/:id/payments", requirePermission("view_payments"), async (request, response) => {
    const orderId = z.uuid().parse(request.params.id);
    const order = await db.order.findUnique({ where: { id: orderId }, select: { total: true, paidAmount: true, paymentStatus: true } });
    if (!order) throw notFound("Order");
    const payments = await db.payment.findMany({ where: { orderId }, orderBy: { receivedAt: "asc" }, include: paymentInclude });
    response.json({ data: payments, summary: { ...order, balance: order.total - order.paidAmount } });
  });

  router.post("/orders/:id/payments", async (request, response) => {
    const input = paymentInput.parse(request.body);
    const orderId = z.uuid().parse(request.params.id);
    if (!can(request, input.kind === "refund" ? "settle_cancelled_order" : "record_payments")) throw forbidden();
    if (input.clientRequestId) {
      const existing = await db.payment.findUnique({ where: { clientRequestId: input.clientRequestId }, include: paymentInclude });
      if (existing) {
        if (existing.orderId !== orderId) throw conflict("IDEMPOTENCY_KEY_REUSED", "This request key belongs to another order");
        response.status(200).json({ data: existing });
        return;
      }
    }
    const now = context.now();
    const receivedAt = input.receivedAt ?? now;
    if (receivedAt.getTime() > now.getTime() + 5 * 60_000) {
      throw new AppError(400, "INVALID_INPUT", "Payment time cannot be in the future");
    }
    const payment = await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, orderId);
      if (order.status === "draft") throw conflict("ORDER_NOT_CONFIRMED", "Confirm the order before recording payments");
      if (input.kind === "payment") {
        if (order.status === "cancelled") throw conflict("ORDER_CANCELLED", "Cannot record payments on a cancelled order");
        const balance = order.total - order.paidAmount;
        if (input.amount > balance) {
          throw new AppError(422, "AMOUNT_EXCEEDS_BALANCE", "Amount exceeds the outstanding balance", { balance });
        }
      } else {
        // Refunds: the whole net paid amount on a cancelled order, otherwise only an overpayment.
        const refundable = order.status === "cancelled" ? order.paidAmount : Math.max(0, order.paidAmount - order.total);
        if (input.amount > refundable) {
          throw new AppError(422, "AMOUNT_EXCEEDS_REFUNDABLE", "Amount exceeds what can be refunded", { refundable });
        }
      }
      const { receivedAt: _receivedAt, ...fields } = input;
      const created = await tx.payment.create({
        data: { ...fields, receivedAt, orderId, recordedById: actorId(request) },
        include: paymentInclude,
      });
      const paidAmount = await refreshPaid(tx, orderId, order.total);
      await recordAudit(tx, {
        actorId: actorId(request), action: input.kind === "refund" ? "payment.refund" : "payment.record",
        entityType: "order", entityId: orderId,
        before: { paidAmount: order.paidAmount },
        after: { paymentId: created.id, method: input.method, amount: input.amount, paidAmount },
      });
      return created;
    });
    response.status(201).json({ data: payment });
  });

  // Mistakes are corrected by voiding; payment rows are never edited or deleted (DB-enforced).
  router.post("/payments/:id/void", requirePermission("void_payments"), async (request, response) => {
    const { reason } = voidInput.parse(request.body);
    const id = z.uuid().parse(request.params.id);
    const payment = await db.payment.findUnique({ where: { id } });
    if (!payment) throw notFound("Payment");
    const updated = await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, payment.orderId);
      const current = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (current.voidedAt) throw conflict("ALREADY_VOIDED", "This payment is already voided");
      const result = await tx.payment.update({
        where: { id },
        data: { voidedAt: context.now(), voidedById: actorId(request), voidReason: reason },
        include: paymentInclude,
      });
      const paidAmount = await refreshPaid(tx, order.id, order.total);
      await recordAudit(tx, {
        actorId: actorId(request), action: "payment.void", entityType: "order", entityId: order.id,
        before: { paidAmount: order.paidAmount }, after: { paymentId: id, kind: current.kind, amount: current.amount, paidAmount },
        reason,
      });
      return result;
    });
    response.json({ data: updated });
  });

  router.get("/customers/:id/balance", requirePermission("view_payments"), async (request, response) => {
    const customerId = z.uuid().parse(request.params.id);
    const orders = await db.order.findMany({
      where: { customerId, status: { notIn: ["draft", "cancelled"] } },
      select: { total: true, paidAmount: true },
    });
    const total = orders.reduce((sum, order) => sum + order.total, 0);
    const paid = orders.reduce((sum, order) => sum + order.paidAmount, 0);
    const outstanding = orders.reduce((sum, order) => sum + Math.max(0, order.total - order.paidAmount), 0);
    response.json({ data: { orders: orders.length, total, paid, outstanding } });
  });

  const ledgerQuery = z.strictObject({ date: isoDate });
  router.get("/payments", requirePermission("view_financial_reports"), async (request, response) => {
    const { date } = ledgerQuery.parse(request.query);
    let range;
    try { range = riyadhDayRange(date); } catch { throw new AppError(400, "INVALID_INPUT", "Invalid date"); }
    const payments = await db.payment.findMany({
      where: { receivedAt: { gte: range.start, lt: range.end } },
      orderBy: { receivedAt: "asc" },
      include: { ...paymentInclude, order: { select: { id: true, number: true, customerName: true } } },
    });
    const valid = payments.filter((payment) => !payment.voidedAt);
    const byMethod: Record<string, number> = {};
    for (const payment of valid) {
      byMethod[payment.method] = (byMethod[payment.method] ?? 0) + (payment.kind === "refund" ? -payment.amount : payment.amount);
    }
    const net = Object.values(byMethod).reduce((sum, value) => sum + value, 0);
    response.json({ data: payments, summary: { byMethod, net } });
  });

  return router;
}
