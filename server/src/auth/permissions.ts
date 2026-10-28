import type { Role } from "../generated/prisma/enums.js";

/**
 * Every permission the backend enforces. Role defaults are a starting point;
 * administrators can grant or revoke any permission per employee.
 * See docs/DECISIONS.md for the matrix rationale.
 */
export const PERMISSIONS = [
  // Customers
  "view_customers",
  "manage_customers",
  "change_customer_phone",
  "archive_customers",
  // Catalog
  "manage_products",
  // Orders
  "view_orders",
  "create_orders",
  "confirm_orders",
  "edit_confirmed_orders",
  "update_order_status",
  "override_order_price",
  "override_order_schedule",
  "apply_discount",
  "cancel_order",
  "restore_draft_orders",
  // Payments
  "view_payments",
  "record_payments",
  "void_payments",
  "settle_cancelled_order",
  // Delivery
  "manage_drivers",
  "assign_drivers",
  "update_delivery_status",
  // Reports and dashboard
  "view_kitchen_reports",
  "print_kitchen_reports",
  "view_financial_reports",
  // Administration
  "manage_employees",
  "manage_settings",
  "view_audit_log",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  reception: [
    "view_customers", "manage_customers",
    "view_orders", "create_orders", "confirm_orders", "edit_confirmed_orders",
    "view_payments", "record_payments",
    "view_kitchen_reports",
  ],
  operations: [
    "view_customers",
    "view_orders", "update_order_status",
    "manage_drivers", "assign_drivers", "update_delivery_status",
    "view_kitchen_reports", "print_kitchen_reports",
  ],
};

export function effectivePermissions(
  role: Role,
  overrides: readonly { permission: string; granted: boolean }[],
): Set<Permission> {
  const result = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const override of overrides) {
    if (!isPermission(override.permission)) continue;
    if (override.granted) result.add(override.permission);
    else result.delete(override.permission);
  }
  return result;
}
