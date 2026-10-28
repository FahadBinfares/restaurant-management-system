import { Router } from "express";
import { z } from "zod";
import { diff, recordAudit } from "../audit.js";
import { actorId, authenticate, requirePermission } from "../auth/sessions.js";
import type { AppContext } from "../context.js";
import { conflict, notFound } from "../http/errors.js";
import { optionalText } from "../http/schemas.js";

/** Halalas: non-negative integers up to 10,000,000 SAR. */
export const halalas = z.number().int().min(0).max(1_000_000_000);

const categoryInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});
const productInput = z.strictObject({
  categoryId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  description: optionalText(1000),
  price: halalas,
  active: z.boolean().optional(),
});
const packageInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: optionalText(1000),
  guestCount: z.number().int().min(1).max(10_000).nullable().optional(),
  price: halalas,
  active: z.boolean().optional(),
  items: z.array(z.strictObject({ productId: z.uuid(), quantity: z.number().int().min(1).max(10_000) }))
    .min(1).max(100)
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, "Duplicate products"),
});
const listQuery = z.strictObject({ includeInactive: z.enum(["true", "false"]).optional() });

const packageInclude = {
  items: { orderBy: { position: "asc" }, include: { product: { select: { id: true, name: true, active: true } } } },
} as const;

export function createCatalogRouter(context: AppContext) {
  const { db } = context;
  const router = Router();
  router.use(authenticate(context));
  const manage = requirePermission("manage_products");

  // Reading the catalog is needed by anyone who builds or views orders.
  router.get("/categories", async (request, response) => {
    const { includeInactive } = listQuery.parse(request.query);
    const data = await db.category.findMany({
      where: includeInactive === "true" ? {} : { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    response.json({ data });
  });

  router.post("/categories", manage, async (request, response) => {
    const input = categoryInput.parse(request.body);
    const category = await db.$transaction(async (tx) => {
      const created = await tx.category.create({ data: input });
      await recordAudit(tx, { actorId: actorId(request), action: "category.create", entityType: "category", entityId: created.id, after: input });
      return created;
    });
    response.status(201).json({ data: category });
  });

  router.patch("/categories/:id", manage, async (request, response) => {
    const input = categoryInput.partial().parse(request.body);
    const existing = await db.category.findUnique({ where: { id: z.uuid().parse(request.params.id) } });
    if (!existing) throw notFound("Category");
    const changes = diff(existing, input);
    const category = await db.$transaction(async (tx) => {
      const updated = await tx.category.update({ where: { id: existing.id }, data: input });
      if (changes.changed) {
        await recordAudit(tx, { actorId: actorId(request), action: "category.update", entityType: "category", entityId: existing.id, ...changes });
      }
      return updated;
    });
    response.json({ data: category });
  });

  router.get("/products", async (request, response) => {
    const { includeInactive } = listQuery.parse(request.query);
    const data = await db.product.findMany({
      where: includeInactive === "true" ? {} : { active: true, category: { active: true } },
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
    });
    response.json({ data });
  });

  router.post("/products", manage, async (request, response) => {
    const input = productInput.parse(request.body);
    if (!(await db.category.findUnique({ where: { id: input.categoryId } }))) throw notFound("Category");
    const product = await db.$transaction(async (tx) => {
      const created = await tx.product.create({ data: input });
      await recordAudit(tx, { actorId: actorId(request), action: "product.create", entityType: "product", entityId: created.id, after: input });
      return created;
    });
    response.status(201).json({ data: product });
  });

  // Products are deactivated, never deleted; order lines keep their own name/price snapshot.
  router.patch("/products/:id", manage, async (request, response) => {
    const input = productInput.partial().parse(request.body);
    const existing = await db.product.findUnique({ where: { id: z.uuid().parse(request.params.id) } });
    if (!existing) throw notFound("Product");
    if (input.categoryId && !(await db.category.findUnique({ where: { id: input.categoryId } }))) throw notFound("Category");
    const changes = diff(existing, input);
    const product = await db.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id: existing.id }, data: input });
      if (changes.changed) {
        await recordAudit(tx, {
          actorId: actorId(request), action: "price" in changes.after ? "product.price_change" : "product.update",
          entityType: "product", entityId: existing.id, ...changes,
        });
      }
      return updated;
    });
    response.json({ data: product });
  });

  router.get("/packages", async (request, response) => {
    const { includeInactive } = listQuery.parse(request.query);
    const data = await db.package.findMany({
      where: includeInactive === "true" ? {} : { active: true },
      include: packageInclude,
      orderBy: { name: "asc" },
    });
    response.json({ data });
  });

  async function assertProductsExist(productIds: string[]) {
    const found = await db.product.count({ where: { id: { in: productIds } } });
    if (found !== productIds.length) throw notFound("Product");
  }

  router.post("/packages", manage, async (request, response) => {
    const { items, ...input } = packageInput.parse(request.body);
    await assertProductsExist(items.map((item) => item.productId));
    const created = await db.$transaction(async (tx) => {
      const result = await tx.package.create({
        data: { ...input, items: { create: items.map((item, position) => ({ ...item, position })) } },
        include: packageInclude,
      });
      await recordAudit(tx, { actorId: actorId(request), action: "package.create", entityType: "package", entityId: result.id, after: { ...input, items } });
      return result;
    });
    response.status(201).json({ data: created });
  });

  /** Editing a catalog package never alters packages already placed in orders. */
  router.patch("/packages/:id", manage, async (request, response) => {
    const { items, ...input } = packageInput.partial().parse(request.body);
    const existing = await db.package.findUnique({ where: { id: z.uuid().parse(request.params.id) }, include: packageInclude });
    if (!existing) throw notFound("Package");
    if (items) await assertProductsExist(items.map((item) => item.productId));
    const before = { ...existing, items: existing.items.map(({ productId, quantity }) => ({ productId, quantity })) };
    const changes = diff(before, { ...input, ...(items ? { items } : {}) });
    const updated = await db.$transaction(async (tx) => {
      if (items) {
        await tx.packageItem.deleteMany({ where: { packageId: existing.id } });
        await tx.packageItem.createMany({ data: items.map((item, position) => ({ ...item, position, packageId: existing.id })) });
      }
      const result = await tx.package.update({ where: { id: existing.id }, data: input, include: packageInclude });
      if (changes.changed) {
        await recordAudit(tx, { actorId: actorId(request), action: "package.update", entityType: "package", entityId: existing.id, ...changes });
      }
      return result;
    });
    response.json({ data: updated });
  });

  router.use((error: unknown, _request: unknown, _response: unknown, next: (error: unknown) => void) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      next(conflict("NAME_CONFLICT", "A record with this name already exists"));
      return;
    }
    next(error);
  });

  return router;
}
