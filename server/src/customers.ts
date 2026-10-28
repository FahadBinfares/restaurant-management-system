import { Router, json } from "express";
import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import type { Customer } from "./generated/prisma/client.js";

const customerInput = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^(?:05[0-9]{8}|\+?9665[0-9]{8})$/)
    .transform((phone) => phone.startsWith("0") ? `+966${phone.slice(1)}`
      : phone.startsWith("+") ? phone : `+${phone}`),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type NewCustomer = z.infer<typeof customerInput>;
export interface CustomerStore {
  create(input: NewCustomer): Promise<Customer>;
  get(id: string): Promise<Customer | null>;
  list(page: number, pageSize: number): Promise<{ data: Customer[]; total: number }>;
}

const positiveInteger = (max: number) => z.string().regex(/^[1-9][0-9]*$/)
  .transform(Number).pipe(z.number().int().max(max));
const pagination = z.strictObject({
  page: positiveInteger(1_000_000).default(1),
  pageSize: positiveInteger(100).default(20),
});

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
    const parsed = pagination.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid pagination" } });
      return;
    }
    const { page, pageSize } = parsed.data;
    const { data, total } = await store.list(page, pageSize);
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
    } else {
      // Never return driver errors, connection strings, or submitted personal data.
      response.status(503).json({ error: { code: "DATABASE_UNAVAILABLE", message: "Customer storage unavailable" } });
    }
  };
  router.use(handleError);
  return router;
}
