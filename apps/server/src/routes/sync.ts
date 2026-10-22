import type { RequestSyncResponse, SyncStatusResponse } from "@pr-peek/core";
import express, { type Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { Db } from "../db";
import { NeedsReauthError, STOP_REASONS } from "../github/tokens";
import { SYNC_TIMEOUT_SECONDS } from "../jobs";
import { currentUser, requireUser } from "./auth";

const REFRESH_EVERY_MS = 30 * 1000;

export interface SyncRouteDeps {
  db: Db;
  // Queues a sync for the user. False if one was already queued or running.
  requestSync: (userId: string) => Promise<boolean>;
  now?: () => Date;
}

export function syncRouter(deps: SyncRouteDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();
  router.use("/sync", requireUser(deps.db));

  // One refresh per user every 30 seconds.
  const limiter = rateLimit({
    windowMs: REFRESH_EVERY_MS,
    limit: 1,
    keyGenerator: (_req, res) => currentUser(res).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: { code: "rate_limited", message: "Wait a moment and try again" },
    },
  });

  // "Refresh now". Runs even while a failed sync is waiting to retry.
  router.post("/sync", limiter, async (_req, res) => {
    const user = currentUser(res);
    const stopped = STOP_REASONS.find((reason) => reason === user.syncError);
    if (stopped) throw new NeedsReauthError(user.id, stopped);
    const body: RequestSyncResponse = {
      queued: await deps.requestSync(user.id),
    };
    res.status(202).json(body);
  });

  router.get("/sync/status", (_req, res) => {
    const user = currentUser(res);
    // A sync that started long ago was given up on, or its worker stopped.
    const running =
      user.syncStartedAt !== null &&
      now().getTime() - user.syncStartedAt.getTime() <
        SYNC_TIMEOUT_SECONDS * 1000;
    const body: SyncStatusResponse = {
      lastSyncedAt: user.lastSyncedAt?.toISOString() ?? null,
      syncError: user.syncError,
      running,
    };
    res.json(body);
  });

  return router;
}
