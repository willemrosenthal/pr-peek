import { pino, type DestinationStream, type Logger } from "pino";
import type { Config } from "./config";

const TOKEN_FIELDS = [
  "token",
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "client_secret",
];

export function createLogger(
  config: Pick<Config, "LOG_LEVEL">,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.LOG_LEVEL,
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
