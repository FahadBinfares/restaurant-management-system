const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/**
 * Normalizes a Saudi mobile number to E.164 (`+9665XXXXXXXX`), or returns null.
 *
 * Staff type numbers as they appear on paper or WhatsApp, so separators
 * (spaces, dashes, dots, parentheses) and Arabic-Indic digits are accepted.
 * Accepted prefixes: `05`, `5`, `9665`, `+9665`, `009665`.
 */
export function normalizeSaudiMobile(input: string): string | null {
  let value = "";
  for (const char of input.trim()) {
    const arabic = ARABIC_INDIC.indexOf(char);
    const eastern = EASTERN_ARABIC_INDIC.indexOf(char);
    if (arabic >= 0) value += String(arabic);
    else if (eastern >= 0) value += String(eastern);
    else if (/[0-9+]/.test(char)) value += char;
    else if (!/[\s\-.()]/.test(char)) return null;
  }
  if (value.indexOf("+") > 0) return null;
  const digits = value.startsWith("+") ? value.slice(1)
    : value.startsWith("00") ? value.slice(2) : value;
  if (value.startsWith("+") && !digits.startsWith("966")) return null;
  const local = digits.startsWith("966") ? digits.slice(3)
    : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^5[0-9]{8}$/.test(local) ? `+966${local}` : null;
}
