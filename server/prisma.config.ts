import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generation and unit tests do not require a database or secret.
  datasource: { url: process.env.DATABASE_URL },
});
