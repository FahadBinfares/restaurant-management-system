import { describe, expect, it } from "vitest";
import calculateOrderTotal from "./calculateOrderTotal";
import { mockOrders } from "../data/mockOrdes";

describe("calculateOrderTotal", () => {
  it("returns zero for an empty array", () => {
    expect(calculateOrderTotal([])).toBe(0);
  });

  it("calculates the existing sample order total", () => {
    expect(calculateOrderTotal(mockOrders[0].items)).toBe(1590);
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
