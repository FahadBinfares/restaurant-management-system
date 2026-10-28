/** Shapes returned by the backend API (money in integer halalas, dates as ISO strings). */

export type Role = "admin" | "reception" | "operations";
export type OrderStatus = "draft" | "confirmed" | "preparing" | "ready" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "partially_paid" | "paid";
export type DeliveryStatus = "unassigned" | "assigned" | "out_for_delivery" | "delivered" | "failed";
export type PaymentMethod = "cash" | "bank_transfer" | "card_pos" | "payment_link";
export type FulfillmentType = "delivery" | "pickup";
export type OrderType = "banquet" | "individual";

export interface Page<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number };
}

export interface Me {
  employee: { id: string; name: string; phone: string; role: Role; mustChangePassword: boolean; totpEnabled: boolean };
  permissions: string[];
  setupRequired: "PASSWORD_CHANGE_REQUIRED" | "MFA_SETUP_REQUIRED" | null;
  sessionId: string;
  settings: { sessionIdleMinutes: number; alertLeadMinutes: number };
}

export interface Address {
  id: string;
  label: string;
  details: string;
  mapsUrl: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  addresses: Address[];
}

export interface Category { id: string; name: string; sortOrder: number; active: boolean }
export interface Product {
  id: string; categoryId: string; name: string; description: string | null; price: number; active: boolean;
  category?: { id: string; name: string };
}
export interface CatalogPackage {
  id: string; name: string; description: string | null; guestCount: number | null; price: number; active: boolean;
  items: { id: string; productId: string; quantity: number; product: { id: string; name: string; active: boolean } }[];
}

export interface OrderLineComponent { id?: string; productId: string | null; name: string; quantity: number }
export interface OrderLine {
  id: string;
  kind: "product" | "package" | "custom";
  productId: string | null;
  packageId: string | null;
  name: string;
  catalogPrice: number | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  priceOverrideReason: string | null;
  notes: string | null;
  components: OrderLineComponent[];
}

export interface Payment {
  id: string;
  kind: "payment" | "refund";
  method: PaymentMethod;
  amount: number;
  reference: string | null;
  notes: string | null;
  receivedAt: string;
  recordedBy: { id: string; name: string };
  voidedAt: string | null;
  voidedBy: { id: string; name: string } | null;
  voidReason: string | null;
}

export interface OrderSummary {
  id: string;
  number: string;
  orderType: OrderType;
  status: OrderStatus;
  customerId: string;
  customerName: string;
  customerPhone: string;
  fulfillmentType: FulfillmentType;
  scheduledAt: string | null;
  total: number;
  deliveryStatus: DeliveryStatus | null;
  driver: { id: string; name: string; phone?: string } | null;
  archivedAt: string | null;
  version: number;
  updatedAt: string;
  /** Present only with view_payments. */
  paidAmount?: number;
  paymentStatus?: PaymentStatus;
  balance?: number;
}

export interface Order extends OrderSummary {
  guestCount: number | null;
  deliveryAddress: string | null;
  deliveryMapsUrl: string | null;
  deliveryNotes: string | null;
  kitchenNotes: string | null;
  deliveryFee: number;
  discountType: "none" | "fixed" | "percent";
  discountValue: number;
  discountReason: string | null;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  vatRateBp: number;
  deliveryFailureReason: string | null;
  deliveredAt: string | null;
  confirmedAt: string | null;
  cancelReason: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  updatedBy: { id: string; name: string };
  confirmedBy: { id: string; name: string } | null;
  lines: OrderLine[];
  payments?: Payment[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface Driver { id: string; name: string; phone: string; notes: string | null; active: boolean }

export interface Employee {
  id: string; name: string; phone: string; role: Role; active: boolean; mustChangePassword: boolean;
  totpEnabled: boolean; locked: boolean; grants: string[]; revokes: string[]; permissions: string[]; createdAt: string;
}

export interface Settings { sessionIdleMinutes: number; draftArchiveDays: number; alertLeadMinutes: number; updatedAt: string }

export interface AlertOrder {
  id: string; number: string; customerName: string; scheduledAt: string; status: OrderStatus;
  fulfillmentType: FulfillmentType; deliveryStatus: DeliveryStatus | null; deliveryFailureReason: string | null;
  driver: { name: string } | null;
}

export interface Dashboard {
  date: string;
  alertLeadMinutes: number;
  today: { total: number; confirmed: number; preparing: number; ready: number; completed: number; cancelled: number; drafts: number };
  upcoming: AlertOrder[];
  delayed: AlertOrder[];
  deliveryProblems: AlertOrder[];
  financial?: { outstandingOrders: number; outstandingAmount: number; receivedToday: number };
}

export interface KitchenOrder {
  id: string; number: string; status: OrderStatus; orderType: OrderType; scheduledAt: string;
  fulfillmentType: FulfillmentType; customerName: string; guestCount: number | null; deliveryAddress: string | null;
  kitchenNotes: string | null; updatedAt: string; driver: { name: string } | null;
  lines: { kind: OrderLine["kind"]; name: string; quantity: number; notes: string | null; components: { name: string; quantity: number }[] }[];
}
