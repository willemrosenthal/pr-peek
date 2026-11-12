import type { SendApple } from "../apns";
import type {
  AdminOverviewResponse,
  SignUpRequestsResponse,
  TestAlertResponse,
} from "@pr-peek/core";
import express, { type RequestHandler, type Router } from "express";
import { readOverview } from "../admin";
import { deleteAccount, type AccountDeps } from "../account";
import { HttpError } from "../http-error";
import { deliver, NOTIFY_TTL_SECONDS, type SendPush } from "../push";
import { userLimiter } from "../rate-limit";
import { currentUser, requireUser } from "./auth";

// The page asks once when it opens. This leaves room for reloads, approving and
// declining a few requests, and no more.
const ASKS_PER_MINUTE = 30;
// Requests shown at once. More waiting means something's wrong.
const MAX_REQUESTS = 100;

// The database, logger, OAuth client, and keys, to delete a declined request's user.
export interface AdminDeps extends AccountDeps {
  // Null when push is off, because the VAPID keys aren't set.
  send: SendPush | null;
  // Null when Apple push is off, because the APNs settings aren't set.
  apple?: SendApple | null;
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

  // The IP the server sees for you, to check TRUST_PROXY_HOPS. It should match your own
  // IP. If it's one of Render's, sign-in rate limits would lump everyone together.
  router.get("/admin/ip", (req, res) => {
    res.json({ ip: req.ip, forwardedFor: req.get("x-forwarded-for") ?? null });
  });

  // Sign-up requests waiting for an admin, oldest first.
  router.get("/admin/requests", async (_req, res) => {
    const users = await deps.db.user.findMany({
      where: { approvedAt: null },
      orderBy: { createdAt: "asc" },
      take: MAX_REQUESTS,
      select: {
        id: true,
        login: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    const body: SignUpRequestsResponse = {
      requests: users.map(({ createdAt, ...user }) => ({
        ...user,
        askedAt: createdAt.toISOString(),
      })),
    };
    res.json(body);
  });

  // Lets them in. Their next request opens their list.
  router.post("/admin/requests/:id/approve", async (req, res) => {
    const { count } = await deps.db.user.updateMany({
      where: { id: req.params.id, approvedAt: null },
      data: { approvedAt: now() },
    });
    if (count === 0) throw requestGone();
    res.sendStatus(204);
  });

  // Deletes what we have on them, like "Delete my account". They can ask again by
  // signing in.
  router.delete("/admin/requests/:id", async (req, res) => {
    const waiting = await deps.db.user.findFirst({
      where: { id: req.params.id, approvedAt: null },
      select: { id: true },
    });
    if (!waiting) throw requestGone();
    await deleteAccount(deps, waiting.id);
    res.sendStatus(204);
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
      { db: deps.db, send: deps.send, apple: deps.apple, logger: deps.logger },
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

// Already approved, declined, or withdrawn.
const requestGone = () =>
  new HttpError(404, "not_found", "That request is no longer waiting");
