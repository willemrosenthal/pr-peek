import { ITEMS_CHANGED_EVENT, NOTIFY_EVENT } from "@pr-peek/core";
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

  // Server-Sent Events. Sends the new summary each time the user's items change, and
  // notifications for the Mac menu bar app.
  router.get("/stream", requireUser(deps.db), (req, res) => {
    const userId = currentUser(res).id;
    // Skips writes once the stream has ended or the client has left.
    const write = (text: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(text);
    };
    // Sends one update at a time, so an older summary never arrives last.
    let sending = Promise.resolve();

    const sendSummary = async () => {
      const summary = summarize(await openItems(deps.db, userId, now()));
      write(
        `event: ${ITEMS_CHANGED_EVENT}\ndata: ${JSON.stringify(summary)}\n\n`,
      );
    };
    const unsubscribe = deps.listener.subscribe(userId, (event) => {
      if (event.type === "notify") {
        write(
          `event: ${NOTIFY_EVENT}\ndata: ${JSON.stringify(event.payload)}\n\n`,
        );
        return;
      }
      sending = sending.then(sendSummary).catch((err: unknown) => {
        req.log.error({ err }, "stream update failed");
      });
    });
    const keepAlive = setInterval(
      () => write(": ping\n\n"),
      deps.keepAliveMs ?? KEEP_ALIVE_MS,
    );
    const end = () => res.end();

    res.on("close", () => {
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

    if (deps.signal?.aborted) end();
    else deps.signal?.addEventListener("abort", end);
  });

  return router;
}
