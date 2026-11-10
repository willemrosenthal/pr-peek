import { pino, type DestinationStream, type Logger } from "pino";
import type { Config } from "./config";
import { reportError } from "./sentry";

const TOKEN_FIELDS = [
  "token",
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "client_secret",
];

type Report = (err: unknown, message: string | undefined) => void;

// The error and message of a log call, like `logger.error({ err }, "sync failed")`,
// `logger.error(err, "sync failed")`, or `logger.error("shutdown timed out")`.
function errorOf(args: unknown[]): [unknown, string | undefined] {
  const [first, second] = args;
  if (typeof first === "string") return [undefined, first];
  const message = typeof second === "string" ? second : undefined;
  if (first instanceof Error) return [first, message];
  const err =
    typeof first === "object" && first !== null && "err" in first
      ? first.err
      : undefined;
  return [err, message];
}

// Every error logged goes to Sentry too (`report`), from the server and the worker, so
// none needs its own call. Children, like each request's `req.log`, do the same.
export function createLogger(
  config: Pick<Config, "LOG_LEVEL">,
  destination?: DestinationStream,
  report: Report = reportError,
): Logger {
  const options = {
    level: config.LOG_LEVEL,
    hooks: {
      logMethod(
        this: Logger,
        args: Parameters<Logger["error"]>,
        method: Logger["error"],
        level: number,
      ) {
        if (level >= pino.levels.values.error!) report(...errorOf(args));
        method.apply(this, args);
      },
    },
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      'res.headers["set-cookie"]',
      // GitHub client errors carry the request: its token, and a refresh's secrets.
      "err.request.headers.authorization",
      "err.request.body",
      // Tokens logged by mistake, at the top or one level down.
      ...TOKEN_FIELDS.flatMap((field) => [field, `*.${field}`]),
    ],
  };
  return destination ? pino(options, destination) : pino(options);
}
