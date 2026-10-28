import "dotenv/config";
import { parseArgs } from "node:util";
import { recordAudit } from "../audit.js";
import { generateTemporaryPassword, hashPassword } from "../auth/password.js";
import { createDatabase } from "../database.js";
import { parseEnvironment } from "../env.js";
import { normalizeSaudiMobile } from "../phone.js";

/**
 * Bootstraps the first administrator. Prints a one-time temporary password that
 * must be changed at first sign-in. Refuses to run once an active admin exists:
 * later admins are created from the application so the action is audited.
 */
async function main() {
  const { values } = parseArgs({ options: { name: { type: "string" }, phone: { type: "string" } } });
  const phone = values.phone ? normalizeSaudiMobile(values.phone) : null;
  if (!values.name?.trim() || !phone) {
    console.error('Usage: npm run admin:create -- --name "الاسم" --phone 05XXXXXXXX');
    process.exitCode = 2;
    return;
  }
  const env = parseEnvironment(process.env);
  const database = createDatabase(env.DATABASE_URL);
  try {
    if (await database.client.employee.count({ where: { role: "admin", active: true } }) > 0) {
      console.error("An active administrator already exists; create further accounts from the application.");
      process.exitCode = 1;
      return;
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await database.client.$transaction(async (tx) => {
      const admin = await tx.employee.create({
        data: { name: values.name!.trim(), phone, role: "admin", passwordHash, mustChangePassword: true },
      });
      await recordAudit(tx, { actorId: null, action: "employee.bootstrap_admin", entityType: "employee", entityId: admin.id });
    });
    console.info(`Administrator created for ${phone}.`);
    console.info(`Temporary password (shown once, change at first sign-in): ${temporaryPassword}`);
  } finally {
    await database.disconnect();
  }
}

await main();
