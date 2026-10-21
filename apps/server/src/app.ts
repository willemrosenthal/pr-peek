import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";

const API = "/api";
const HEALTH = "/health";

export interface AppDeps {
  logger: Logger;
  version: string;
  checkDb: () => Promise<void>;
  // Folder with the built PWA. Skipped if it has no index.html.
  webDir?: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(
    pinoHttp({
      logger: deps.logger,
      // Render calls this every few seconds. Failures are still logged by the route.
      autoLogging: { ignore: (req) => req.url === `${API}${HEALTH}` },
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));

  app.use(API, apiRouter(deps));
  app.use(API, notFound);

  const { webDir } = deps;
  if (webDir && existsSync(join(webDir, "index.html"))) {
    app.use(express.static(webDir));
    // App routes get index.html. Missing files (e.g. an old asset) fall through to a 404.
    app.get("/{*path}", (req, res, next) => {
      if (extname(req.path)) return next();
      res.sendFile(join(webDir, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

function apiRouter(deps: AppDeps): express.Router {
  const router = express.Router();

  router.get(HEALTH, async (req, res) => {
    try {
      await deps.checkDb();
      res.json({ ok: true, version: deps.version });
    } catch (err) {
      req.log.error({ err }, "health check failed");
      res.status(503).json({ ok: false, version: deps.version });
    }
  });

  return router;
}

const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Not found" } });
};

// Body parser and similar errors carry a 4xx `status` and a safe `message`.
function httpError(err: unknown): { status: number; message?: string } {
  if (typeof err !== "object" || err === null) return { status: 500 };
  const { status, expose, message } = err as Record<string, unknown>;
  if (typeof status !== "number" || status < 400 || status >= 600) {
    return { status: 500 };
  }
  return expose === true && typeof message === "string"
    ? { status, message }
    : { status };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const { status, message } = httpError(err);
  if (status >= 500) {
    req.log.error({ err }, "request failed");
    res.status(status).json({
      error: { code: "internal_error", message: "Something went wrong" },
    });
    return;
  }
  res.status(status).json({
    error: { code: "bad_request", message: message ?? "Bad request" },
  });
};
