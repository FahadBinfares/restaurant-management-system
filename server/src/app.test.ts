import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

describe("development API", () => {
  it("is live without consulting the database", async () => {
    const check = vi.fn().mockRejectedValue(new Error("unavailable"));
    const response = await request(createApp(check)).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(check).not.toHaveBeenCalled();
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("is ready only after the database check resolves", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const response = await request(createApp(check)).get("/api/ready");
    expect(check).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns 503 without leaking database errors and can recover", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("private database credentials"))
      .mockResolvedValueOnce(undefined);
    const app = createApp(check);
    const failed = await request(app).get("/api/ready");
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ status: "not_ready" });
    const recovered = await request(app).get("/api/ready");
    expect(recovered.status).toBe(200);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("returns a JSON 404 for unknown endpoints", async () => {
    const response = await request(createApp(vi.fn())).get("/api/customers");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });
});
