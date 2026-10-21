import type { RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Blocks requests that change data unless they come from our own site.
// The API and the PWA share one origin, so checking the Origin header is enough.
export function requireSameOrigin(appUrl: string): RequestHandler {
  const allowed = new URL(appUrl).origin;
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || req.get("origin") === allowed) {
      next();
      return;
    }
    res.status(403).json({
      error: { code: "forbidden", message: "Cross-site request blocked" },
    });
  };
}
