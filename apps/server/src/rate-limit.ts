import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

// Slows down anyone hammering endpoints that call GitHub, like sign in.
export const attemptLimiter = (): RequestHandler =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
