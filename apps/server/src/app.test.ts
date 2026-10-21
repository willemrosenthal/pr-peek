import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { pino } from "pino";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp, errorHandler, type AppDeps } from "./app";

function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    logger: pino({ level: "silent" }),
    version: "test",
    checkDb: () => Promise.resolve(),
    ...overrides,
  });
}

describe("GET /api/health", () => {
  it("returns ok when the database is reachable", async () => {
    const res = await request(makeApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: "test" });
  });

  it("returns 503 when the database is down", async () => {
    const app = makeApp({
      checkDb: () => Promise.reject(new Error("connection refused")),
    });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, version: "test" });
  });
});

describe("API errors", () => {
  it("returns JSON 404 for unknown API routes", async () => {
    const res = await request(makeApp()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "not_found", message: "Not found" },
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(makeApp())
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "bad_request" } });
  });

  it("returns 413 for bodies over the size limit", async () => {
    const res = await request(makeApp())
      .post("/api/health")
      .send({ data: "x".repeat(200_000) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: { code: "bad_request" } });
  });

  it("hides the details of unexpected errors", async () => {
    const app = express();
    app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
    app.get("/boom", () => {
      throw new Error("database password is hunter2");
    });
    app.use(errorHandler);

    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: "internal_error", message: "Something went wrong" },
    });
  });
});

describe("serving the PWA", () => {
  const webDir = mkdtempSync(join(tmpdir(), "pr-peek-web-"));
  const emptyDir = mkdtempSync(join(tmpdir(), "pr-peek-empty-"));
  writeFileSync(join(webDir, "index.html"), "<h1>pr-peek</h1>");
  afterAll(() => {
    rmSync(webDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("falls back to index.html for app routes", async () => {
    const res = await request(makeApp({ webDir })).get("/settings/rules");
    expect(res.status).toBe(200);
    expect(res.text).toContain("pr-peek");
  });

  it("returns 404, not index.html, for missing files", async () => {
    const res = await request(makeApp({ webDir })).get("/assets/old.js");
    expect(res.status).toBe(404);
  });

  it("still returns JSON 404 for unknown API routes", async () => {
    const res = await request(makeApp({ webDir })).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "not_found" } });
  });

  it("serves nothing when the folder has no index.html", async () => {
    const res = await request(makeApp({ webDir: emptyDir })).get("/");
    expect(res.status).toBe(404);
  });
});
