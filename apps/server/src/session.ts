import session, { type Store } from "express-session";
import type { Request, RequestHandler } from "express";

declare module "express-session" {
  interface SessionData {
    userId: string;
    // Random value checked on the GitHub callback, so nobody can fake it.
    oauthState: string;
  }
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = "sid";

// Promise versions of express-session's callback methods.
function promisified(
  req: Request,
  method: "regenerate" | "save" | "destroy",
): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session[method]((err?: Error) => (err ? reject(err) : resolve()));
  });
}

// Gives the user a new session id, so an attacker can't plant a known one before sign in.
export const regenerateSession = (req: Request) =>
  promisified(req, "regenerate");
export const saveSession = (req: Request) => promisified(req, "save");
export const destroySession = (req: Request) => promisified(req, "destroy");

// Whether the request's session is still in the store, signed in as this user. False
// once they sign out, it expires, or their account is deleted. Reads the store, not
// req.session, so it sees changes made by other requests and other servers.
export function sessionBelongsTo(
  req: Request,
  userId: string,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    req.sessionStore.get(req.sessionID, (err: Error | null, data) => {
      if (err) reject(err);
      else resolve(data?.userId === userId);
    });
  });
}

export interface SessionOptions {
  secret: string;
  // Only send the cookie over HTTPS. On in production.
  secure: boolean;
  // Defaults to an in-memory store, which is fine for tests.
  store?: Store;
}

export function sessionMiddleware(options: SessionOptions): RequestHandler {
  return session({
    name: SESSION_COOKIE,
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
