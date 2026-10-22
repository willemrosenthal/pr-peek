import { githubTokenBody, type GitHubTokenResponse } from "@pr-peek/core";
import express, { type Router } from "express";
import type { Db } from "../db";
import { GitHubAuthError, type GitHubOAuth } from "../github/oauth";
import { encryptPersonalToken, personalTokenDto } from "../github/tokens";
import { HttpError, parseInput } from "../http-error";
import { attemptLimiter } from "../rate-limit";
import { currentUser, requireUser } from "./auth";

export interface GitHubTokenDeps {
  db: Db;
  oauth: GitHubOAuth;
  key: Buffer;
}

// A personal access token the user adds for syncs, for orgs that block our OAuth App.
export function githubTokenRouter(deps: GitHubTokenDeps): Router {
  const router = express.Router();
  router.use("/github-token", requireUser(deps.db));

  const limiter = attemptLimiter();

  router.put("/github-token", limiter, async (req, res) => {
    const { token } = parseInput(githubTokenBody, req.body);
    const user = currentUser(res);
    const checked = await deps.oauth.checkToken(token).catch((err: unknown) => {
      if (err instanceof GitHubAuthError) {
        throw new HttpError(
          400,
          "bad_token",
          "GitHub didn't accept this token. Check it's copied in full and not expired.",
        );
      }
      throw err;
    });

    if (checked.user.id !== user.githubId) {
      throw new HttpError(
        400,
        "wrong_account",
        `This token belongs to ${checked.user.login}. Use a token from ${user.login}.`,
      );
    }
    // Classic tokens list their scopes. Fine-grained ones don't, so GitHub decides later.
    const { scopes } = checked;
    if (scopes && !scopes.includes("repo") && !scopes.includes("public_repo")) {
      throw new HttpError(
        400,
        "missing_scope",
        "The token needs the repo scope (or public_repo for public repos only).",
      );
    }

    // A new token fixes any stopped sync, so the next dispatch picks the user up.
    const updated = await deps.db.user.update({
      where: { id: user.id },
      data: {
        ...encryptPersonalToken(
          { token, expiresAt: checked.expiresAt, scopes: scopes ?? [] },
          deps.key,
        ),
        syncError: null,
        syncFailures: 0,
        syncRetryAt: null,
      },
    });
    const body: GitHubTokenResponse = {
      githubToken: personalTokenDto(updated)!,
    };
    res.json(body);
  });

  // Syncs go back to the sign in token.
  router.delete("/github-token", async (_req, res) => {
    const user = currentUser(res);
    await deps.db.user.update({
      where: { id: user.id },
      data: {
        patEnc: null,
        patExpiresAt: null,
        patScopes: [],
        ...(user.syncError === "token" && { syncError: null }),
      },
    });
    res.sendStatus(204);
  });

  return router;
}
