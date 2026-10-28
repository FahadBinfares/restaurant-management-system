import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

// scrypt with N=2^15, r=8, p=1 (~32 MiB, OWASP-recommended minimum class).
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEMORY },
      (error, key) => error ? reject(error) : resolve(key));
  });
}

/** Returns `scrypt$N$r$p$salt$hash` (base64url); parameters are stored for future upgrades. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Verifies against a throwaway hash so unknown accounts take as long as known ones. */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
}

// Excludes look-alike characters (0/O, 1/l/I) because temporary passwords are read aloud or copied by hand.
const TEMPORARY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export function generateTemporaryPassword(length = 14) {
  return Array.from({ length }, () => TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)]).join("");
}

export const PASSWORD_MIN_LENGTH = 10;
