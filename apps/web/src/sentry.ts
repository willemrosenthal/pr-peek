import { cleanReports, NO_EXTRA_DATA } from "@pr-peek/core";
import * as Sentry from "@sentry/react";
import { BUILD } from "./build";

// Where git-buddy-web's errors go. Not a secret: it only lets Sentry receive events.
const DSN =
  "https://0473a3b797a8764ffb9d31fee5d8b440@o4512397204520960.ingest.us.sentry.io/4512397222805504";
// Only the live site reports, which the Mac app shows too. Not local runs, previews, or
// tests.
export const LIVE_HOST = "www.git-buddy.com";
// Share of page loads and navigations traced, for how long they take.
const TRACES_SAMPLE_RATE = 0.1;

// Starts reporting errors to Sentry on the live site. Sends no cookies, headers, request
// bodies, or URL query strings (see error-reports.ts in core): only the error, its
// stack, the page's path, and timings.
export function initSentry(host = location.hostname): void {
  if (host !== LIVE_HOST) return;
  Sentry.init({
    dsn: DSN,
    release: BUILD.commit || undefined,
    environment: "production",
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: TRACES_SAMPLE_RATE,
    dataCollection: NO_EXTRA_DATA,
    ...cleanReports,
  });
}

const handleReactError = Sentry.reactErrorHandler();

// For createRoot: reports errors React catches while rendering, once initSentry has
// started Sentry. Still logs them, as React does without these handlers.
export function reportReactError(
  error: unknown,
  { componentStack }: { componentStack?: string | undefined },
): void {
  console.error(error);
  handleReactError(
    error,
    componentStack === undefined ? {} : { componentStack },
  );
}
