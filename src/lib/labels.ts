import type { DeliveryStatus, OrderStatus, PaymentMethod, PaymentStatus, Role } from "./types";

export const ORDER_STATUS: Record<OrderStatus, string> = {
  draft: "مسودة",
  confirmed: "مؤكد",
  preparing: "قيد التحضير",
  ready: "جاهز",
  completed: "مكتمل",
  cancelled: "ملغي",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  draft: "neutral",
  confirmed: "info",
  preparing: "warning",
  ready: "success",
  completed: "muted",
  cancelled: "danger",
};

export const PAYMENT_STATUS: Record<PaymentStatus, string> = {
  unpaid: "غير مدفوع",
  partially_paid: "مدفوع جزئياً",
  paid: "مدفوع",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  unpaid: "danger",
  partially_paid: "warning",
  paid: "success",
};

export const DELIVERY_STATUS: Record<DeliveryStatus, string> = {
  unassigned: "بدون سائق",
  assigned: "تم إسناد سائق",
  out_for_delivery: "خرج للتوصيل",
  delivered: "تم التوصيل",
  failed: "تعذّر التوصيل",
};

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, Tone> = {
  unassigned: "warning",
  assigned: "info",
  out_for_delivery: "info",
  delivered: "success",
  failed: "danger",
};

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  cash: "نقداً",
  bank_transfer: "تحويل بنكي",
  card_pos: "شبكة (مدى/بطاقة)",
  payment_link: "رابط دفع",
};

export const FULFILLMENT_TYPE = { delivery: "توصيل", pickup: "استلام من المطعم" } as const;
export const ORDER_TYPE = { banquet: "وليمة", individual: "طلب فردي" } as const;
export const ROLE: Record<Role, string> = { admin: "مدير", reception: "استقبال", operations: "عمليات" };

export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "muted";

export const PERMISSION_LABELS: Record<string, string> = {
  view_customers: "عرض العملاء",
  manage_customers: "إضافة وتعديل العملاء",
  change_customer_phone: "تغيير جوال العميل",
  archive_customers: "أرشفة العملاء",
  manage_products: "إدارة المنتجات والباقات",
  view_orders: "عرض الطلبات",
  create_orders: "إنشاء الطلبات والمسودات",
  confirm_orders: "تأكيد الطلبات",
  edit_confirmed_orders: "تعديل الطلبات المؤكدة",
  update_order_status: "تحديث حالة التحضير",
  override_order_price: "تعديل الأسعار والأصناف المخصصة",
  override_order_schedule: "تغيير موعد طلب قيد التحضير",
  apply_discount: "تطبيق الخصومات",
  cancel_order: "إلغاء الطلبات",
  restore_draft_orders: "استعادة المسودات المؤرشفة",
  view_payments: "عرض المدفوعات",
  record_payments: "تسجيل المدفوعات",
  void_payments: "إلغاء قيود الدفع",
  settle_cancelled_order: "تسوية الطلبات الملغاة (الاسترداد)",
  manage_drivers: "إدارة السائقين",
  assign_drivers: "إسناد السائقين",
  update_delivery_status: "تحديث حالة التوصيل",
  view_kitchen_reports: "عرض تقرير المطبخ",
  print_kitchen_reports: "طباعة تقرير المطبخ",
  view_financial_reports: "عرض التقارير المالية",
  manage_employees: "إدارة الموظفين",
  manage_settings: "إدارة الإعدادات",
  view_audit_log: "عرض سجل التدقيق",
};

