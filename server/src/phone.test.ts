import { describe, expect, it } from "vitest";
import { normalizeSaudiMobile } from "./phone.js";

describe("normalizeSaudiMobile", () => {
  it.each([
    "0512345678", "512345678", "966512345678", "+966512345678", "00966512345678",
    " 0512345678 ", "051 234 5678", "+966 51-234-5678", "(051) 234.5678",
    "٠٥١٢٣٤٥٦٧٨", "۰۵۱۲۳۴۵۶۷۸",
  ])("normalizes %s", (input) => {
    expect(normalizeSaudiMobile(input)).toBe("+966512345678");
  });

  it.each([
    "", "05123456789", "051234567", "0412345678", "+9660512345678", "+1512345678",
    "05123x5678", "05+12345678", "966412345678", "0096605123456789",
  ])("rejects %s", (input) => {
    expect(normalizeSaudiMobile(input)).toBeNull();
  });
});
