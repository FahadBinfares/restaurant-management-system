/** Money is handled as integer halalas end to end; these helpers only convert for display/input. */

const groupFormatter = new Intl.NumberFormat("en-US");

export function formatMoney(halalas: number | null | undefined) {
  if (halalas === null || halalas === undefined) return "—";
  const negative = halalas < 0;
  const absolute = Math.abs(halalas);
  const riyals = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${groupFormatter.format(riyals)}.${fraction} ر.س`;
}

/** "1,234.5" / "١٢٣٤٫٥" → 123450. Parses digits as text, never through floating point. */
export function parseMoney(input: string): number | null {
  const normalized = input.trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[,٬\s]/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** For pre-filling inputs: 123450 → "1234.50", 1200 → "12". */
export function moneyInputValue(halalas: number) {
  const fraction = halalas % 100;
  return fraction === 0 ? String(halalas / 100) : `${Math.floor(halalas / 100)}.${String(fraction).padStart(2, "0")}`;
}

const RIYADH = "Asia/Riyadh";

const dateTimeFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  timeZone: RIYADH, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  timeZone: RIYADH, weekday: "long", year: "numeric", month: "long", day: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: RIYADH, hour: "numeric", minute: "2-digit" });

export const formatDateTime = (value: string | null | undefined) => value ? dateTimeFormatter.format(new Date(value)) : "—";
export const formatTime = (value: string | null | undefined) => value ? timeFormatter.format(new Date(value)) : "—";
export const formatDate = (isoDay: string) => dateFormatter.format(new Date(`${isoDay}T12:00:00+03:00`));

/** Today's date (YYYY-MM-DD) in Riyadh. */
export function riyadhToday(now = new Date()) {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** `<input type="datetime-local">` value (Riyadh wall clock) ↔ ISO instant with +03:00. */
export function toRiyadhLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 16);
}
export function fromRiyadhLocalInput(value: string) {
  return value ? `${value}:00+03:00` : null;
}

/** Display a canonical +9665XXXXXXXX number the way staff write it: 05X XXX XXXX. */
export function formatPhone(phone: string | null | undefined) {
  if (!phone) return "—";
  const local = phone.startsWith("+966") ? `0${phone.slice(4)}` : phone;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
}
