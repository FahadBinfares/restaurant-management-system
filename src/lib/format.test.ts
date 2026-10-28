import { describe, expect, it } from "vitest";
import {
  formatMoney, formatPhone, fromRiyadhLocalInput, moneyInputValue, parseMoney, riyadhToday, toRiyadhLocalInput,
} from "./format";

describe("money formatting", () => {
  it("formats halalas as SAR without floating-point artefacts", () => {
    expect(formatMoney(0)).toBe("0.00 ر.س");
    expect(formatMoney(123_456_789)).toBe("1,234,567.89 ر.س");
    expect(formatMoney(5)).toBe("0.05 ر.س");
    expect(formatMoney(-1_050)).toBe("-10.50 ر.س");
    expect(formatMoney(null)).toBe("—");
  });

  it.each([
    ["12", 1_200], ["12.5", 1_250], ["12.05", 1_205], ["1,234.50", 123_450], ["0.1", 10],
    ["١٢٫٥", 1_250], ["۱۲", 1_200], [" 7 ", 700],
  ])("parses %s as %i halalas", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "-5", "1e3", "12.5.0"])("rejects %s", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it("round-trips input values", () => {
    expect(moneyInputValue(123_450)).toBe("1234.50");
    expect(moneyInputValue(1_200)).toBe("12");
    expect(parseMoney(moneyInputValue(99_999))).toBe(99_999);
  });
});

describe("Riyadh dates and phones", () => {
  it("converts between Riyadh wall-clock inputs and instants", () => {
    expect(toRiyadhLocalInput("2026-10-28T16:30:00.000Z")).toBe("2026-10-28T19:30");
    expect(fromRiyadhLocalInput("2026-10-28T19:30")).toBe("2026-10-28T19:30:00+03:00");
    expect(fromRiyadhLocalInput("")).toBeNull();
    expect(riyadhToday(new Date("2026-12-31T21:30:00Z"))).toBe("2027-01-01");
  });

  it("formats canonical phones for display", () => {
    expect(formatPhone("+966512345678")).toBe("051 234 5678");
  });
});
