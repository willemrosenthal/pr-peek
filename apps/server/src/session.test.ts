import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { sessionMiddleware } from "./session";

function makeApp(secure: boolean) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(sessionMiddleware({ secret: "x".repeat(32), secure }));
  app.get("/sign-in", (req, res) => {
    req.session.userId = "user-1";
    res.sendStatus(204);
  });
  app.get("/whoami", (req, res) => {
    res.json({ userId: req.session.userId ?? null });
  });
  app.get("/nothing", (_req, res) => {
    res.sendStatus(204);
  });
  return app;
}

function cookieOf(res: request.Response): string {
  const header = res.headers["set-cookie"] as string[] | undefined;
  return header?.[0] ?? "";
}

describe("sessionMiddleware", () => {
  it("sets a safe cookie when a session starts", async () => {
    const cookie = cookieOf(await request(makeApp(false)).get("/sign-in"));
    expect(cookie).toMatch(/^sid=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toMatch(/Expires=/);
  });

  it("only sends the cookie over HTTPS when secure", async () => {
    const app = makeApp(true);
    const overHttp = await request(app).get("/sign-in");
    expect(cookieOf(overHttp)).toBe("");

    const overHttps = await request(app)
      .get("/sign-in")
      .set("X-Forwarded-Proto", "https");
    expect(cookieOf(overHttps)).toContain("Secure");
  });

  it("remembers the user on the next request", async () => {
    const agent = request.agent(makeApp(false));
    await agent.get("/sign-in");
    const res = await agent.get("/whoami");
    expect(res.body).toEqual({ userId: "user-1" });
  });

  it("doesn't set a cookie for visitors who haven't signed in", async () => {
    const res = await request(makeApp(false)).get("/nothing");
    expect(cookieOf(res)).toBe("");
  });
});
