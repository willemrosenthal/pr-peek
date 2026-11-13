import {
  githubTokenBody,
  saveTokenBody,
  type CheckTokenResponse,
  type TokenResponse,
  type TokensResponse,
} from "@pr-peek/core";
import express, { type Router } from "express";
import type { Db } from "../db";
import type { User } from "../generated/prisma/client";
import { GitHubAuthError, type GitHubOAuth } from "../github/oauth";
import {
  alreadyAdded,
  encryptPersonalToken,
  listTokens,
  pickToken,
  reachesOwner,
  removeToken,
  saveToken,
  sameLogin,
  tokenDto,
  tokenKind,
  type CheckedPersonalToken,
} from "../github/tokens";
import { HttpError, parseInput } from "../http-error";
import { userLimiter } from "../rate-limit";
import { currentUser, requireUser } from "./auth";

export interface GitHubTokenDeps {
  db: Db;
  oauth: GitHubOAuth;
  key: Buffer;
}

const sameOwners = (a: string[], b: string[]) =>
  a.length === b.length &&
  a.every((owner) => b.some((o) => sameLogin(o, owner)));

// Checks, saves, and replacements each user can make in 15 minutes. Each asks GitHub.
// Per user, not by IP: a company's people often share one.
export const TOKEN_ASKS = 30;
const TOKEN_ASKS_WINDOW_MS = 15 * 60 * 1000;

// Fine-grained personal access tokens the user adds. Signing in only reads public repos,
// so these are how private repos sync. Each reaches one owner, so a user can add several.
export function githubTokenRouter(deps: GitHubTokenDeps): Router {
  const router = express.Router();
  router.use("/github-tokens", requireUser(deps.db));

  const limiter = userLimiter(TOKEN_ASKS_WINDOW_MS, TOKEN_ASKS);

  // Asks GitHub about a pasted token: that it works, is the user's, and what it reaches.
  // Only fine-grained tokens: a classic one needs `repo` to read private repos, and that
  // can also write (plan 22). Refused before it's sent to GitHub.
  async function check(user: User, token: string) {
    if (tokenKind(token) !== "fine_grained") {
      throw new HttpError(
        400,
        "classic_token",
        "Git Buddy only takes fine-grained tokens. Unlike classic tokens, they can be made read-only.",
      );
    }
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
    const fields = encryptPersonalToken(
      { token, expiresAt: checked.expiresAt, scopes: checked.scopes ?? [] },
      deps.key,
    );
    const owners = await deps.oauth.tokenOwners(token);
    return { ...fields, owners } satisfies CheckedPersonalToken;
  }

  // A name to start from: the org the token reaches.
  const nameFor = (token: CheckedPersonalToken) =>
    token.owners[0] ?? "Personal access token";

  router.get("/github-tokens", async (_req, res) => {
    const user = currentUser(res);
    const [tokens, watched] = await Promise.all([
      listTokens(deps.db, user.id),
      deps.db.watchedRepo.groupBy({
        by: ["owner"],
        where: { userId: user.id, enabled: true },
        _count: true,
        orderBy: { owner: "asc" },
      }),
    ]);
    const body: TokensResponse = {
      tokens: tokens.map(tokenDto),
      syncedBy: watched.map(({ owner, _count }) => ({
        owner,
        repos: _count,
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
      throw alreadyAdded();
    }
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
      reachesWatched: watched.some(({ owner }) => reachesOwner(checked, owner)),
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

  return router;
}
