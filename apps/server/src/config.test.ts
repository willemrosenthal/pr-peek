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

  it("turns PORT into a number", () => {
    expect(loadConfig({ ...required, PORT: "8080" }).PORT).toBe(8080);
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
