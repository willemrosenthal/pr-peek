import type { PushPayload } from "@pr-peek/core";
import type pg from "pg";
import type { Logger } from "pino";
import { ITEMS_CHANNEL } from "./items";
import { listen } from "./listen";
import { DESKTOP_CHANNEL } from "./push";
import type { Usage } from "./usage";

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
  // Counts the connection's bytes for the admin page.
  usage?: Usage;
}

// Listens for `publishItemsChanged` and `deliver`. After a lost connection, tells every
// subscriber their items changed, in case they missed one.
export async function listenForItemChanges(
  options: ItemsListenerOptions,
): Promise<ItemsListener> {
  const { logger } = options;
  const handlers = new Map<string, Set<(event: UserEvent) => void>>();

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

  const listener = await listen({
    ...options,
    channels: [ITEMS_CHANNEL, DESKTOP_CHANNEL],
    name: "items listener",
    onMessage,
    onReconnect: () => {
      for (const userId of handlers.keys()) emit(userId, { type: "items" });
    },
  });

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
    stop: () => listener.stop(),
  };
}
