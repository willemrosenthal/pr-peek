import { existsSync } from "node:fs";
import { join } from "node:path";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";

export interface AppDeps {
  logger: Logger;
  version: string;
  checkDb: () => Promise<void>;
  // Folder with the built PWA. Skipped if it has no index.html.
  webDir?: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(pinoHttp({ logger: deps.logger }));
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));

  app.use("/api", apiRouter(deps));
  app.use("/api", notFound);

  const { webDir } = deps;
  if (webDir && existsSync(join(webDir, "index.html"))) {
    app.use(express.static(webDir));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(join(webDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}

function apiRouter(deps: AppDeps): express.Router {
  const router = express.Router();

  router.get("/health", async (req, res) => {
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

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
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
