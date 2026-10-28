import { describe, expect, it } from "vitest";
import { computeTotals, divideRoundHalfUp, paymentStatus } from "./pricing.js";
import { formatOrderNumber, riyadhDate, riyadhDayRange, riyadhYear } from "./time.js";
import { canTransitionDelivery, canTransitionOrder } from "./workflow.js";

describe("computeTotals", () => {
  it("sums quantity × unit price exactly, without floating-point drift", () => {
    // 0.1 + 0.2 style inputs: 10 × 0.10 SAR and 3 × 0.20 SAR.
    expect(computeTotals([{ unitPrice: 10, quantity: 10 }, { unitPrice: 20, quantity: 3 }], { type: "none" }, 0))
      .toMatchObject({ subtotal: 160, total: 160 });
  });

  it("applies a fixed discount to items and adds the delivery fee afterwards", () => {
    expect(computeTotals([{ unitPrice: 50_000, quantity: 2 }], { type: "fixed", amount: 10_000 }, 2_500)).toEqual({
      subtotal: 100_000, discountAmount: 10_000, deliveryFee: 2_500, total: 92_500, vatAmount: 12_065,
    });
  });

  it("rounds percentage discounts half-up to the halala", () => {
    // 12.5 % of 333 halalas = 41.625 → 42.
    expect(computeTotals([{ unitPrice: 333, quantity: 1 }], { type: "percent", basisPoints: 1250 }, 0).discountAmount).toBe(42);
    // 10 % of 1,005 = 100.5 → 101.
    expect(computeTotals([{ unitPrice: 1005, quantity: 1 }], { type: "percent", basisPoints: 1000 }, 0).discountAmount).toBe(101);
  });

  it("extracts VAT from VAT-inclusive totals", () => {
    // 115.00 SAR inclusive = 100.00 net + 15.00 VAT.
    expect(computeTotals([{ unitPrice: 11_500, quantity: 1 }], { type: "none" }, 0).vatAmount).toBe(1_500);
    // 10.00 SAR → 1.3043… → 1.30.
    expect(computeTotals([{ unitPrice: 1_000, quantity: 1 }], { type: "none" }, 0).vatAmount).toBe(130);
  });

  it("supports a 100 % discount and an empty order", () => {
    expect(computeTotals([{ unitPrice: 500, quantity: 2 }], { type: "percent", basisPoints: 10_000 }, 0).total).toBe(0);
    expect(computeTotals([], { type: "none" }, 1_000)).toMatchObject({ subtotal: 0, total: 1_000 });
  });

  it.each([
    [[{ unitPrice: 100, quantity: 1 }], { type: "fixed", amount: 101 }, 0],
    [[{ unitPrice: 100, quantity: 0 }], { type: "none" }, 0],
    [[{ unitPrice: 1.5, quantity: 1 }], { type: "none" }, 0],
    [[{ unitPrice: -1, quantity: 1 }], { type: "none" }, 0],
    [[], { type: "none" }, -5],
    [[{ unitPrice: 100, quantity: 1 }], { type: "percent", basisPoints: 10_001 }, 0],
  ] as const)("rejects invalid input %#", (lines, discount, fee) => {
    expect(() => computeTotals(lines, discount, fee)).toThrow(RangeError);
  });

  it("rounds exact halves up", () => {
    expect(divideRoundHalfUp(5, 2)).toBe(3);
    expect(divideRoundHalfUp(4, 3)).toBe(1);
    expect(divideRoundHalfUp(5, 3)).toBe(2);
  });
});

describe("paymentStatus", () => {
  it.each([[1000, 0, "unpaid"], [1000, 1, "partially_paid"], [1000, 1000, "paid"], [1000, 1200, "paid"], [0, 0, "paid"]] as const)(
    "total %i paid %i → %s", (total, paid, expected) => {
      expect(paymentStatus(total, paid)).toBe(expected);
    },
  );
});

describe("workflow", () => {
  it("allows only the planned forward path and single-step corrections", () => {
    expect(canTransitionOrder("confirmed", "preparing")).toBe(true);
    expect(canTransitionOrder("preparing", "ready")).toBe(true);
    expect(canTransitionOrder("ready", "completed")).toBe(true);
    expect(canTransitionOrder("ready", "preparing")).toBe(true);
    expect(canTransitionOrder("confirmed", "ready")).toBe(false);
    expect(canTransitionOrder("draft", "preparing")).toBe(false);
    expect(canTransitionOrder("completed", "ready")).toBe(false);
    expect(canTransitionOrder("cancelled", "confirmed")).toBe(false);
  });

  it("keeps delivery transitions independent and terminal once delivered", () => {
    expect(canTransitionDelivery("assigned", "out_for_delivery")).toBe(true);
    expect(canTransitionDelivery("out_for_delivery", "failed")).toBe(true);
    expect(canTransitionDelivery("unassigned", "out_for_delivery")).toBe(false);
    expect(canTransitionDelivery("delivered", "failed")).toBe(false);
  });
});

describe("Riyadh time", () => {
  it("computes day ranges in UTC+3", () => {
    const { start, end } = riyadhDayRange("2026-10-28");
    expect(start.toISOString()).toBe("2026-10-27T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-28T21:00:00.000Z");
    expect(() => riyadhDayRange("2026-02-30")).toThrow(RangeError);
    expect(() => riyadhDayRange("tomorrow")).toThrow(RangeError);
  });

  it("uses the Riyadh calendar for dates and order-number years", () => {
    const newYearInRiyadh = new Date("2026-12-31T21:30:00Z");
    expect(riyadhDate(newYearInRiyadh)).toBe("2027-01-01");
    expect(riyadhYear(newYearInRiyadh)).toBe(2027);
    expect(formatOrderNumber(2026, 1)).toBe("ORD-2026-0001");
    expect(formatOrderNumber(2026, 12345)).toBe("ORD-2026-12345");
  });
});
