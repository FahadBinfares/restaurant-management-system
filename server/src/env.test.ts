import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env.js";

describe("environment validation", () => {
  const url = "postgresql://example:example@127.0.0.1:5433/test";

  it("validates the URL and supplies loopback/port defaults", () => {
    expect(parseEnvironment({ DATABASE_URL: url })).toEqual({
      DATABASE_URL: url, HOST: "127.0.0.1", PORT: 3001,
    });
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
