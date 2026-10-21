import { z } from "zod";
import { KEY_BYTES } from "./crypto";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  APP_URL: z.url(),
  DATABASE_URL: z.url(),
  // Max connections per pool. Kept small to stay under Supabase's free plan limit.
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  // Signs the session cookie. Generate with: openssl rand -base64 32
  SESSION_SECRET: z.string().min(32),
  // Encrypts GitHub tokens. Generate with: openssl rand -base64 32
  TOKEN_ENC_KEY: z
    .base64()
    .transform((value) => Buffer.from(value, "base64"))
    .refine((key) => key.length === KEY_BYTES, {
      message: `Must be ${KEY_BYTES} bytes, base64 encoded`,
    }),
  // The GitHub OAuth App ("git-buddy (dev)" locally, "git-buddy" in production).
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  // Set by Render on every deploy.
  RENDER_GIT_COMMIT: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
