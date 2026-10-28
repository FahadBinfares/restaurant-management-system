/** Saudi Arabia observes UTC+3 all year (no daylight saving). */
const RIYADH_OFFSET_MS = 3 * 3_600_000;

/** [start, end) of a calendar day (YYYY-MM-DD) in Riyadh time. */
export function riyadhDayRange(date: string) {
  const start = new Date(`${date}T00:00:00+03:00`);
  // Round-tripping rejects impossible dates such as 2026-02-30.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(start.getTime()) || riyadhDate(start) !== date) {
    throw new RangeError("Invalid date");
  }
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** YYYY-MM-DD of an instant in Riyadh time. */
export function riyadhDate(instant: Date) {
  return new Date(instant.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}

export function riyadhYear(instant: Date) {
  return new Date(instant.getTime() + RIYADH_OFFSET_MS).getUTCFullYear();
}

export function formatOrderNumber(year: number, sequence: number) {
  return `ORD-${year}-${String(sequence).padStart(4, "0")}`;
}
