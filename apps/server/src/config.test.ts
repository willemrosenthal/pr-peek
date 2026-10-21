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

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig(required)).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      LOG_LEVEL: "info",
      DB_POOL_MAX: 5,
    });
  });

  it("turns number settings into numbers", () => {
    const config = loadConfig({ ...required, PORT: "8080", DB_POOL_MAX: "3" });
    expect(config.PORT).toBe(8080);
    expect(config.DB_POOL_MAX).toBe(3);
  });

  it("decodes the token key into bytes", () => {
    expect(loadConfig(required).TOKEN_ENC_KEY.equals(key)).toBe(true);
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
  ])("rejects %s", (_name, overrides, error) => {
    expect(() => loadConfig({ ...required, ...overrides })).toThrow(error);
  });
});
