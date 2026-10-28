import express from "express";
import type { RequestHandler } from "express";
import { createAuthRouter } from "./auth/routes.js";
import type { AppContext } from "./context.js";
import { AppError, errorHandler } from "./http/errors.js";
import { createCatalogRouter } from "./modules/catalog.js";
import { createCustomersRouter } from "./modules/customers.js";
import { createDeliveryRouter } from "./modules/delivery.js";
import { createOrdersRouter } from "./modules/orders/routes.js";
import { createPaymentsRouter } from "./modules/payments.js";
import { createReportsRouter } from "./modules/reports.js";
import { createEmployeesRouter } from "./modules/employees.js";
import { createAuditRouter, createSettingsRouter } from "./modules/settings.js";

const securityHeaders: RequestHandler = (_request, response, next) => {
  response.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  next();
};

/**
 * CSRF defence in depth on top of SameSite=Strict cookies: state-changing requests
 * must carry a custom header, which cross-site forms cannot send and cross-origin
 * scripts cannot send without a CORS preflight this API never approves.
 */
const requireApiClientHeader: RequestHandler = (request, _response, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && request.get("x-requested-with") !== "rms") {
    throw new AppError(403, "CSRF_REJECTED", "Missing X-Requested-With header");
  }
  next();
};

export function createApp(checkDatabase: () => Promise<void>, context?: AppContext) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", context?.config.trustProxy ? 1 : false);
  app.use(securityHeaders);

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/ready", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    try {
      await checkDatabase();
      response.json({ status: "ready" });
    } catch {
      response.status(503).json({ status: "not_ready" });
    }
  });

  if (context) {
    app.use("/api", (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      next();
    });
    app.use("/api", requireApiClientHeader, express.json({ limit: "256kb" }));
    app.use("/api/auth", createAuthRouter(context));
    app.use("/api/employees", createEmployeesRouter(context));
    app.use("/api/settings", createSettingsRouter(context));
    app.use("/api/audit", createAuditRouter(context));
    app.use("/api/customers", createCustomersRouter(context));
    app.use("/api/catalog", createCatalogRouter(context));
    app.use("/api/orders", createOrdersRouter(context));
    // These routers span several resource paths, so they mount at /api.
    app.use("/api", createPaymentsRouter(context), createDeliveryRouter(context), createReportsRouter(context));
  }

  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  });
  app.use(errorHandler);
  return app;
}
