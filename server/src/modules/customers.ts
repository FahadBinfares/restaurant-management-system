import { Router } from "express";
import { z } from "zod";
import { diff, recordAudit } from "../audit.js";
import { actorId, authenticate, can, requirePermission } from "../auth/sessions.js";
import type { AppContext } from "../context.js";
import type { Prisma } from "../generated/prisma/client.js";
import { AppError, conflict, forbidden, notFound } from "../http/errors.js";
import { httpsUrl, optionalText, pageQuery, phoneSchema } from "../http/schemas.js";
import { normalizeSaudiMobile } from "../phone.js";

const addressInput = z.strictObject({
  label: z.string().trim().min(1).max(60),
  details: z.string().trim().min(1).max(500),
  mapsUrl: httpsUrl.nullable().optional(),
});
const createInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: phoneSchema,
  notes: optionalText(2000),
  addresses: z.array(addressInput).max(10).optional(),
});
const updateInput = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  phone: phoneSchema.optional(),
  notes: optionalText(2000),
});
const listQuery = z.strictObject({
  ...pageQuery,
  q: z.string().max(120).optional(),
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
});

/** Exact normalized phone, a digit fragment of a phone, or a name substring. */
export function customerSearchFilter(raw: string | undefined): Prisma.CustomerWhereInput {
  const query = raw?.trim();
  if (!query) return {};
  const phone = normalizeSaudiMobile(query);
  if (phone) return { phone };
  const digits = query.replace(/[\s\-.()+]/g, "");
  if (/^[0-9]{3,}$/.test(digits)) return { phone: { contains: digits.replace(/^0+/, "") } };
  return { name: { contains: query, mode: "insensitive" } };
}

const activeAddresses = {
  addresses: { where: { archivedAt: null }, orderBy: { createdAt: "asc" } },
} as const satisfies Prisma.CustomerInclude;

export function createCustomersRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  router.use(authenticate(context));

  const load = async (id: unknown) => {
    const customer = await db.customer.findUnique({ where: { id: z.uuid().parse(id) }, include: activeAddresses });
    if (!customer) throw notFound("Customer");
    return customer;
  };

  router.get("/", requirePermission("view_customers"), async (request, response) => {
    const { page, pageSize, q, archived } = listQuery.parse(request.query);
    const where: Prisma.CustomerWhereInput = {
      ...customerSearchFilter(q),
      ...(archived === "exclude" ? { archivedAt: null } : archived === "only" ? { archivedAt: { not: null } } : {}),
    };
    const [data, total] = await db.$transaction([
      db.customer.findMany({
        where, include: activeAddresses, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      db.customer.count({ where }),
    ], { isolationLevel: "RepeatableRead" });
    response.json({ data, pagination: { page, pageSize, total } });
  });

  router.post("/", requirePermission("manage_customers"), async (request, response) => {
    const { addresses, ...input } = createInput.parse(request.body);
    const customer = await db.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: { ...input, addresses: addresses?.length ? { create: addresses } : undefined },
        include: activeAddresses,
      });
      await recordAudit(tx, {
        actorId: actorId(request), action: "customer.create", entityType: "customer", entityId: created.id,
        after: { name: created.name, phone: created.phone },
      });
      return created;
    }).catch((error: unknown) => phoneConflict(error, input.phone));
    response.location(`/api/customers/${customer.id}`).status(201).json({ data: customer });
  });

  router.get("/:id", requirePermission("view_customers"), async (request, response) => {
    response.json({ data: await load(request.params.id) });
  });

  router.patch("/:id", requirePermission("manage_customers"), async (request, response) => {
    const input = updateInput.parse(request.body);
    const customer = await load(request.params.id);
    const changes = diff(customer, input);
    if (!changes.changed) { response.json({ data: customer }); return; }
    if ("phone" in changes.after && !can(request, "change_customer_phone")) throw forbidden();
    if (customer.archivedAt) throw conflict("CUSTOMER_ARCHIVED", "Restore the customer before editing");
    const updated = await db.$transaction(async (tx) => {
      const result = await tx.customer.update({ where: { id: customer.id }, data: input, include: activeAddresses });
      await recordAudit(tx, {
        actorId: actorId(request), action: "phone" in changes.after ? "customer.phone_change" : "customer.update",
        entityType: "customer", entityId: customer.id, ...changes,
      });
      return result;
    }).catch((error: unknown) => phoneConflict(error, input.phone));
    response.json({ data: updated });
  });

  /** Unique-constraint races surface as PHONE_CONFLICT with the existing customer's ID. */
  async function phoneConflict(error: unknown, phone: string | undefined): Promise<never> {
    if (phone && typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const existing = await db.customer.findUnique({ where: { phone }, select: { id: true } });
      throw conflict("PHONE_CONFLICT", "Phone already registered", existing ? { customerId: existing.id } : undefined);
    }
    throw error;
  }

  for (const [action, archive] of [["archive", true], ["restore", false]] as const) {
    router.post(`/:id/${action}`, requirePermission("archive_customers"), async (request, response) => {
      const customer = await load(request.params.id);
      if (Boolean(customer.archivedAt) === archive) { response.json({ data: customer }); return; }
      const updated = await db.$transaction(async (tx) => {
        const result = await tx.customer.update({
          where: { id: customer.id }, data: { archivedAt: archive ? context.now() : null }, include: activeAddresses,
        });
        await recordAudit(tx, { actorId: actorId(request), action: `customer.${action}`, entityType: "customer", entityId: customer.id });
        return result;
      });
      response.json({ data: updated });
    });
  }

  router.post("/:id/addresses", requirePermission("manage_customers"), async (request, response) => {
    const input = addressInput.parse(request.body);
    const customer = await load(request.params.id);
    if (customer.archivedAt) throw conflict("CUSTOMER_ARCHIVED", "Restore the customer before editing");
    if (customer.addresses.length >= 20) throw new AppError(422, "TOO_MANY_ADDRESSES", "A customer can have at most 20 addresses");
    const address = await db.customerAddress.create({ data: { ...input, customerId: customer.id } });
    response.status(201).json({ data: address });
  });

  router.patch("/:id/addresses/:addressId", requirePermission("manage_customers"), async (request, response) => {
    const input = addressInput.partial().parse(request.body);
    const customer = await load(request.params.id);
    const address = customer.addresses.find((row) => row.id === request.params.addressId);
    if (!address) throw notFound("Address");
    const updated = await db.customerAddress.update({ where: { id: address.id }, data: input });
    response.json({ data: updated });
  });

  // Addresses are archived, not deleted: orders keep their own snapshot either way.
  router.delete("/:id/addresses/:addressId", requirePermission("manage_customers"), async (request, response) => {
    const customer = await load(request.params.id);
    const address = customer.addresses.find((row) => row.id === request.params.addressId);
    if (!address) throw notFound("Address");
    await db.customerAddress.update({ where: { id: address.id }, data: { archivedAt: context.now() } });
    response.status(204).end();
  });

  return router;
}
