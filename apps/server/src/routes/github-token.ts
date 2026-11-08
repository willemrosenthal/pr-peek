import {
  githubTokenBody,
  saveTokenBody,
  type CheckTokenResponse,
  type GitHubTokenResponse,
  type TokenResponse,
  type TokensResponse,
} from "@pr-peek/core";
import express, { type Router } from "express";
import type { Db } from "../db";
import type { User } from "../generated/prisma/client";
import { GitHubAuthError, type GitHubOAuth } from "../github/oauth";
import {
  encryptPersonalToken,
  listTokens,
  personalTokenDto,
  pickToken,
  removePersonalTokens,
  removeToken,
  savePersonalToken,
  saveToken,
  tokenDto,
  type CheckedPersonalToken,
} from "../github/tokens";
import { HttpError, parseInput } from "../http-error";
import { attemptLimiter } from "../rate-limit";
import { currentUser, requireUser } from "./auth";

export interface GitHubTokenDeps {
  db: Db;
  oauth: GitHubOAuth;
  key: Buffer;
}

// Logins ignore case on GitHub.
const sameOwners = (a: string[], b: string[]) =>
  a.length === b.length &&
  a.every((owner) => b.some((o) => o.toLowerCase() === owner.toLowerCase()));

// Personal access tokens the user adds for syncs, for orgs that block our OAuth App. A
// fine-grained token reaches one org, so a user can add several.
export function githubTokenRouter(deps: GitHubTokenDeps): Router {
  const router = express.Router();
  router.use(["/github-token", "/github-tokens"], requireUser(deps.db));

  const limiter = attemptLimiter();

  // Asks GitHub about a pasted token: that it works, is the user's, and what it reaches.
  // Classic tokens reach everything the account can, so their owners aren't listed.
  async function check(user: User, token: string) {
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
    const fields = encryptPersonalToken(
      { token, expiresAt: checked.expiresAt, scopes: scopes ?? [] },
      deps.key,
    );
    const owners =
      fields.kind === "classic" ? [] : await deps.oauth.tokenOwners(token);
    return { ...fields, owners } satisfies CheckedPersonalToken;
  }

  // A name to start from: the org a fine-grained token reaches.
  const nameFor = (token: CheckedPersonalToken) =>
    token.kind === "classic"
      ? "Classic token"
      : (token.owners[0] ?? "Personal access token");

  router.get("/github-tokens", async (_req, res) => {
    const user = currentUser(res);
    const [tokens, watched] = await Promise.all([
      listTokens(deps.db, user.id),
      deps.db.watchedRepo.findMany({
        where: { userId: user.id, enabled: true },
        select: { owner: true },
        distinct: ["owner"],
        orderBy: { owner: "asc" },
      }),
    ]);
    const body: TokensResponse = {
      tokens: tokens.map(tokenDto),
      syncedBy: watched.map(({ owner }) => ({
        owner,
        tokenId: pickToken(tokens, owner),
      })),
    };
    res.json(body);
  });

  // What a pasted token reaches, before it's saved. Says if it's already added, or
  // reaches the same owners as one the user has.
  router.post("/github-tokens/check", limiter, async (req, res) => {
    const { token } = parseInput(githubTokenBody, req.body);
    const user = currentUser(res);
    const checked = await check(user, token);
    const [tokens, watched] = await Promise.all([
      deps.db.gitHubToken.findMany({
        where: { userId: user.id },
        select: { id: true, kind: true, owners: true, tokenHash: true },
      }),
      deps.db.watchedRepo.findMany({
        where: { userId: user.id, enabled: true },
        select: { owner: true },
      }),
    ]);
    if (tokens.some((t) => t.tokenHash === checked.tokenHash)) {
      throw new HttpError(
        409,
        "already_added",
        "You've already added this token.",
      );
    }
    const reaches = (owner: string) =>
      checked.kind === "classic" ||
      checked.owners.some((o) => o.toLowerCase() === owner.toLowerCase());
    const body: CheckTokenResponse = {
      kind: checked.kind,
      owners: checked.owners,
      scopes: checked.scopes,
      expiresAt: checked.expiresAt?.toISOString() ?? null,
      name: nameFor(checked),
      sameOwnersAs:
        tokens.find(
          (t) =>
            t.kind === checked.kind && sameOwners(t.owners, checked.owners),
        )?.id ?? null,
      reachesWatched: watched.some(({ owner }) => reaches(owner)),
    };
    res.json(body);
  });

  router.post("/github-tokens", limiter, async (req, res) => {
    const { token, name } = parseInput(saveTokenBody, req.body);
    const user = currentUser(res);
    const checked = await check(user, token);
    const saved = await saveToken(deps.db, user.id, checked, {
      name: name ?? nameFor(checked),
    });
    const body: TokenResponse = { token: tokenDto(saved) };
    res.status(201).json(body);
  });

  // Replaces a token with a new one in one step, keeping its name unless given one.
  router.put<{ id: string }>(
    "/github-tokens/:id",
    limiter,
    async (req, res) => {
      const { token, name } = parseInput(saveTokenBody, req.body);
      const user = currentUser(res);
      const checked = await check(user, token);
      const saved = await saveToken(deps.db, user.id, checked, {
        replaceId: req.params.id,
        ...(name !== undefined && { name }),
      });
      const body: TokenResponse = { token: tokenDto(saved) };
      res.json(body);
    },
  );

  router.delete("/github-tokens/:id", async (req, res) => {
    await removeToken(deps.db, currentUser(res).id, req.params.id);
    res.sendStatus(204);
  });

  // The old single-token routes, until the web app moves to the ones above.
  router.put("/github-token", limiter, async (req, res) => {
    const { token } = parseInput(githubTokenBody, req.body);
    const user = currentUser(res);
    const checked = await check(user, token);
    const saved = await savePersonalToken(deps.db, user.id, checked, {
      syncError: null,
      syncFailures: 0,
      syncRetryAt: null,
    });
    const body: GitHubTokenResponse = {
      githubToken: personalTokenDto(saved, null)!,
    };
    res.json(body);
  });

  // Syncs go back to the sign in token.
  router.delete("/github-token", async (_req, res) => {
    const user = currentUser(res);
    await removePersonalTokens(
      deps.db,
      user.id,
      user.syncError === "token" ? { syncError: null } : {},
    );
    res.sendStatus(204);
  });

  return router;
}
