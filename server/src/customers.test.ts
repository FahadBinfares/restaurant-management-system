import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { CustomerStore } from "./customers.js";

function setup() {
  const customer = {
    id: randomUUID(), name: "Test customer", phone: "+966512345678", notes: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
  const store = {
    create: vi.fn<CustomerStore["create"]>().mockResolvedValue(customer),
    get: vi.fn<CustomerStore["get"]>().mockResolvedValue(customer),
    list: vi.fn<CustomerStore["list"]>().mockResolvedValue({ data: [customer], total: 1 }),
  };
  return { store, customer, app: createApp(async () => {}, store) };
}

describe("customer request contracts", () => {
  it.each(["0512345678", "+966512345678", "966512345678", " 0512345678 ", "05 12345678", "٠٥١٢٣٤٥٦٧٨"])(
    "normalizes %s", async (phone) => {
    const { app, store, customer } = setup();
    const response = await request(app).post("/api/customers").send({ name: " Test customer ", phone });
    expect(response.status).toBe(201);
    expect(store.create).toHaveBeenCalledWith({ name: "Test customer", phone: "+966512345678" });
    expect(response.headers.location).toBe(`/api/customers/${customer.id}`);
    expect(response.body.data.id).toBe(customer.id);
  });

  it.each(["", "51234567", "+9660512345678", "0412345678", "05123456789", 512345678])(
    "rejects malformed phone %s before storage", async (phone) => {
      const { app, store } = setup();
      const response = await request(app).post("/api/customers").send({ name: "Test", phone });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_INPUT");
      expect(store.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    { phone: "0512345678" },
    { name: " ", phone: "0512345678" },
    { name: "x".repeat(121), phone: "0512345678" },
    { name: "Test", phone: "0512345678", notes: 1 },
    { name: "Test", phone: "0512345678", notes: "x".repeat(2001) },
    { name: "Test", phone: "0512345678", id: randomUUID() },
  ])("rejects invalid payload %#", async (input) => {
    const { app, store } = setup();
    expect((await request(app).post("/api/customers").send(input)).status).toBe(400);
    expect(store.create).not.toHaveBeenCalled();
  });

  it("controls invalid JSON and oversized bodies", async () => {
    const { app } = setup();
    const malformed = await request(app).post("/api/customers").type("json").send('{"name":');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("INVALID_INPUT");
    const oversized = await request(app).post("/api/customers").send({ notes: "x".repeat(17000) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("uses bounded pagination defaults and explicit values", async () => {
    const { app, store } = setup();
    const response = await request(app).get("/api/customers");
    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
    expect(store.list).toHaveBeenCalledWith(1, 20, undefined);
    await request(app).get("/api/customers?page=2&pageSize=100").expect(200);
    expect(store.list).toHaveBeenLastCalledWith(2, 100, undefined);
  });

  it.each([
    ["0512345678", { phone: "+966512345678" }],
    ["051 234", { phoneFragment: "51234" }],
    [" محمد ", { name: "محمد" }],
    ["   ", undefined],
  ])("parses search %j", async (q, expected) => {
    const { app, store } = setup();
    await request(app).get("/api/customers").query({ q }).expect(200);
    expect(store.list).toHaveBeenCalledWith(1, 20, expected);
  });

  it.each(["page=0", "page=-1", "page=1.5", "page=1e2", "page=1000001", "pageSize=0",
    "pageSize=101", "pageSize=two", "page=1&page=2", "unknown=1"])("rejects pagination %s", async (query) => {
    const { app, store } = setup();
    expect((await request(app).get(`/api/customers?${query}`)).status).toBe(400);
    expect(store.list).not.toHaveBeenCalled();
  });

  it("validates IDs and distinguishes missing customers", async () => {
    const { app, store } = setup();
    await request(app).get("/api/customers/invalid").expect(400);
    expect(store.get).not.toHaveBeenCalled();
    store.get.mockResolvedValue(null);
    const response = await request(app).get(`/api/customers/${randomUUID()}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Customer not found" } });
  });

  it("maps a unique constraint violation to 409 without exposing details", async () => {
    const { app, store } = setup();
    store.create.mockRejectedValue(Object.assign(new Error("private DB details"), { code: "P2002" }));
    const response = await request(app).post("/api/customers").send({ name: "Test", phone: "0512345678" });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { code: "PHONE_CONFLICT", message: "Phone already registered" } });
  });

  it("maps unexpected errors to 500 rather than a database outage", async () => {
    const { app, store } = setup();
    store.list.mockRejectedValue(new TypeError("private details"));
    const response = await request(app).get("/api/customers");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  it("maps connectivity failures to a generic 503 on all customer endpoints", async () => {
    const { app, store } = setup();
    const error = Object.assign(new Error("private connection string"), { code: "P1001" });
    store.create.mockRejectedValue(error);
    store.list.mockRejectedValue(error);
    store.get.mockRejectedValue(error);
    const responses = await Promise.all([
      request(app).post("/api/customers").send({ name: "Test", phone: "0512345678" }),
      request(app).get("/api/customers"),
      request(app).get(`/api/customers/${randomUUID()}`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: { code: "DATABASE_UNAVAILABLE", message: "Customer storage unavailable" } });
    }
  });
});
