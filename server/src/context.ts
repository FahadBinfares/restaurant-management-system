import type { PrismaClient } from "./generated/prisma/client.js";
import type { Employee, Session } from "./generated/prisma/client.js";
import type { Permission } from "./auth/permissions.js";

export interface AppConfig {
  /** Mark cookies `Secure`; true everywhere except plain-HTTP local development. */
  secureCookies: boolean;
  /** Administrators must enrol TOTP before using anything else. */
  requireAdminMfa: boolean;
  /** Absolute session lifetime regardless of activity. */
  sessionMaxHours: number;
  /** Behind exactly one reverse proxy: trust its X-Forwarded-For for client IPs. */
  trustProxy: boolean;
}

export interface AppContext {
  db: PrismaClient;
  config: AppConfig;
  /** Injectable clock so tests can exercise timeouts without waiting. */
  now: () => Date;
}

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export interface AuthState {
  employee: Employee;
  session: Session;
  permissions: Set<Permission>;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthState;
  }
}
