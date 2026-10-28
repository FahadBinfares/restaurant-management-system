import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

/** An error whose code and message are safe to return to the client. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = () => new AppError(403, "FORBIDDEN", "You do not have permission for this action");
export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

export function isDatabaseUnavailable(code: unknown) {
  // P1xxx: connection/authentication failures; P2024: connection pool timeout.
  return typeof code === "string" && (/^P1[0-9]{3}$/.test(code) || code === "P2024");
}

function field(error: unknown, key: string): unknown {
  return typeof error === "object" && error !== null && key in error
    ? (error as Record<string, unknown>)[key] : undefined;
}

/** Final error handler: never returns driver errors, SQL, or submitted personal data. */
export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) { next(error); return; }
  const send = (status: number, code: string, message: string, details?: unknown) => {
    response.status(status).json({ error: details === undefined ? { code, message } : { code, message, details } });
  };
  if (error instanceof AppError) return send(error.status, error.code, error.message, error.details);
  if (error instanceof ZodError) {
    // Report paths and messages only; never echo the submitted values.
    return send(400, "INVALID_INPUT", "Invalid request", error.issues.map((issue) => ({
      path: issue.path.join("."), message: issue.message,
    })));
  }
  const status = field(error, "status");
  const type = field(error, "type");
  if (status === 413) return send(413, "PAYLOAD_TOO_LARGE", "Payload too large");
  if (status === 400 && type === "entity.parse.failed") return send(400, "INVALID_INPUT", "Invalid JSON payload");
  if (status === 415) return send(415, "UNSUPPORTED_MEDIA_TYPE", "Expected application/json");
  const code = field(error, "code");
  if (code === "P2002") return send(409, "CONFLICT", "A record with these unique values already exists");
  if (code === "P2025") return send(404, "NOT_FOUND", "Record not found");
  if (code === "P2034") return send(409, "TRANSACTION_CONFLICT", "Concurrent update; please retry");
  if (isDatabaseUnavailable(code)) return send(503, "DATABASE_UNAVAILABLE", "Storage unavailable");
  // Prisma messages can embed query arguments (personal data); log only name and code for those.
  const description = !(error instanceof Error) ? typeof error
    : error.name.startsWith("Prisma") ? `${error.name} ${String(code ?? "")}`
      : `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  console.error("Unhandled API error:", description);
  send(500, "INTERNAL_ERROR", "Internal server error");
};
