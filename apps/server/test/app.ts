import type { Router } from "express";
import { pino } from "pino";
import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/db";
import type { SendPush } from "../src/push";
import { authRouter } from "../src/routes/auth";
import { sessionMiddleware } from "../src/session";
import { fakeOAuth, TEST_KEY } from "./fakes";

export const APP_URL = "https://git-buddy.example";

// The app with sign in, plus any extra routers. Returns a cookie-keeping test client.
export function makeTestApp(
  db: Db,
  options: {
    oauth?: ReturnType<typeof fakeOAuth>;
    routers?: Router[];
    send?: SendPush | null;
  } = {},
) {
  const oauth = options.oauth ?? fakeOAuth();
  const app = createApp({
    logger: pino({ level: "silent" }),
    version: "test",
    checkDb: () => Promise.resolve(),
    appUrl: APP_URL,
    session: sessionMiddleware({ secret: "x".repeat(32), secure: false }),
    routers: [
      authRouter({
        db,
        oauth,
        key: TEST_KEY,
        appUrl: APP_URL,
        send: options.send ?? null,
        logger: pino({ level: "silent" }),
      }),
      ...(options.routers ?? []),
    ],
  });
  const agent = request.agent(app);
  databases.set(agent, db);
  return { app, agent, oauth };
}

// Each test client's database, so `signIn` can approve the user.
const databases = new WeakMap<object, Db>();

export type Agent = ReturnType<typeof makeTestApp>["agent"];

// A response body, typed with the API's response type.
export function bodyOf<T>(res: request.Response): T {
  return res.body as T;
}

// Starts sign in and returns the `state` value we sent to GitHub.
export async function startSignIn(agent: Agent, query = ""): Promise<string> {
  const res = await agent.get(`/api/auth/github${query}`);
  expect(res.status).toBe(302);
  return (
    new URL(res.headers.location as string).searchParams.get("state") ?? ""
  );
}

// Signs in as the fake GitHub user (octocat), approved unless `pending`.
export async function signIn(agent: Agent, { pending = false } = {}) {
  const state = await startSignIn(agent);
  const res = await agent.get(
    `/api/auth/github/callback?code=the-code&state=${state}`,
  );
  const db = databases.get(agent);
  if (!pending && db) {
    await db.user.updateMany({
      where: { approvedAt: null },
      data: { approvedAt: new Date() },
    });
  }
  return res;
}
