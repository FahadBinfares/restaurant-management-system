import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.url().refine((value) => {
    return value.startsWith("postgresql:") || value.startsWith("postgres:");
  }),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export function parseEnvironment(input: NodeJS.ProcessEnv) {
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    // Report names only: never serialize Zod input or connection strings.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid environment configuration: ${fields.join(", ")}`);
  }
  return result.data;
}
