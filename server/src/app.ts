import express from "express";
import type { ErrorRequestHandler } from "express";

export function createApp(checkDatabase: () => Promise<void>) {
  const app = express();
  app.disable("x-powered-by");

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

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });

  const handleError: ErrorRequestHandler = (_error, _request, response, next) => {
    if (response.headersSent) {
      next(_error);
      return;
    }
    response.status(500).json({ error: "Internal server error" });
  };
  app.use(handleError);
  return app;
}
