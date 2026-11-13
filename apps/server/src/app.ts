import { existsSync } from "node:fs";
import { extname, join, sep } from "node:path";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type RequestHandler,
  type Router,
} from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";
import { requireSameOrigin } from "./csrf";
import { HttpError } from "./http-error";

const API = "/api";
const HEALTH = "/health";
// Built files in /assets have a hash in their name, so a new build gets new names.
const CACHE_FOREVER = "public, max-age=31536000, immutable";
// Everything else (index.html, sw.js, the manifest, icons) is checked with us each time.
const NO_CACHE = "no-cache";
// Where the web app's Sentry errors go.
const SENTRY_INGEST = "https://*.ingest.us.sentry.io";
// Where GitHub's pictures come from: avatars, pasted images (private ones too), and
// other sites' images, which GitHub serves itself. Plus its emoji.
const GITHUB_IMAGES = [
  "https://*.githubusercontent.com",
  "https://github.com",
  "https://github.githubassets.com",
];

export interface AppDeps {
  logger: Logger;
  version: string;
  checkDb: () => Promise<void>;
  // Public URL of the app. Requests that change data must come from here.
  appUrl: string;
  // Session middleware (see session.ts). Runs on API routes only.
  session: RequestHandler;
  // Feature routes mounted under /api, like sign in (routes/auth.ts).
  routers?: Router[];
  // Folder with the built PWA. Skipped if it has no index.html.
  webDir?: string;
  // Proxies in front of us (TRUST_PROXY_HOPS).
  trustProxyHops: number;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  // Proxies sit in front of us (on Render: Cloudflare, then Render's own). This lets
  // secure cookies work, and gives `req.ip` the user's IP for rate limits.
  app.set("trust proxy", deps.trustProxyHops);

  app.use(
    pinoHttp({
      logger: deps.logger,
      // Render calls this every few seconds. Failures are still logged by the route.
      autoLogging: { ignore: (req) => req.url === `${API}${HEALTH}` },
      // A 4xx or 5xx is a warning, not pino-http's usual error for a 5xx. The error
      // behind a 5xx is logged as an error where it happened (errorHandler, the health
      // check), so each goes to Sentry once.
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 400 ? "warn" : "info",
      // An allowlist, not the whole request. Its URL and headers can hold OAuth codes,
      // private PR links, and device tokens. Every line says who asked, and the line
      // when it ends says what for (routeOf), once the route is known.
      serializers: {
        req: (req: { id: unknown; raw: Request }) => ({
          id: req.id,
          method: req.raw.method,
          ip: req.raw.ip,
        }),
        // A redirect's Location can hold the OAuth state.
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customSuccessObject: (req, _res, line: object) => ({
        ...line,
        route: routeOf(req as Request),
      }),
      customErrorObject: (req, _res, _err, line: object) => ({
        ...line,
        route: routeOf(req as Request),
      }),
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "data:", ...GITHUB_IMAGES],
          // The web app sends its errors to Sentry (apps/web/src/sentry.ts).
          "connect-src": ["'self'", SENTRY_INGEST],
        },
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  app.use(
    API,
    deps.session,
    requireSameOrigin(deps.appUrl),
    apiRouter(deps),
    ...(deps.routers ?? []),
    notFound,
  );

  const { webDir } = deps;
  if (webDir && existsSync(join(webDir, "index.html"))) {
    const assetsDir = join(webDir, "assets") + sep;
    app.use(
      express.static(webDir, {
        setHeaders: (res, path) => {
          res.set(
            "Cache-Control",
            path.startsWith(assetsDir) ? CACHE_FOREVER : NO_CACHE,
          );
        },
      }),
    );
    // App routes get index.html. Missing files (e.g. an old asset) fall through to a 404.
    app.get("/{*path}", (req, res, next) => {
      if (extname(req.path)) return next();
      res.set("Cache-Control", NO_CACHE);
      res.sendFile(join(webDir, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

// What a request was for, safe to log. An API request gives its route's pattern, like
// /api/apple-devices/:token, never the token itself. A page or file gives its path,
// which holds nothing private. Neither gives the query.
function routeOf(req: Request) {
  const path = req.originalUrl.split("?")[0]!;
  // Express matches routes in any case, so /API/... reaches them too.
  const lower = path.toLowerCase();
  if (lower !== API && !lower.startsWith(`${API}/`)) return path;
  // Every API router is mounted at /api. Not req.baseUrl: Express clears it when an
  // error leaves the router.
  const route = req.route as { path?: unknown } | undefined;
  return typeof route?.path === "string" ? `${API}${route.path}` : `${API}/*`;
}

function apiRouter(deps: AppDeps): express.Router {
  const router = express.Router();

  router.get(HEALTH, async (req, res) => {
    try {
      await deps.checkDb();
      res.json({ ok: true, version: deps.version });
    } catch (err) {
      // A warning, not an error: an error goes to Sentry, and Render checks this every
      // few seconds, so an outage would send hundreds. The uptime monitor reports it.
      req.log.warn({ err }, "health check failed");
      res.status(503).json({ ok: false, version: deps.version });
    }
  });

  return router;
}

const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "Not found" } });
};

interface ClientError {
  status: number;
  code: string;
  message: string;
}

// Errors that are safe to show: our HttpError, and body parser errors (4xx `status`, `expose`).
function clientError(err: unknown): ClientError | null {
  if (err instanceof HttpError) return err;
  if (typeof err !== "object" || err === null) return null;
  const { status, expose, message } = err as Record<string, unknown>;
  if (typeof status !== "number" || status < 400 || status >= 500) return null;
  return {
    status,
    code: "bad_request",
    message:
      expose === true && typeof message === "string" ? message : "Bad request",
  };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = clientError(err);
  if (known) {
    res.status(known.status).json({
      error: { code: known.code, message: known.message },
    });
    return;
  }
  req.log.error({ err }, "request failed");
  res.status(500).json({
    error: { code: "internal_error", message: "Something went wrong" },
  });
};
