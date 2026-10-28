import type { Prisma, PrismaClient } from "./generated/prisma/client.js";
import type { CustomerSearch, CustomerStore } from "./customers.js";

function searchFilter(search?: CustomerSearch): Prisma.CustomerWhereInput {
  if (!search) return {};
  if ("phone" in search) return { phone: search.phone };
  if ("phoneFragment" in search) return { phone: { contains: search.phoneFragment } };
  return { name: { contains: search.name, mode: "insensitive" } };
}

export function createCustomerStore(client: PrismaClient): CustomerStore {
  return {
    create: (input) => client.customer.create({ data: input }),
    get: (id) => client.customer.findUnique({ where: { id } }),
    async list(page, pageSize, search) {
      const where = searchFilter(search);
      const [data, total] = await client.$transaction([
        client.customer.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        client.customer.count({ where }),
      ], { isolationLevel: "RepeatableRead" });
      return { data, total };
    },
  };
}
