import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import type { Permission } from "../src/auth/permissions.js";
import type { AppContext } from "../src/context.js";
import { createDatabase } from "../src/database.js";
import type { Role } from "../src/generated/prisma/enums.js";

// Explicit opt-in; never use DATABASE_URL or a developer's regular data implicitly.
function baseUrl() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("TEST_DATABASE_URL is required");
  const base = new URL(raw);
  if (!["127.0.0.1", "localhost"].includes(base.hostname) || !/_(ci|test)$/.test(base.pathname)) {
    throw new Error("Integration tests require a loopback database ending in _ci or _test");
  }
  return base;
}

export const PASSWORD = "synthetic-test-password";

/** A disposable, fully migrated database plus an app wired to a controllable clock. */
export async function createHarness() {
  const base = baseUrl();
  const name = `restaurant_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(base);
  url.pathname = `/${name}`;
  const admin = new Pool({ connectionString: base.href, max: 1, connectionTimeoutMillis: 5000 });
  await admin.query(`CREATE DATABASE "${name}"`);
  await promisify(execFile)(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url.href }, timeout: 60_000,
  });
  const database = createDatabase(url.href);
  let current = new Date();
  const context: AppContext = {
    db: database.client,
    now: () => new Date(current),
    config: { secureCookies: false, requireAdminMfa: false, sessionMaxHours: 12, trustProxy: false },
  };
  const app = createApp(database.check, context);
  let phoneCounter = 0;

  async function employee(role: Role, options: {
    grants?: Permission[]; revokes?: Permission[]; mustChangePassword?: boolean; name?: string;
  } = {}) {
    phoneCounter += 1;
    const phone = `+9665${String(10_000_000 + phoneCounter).slice(-8)}`;
    return database.client.employee.create({
      data: {
        name: options.name ?? `${role} ${phoneCounter}`, phone, role,
        passwordHash: await hashPassword(PASSWORD),
        mustChangePassword: options.mustChangePassword ?? false,
        permissionOverrides: { create: [
          ...(options.grants ?? []).map((permission) => ({ permission, granted: true })),
          ...(options.revokes ?? []).map((permission) => ({ permission, granted: false })),
        ] },
      },
    });
  }

  /** A cookie-carrying client signed in as a new employee with the given role. */
  async function signIn(role: Role, options: Parameters<typeof employee>[1] = {}) {
    const user = await employee(role, options);
    const agent = request.agent(app).set("X-Requested-With", "rms");
    const response = await agent.post("/api/auth/login").send({ phone: user.phone, password: PASSWORD });
    if (response.status !== 200) throw new Error(`Login failed: ${response.status} ${JSON.stringify(response.body)}`);
    return { agent, user };
  }

  return {
    app,
    db: database.client,
    context,
    url: url.href,
    employee,
    signIn,
    client: () => request.agent(app).set("X-Requested-With", "rms"),
    advance(ms: number) { current = new Date(current.getTime() + ms); },
    setNow(date: Date) { current = new Date(date); },
    async cleanup() {
      try {
        await database.disconnect();
      } finally {
        try { await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`); } finally { await admin.end(); }
      }
    },
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
