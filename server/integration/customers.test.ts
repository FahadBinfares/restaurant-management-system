import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { createCustomerStore } from "../src/customer-store.js";
import { createApp } from "../src/app.js";

// Explicit opt-in; never use DATABASE_URL or a developer's regular data implicitly.
const base = new URL(process.env.TEST_DATABASE_URL ?? (() => { throw new Error("TEST_DATABASE_URL is required"); })());
if (!["127.0.0.1", "localhost"].includes(base.hostname)
  || !/_(ci|test)$/.test(base.pathname)) {
  throw new Error("Integration tests require a loopback database ending in _ci or _test");
}
const name = `restaurant_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(base);
url.pathname = `/${name}`;
const admin = new Pool({ connectionString: base.href, max: 1, connectionTimeoutMillis: 2000 });
let created = false;
let database: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  await promisify(execFile)(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url.href }, timeout: 45_000,
  });
  database = createDatabase(url.href);
  app = createApp(database.check, createCustomerStore(database.client));
});

beforeEach(async () => { await database.client.customer.deleteMany(); });

afterAll(async () => {
  try {
    if (database) await database.disconnect();
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally { await admin.end(); }
  }
});

describe("Customer API with real PostgreSQL", () => {
  it("returns an empty page with defaults before any customers are created", async () => {
    const response = await request(app).get("/api/customers");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [], pagination: { page: 1, pageSize: 20, total: 0 } });
  });

  it("creates, persists and fetches a customer with timestamps and optional notes", async () => {
    const response = await request(app).post("/api/customers").send({
      name: " عميل اختبار ", phone: "0512345678", notes: " synthetic test data ",
    });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ name: "عميل اختبار", phone: "+966512345678", notes: "synthetic test data" });
    expect(response.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(response.body.data.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(response.body.data.updatedAt))).toBe(false);
    const stored = await database.client.customer.findUniqueOrThrow({ where: { id: response.body.data.id } });
    expect(stored.phone).toBe("+966512345678");
    const fetched = await request(app).get(`/api/customers/${stored.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(response.body);
  });

  it.each(["0512345678", "+966512345678", "966512345678"])("stores %s canonically", async (phone) => {
    const response = await request(app).post("/api/customers").send({ name: "Synthetic", phone });
    expect(response.status).toBe(201);
    expect(response.body.data.phone).toBe("+966512345678");
    expect(response.body.data.notes).toBeNull();
  });

  it("enforces phone uniqueness for concurrent equivalent requests and direct DB writes", async () => {
    const responses = await Promise.all(["0512345678", "+966512345678"].map((phone) =>
      request(app).post("/api/customers").send({ name: "Synthetic", phone })));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await database.client.customer.count()).toBe(1);
    await expect(database.client.customer.create({ data: { name: "Duplicate", phone: "+966512345678" } }))
      .rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects malformed input and IDs without inserting rows", async () => {
    await request(app).post("/api/customers").send({ name: " ", phone: "512345678" }).expect(400);
    await request(app).get("/api/customers/not-a-uuid").expect(400);
    await request(app).get(`/api/customers/${randomUUID()}`).expect(404);
    expect(await database.client.customer.count()).toBe(0);
  });

  it("paginates deterministically even when creation timestamps tie", async () => {
    const timestamp = new Date("2026-01-01T00:00:00Z");
    const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003"];
    await database.client.customer.createMany({ data: ids.map((id, index) => ({
      id, name: "Synthetic", phone: `+96650000000${index}`, createdAt: timestamp,
    })) });
    const first = await request(app).get("/api/customers?page=1&pageSize=2");
    const second = await request(app).get("/api/customers?page=2&pageSize=2");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.pagination).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(first.body.data.map((row: { id: string }) => row.id)).toEqual([ids[2], ids[1]]);
    expect(second.body.data.map((row: { id: string }) => row.id)).toEqual([ids[0]]);
    expect((await request(app).get("/api/customers?page=3&pageSize=2")).body.data).toEqual([]);
    await request(app).get("/api/customers?pageSize=101").expect(400);
  });

  it("returns a safe 503 when actual database authentication fails", async () => {
    const unavailableUrl = new URL(url);
    unavailableUrl.password = randomUUID();
    const unavailable = createDatabase(unavailableUrl.href);
    try {
      const failed = await request(createApp(unavailable.check, createCustomerStore(unavailable.client)))
        .get("/api/customers");
      expect(failed.status).toBe(503);
      expect(failed.body).toEqual({ error: { code: "DATABASE_UNAVAILABLE", message: "Customer storage unavailable" } });
    } finally { await unavailable.disconnect(); }
  });
});
