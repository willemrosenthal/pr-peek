import { pino, type DestinationStream, type Logger } from "pino";
import type { Config } from "./config";

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
    ],
  };
  return destination ? pino(options, destination) : pino(options);
}
