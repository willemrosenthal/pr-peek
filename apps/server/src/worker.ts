// Starts Sentry, then the worker. See index.ts. The worker is run-worker.ts.
import { initSentry } from "./sentry";

initSentry("worker");
await import("./run-worker");
