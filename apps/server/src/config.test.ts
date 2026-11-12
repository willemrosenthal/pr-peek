import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const key = randomBytes(32);
const required = {
  APP_URL: "http://localhost:5173",
  DATABASE_URL: "postgresql://user:pass@localhost:5433/db",
  SESSION_SECRET: "x".repeat(32),
  TOKEN_ENC_KEY: key.toString("base64"),
  GITHUB_CLIENT_ID: "Iv1.test",
  GITHUB_CLIENT_SECRET: "secret",
};

// APNs settings as Render keeps them: the key on one line.
const APNS = {
  APNS_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
  APNS_KEY_ID: "KEY1234567",
  APNS_TEAM_ID: "TEAM123456",
  APNS_TOPIC: "com.git-buddy.pr-peek",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig(required)).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
      DB_POOL_MAX: 5,
      SYNC_CONCURRENCY: 6,
      // Render's: Cloudflare, then Render's own.
      TRUST_PROXY_HOPS: 2,
    });
  });

  it("turns number settings into numbers", () => {
    const config = loadConfig({
      ...required,
      PORT: "8080",
      DB_POOL_MAX: "3",
      TRUST_PROXY_HOPS: "1",
    });
    expect(config.PORT).toBe(8080);
    expect(config.DB_POOL_MAX).toBe(3);
    expect(config.TRUST_PROXY_HOPS).toBe(1);
  });

  it("decodes the token key into bytes", () => {
    expect(loadConfig(required).TOKEN_ENC_KEY.equals(key)).toBe(true);
  });

  it("leaves push off when the VAPID settings are missing or empty", () => {
    expect(loadConfig(required).VAPID_PUBLIC_KEY).toBeUndefined();
    const empty = {
      VAPID_PUBLIC_KEY: "",
      VAPID_PRIVATE_KEY: "",
      VAPID_SUBJECT: "",
    };
    expect(
      loadConfig({ ...required, ...empty }).VAPID_PUBLIC_KEY,
    ).toBeUndefined();
  });

  it("reads the APNs key with its line breaks written as \\n", () => {
    const config = loadConfig({ ...required, ...APNS });
    expect(config.APNS_KEY).toBe(
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    );
  });

  it("names each missing variable", () => {
    expect(() => loadConfig({})).toThrow(
      /APP_URL[\s\S]*DATABASE_URL[\s\S]*SESSION_SECRET[\s\S]*TOKEN_ENC_KEY[\s\S]*GITHUB_CLIENT_ID[\s\S]*GITHUB_CLIENT_SECRET/,
    );
  });

  it.each([
    ["an unknown NODE_ENV", { NODE_ENV: "staging" }, /NODE_ENV/],
    ["a pool size of zero", { DB_POOL_MAX: "0" }, /DB_POOL_MAX/],
    ["a short session secret", { SESSION_SECRET: "short" }, /SESSION_SECRET/],
    [
      "a token key of the wrong length",
      { TOKEN_ENC_KEY: randomBytes(16).toString("base64") },
      /TOKEN_ENC_KEY/,
    ],
    [
      "only some of the VAPID settings",
      { VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" },
      /VAPID_SUBJECT, or none/,
    ],
    [
      "a VAPID subject that isn't a contact",
      {
        VAPID_PUBLIC_KEY: "public",
        VAPID_PRIVATE_KEY: "private",
        VAPID_SUBJECT: "you@example.com",
      },
      /VAPID_SUBJECT/,
    ],
    [
      "only some of the APNs settings",
      { ...APNS, APNS_TOPIC: undefined },
      /APNS_TOPIC, or none/,
    ],
    ["an APNs key that isn't one", { ...APNS, APNS_KEY: "abc" }, /APNS_KEY/],
    [
      "an APNs key ID of the wrong length",
      { ...APNS, APNS_KEY_ID: "ABC" },
      /APNS_KEY_ID/,
    ],
  ])("rejects %s", (_name, overrides, error) => {
    expect(() => loadConfig({ ...required, ...overrides })).toThrow(error);
  });
});
