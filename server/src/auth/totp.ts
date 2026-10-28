import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret() {
  const bytes = randomBytes(20);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let secret = "";
  for (let index = 0; index + 5 <= bits.length; index += 5) secret += BASE32[parseInt(bits.slice(index, index + 5), 2)];
  return secret;
}

function decodeBase32(secret: string) {
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error("Invalid base32 secret");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits) — what authenticator apps expect. */
export function totpCode(secret: string, at: Date, offsetSteps = 0) {
  const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS) + offsetSteps;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return binary.toString().padStart(DIGITS, "0");
}

/** Accepts the current step and one step either side to tolerate clock drift. */
export function verifyTotp(secret: string, code: string, at: Date) {
  if (!/^[0-9]{6}$/.test(code)) return false;
  return [-1, 0, 1].some((offset) => timingSafeEqual(Buffer.from(totpCode(secret, at, offset)), Buffer.from(code)));
}

export function totpUri(secret: string, accountName: string) {
  const label = encodeURIComponent(`مطعم:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Restaurant")}&digits=6&period=30`;
}
