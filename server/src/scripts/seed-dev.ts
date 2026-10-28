import "dotenv/config";
import { createDatabase } from "../database.js";
import { parseEnvironment } from "../env.js";
import { seedDemoData } from "./demo-data.js";

/** Synthetic demo catalog, drivers, and customers. Development databases only. */
async function main() {
  const env = parseEnvironment(process.env);
  if (env.APP_ENV !== "development") {
    console.error("Refusing to seed: APP_ENV must be development.");
    process.exitCode = 1;
    return;
  }
  const { client: db, disconnect } = createDatabase(env.DATABASE_URL);
  try {
    if (await db.category.count() > 0) {
      console.info("Catalog already has data; nothing seeded.");
      return;
    }
    await seedDemoData(db);
    console.info("Seeded synthetic catalog, drivers, and a demo customer.");
  } finally {
    await disconnect();
  }
}

await main();
