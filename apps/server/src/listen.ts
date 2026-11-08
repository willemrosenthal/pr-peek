import pg from "pg";
import type { Logger } from "pino";
import { countConnection, type Usage } from "./usage";

const RECONNECT_MS = 5_000;
// Checks a quiet connection is still there, so a silent drop is found and fixed.
const KEEP_ALIVE_MS = 60_000;

export interface ListenOptions {
  connectionString: string;
  channels: string[];
  // Names it in logs, like "items listener".
  name: string;
  logger: Logger;
  onMessage: (msg: pg.Notification) => void;
  // Called after it reconnects, since messages sent while it was gone are lost.
  onReconnect?: () => void;
  reconnectMs?: number;
  // Counts the connection's bytes for the admin page.
  usage?: Usage;
}

export interface Listener {
  stop(): Promise<void>;
}

// LISTENs on its own connection, outside the pool, since LISTEN holds it open.
// Reconnects if the connection drops. Throws if it can't connect the first time.
export async function listen(options: ListenOptions): Promise<Listener> {
  const { connectionString, channels, name, logger } = options;
  const reconnectMs = options.reconnectMs ?? RECONNECT_MS;
  let client: pg.Client | null = null;
  let retry: NodeJS.Timeout | undefined;
  let stopped = false;

  async function connect(): Promise<void> {
    const next = new pg.Client({
      connectionString,
      keepAlive: true,
      keepAliveInitialDelayMillis: KEEP_ALIVE_MS,
    });
    let ready = false;
    let lost = false;
    const onLost = (err?: Error) => {
      if (!ready || lost || stopped) return;
      lost = true;
      client = null;
      logger.warn({ err }, `${name} lost its connection`);
      next.end().catch(() => undefined);
      reconnectLater();
    };
    next.on("error", onLost);
    next.on("end", () => onLost());
    next.on("notification", options.onMessage);

    try {
      await next.connect();
      if (options.usage) countConnection(next, options.usage);
      for (const channel of channels) {
        await next.query(`LISTEN ${next.escapeIdentifier(channel)}`);
      }
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
          logger.info(`${name} reconnected`);
          options.onReconnect?.();
        },
        (err: unknown) => {
          logger.warn({ err }, `${name} could not reconnect`);
          reconnectLater();
        },
      );
    }, reconnectMs);
  }

  await connect();

  return {
    async stop() {
      stopped = true;
      clearTimeout(retry);
      await client?.end();
    },
  };
}
