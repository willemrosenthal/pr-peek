import { randomBytes } from "node:crypto";
import type { MeResponse } from "@pr-peek/core";
import express, {
  type RequestHandler,
  type Response,
  type Router,
} from "express";
import type { Logger } from "pino";
import { awakeAdmins, pushToAdmins } from "../admin-push";
import type { SendApple } from "../apns";
import type { Db } from "../db";
import type { User } from "../generated/prisma/client";
import { GitHubAuthError, type ScopeChoice } from "../github/oauth";
import { listTokens, tokenDto, type TokenDeps } from "../github/tokens";
import { deleteAccount } from "../account";
import type { SendPush } from "../push";
import { attemptLimiter } from "../rate-limit";
import {
  destroySession,
  regenerateSession,
  saveSession,
  SESSION_COOKIE,
} from "../session";
import { upsertGitHubUser } from "../users";

export interface AuthDeps extends TokenDeps {
  appUrl: string;
  // Null when push is off, because the VAPID keys aren't set.
  send: SendPush | null;
  // Null when Apple push is off, because the APNs settings aren't set.
  apple?: SendApple | null;
  logger: Logger;
}

// Loads the signed in user, or answers 401. A user whose sign-up request waits for an
// admin gets 403, unless the route passes `{ allowPending: true }`. Use `currentUser(res)` in
// the route after it.
export function requireUser(
  db: Db,
  { allowPending = false } = {},
): RequestHandler {
  return async (req, res, next) => {
    const userId = req.session.userId;
    const user =
      userId && (await db.user.findUnique({ where: { id: userId } }));
    if (!user) {
      res.status(401).json({
        error: { code: "unauthorized", message: "Sign in required" },
      });
      return;
    }
    if (!user.approvedAt && !allowPending) {
      res.status(403).json({
        error: { code: "pending", message: "Your sign-up request is waiting" },
      });
      return;
    }
    res.locals.user = user;
    next();
  };
}

export function currentUser(res: Response): User {
  const user = res.locals.user as User | undefined;
  // Only happens if a route forgot `requireUser`. Fail loudly instead of acting as nobody.
  if (!user) {
    throw new Error("currentUser() used on a route without requireUser");
  }
  return user;
}

export function authRouter(deps: AuthDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();
  const signedIn = requireUser(deps.db, { allowPending: true });
  const callbackUrl = new URL(
    "/api/auth/github/callback",
    deps.appUrl,
  ).toString();
  // The browser lands on these app routes. They exist from plan 07.
  const signInError = (code: string) => `/signin?error=${code}`;

  const limiter = attemptLimiter();

  router.get("/auth/github", limiter, async (req, res) => {
    const scope: ScopeChoice = req.query.scope === "public" ? "public" : "full";
    const state = randomBytes(16).toString("hex");
    req.session.oauthState = state;
    await saveSession(req);
    res.redirect(
      deps.oauth.authorizeUrl({ state, scope, redirectUri: callbackUrl }),
    );
  });

  router.get("/auth/github/callback", limiter, async (req, res) => {
    const { code, state, error } = req.query;
    const expectedState = req.session.oauthState;
    delete req.session.oauthState;

    // The user clicked "Cancel" on GitHub.
    if (error === "access_denied") return res.redirect(signInError("denied"));
    if (
      typeof code !== "string" ||
      typeof state !== "string" ||
      !expectedState ||
      state !== expectedState
    ) {
      return res.redirect(signInError("state"));
    }

    try {
      const tokens = await deps.oauth.exchangeCode(code, callbackUrl);
      const githubUser = await deps.oauth.getUser(tokens.accessToken);
      const { user, isNew } = await upsertGitHubUser(
        deps.db,
        githubUser,
        tokens,
        deps.key,
      );

      await regenerateSession(req);
      req.session.userId = user.id;
      await saveSession(req);
      // A failed push shouldn't fail sign in. The request still shows on the admin page.
      if (isNew) {
        await askAdmins(user).catch((err: unknown) => {
          req.log.warn({ err }, "sign-up request push failed");
        });
      }
      res.redirect(isNew ? "/onboarding" : "/");
    } catch (err) {
      req.log.warn({ err }, "GitHub sign in failed");
      res.redirect(
        signInError(err instanceof GitHubAuthError ? "github" : "server"),
      );
    }
  });

  router.post("/auth/signout", async (req, res) => {
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE);
    res.sendStatus(204);
  });

  // Pushes a new sign-up request to the admins.
  async function askAdmins(user: User) {
    if (!deps.send) return;
    const at = now();
    const admins = await awakeAdmins(deps.db, deps.logger, at);
    await pushToAdmins(
      { db: deps.db, send: deps.send, apple: deps.apple, logger: deps.logger },
      admins,
      {
        title: "Git Buddy sign-up request",
        body: `${user.login} asked to use Git Buddy.`,
        url: "/settings/admin",
        tag: `signup-${user.id}`,
      },
      at,
    );
  }

  router.get("/me", signedIn, async (_req, res) => {
    const user = currentUser(res);
    const tokens = await listTokens(deps.db, user.id);
    const body: MeResponse = {
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
        scopes: user.tokenScopes,
      },
      githubTokens: tokens.map(tokenDto),
      needsReauth: user.syncError === "reauth" || user.signInStoppedAt !== null,
      isAdmin: user.role === "admin",
      pending: !user.approvedAt,
    };
    res.json(body);
  });

  // "Delete my account", or withdrawing a waiting sign-up request: takes back Git
  // Buddy's grant on GitHub, deletes everything we have, and signs out everywhere.
  router.delete("/me", signedIn, async (req, res) => {
    await deleteAccount(deps, currentUser(res).id);
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE);
    res.sendStatus(204);
  });

  return router;
}
