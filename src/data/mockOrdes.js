export const mockOrders = [
  {
    id: 1001,
    customerId: 12,
    deliveryType: "delivery",
    scheduledAt: "2026-10-20T19:30:00",
    status: "confirmed",
    notes: "التوصيل قبل الموعد بعشر دقائق",

    items: [
      {
        id: 1,
        name: "باقة وليمة 20 شخص",
        quantity: 1,
        unitPrice: 1500,
      },
      {
        id: 2,
        name: "سلطة",
        quantity: 3,
        unitPrice: 30,
      },
    ],
  },
  {
    id: 1002,
    customerId: 13,
    deliveryType: "delivery",
    scheduledAt: "2026-10-21T18:30:00",
    status: "delivered",
    notes: "التوصيل قبل الموعد بعشر دقائق",

    items: [
      {
        id: 1,
        name: "باقة وليمة 20 شخص",
        quantity: 1,
        unitPrice: 1500,
      },
      {
        id: 2,
        name: "سلطة",
        quantity: 3,
        unitPrice: 30,
      },
    ],
  },
  {
    id: 1003,
    customerId: 14,
    deliveryType: "delivery",
    scheduledAt: "2026-10-22T13:30:00",
    status: "cancelled",
    notes: "التوصيل قبل الموعد بعشر دقائق",

    items: [
      {
        id: 1,
        name: "باقة وليمة 20 شخص",
        quantity: 1,
        unitPrice: 1500,
      },
      {
        id: 2,
        name: "سلطة",
        quantity: 3,
        unitPrice: 30,
      },
    ],
  },
];
