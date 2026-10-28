import { describe, expect, it } from "vitest";
import calculateOrderTotal from "./calculateOrderTotal";

// Items of the original prototype sample order (formerly src/data/mockOrdes.ts).
const sampleOrderItems = [
  { id: 1, name: "باقة وليمة 20 شخص", quantity: 1, unitPrice: 1500 },
  { id: 2, name: "سلطة", quantity: 3, unitPrice: 30 },
];

describe("calculateOrderTotal", () => {
  it("returns zero for an empty array", () => {
    expect(calculateOrderTotal([])).toBe(0);
  });

  it("calculates the existing sample order total", () => {
    expect(calculateOrderTotal(sampleOrderItems)).toBe(1590);
  });

  it("multiplies each quantity by its price and sums different lines", () => {
    expect(calculateOrderTotal([
      { quantity: 2, unitPrice: 12.5 },
      { quantity: 3, unitPrice: 4 },
      { quantity: 0, unitPrice: 100 },
    ])).toBe(37);
  });

  it("does not modify the supplied items", () => {
    const items = Object.freeze([
      Object.freeze({ quantity: 2, unitPrice: 25 }),
    ]);
    expect(calculateOrderTotal(items)).toBe(50);
    expect(items).toEqual([{ quantity: 2, unitPrice: 25 }]);
  });
});
