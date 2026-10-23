import { markSeenBody, type ItemsResponse } from "@pr-peek/core";
import express, { type Router } from "express";
import type { Db } from "../db";
import { HttpError, parseInput } from "../http-error";
import {
  groupItems,
  idlePrs,
  onePerPr,
  openItems,
  summarize,
} from "../item-list";
import { publishItemsChanged } from "../items";
import { currentUser, requireUser } from "./auth";

export interface ItemDeps {
  db: Db;
  now?: () => Date;
}

export function itemsRouter(deps: ItemDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();
  router.use(["/items", "/summary", "/prs"], requireUser(deps.db));

  router.get("/items", async (_req, res) => {
    const user = currentUser(res);
    const [items, idle, quietItems, quietIdle] = await Promise.all([
      openItems(deps.db, user.id, now()),
      idlePrs(deps.db, user, now()),
      openItems(deps.db, user.id, now(), true),
      idlePrs(deps.db, user, now(), true),
    ]);
    const body: ItemsResponse = {
      ...groupItems(items),
      idlePrs: idle,
      quiet: { items: onePerPr(quietItems), idlePrs: quietIdle },
    };
    res.json(body);
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

  // Quiets a PR until something new happens on it.
  router.put("/prs/:id/quiet", async (req, res) => {
    await setQuietAt(deps.db, currentUser(res).id, req.params.id, now());
    res.sendStatus(204);
  });

  router.delete("/prs/:id/quiet", async (req, res) => {
    await setQuietAt(deps.db, currentUser(res).id, req.params.id, null);
    res.sendStatus(204);
  });

  return router;
}

// Sets when the user's PR went quiet, or null to bring it back. Tells the user's other
// devices.
async function setQuietAt(
  db: Db,
  userId: string,
  prId: string,
  quietAt: Date | null,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { count } = await tx.pullRequest.updateMany({
      where: { id: prId, userId },
      data: { quietAt },
    });
    if (count === 0) throw new HttpError(404, "not_found", "PR not found");
    await publishItemsChanged(tx, userId);
  });
}
