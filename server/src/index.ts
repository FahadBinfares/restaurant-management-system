import "dotenv/config";
import { createApp } from "./app.js";
import { createDatabase } from "./database.js";
import { parseEnvironment } from "./env.js";
import type { AppContext } from "./context.js";

function start() {
  const env = parseEnvironment(process.env);
  const database = createDatabase(env.DATABASE_URL);
  const context: AppContext = {
    db: database.client,
    now: () => new Date(),
    config: {
      secureCookies: env.SECURE_COOKIES,
      requireAdminMfa: env.REQUIRE_ADMIN_MFA,
      sessionMaxHours: env.SESSION_MAX_HOURS,
      trustProxy: env.TRUST_PROXY,
    },
  };
  const server = createApp(database.check, context).listen(env.PORT, env.HOST, () => {
    console.info(`API (${env.APP_ENV}) listening on ${env.HOST}:${env.PORT}`);
  });
  let shuttingDown = false;

  async function shutdown(exitCode: number) {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => {
      console.error("API shutdown timed out");
      process.exit(1);
    }, 10_000);
    deadline.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await database.disconnect();
      process.exitCode = exitCode;
    } catch {
      console.error("API shutdown failed");
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  }

  process.once("SIGINT", () => { void shutdown(0); });
  process.once("SIGTERM", () => { void shutdown(0); });
  server.on("error", () => {
    console.error("API listener failed");
    void shutdown(1);
  });
}

try {
  start();
} catch {
  console.error("API startup failed; check environment configuration");
  process.exitCode = 1;
}
