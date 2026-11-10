import * as Sentry from "@sentry/node";

// Where git-buddy-server's errors go. Not a secret: it only lets Sentry receive events.
const DSN =
  "https://ee1b1d1c1b7fff0ad9d4aa042e4a06c8@o4512397204520960.ingest.us.sentry.io/4512397222739968";
// Share of requests and jobs traced, for how long they take.
const TRACES_SAMPLE_RATE = 0.1;

// Each kind of extra data, off. Named one by one: an option left out can default to on.
const NOTHING_EXTRA = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
} satisfies Sentry.NodeOptions["dataCollection"];

// Starts reporting errors to Sentry, on Render only (it sets RENDER_GIT_COMMIT), so
// local runs, tests, and CI send nothing. `service` says which one: the web server or
// the worker. Call it before the app's other modules load (see index.ts).
//
// Sends no cookies, headers, request bodies, IPs, or variable values, since requests
// and code can hold GitHub tokens. Only the error, its stack, and its log message.
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
    dataCollection: NOTHING_EXTRA,
  });
}

// Sends an error to Sentry, with the log message that came with it. A message on its own
// goes as one. Does nothing until initSentry has started it.
export function reportError(err: unknown, message: string | undefined): void {
  if (err !== undefined) {
    Sentry.captureException(err, message ? { extra: { message } } : undefined);
  } else if (message) {
    Sentry.captureMessage(message, "error");
  }
}
