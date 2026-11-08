import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { pino } from "pino";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp, errorHandler, type AppDeps } from "./app";
import { sessionMiddleware } from "./session";

const APP_URL = "https://git-buddy.example";

function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    logger: pino({ level: "silent" }),
    version: "test",
    checkDb: () => Promise.resolve(),
    appUrl: APP_URL,
    trustProxyHops: 1,
    session: sessionMiddleware({ secret: "x".repeat(32), secure: false }),
    ...overrides,
  });
}

it("reads the user's IP past TRUST_PROXY_HOPS proxies", async () => {
  const ipRouter = express.Router().get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });
  const ipWith = async (trustProxyHops: number) =>
    (
      await request(makeApp({ routers: [ipRouter], trustProxyHops }))
        .get("/api/ip")
        .set("X-Forwarded-For", "203.0.113.7, 10.0.0.2")
    ).body as { ip: string };

  expect(await ipWith(1)).toEqual({ ip: "10.0.0.2" });
  expect(await ipWith(2)).toEqual({ ip: "203.0.113.7" });
});

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

describe("cross-site request protection", () => {
  it("blocks a POST from another site", async () => {
    const res = await request(makeApp())
      .post("/api/health")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "forbidden" } });
  });

  it("blocks a POST with no Origin header", async () => {
    const res = await request(makeApp()).post("/api/health");
    expect(res.status).toBe(403);
  });

  it("lets a POST from our own site through", async () => {
    const res = await request(makeApp())
      .post("/api/nope")
      .set("Origin", APP_URL);
    expect(res.status).toBe(404);
  });

  it("matches APP_URL even with a trailing slash", async () => {
    const res = await request(makeApp({ appUrl: `${APP_URL}/` }))
      .post("/api/nope")
      .set("Origin", APP_URL);
    expect(res.status).toBe(404);
  });

  it("allows GET from anywhere, since it doesn't change data", async () => {
    const res = await request(makeApp())
      .get("/api/health")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(200);
  });
});

describe("request logging", () => {
  function appWithLogs(overrides: Partial<AppDeps> = {}) {
    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (l) => lines.push(l) });
    return { app: makeApp({ logger, ...overrides }), lines };
  }

  it("skips successful health checks", async () => {
    const { app, lines } = appWithLogs();
    await request(app).get("/api/health");
    expect(lines).toEqual([]);
  });

  it("still logs failed health checks", async () => {
    const { app, lines } = appWithLogs({
      checkDb: () => Promise.reject(new Error("connection refused")),
    });
    await request(app).get("/api/health");
    expect(lines.join("")).toContain("health check failed");
  });

  it("logs other requests", async () => {
    const { app, lines } = appWithLogs();
    await request(app).get("/api/nope");
    expect(lines.join("")).toContain("request completed");
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
  mkdirSync(join(webDir, "assets"));
  writeFileSync(join(webDir, "assets", "app.js"), "console.log(1);");
  writeFileSync(join(webDir, "sw.js"), "console.log(2);");
  afterAll(() => {
    rmSync(webDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("falls back to index.html for app routes", async () => {
    const res = await request(makeApp({ webDir })).get("/settings/rules");
    expect(res.status).toBe(200);
    expect(res.text).toContain("pr-peek");
  });

  it("lets the page load GitHub's images, and other images only from here", async () => {
    const res = await request(makeApp({ webDir })).get("/");
    const imgSrc = String(res.headers["content-security-policy"])
      .split(";")
      .find((directive) => directive.startsWith("img-src"));
    expect(imgSrc).toBe(
      "img-src 'self' data: https://*.githubusercontent.com https://github.com https://github.githubassets.com",
    );
  });

  it("serves files that exist", async () => {
    const res = await request(makeApp({ webDir })).get("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/javascript");
  });

  it("keeps built assets forever, since their names change each build", async () => {
    const res = await request(makeApp({ webDir })).get("/assets/app.js");
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it.each(["/", "/index.html", "/settings/rules", "/sw.js"])(
    "checks %s for a new version on every load",
    async (path) => {
      const res = await request(makeApp({ webDir })).get(path);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-cache");
    },
  );

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
