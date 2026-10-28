import { Router, json } from "express";
import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import type { Customer } from "./generated/prisma/client.js";
import { normalizeSaudiMobile } from "./phone.js";

const customerInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: z.string().max(32).transform((phone, context) => {
    const normalized = normalizeSaudiMobile(phone);
    if (!normalized) context.addIssue({ code: "custom", message: "Invalid Saudi mobile number" });
    return normalized ?? z.NEVER;
  }),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type NewCustomer = z.infer<typeof customerInput>;
/** Exact normalized phone, a digit fragment of a phone, or a name substring. */
export type CustomerSearch = { phone: string } | { phoneFragment: string } | { name: string };
export interface CustomerStore {
  create(input: NewCustomer): Promise<Customer>;
  get(id: string): Promise<Customer | null>;
  list(page: number, pageSize: number, search?: CustomerSearch): Promise<{ data: Customer[]; total: number }>;
}

export function parseCustomerSearch(raw: string | undefined): CustomerSearch | undefined {
  const query = raw?.trim();
  if (!query) return undefined;
  const phone = normalizeSaudiMobile(query);
  if (phone) return { phone };
  const digits = query.replace(/[\s\-.()+]/g, "");
  if (/^[0-9]{3,}$/.test(digits)) return { phoneFragment: digits.replace(/^0+/, "") };
  return { name: query };
}

const positiveInteger = (max: number) => z.string().regex(/^[1-9][0-9]*$/)
  .transform(Number).pipe(z.number().int().max(max));
const listQuery = z.strictObject({
  page: positiveInteger(1_000_000).default(1),
  pageSize: positiveInteger(100).default(20),
  q: z.string().max(120).optional(),
});

export function isDatabaseUnavailable(code: unknown) {
  // P1xxx: connection/authentication failures; P2024: connection pool timeout.
  return typeof code === "string" && (/^P1[0-9]{3}$/.test(code) || code === "P2024");
}

export function createCustomersRouter(store: CustomerStore) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.use(json({ limit: "16kb" }));

  router.post("/", async (request, response) => {
    const parsed = customerInput.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid customer payload" } });
      return;
    }
    const customer = await store.create(parsed.data);
    response.location(`/api/customers/${customer.id}`).status(201).json({ data: customer });
  });

  router.get("/", async (request, response) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid pagination" } });
      return;
    }
    const { page, pageSize, q } = parsed.data;
    const { data, total } = await store.list(page, pageSize, parseCustomerSearch(q));
    response.json({ data, pagination: { page, pageSize, total } });
  });

  router.get("/:id", async (request, response) => {
    const parsed = z.uuid().safeParse(request.params.id);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid customer ID" } });
      return;
    }
    const customer = await store.get(parsed.data);
    if (!customer) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Customer not found" } });
      return;
    }
    response.json({ data: customer });
  });

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) { next(error); return; }
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
    if (status === 400 || status === 413) {
      response.status(status).json({ error: {
        code: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT",
        message: status === 413 ? "Payload too large" : "Invalid JSON payload",
      } });
    } else if (code === "P2002") {
      response.status(409).json({ error: { code: "PHONE_CONFLICT", message: "Phone already registered" } });
    } else if (isDatabaseUnavailable(code)) {
      // Never return driver errors, connection strings, or submitted personal data.
      response.status(503).json({ error: { code: "DATABASE_UNAVAILABLE", message: "Customer storage unavailable" } });
    } else {
      // Programming errors must not be reported as database outages.
      console.error("Unhandled customer API error:", error instanceof Error ? error.name : typeof error);
      response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
    }
  };
  router.use(handleError);
  return router;
}
