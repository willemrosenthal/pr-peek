import express, { type Router } from "express";
import type { Db } from "../db";
import { currentUser, requireUser } from "./auth";

export interface DesktopRouteDeps {
  db: Db;
  now?: () => Date;
}

// For the Mac menu bar app.
export function desktopRouter(deps: DesktopRouteDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();
  router.use("/desktop", requireUser(deps.db));

  // Sent every minute while the app runs. Until a few minutes after the last one, the
  // user's notifications go to the app instead of the browsers on that Mac.
  router.post("/desktop/heartbeat", async (_req, res) => {
    await deps.db.user.updateMany({
      where: { id: currentUser(res).id },
      data: { desktopSeenAt: now() },
    });
    res.sendStatus(204);
  });

  return router;
}