/** Arabic messages for API error codes; falls back to a generic message. */
export const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "رقم الجوال أو كلمة المرور غير صحيحة",
  ACCOUNT_LOCKED: "تم إيقاف الحساب مؤقتاً بسبب محاولات خاطئة متكررة. حاول بعد 15 دقيقة",
  RATE_LIMITED: "محاولات كثيرة. حاول لاحقاً",
  MFA_REQUIRED: "أدخل رمز التحقق من تطبيق المصادقة",
  INVALID_MFA_CODE: "رمز التحقق غير صحيح",
  UNAUTHENTICATED: "انتهت الجلسة. سجّل الدخول مجدداً",
  FORBIDDEN: "ليست لديك صلاحية لهذا الإجراء",
  INVALID_INPUT: "البيانات المدخلة غير صحيحة",
  PHONE_CONFLICT: "رقم الجوال مسجّل مسبقاً لعميل آخر",
  VERSION_CONFLICT: "عدّل موظف آخر هذا الطلب للتو. أعد تحميل الطلب ثم كرّر التعديل",
  ORDER_LOCKED: "لا يمكن تعديل الطلبات المكتملة أو الملغاة",
  ORDER_ARCHIVED: "هذه المسودة مؤرشفة. استعدها أولاً",
  ORDER_INCOMPLETE: "الطلب غير مكتمل للتأكيد",
  INVALID_TRANSITION: "لا يمكن الانتقال إلى هذه الحالة",
  REASON_REQUIRED: "يجب كتابة السبب",
  OVERRIDE_REASON_REQUIRED: "يجب كتابة سبب تعديل السعر",
  INVALID_TOTALS: "الخصم أكبر من مجموع الأصناف",
  PRODUCT_INACTIVE: "هذا المنتج لم يعد متاحاً",
  PACKAGE_INACTIVE: "هذه الباقة لم تعد متاحة",
  AMOUNT_EXCEEDS_BALANCE: "المبلغ أكبر من المتبقي على الطلب",
  AMOUNT_EXCEEDS_REFUNDABLE: "المبلغ أكبر من المسموح باسترداده",
  ORDER_NOT_CONFIRMED: "أكّد الطلب قبل تسجيل الدفعات",
  ORDER_CANCELLED: "الطلب ملغي",
  ALREADY_VOIDED: "تم إلغاء هذا القيد مسبقاً",
  DRIVER_CONFLICT: "لدى السائق توصيل آخر قريب من هذا الموعد",
  NOT_DELIVERY: "هذا الطلب استلام من المطعم",
  DELIVERY_IN_PROGRESS: "التوصيل جارٍ بالفعل",
  CUSTOMER_ARCHIVED: "هذا العميل مؤرشف",
  SELF_LOCKOUT: "لا يمكنك تعطيل حسابك أو سحب صلاحية الإدارة من نفسك",
  NAME_CONFLICT: "الاسم مستخدم مسبقاً",
  CONFLICT: "السجل موجود مسبقاً",
  DATABASE_UNAVAILABLE: "تعذّر الاتصال بقاعدة البيانات. حاول بعد قليل",
  PASSWORD_REUSED: "اختر كلمة مرور مختلفة عن الحالية",
  INVALID_CURRENT_PASSWORD: "كلمة المرور الحالية غير صحيحة",
  CSRF_REJECTED: "تم رفض الطلب لأسباب أمنية. حدّث الصفحة",
};

export const INCOMPLETE_PROBLEMS: Record<string, string> = {
  lines: "أضف صنفاً واحداً على الأقل",
  scheduledAt: "حدد موعد التسليم",
  scheduledAt_past: "موعد التسليم في الماضي",
  deliveryAddress: "أدخل عنوان التوصيل",
  customer_archived: "العميل مؤرشف",
};

export const AUDIT_ACTIONS: Record<string, string> = {
  "order.create": "إنشاء الطلب",
  "order.update_draft": "تعديل المسودة",
  "order.edit_confirmed": "تعديل طلب مؤكد",
  "order.confirm": "تأكيد الطلب",
  "order.status": "تغيير الحالة",
  "order.cancel": "إلغاء الطلب",
  "order.archive": "أرشفة المسودة",
  "order.auto_archive": "أرشفة تلقائية",
  "order.restore": "استعادة المسودة",
  "order.price_override": "تعديل سعر",
  "order.discount": "تغيير الخصم",
  "payment.record": "تسجيل دفعة",
  "payment.refund": "استرداد",
  "payment.void": "إلغاء قيد دفع",
  "delivery.assign": "إسناد سائق",
  "delivery.unassign": "إلغاء إسناد السائق",
  "delivery.status": "تغيير حالة التوصيل",
};
