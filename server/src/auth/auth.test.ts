import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "./password.js";
import { effectivePermissions, ROLE_PERMISSIONS } from "./permissions.js";
import { generateTotpSecret, totpCode, verifyTotp } from "./totp.js";

describe("password hashing", () => {
  it("verifies the original password only and salts each hash", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("correct horsE", hash)).toBe(false);
    expect(await hashPassword("correct horse")).not.toBe(hash);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "plain-text")).toBe(false);
  });

  it("generates unambiguous temporary passwords", () => {
    const password = generateTemporaryPassword();
    expect(password).toHaveLength(14);
    expect(password).not.toMatch(/[01OIl]/);
  });
});

describe("TOTP", () => {
  // RFC 6238 Appendix B test vector: ASCII "12345678901234567890" in base32, 8 digits truncated to 6.
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it("matches the RFC 6238 SHA-1 test vectors", () => {
    expect(totpCode(rfcSecret, new Date(59_000))).toBe("287082");
    expect(totpCode(rfcSecret, new Date(1_111_111_109_000))).toBe("081804");
    expect(totpCode(rfcSecret, new Date(2_000_000_000_000))).toBe("279037");
  });

  it("accepts adjacent steps for drift and rejects older codes", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const now = new Date("2026-10-28T12:00:15Z");
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now, -1), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now, -2), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
  });
});

describe("permissions", () => {
  it("applies individual grants and revocations on top of role defaults", () => {
    const permissions = effectivePermissions("reception", [
      { permission: "apply_discount", granted: true },
      { permission: "record_payments", granted: false },
      { permission: "not_a_permission", granted: true },
    ]);
    expect(permissions.has("apply_discount")).toBe(true);
    expect(permissions.has("record_payments")).toBe(false);
    expect(permissions.has("manage_employees")).toBe(false);
    expect([...permissions]).not.toContain("not_a_permission");
  });

  it("keeps sensitive financial and admin powers away from non-admin defaults", () => {
    for (const role of ["reception", "operations"] as const) {
      for (const sensitive of ["override_order_price", "apply_discount", "void_payments", "settle_cancelled_order",
        "manage_employees", "manage_settings", "view_financial_reports"] as const) {
        expect(ROLE_PERMISSIONS[role]).not.toContain(sensitive);
      }
    }
  });
});
