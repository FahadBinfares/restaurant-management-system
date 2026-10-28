import type { PrismaClient } from "./generated/prisma/client.js";
import type { CustomerStore } from "./customers.js";

export function createCustomerStore(client: PrismaClient): CustomerStore {
  return {
    create: (input) => client.customer.create({ data: input }),
    get: (id) => client.customer.findUnique({ where: { id } }),
    async list(page, pageSize) {
      const [data, total] = await client.$transaction([
        client.customer.findMany({
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        client.customer.count(),
      ], { isolationLevel: "RepeatableRead" });
      return { data, total };
    },
  };
}
