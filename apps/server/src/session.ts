import session, { type Store } from "express-session";
import type { RequestHandler } from "express";

declare module "express-session" {
  interface SessionData {
    userId: string;
    // Random value checked on the GitHub callback, so nobody can fake it.
    oauthState: string;
  }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionOptions {
  secret: string;
  // Only send the cookie over HTTPS. On in production.
  secure: boolean;
  // Defaults to an in-memory store, which is fine for tests.
  store?: Store;
}

export function sessionMiddleware(options: SessionOptions): RequestHandler {
  return session({
    name: "sid",
    secret: options.secret,
    ...(options.store && { store: options.store }),
    resave: false,
    saveUninitialized: false,
    // Each request pushes the expiry forward.
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: options.secure,
      sameSite: "lax",
      maxAge: THIRTY_DAYS_MS,
    },
  });
}
