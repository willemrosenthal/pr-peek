import type { AdminOverviewResponse, TestAlertResponse } from "@pr-peek/core";
import express, { type RequestHandler, type Router } from "express";
import type { Logger } from "pino";
import { readOverview } from "../admin";
import type { Db } from "../db";
import { HttpError } from "../http-error";
import { deliver, NOTIFY_TTL_SECONDS, type SendPush } from "../push";
import { userLimiter } from "../rate-limit";
import { currentUser, requireUser } from "./auth";

// The page asks once when it opens. This leaves room for reloads, and no more.
const ASKS_PER_MINUTE = 20;

export interface AdminDeps {
  db: Db;
  logger: Logger;
  // Null when push is off, because the VAPID keys aren't set.
  send: SendPush | null;
  now?: () => Date;
}

// Admins only. Others get a 404, so the page doesn't show it exists.
const requireAdmin: RequestHandler = (_req, res, next) => {
  if (currentUser(res).role !== "admin") {
    throw new HttpError(404, "not_found", "Not found");
  }
  next();
};

export function adminRouter(deps: AdminDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();
  router.use(
    "/admin",
    requireUser(deps.db),
    requireAdmin,
    userLimiter(60 * 1000, ASKS_PER_MINUTE),
  );

  // Everything the admin page shows, in one answer.
  router.get("/admin/overview", async (_req, res) => {
    const body: AdminOverviewResponse = await readOverview(deps.db, now());
    res.json(body);
  });

  // A test push to the admin's own devices, like a health alert.
  router.post("/admin/test-alert", async (_req, res) => {
    if (!deps.send) {
      throw new HttpError(
        503,
        "push_off",
        "Push notifications are off on this server",
      );
    }
    const user = currentUser(res);
    const devices = await deps.db.pushSubscription.findMany({
      where: { userId: user.id },
    });
    const sent = await deliver(
      { db: deps.db, send: deps.send, logger: deps.logger },
      user,
      devices,
      {
        title: "Git Buddy needs a look",
        body: "This is a test alert from the admin page.",
        url: "/admin",
        tag: "alert-test",
      },
      { ttlSeconds: NOTIFY_TTL_SECONDS, urgency: "normal", now: now() },
    );
    const body: TestAlertResponse = { sent: sent === "sent" };
    res.json(body);
  });

  return router;
}
