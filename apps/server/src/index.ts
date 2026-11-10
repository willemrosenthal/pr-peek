// Starts Sentry, then the web server. Sentry must start before the server's packages
// load, so it can trace them: Sentry's "deferred entrypoint". The server is run-server.ts.
import { initSentry } from "./sentry";

initSentry("web");
await import("./run-server");
