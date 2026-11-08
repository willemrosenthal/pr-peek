import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { currentUser } from "./routes/auth";

// Slows down anyone hammering sign in, by IP, since nobody is signed in yet. Needs
// TRUST_PROXY_HOPS right (see docs/security.md).
export const attemptLimiter = (): RequestHandler =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

// Limits each signed in user, for routes that ask GitHub on their behalf. Not by IP: a
// company's people often share one. Goes after `requireUser`.
export const userLimiter = (windowMs: number, limit: number): RequestHandler =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: (_req, res) => currentUser(res).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: { code: "rate_limited", message: "Wait a moment and try again" },
    },
  });
