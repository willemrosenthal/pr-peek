import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const required = {
  APP_URL: "http://localhost:5173",
  DATABASE_URL: "postgresql://user:pass@localhost:5433/db",
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig(required)).toEqual({
      ...required,
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

  it("rejects a pool size of zero", () => {
    expect(() => loadConfig({ ...required, DB_POOL_MAX: "0" })).toThrow(
      /DB_POOL_MAX/,
    );
  });

  it("names each missing variable", () => {
    expect(() => loadConfig({})).toThrow(/APP_URL[\s\S]*DATABASE_URL/);
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => loadConfig({ ...required, NODE_ENV: "staging" })).toThrow(
      /NODE_ENV/,
    );
  });
});
