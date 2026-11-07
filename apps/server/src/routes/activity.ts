import { LOOKING_HEADER } from "@pr-peek/core";
import express, { type Router } from "express";
import type { Db } from "../db";
import { STOP_REASONS } from "../github/tokens";
import { MINUTE_MS, SYNC_TIMING } from "../sync-timing";
import { markActive } from "../users";

export interface ActivityDeps {
  db: Db;
  // Queues a sync for the user. False if one was already queued or running.
  requestSync: (userId: string) => Promise<boolean>;
  now?: () => Date;
}

// Records that the signed in user is using the app, on any device, so their syncs speed up
// (see sync-timing.ts). Coming back after a while also syncs right away, so the list is
// fresh. Mount it before the other routers.
export function activityRouter(deps: ActivityDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();

  router.use(async (req, _res, next) => {
    const userId = req.session.userId;
    // Only requests from the app while it has focus. Not background refetches, the live
    // stream, or the Mac app while its window is hidden, heartbeat included.
    if (!userId || req.get(LOOKING_HEADER) !== "1") return next();

    const at = now();
    const saved = await markActive(deps.db, userId, at);
    if (!saved) return next();

    const fresh =
      saved.lastSyncedAt !== null &&
      at.getTime() - saved.lastSyncedAt.getTime() <=
        SYNC_TIMING.activeEveryMinutes * MINUTE_MS;
    // Leaves users alone who must sign in again, whose syncs are backing off, or whose
    // sign-up request waits for an admin.
    const waiting =
      !saved.approvedAt ||
      STOP_REASONS.some((reason) => reason === saved.syncError) ||
      (saved.syncRetryAt !== null && saved.syncRetryAt > at);
    if (!fresh && !waiting) {
      // A failed queue shouldn't fail the request. The next scheduled sync still runs.
      await deps.requestSync(userId).catch((err: unknown) => {
        req.log.warn({ err }, "sync on open failed to queue");
      });
    }
    next();
  });

  return router;
}
