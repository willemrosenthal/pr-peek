import type { Logger } from "pino";

const FORCE_EXIT_MS = 10_000;

// Runs `cleanup` once on SIGTERM or SIGINT, then exits. Exits anyway if cleanup hangs.
export function onShutdown(logger: Logger, cleanup: () => Promise<void>): void {
  let shuttingDown = false;

  const handle = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");

    setTimeout(() => {
      logger.error("shutdown timed out, forcing exit");
      process.exit(1);
    }, FORCE_EXIT_MS).unref();

    cleanup().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error({ err }, "shutdown failed");
        process.exit(1);
      },
    );
  };

  process.once("SIGTERM", handle);
  process.once("SIGINT", handle);
}
