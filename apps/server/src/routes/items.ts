import { markSeenBody, type ItemsResponse } from "@pr-peek/core";
import express, { type Router } from "express";
import type { Db } from "../db";
import { HttpError, parseInput } from "../http-error";
import {
  groupItems,
  idlePrs,
  loadListContext,
  mergedPrs,
  onePerPr,
  openItems,
  summarize,
} from "../item-list";
import { publishItemsChanged } from "../items";
import { KEEP_UNSEEN_MS } from "../sync";
import { currentUser, requireUser } from "./auth";

export interface ItemDeps {
  db: Db;
  // Queues a sync for the user. False if one was already queued or running.
  requestSync: (userId: string) => Promise<boolean>;
  now?: () => Date;
}

export function itemsRouter(deps: ItemDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();
  router.use(["/items", "/summary", "/prs"], requireUser(deps.db));

  router.get("/items", async (_req, res) => {
    const user = currentUser(res);
    const at = now();
    const ctx = await loadListContext(deps.db, user.id);
    const [items, idle, merged, quietItems, quietIdle] = await Promise.all([
      openItems(deps.db, user.id, at, { ctx }),
      idlePrs(deps.db, user, at, ctx),
      mergedPrs(deps.db, user, at, ctx),
      openItems(deps.db, user.id, at, { quiet: true, ctx }),
      idlePrs(deps.db, user, at, ctx, true),
    ]);
    const body: ItemsResponse = {
      ...groupItems(items),
      idlePrs: idle,
      merged,
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
    await updatePr(deps.db, currentUser(res).id, req.params.id, {
      quietAt: now(),
    });
    res.sendStatus(204);
  });

  router.delete("/prs/:id/quiet", async (req, res) => {
    await updatePr(deps.db, currentUser(res).id, req.params.id, {
      quietAt: null,
    });
    res.sendStatus(204);
  });

  // Marks a PR important, as a reminder to come back to it.
  router.put("/prs/:id/important", async (req, res) => {
    await updatePr(deps.db, currentUser(res).id, req.params.id, {
      importantAt: now(),
    });
    res.sendStatus(204);
  });

  // A PR added by its link stops being tracked too. It's marked as unseen for a week,
  // and a sync's cleanup decides: kept if the searches still find it or it has open
  // items, else deleted. Deleting it here could lose a PR the searches track too.
  router.delete("/prs/:id/important", async (req, res) => {
    const userId = currentUser(res).id;
    const pr = await deps.db.pullRequest.findFirst({
      where: { id: req.params.id, userId },
      select: { addedAt: true },
    });
    if (!pr) throw new HttpError(404, "not_found", "PR not found");
    const at = now();
    await updatePr(deps.db, userId, req.params.id, {
      importantAt: null,
      ...(pr.addedAt && {
        addedAt: null,
        lastSeenAt: new Date(at.getTime() - KEEP_UNSEEN_MS),
      }),
    });
    if (pr.addedAt) {
      await deps.requestSync(userId).catch((err: unknown) => {
        req.log.warn({ err }, "queueing a sync after unflagging failed");
      });
    }
    res.sendStatus(204);
  });

  return router;
}

// Changes the user's PR. Tells the user's other devices.
export async function updatePr(
  db: Db,
  userId: string,
  prId: string,
  data: {
    quietAt?: Date | null;
    importantAt?: Date | null;
    addedAt?: null;
    lastSeenAt?: Date;
  },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const { count } = await tx.pullRequest.updateMany({
      where: { id: prId, userId },
      data,
    });
    if (count === 0) throw new HttpError(404, "not_found", "PR not found");
    await publishItemsChanged(tx, userId);
  });
}
