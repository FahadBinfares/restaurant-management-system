import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { hashPassword } from "../auth/password.js";
import { createDatabase } from "../database.js";
import { seedDemoData } from "./demo-data.js";

/**
 * Resets a disposable end-to-end database: creates it if needed, applies migrations,
 * wipes all data, and seeds synthetic accounts and catalog. Refuses anything that is
 * not a loopback database whose name ends in `_e2e`.
 */
const E2E_PASSWORD = "e2e-password-123";
const E2E_ACCOUNTS = [
  { name: "مدير الاختبار", phone: "+966500000101", role: "admin" },
  { name: "استقبال الاختبار", phone: "+966500000102", role: "reception" },
  { name: "عمليات الاختبار", phone: "+966500000103", role: "operations" },
] as const;

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  const name = url.pathname.slice(1);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/^[a-z0-9_]+_e2e$/.test(name)) {
    throw new Error("e2e-prepare requires a loopback DATABASE_URL whose database name ends in _e2e");
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.href, max: 1 });
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "ignore", env: process.env });

  const { client: db, disconnect } = createDatabase(url.href);
  try {
    // TRUNCATE bypasses the row-level append-only triggers, which is intended for this throwaway database only.
    const tables = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    await db.settings.create({ data: { id: 1 } });
    const passwordHash = await hashPassword(E2E_PASSWORD);
    for (const account of E2E_ACCOUNTS) {
      await db.employee.create({ data: { ...account, passwordHash, mustChangePassword: false } });
    }
    await seedDemoData(db);
  } finally {
    await disconnect();
  }
  console.info(`E2E database ${name} ready.`);
}

await main();
