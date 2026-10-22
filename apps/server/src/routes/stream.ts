import { ITEMS_CHANGED_EVENT } from "@pr-peek/core";
import express, { type Router } from "express";
import type { Db } from "../db";
import { openItems, summarize } from "../item-list";
import type { ItemsListener } from "../items-listener";
import { currentUser, requireUser } from "./auth";

// Proxies close connections that stay quiet for too long.
const KEEP_ALIVE_MS = 25_000;

export interface StreamDeps {
  db: Db;
  listener: Pick<ItemsListener, "subscribe">;
  // Ends every open stream, so shutdown doesn't wait on them.
  signal?: AbortSignal;
  keepAliveMs?: number;
  now?: () => Date;
}

export function streamRouter(deps: StreamDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();

  // Server-Sent Events. Sends the new summary each time the user's items change.
  router.get("/stream", requireUser(deps.db), (req, res) => {
    const userId = currentUser(res).id;
    let closed = false;
    // Sends one update at a time, so an older summary never arrives last.
    let sending = Promise.resolve();

    const sendSummary = async () => {
      const summary = summarize(await openItems(deps.db, userId, now()));
      if (closed) return;
      res.write(
        `event: ${ITEMS_CHANGED_EVENT}\ndata: ${JSON.stringify(summary)}\n\n`,
      );
    };
    const unsubscribe = deps.listener.subscribe(userId, () => {
      sending = sending.then(sendSummary).catch((err: unknown) => {
        req.log.error({ err }, "stream update failed");
      });
    });
    const keepAlive = setInterval(
      () => res.write(": ping\n\n"),
      deps.keepAliveMs ?? KEEP_ALIVE_MS,
    );
    const end = () => res.end();
    deps.signal?.addEventListener("abort", end);

    res.on("close", () => {
      closed = true;
      clearInterval(keepAlive);
      unsubscribe();
      deps.signal?.removeEventListener("abort", end);
    });

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      // Stops proxies from holding events back.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
  });

  return router;
}
