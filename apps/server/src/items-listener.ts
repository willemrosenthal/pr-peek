import type { PushPayload } from "@pr-peek/core";
import pg from "pg";
import type { Logger } from "pino";
import { ITEMS_CHANNEL } from "./items";
import { DESKTOP_CHANNEL } from "./push";

const RECONNECT_MS = 5_000;

// "items": the user's items changed. "notify": a notification for the Mac menu bar app.
export type UserEvent =
  { type: "items" } | { type: "notify"; payload: PushPayload };

export interface ItemsListener {
  // Calls `handler` with each of the user's events. Returns a function that stops it.
  subscribe(userId: string, handler: (event: UserEvent) => void): () => void;
  stop(): Promise<void>;
}

export interface ItemsListenerOptions {
  connectionString: string;
  logger: Logger;
  reconnectMs?: number;
}

// Listens for `publishItemsChanged` and `deliver` on its own connection, since LISTEN
// holds it open. Reconnects if the connection drops, then tells every subscriber their
// items changed, in case they missed one.
export async function listenForItemChanges(
  options: ItemsListenerOptions,
): Promise<ItemsListener> {
  const { connectionString, logger } = options;
  const reconnectMs = options.reconnectMs ?? RECONNECT_MS;
  const handlers = new Map<string, Set<(event: UserEvent) => void>>();
  let client: pg.Client | null = null;
  let retry: NodeJS.Timeout | undefined;
  let stopped = false;

  const emit = (userId: string, event: UserEvent) => {
    for (const handler of handlers.get(userId) ?? []) handler(event);
  };

  const onMessage = (msg: pg.Notification) => {
    if (!msg.payload) return;
    if (msg.channel === ITEMS_CHANNEL) {
      emit(msg.payload, { type: "items" });
      return;
    }
    try {
      const { userId, payload } = JSON.parse(msg.payload) as {
        userId: string;
        payload: PushPayload;
      };
      emit(userId, { type: "notify", payload });
    } catch (err) {
      logger.warn({ err }, "unreadable desktop notification");
    }
  };

  // Throws if it can't connect.
  async function connect(): Promise<void> {
    const next = new pg.Client({ connectionString });
    let ready = false;
    let lost = false;
    const onLost = (err?: Error) => {
      if (!ready || lost || stopped) return;
      lost = true;
      client = null;
      logger.warn({ err }, "items listener lost its connection");
      next.end().catch(() => undefined);
      reconnectLater();
    };
    next.on("error", onLost);
    next.on("end", () => onLost());
    next.on("notification", onMessage);

    try {
      await next.connect();
      await next.query(`LISTEN ${ITEMS_CHANNEL}`);
      await next.query(`LISTEN ${DESKTOP_CHANNEL}`);
    } catch (err) {
      await next.end().catch(() => undefined);
      throw err;
    }
    if (stopped) {
      await next.end();
      return;
    }
    ready = true;
    client = next;
  }

  function reconnectLater() {
    if (stopped) return;
    retry = setTimeout(() => {
      connect().then(
        () => {
          logger.info("items listener reconnected");
          for (const userId of handlers.keys()) {
            emit(userId, { type: "items" });
          }
        },
        (err: unknown) => {
          logger.warn({ err }, "items listener could not reconnect");
          reconnectLater();
        },
      );
    }, reconnectMs);
  }

  await connect();

  return {
    subscribe(userId, handler) {
      const userHandlers = handlers.get(userId) ?? new Set();
      handlers.set(userId, userHandlers.add(handler));
      return () => {
        userHandlers.delete(handler);
        if (userHandlers.size === 0 && handlers.get(userId) === userHandlers) {
          handlers.delete(userId);
        }
      };
    },
    async stop() {
      stopped = true;
      clearTimeout(retry);
      await client?.end();
    },
  };
}
