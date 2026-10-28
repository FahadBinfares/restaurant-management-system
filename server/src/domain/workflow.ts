import type { DeliveryStatus, OrderStatus } from "../generated/prisma/enums.js";

/**
 * Order status transitions reachable through POST /orders/:id/status.
 * Confirmation and cancellation have dedicated endpoints and permissions.
 * One-step backward moves exist to correct mistakes. See docs/DECISIONS.md §4.
 */
const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: [],
  confirmed: ["preparing"],
  preparing: ["ready", "confirmed"],
  ready: ["completed", "preparing"],
  completed: [],
  cancelled: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus) {
  return ORDER_TRANSITIONS[from].includes(to);
}

export const CANCELLABLE_STATUSES: readonly OrderStatus[] = ["confirmed", "preparing", "ready"];
/** Statuses whose details may still be edited (with the right permissions). */
export const EDITABLE_STATUSES: readonly OrderStatus[] = ["draft", "confirmed", "preparing", "ready"];
/** Once preparation starts, moving the schedule needs override_order_schedule. */
export const SCHEDULE_LOCKED_STATUSES: readonly OrderStatus[] = ["preparing", "ready"];
/** Orders the kitchen must prepare; payment status never excludes an order. */
export const KITCHEN_STATUSES: readonly OrderStatus[] = ["confirmed", "preparing", "ready"];
/** Orders that are live operational commitments. */
export const ACTIVE_STATUSES: readonly OrderStatus[] = ["confirmed", "preparing", "ready"];

/** Delivery transitions via POST /orders/:id/delivery/status (assignment has its own endpoint). */
const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  unassigned: [],
  assigned: ["out_for_delivery"],
  out_for_delivery: ["delivered", "failed"],
  delivered: [],
  failed: [],
};

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus) {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

/** Driver (re)assignment is possible before departure, or to retry a failed delivery. */
export const ASSIGNABLE_DELIVERY_STATUSES: readonly DeliveryStatus[] = ["unassigned", "assigned", "failed"];
