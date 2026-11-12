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

// A refine for settings that only work together: all set, or none.
function allOrNone<Key extends string>(
  keys: Key[],
): [
  check: (env: Partial<Record<Key, unknown>>) => boolean,
  error: { message: string; path: string[] },
] {
  return [
    (env) => {
      const set = keys.map((key) => env[key]);
      return set.every(Boolean) || !set.some(Boolean);
    },
    { message: `Set all of ${keys.join(", ")}, or none`, path: [keys[0]!] },
  ];
}

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
    // Signs pushes to the iPhone app (plan 12): the APNs key from Apple's developer site.
    // Without them, the app gets no pushes. APNS_KEY is the whole .p8 file. A value with
    // "\n" in place of its line breaks works too.
    APNS_KEY: optional(
      z
        .string()
        .transform((key) => key.replaceAll("\\n", "\n"))
        .refine((key) => key.includes("BEGIN PRIVATE KEY"), {
          message: "Must be the .p8 file's text",
        }),
    ),
    APNS_KEY_ID: optional(
      z.string().regex(/^[A-Z0-9]{10}$/, "Must be 10 characters"),
    ),
    APNS_TEAM_ID: optional(
      z.string().regex(/^[A-Z0-9]{10}$/, "Must be 10 characters"),
    ),
    // The app's bundle ID, com.git-buddy.pr-peek.
    APNS_TOPIC: optional(z.string().min(1)),
    // Proxies between users and us, so rate limits see each user's real IP. On Render,
    // 2: Cloudflare, then Render's own. Check with GET /api/admin/ip (see
    // docs/security.md, "Rate limits and IPs").
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(2),
    // Set by Render on every deploy.
    RENDER_GIT_COMMIT: z.string().optional(),
  })
  .refine(
    ...allOrNone(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]),
  )
  .refine(
    ...allOrNone(["APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_TOPIC"]),
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
