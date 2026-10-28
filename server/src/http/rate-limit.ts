import type { RequestHandler } from "express";
import { AppError } from "./errors.js";

/**
 * Fixed-window, in-memory limiter keyed by client IP. Adequate for a single API
 * instance; per-account lockout in the database is the durable brute-force control.
 */
export function rateLimit(options: { windowMs: number; max: number; now?: () => number }): RequestHandler {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (request, response, next) => {
    const key = request.ip ?? "unknown";
    const time = now();
    if (hits.size > 10_000) {
      for (const [entryKey, entry] of hits) if (entry.resetAt <= time) hits.delete(entryKey);
    }
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= time) {
      hits.set(key, { count: 1, resetAt: time + options.windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > options.max) {
      response.set("Retry-After", String(Math.ceil((entry.resetAt - time) / 1000)));
      throw new AppError(429, "RATE_LIMITED", "Too many attempts; try again later");
    }
    next();
  };
}
