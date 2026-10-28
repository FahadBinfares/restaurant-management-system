/**
 * Authoritative order pricing. All amounts are integer halalas (1 SAR = 100),
 * and prices are VAT-inclusive. See docs/DECISIONS.md §3.
 */

export const DEFAULT_VAT_RATE_BP = 1500; // 15.00 %

export type DiscountInput =
  | { type: "none" }
  | { type: "fixed"; amount: number }
  | { type: "percent"; basisPoints: number };

export interface PricedLine {
  unitPrice: number;
  quantity: number;
}

export interface OrderTotals {
  subtotal: number;
  discountAmount: number;
  deliveryFee: number;
  total: number;
  /** VAT contained in `total` (informational; this system does not issue tax invoices). */
  vatAmount: number;
}

function assertHalalas(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative integer`);
}

/** Integer division rounding half away from zero, without floating point. */
export function divideRoundHalfUp(numerator: number, denominator: number) {
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

export function lineTotal(line: PricedLine) {
  assertHalalas(line.unitPrice, "unitPrice");
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new RangeError("quantity must be a positive integer");
  const total = line.unitPrice * line.quantity;
  if (!Number.isSafeInteger(total)) throw new RangeError("line total overflow");
  return total;
}

export function computeTotals(
  lines: readonly PricedLine[],
  discount: DiscountInput,
  deliveryFee: number,
  vatRateBp = DEFAULT_VAT_RATE_BP,
): OrderTotals {
  assertHalalas(deliveryFee, "deliveryFee");
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  let discountAmount = 0;
  if (discount.type === "fixed") {
    assertHalalas(discount.amount, "discount");
    discountAmount = discount.amount;
  } else if (discount.type === "percent") {
    if (!Number.isInteger(discount.basisPoints) || discount.basisPoints < 0 || discount.basisPoints > 10_000) {
      throw new RangeError("discount percent must be between 0 and 100");
    }
    discountAmount = divideRoundHalfUp(subtotal * discount.basisPoints, 10_000);
  }
  if (discountAmount > subtotal) throw new RangeError("discount exceeds subtotal");
  const total = subtotal - discountAmount + deliveryFee;
  // VAT-inclusive: VAT = total × rate / (1 + rate).
  const vatAmount = divideRoundHalfUp(total * vatRateBp, 10_000 + vatRateBp);
  return { subtotal, discountAmount, deliveryFee, total, vatAmount };
}

export function paymentStatus(total: number, paid: number): "unpaid" | "partially_paid" | "paid" {
  if (paid >= total) return "paid";
  return paid > 0 ? "partially_paid" : "unpaid";
}
