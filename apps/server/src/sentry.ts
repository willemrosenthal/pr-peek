import { cleanReports, NO_EXTRA_DATA } from "@pr-peek/core";
import * as Sentry from "@sentry/node";

// Where git-buddy-server's errors go. Not a secret: it only lets Sentry receive events.
const DSN =
  "https://ee1b1d1c1b7fff0ad9d4aa042e4a06c8@o4512397204520960.ingest.us.sentry.io/4512397222739968";
// Share of requests and jobs traced, for how long they take.
const TRACES_SAMPLE_RATE = 0.1;

// Starts reporting errors to Sentry, on Render only (it sets RENDER_GIT_COMMIT), so
// local runs, tests, and CI send nothing. `service` says which one: the web server or
// the worker. Call it before the app's other modules load (see index.ts).
//
// Sends no cookies, headers, request bodies, IPs, or variable values, since requests
// and code can hold GitHub tokens, and no URL query strings or GitHub paths, which can
// name private repos (see error-reports.ts in core). Only the error, its stack, its log
// message, and timings.
export function initSentry(service: "web" | "worker"): void {
  const release = process.env.RENDER_GIT_COMMIT;
  if (!release) return;
  // Stack traces point at the TypeScript files, not the built ones.
  process.setSourceMapsEnabled(true);
  Sentry.init({
    dsn: DSN,
    release,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: TRACES_SAMPLE_RATE,
    initialScope: { tags: { service } },
    dataCollection: NO_EXTRA_DATA,
    ...cleanReports,
  });
}

// The same error goes to Sentry at most once in this long, from each process. So a
// burst, like every poll failing while the database is down, can't use up the free
// plan's errors for the month. "The same" is the same log message and error text.
export const REPEAT_MS = 5 * 60_000;
// Forgets them all past this many, so the map can't grow forever.
const MAX_REMEMBERED = 500;
const lastSent = new Map<string, number>();

function sentRecently(err: unknown, message: string | undefined, now: number) {
  const key = `${message}\n${err instanceof Error ? err.message : String(err)}`;
  const last = lastSent.get(key);
  if (last !== undefined && now - last < REPEAT_MS) return true;
  if (lastSent.size >= MAX_REMEMBERED) lastSent.clear();
  lastSent.set(key, now);
  return false;
}

// Sends an error to Sentry, with the log message that came with it. A message on its own
// goes as one. Does nothing until initSentry has started it.
export function reportError(
  err: unknown,
  message: string | undefined,
  now = Date.now(),
): void {
  if (err === undefined && !message) return;
  if (sentRecently(err, message, now)) return;
  if (err !== undefined) {
    Sentry.captureException(err, message ? { extra: { message } } : undefined);
  } else if (message) {
    Sentry.captureMessage(message, "error");
  }
}
