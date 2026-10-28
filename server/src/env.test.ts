import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env.js";

describe("environment validation", () => {
  const url = "postgresql://example:example@127.0.0.1:5433/test";

  it("validates the URL and supplies loopback/port defaults", () => {
    expect(parseEnvironment({ DATABASE_URL: url })).toEqual({
      DATABASE_URL: url, HOST: "127.0.0.1", PORT: 3001, APP_ENV: "development",
      SECURE_COOKIES: false, REQUIRE_ADMIN_MFA: false, TRUST_PROXY: false, SESSION_MAX_HOURS: 12,
    });
  });

  it("defaults to secure cookies and admin MFA in deployed environments", () => {
    expect(parseEnvironment({ DATABASE_URL: url, APP_ENV: "staging" })).toMatchObject({
      SECURE_COOKIES: true, REQUIRE_ADMIN_MFA: true,
    });
  });

  it("refuses to weaken production security", () => {
    expect(() => parseEnvironment({ DATABASE_URL: url, APP_ENV: "production", SECURE_COOKIES: "false" }))
      .toThrow("Invalid environment configuration: APP_ENV");
  });

  it.each([{}, { DATABASE_URL: "https://example.com" },
    { DATABASE_URL: url, PORT: "0" }, { DATABASE_URL: url, PORT: "65536" },
    { DATABASE_URL: url, PORT: "invalid" }])("rejects invalid settings: %j", (input) => {
    expect(() => parseEnvironment(input)).toThrow("Invalid environment configuration");
  });

  it("does not put supplied credential values in validation errors", () => {
    expect(() => parseEnvironment({ DATABASE_URL: "private-value" }))
      .toThrow("Invalid environment configuration: DATABASE_URL");
  });
});
