import { z } from "zod";

const booleanFlag = z.enum(["true", "false"]).transform((value) => value === "true");

const environmentSchema = z.object({
  DATABASE_URL: z.url().refine((value) => {
    return value.startsWith("postgresql:") || value.startsWith("postgres:");
  }),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  /** Defaults to true outside development; local HTTP needs false. */
  SECURE_COOKIES: booleanFlag.optional(),
  /** Defaults to true outside development. */
  REQUIRE_ADMIN_MFA: booleanFlag.optional(),
  /** Set when running behind exactly one reverse proxy (Nginx) so client IPs are correct. */
  TRUST_PROXY: booleanFlag.default(false),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(24).default(12),
}).transform((env) => {
  const deployed = env.APP_ENV === "staging" || env.APP_ENV === "production";
  return {
    ...env,
    SECURE_COOKIES: env.SECURE_COOKIES ?? deployed,
    REQUIRE_ADMIN_MFA: env.REQUIRE_ADMIN_MFA ?? deployed,
  };
}).refine((env) => !(env.APP_ENV === "production" && (!env.SECURE_COOKIES || !env.REQUIRE_ADMIN_MFA)), {
  path: ["APP_ENV"],
  message: "Production requires secure cookies and administrator MFA",
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(input: NodeJS.ProcessEnv) {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    // Report names only: never serialize Zod input or connection strings.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid environment configuration: ${fields.join(", ")}`);
  }
  return result.data;
}
