import { z } from "zod";
import { KEY_BYTES } from "./crypto";

// A setting that can be left out or left empty, like `NAME=` in .env.
const optional = <T extends z.ZodType>(type: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), type.optional());

// 32 bytes, base64 encoded.
const encryptionKey = z
  .base64()
  .transform((value) => Buffer.from(value, "base64"))
  .refine((key) => key.length === KEY_BYTES, {
    message: `Must be ${KEY_BYTES} bytes, base64 encoded`,
  });

const schema = z
  .object({
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
    // Syncs the worker runs at once. They mostly wait on GitHub, and only hold a database
    // connection for short reads and their save, so this can be above DB_POOL_MAX.
    SYNC_CONCURRENCY: z.coerce.number().int().positive().default(6),
    // Signs the session cookie. Generate with: openssl rand -base64 32
    SESSION_SECRET: z.string().min(32),
    // Encrypts GitHub tokens. Generate with: openssl rand -base64 32
    TOKEN_ENC_KEY: encryptionKey,
    // The key before TOKEN_ENC_KEY, while changing it. Tokens it encrypted still read.
    // See docs/security.md, "Change the key".
    TOKEN_ENC_KEY_PREVIOUS: optional(encryptionKey),
    // The GitHub OAuth App ("git-buddy (dev)" locally, "git-buddy" in production).
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    // Signs push notifications. Without them, push is off. Never change them once set:
    // every device would have to turn notifications on again.
    VAPID_PUBLIC_KEY: optional(z.string()),
    VAPID_PRIVATE_KEY: optional(z.string()),
    // A contact for the push services, like mailto:you@example.com.
    VAPID_SUBJECT: optional(
      z
        .string()
        .regex(/^(mailto:|https:)/, "Must start with mailto: or https:"),
    ),
    // Set by Render on every deploy.
    RENDER_GIT_COMMIT: z.string().optional(),
  })
  .refine(
    (env) => {
      const set = [
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY,
        env.VAPID_SUBJECT,
      ];
      return set.every(Boolean) || !set.some(Boolean);
    },
    {
      message:
        "Set all of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, or none",
      path: ["VAPID_PUBLIC_KEY"],
    },
  );

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
