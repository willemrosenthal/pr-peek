import { markSeenBody } from "@pr-peek/core";
import express, { type Router } from "express";
import type { Db } from "../db";
import { parseInput } from "../http-error";
import { groupItems, openItems, summarize } from "../item-list";
import { currentUser, requireUser } from "./auth";

export interface ItemDeps {
  db: Db;
  now?: () => Date;
}

export function itemsRouter(deps: ItemDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();
  router.use(["/items", "/summary"], requireUser(deps.db));

  router.get("/items", async (_req, res) => {
    const items = await openItems(deps.db, currentUser(res).id, now());
    res.json(groupItems(items));
  });

  router.get("/summary", async (_req, res) => {
    const items = await openItems(deps.db, currentUser(res).id, now());
    res.json(summarize(items));
  });

  // Called when the user leaves the list. Items the user can't see are skipped.
  router.post("/items/seen", async (req, res) => {
    const { ids } = parseInput(markSeenBody, req.body);
    await deps.db.item.updateMany({
      where: { id: { in: ids }, userId: currentUser(res).id, seenAt: null },
      data: { seenAt: now() },
    });
    res.sendStatus(204);
  });

  return router;
}
