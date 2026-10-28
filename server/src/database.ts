import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export function createDatabase(connectionString: string) {
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
    max: 5,
  });
  const client = new PrismaClient({ adapter });
  return {
    async check() {
      await client.$queryRaw`SELECT 1`;
    },
    disconnect: () => client.$disconnect(),
  };
}
