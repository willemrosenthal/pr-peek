import {
  addRepoBody,
  MAX_WATCHED_REPOS,
  searchReposQuery,
  updateRepoBody,
  type AddRepoResponse,
  type RepoOwner,
  type RepoOwnersResponse,
  type SearchReposResponse,
  type WatchedRepoDto,
  type WatchedReposResponse,
} from "@pr-peek/core";
import express, { type Router } from "express";
import type { GitHubFor } from "../github/client";
import type { Db } from "../db";
import {
  Prisma,
  type User,
  type WatchedRepo,
} from "../generated/prisma/client";
import {
  findRepo,
  listOwners,
  listRepos,
  searchRepos,
  withTokenOwners,
} from "../github/repos";
import { isRejection } from "../github/tokens";
import { HttpError, parseInput, sentFields } from "../http-error";
import { userLimiter } from "../rate-limit";
import { currentUser, requireUser } from "./auth";

export interface RepoDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: GitHubFor;
}

function toDto(repo: WatchedRepo): WatchedRepoDto {
  return {
    id: repo.id,
    githubRepoId: repo.githubRepoId,
    owner: repo.owner,
    name: repo.name,
    enabled: repo.enabled,
    muted: repo.muted,
    color: repo.color,
    colorOn: repo.colorOn,
  };
}

// Enough for the picker to load a few owners' lists, 100 repos a page.
export const PICKER_ASKS_PER_MINUTE = 60;

const notFound = () => new HttpError(404, "not_found", "Repo not found");

// What the picker reads with, from one query. `sources`: where a list or search with no
// owner reads from, one after another. First the newest working classic token, or else
// the sign in (null), which see every owner. The sign in is left out while it's stopped
// and a token works (see markRejected). Then each working fine-grained token. `owners`:
// the owners the working tokens reach.
async function pickerTokens(
  db: Db,
  user: Pick<User, "id" | "signInStoppedAt">,
) {
  const tokens = await db.gitHubToken.findMany({
    where: { userId: user.id, status: "working" },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, owners: true },
  });
  const classic = tokens.find((token) => token.kind === "classic");
  const signIn = user.signInStoppedAt && tokens.length > 0 ? [] : [null];
  const sources: (string | null)[] = [
    ...(classic ? [classic.id] : signIn),
    ...tokens.filter((token) => token.kind !== "classic").map((t) => t.id),
  ];
  return { sources, owners: tokens.flatMap((token) => token.owners) };
}

// The cursor for a list across several sources: which source, then GitHub's own cursor
// in it. "2:abc" is source 2 from "abc". The browser passes it back as it is.
const sourceCursor = (index: number, cursor: string | null) =>
  `${index}:${cursor ?? ""}`;

function parseSourceCursor(cursor: string | undefined) {
  const match = cursor ? /^(\d+):(.*)$/.exec(cursor) : null;
  return match
    ? { index: Number(match[1]), cursor: match[2] || undefined }
    : { index: 0, cursor: undefined };
}

// Prisma's code for "a row like this already exists".
const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export function reposRouter(deps: RepoDeps): Router {
  const router = express.Router();
  router.use(
    ["/github/repos", "/github/owners", "/repos"],
    requireUser(deps.db),
  );
  // These spend the user's GitHub budget, which their sync needs too.
  const githubLimit = userLimiter(60 * 1000, PICKER_ASKS_PER_MINUTE);
  router.use(["/github/repos", "/github/owners"], githubLimit);

  // Repos the user could add, for the picker: a list, or a search with `query`.
  router.get("/github/repos", async (req, res) => {
    const { query, owner, cursor } = parseInput(searchReposQuery, req.query);
    const user = currentUser(res);
    if (!owner) {
      res.json(await acrossSources(user, query, cursor));
      return;
    }
    // An owner's repos list with the token that reaches it.
    const octokit = await deps.github(user.id, { owner });
    if (query) {
      res.json(await searchRepos(octokit, { query, owner, cursor }));
      return;
    }
    const list = await listRepos(octokit, { owner, cursor });
    if (!list) {
      throw new HttpError(
        404,
        "not_found",
        "No GitHub user or org has that name",
      );
    }
    res.json(list);
  });

  // The owners the picker offers: the ones GitHub lists to the first source, and the
  // ones tokens reach. If GitHub refuses that source but a token works, the tokens'.
  router.get("/github/owners", async (_req, res) => {
    const user = currentUser(res);
    const { sources, owners: tokenOwners } = await pickerTokens(deps.db, user);
    let listed: RepoOwner[];
    try {
      listed = await listOwners(
        await deps.github(user.id, { tokenId: sources[0] ?? null }),
      );
    } catch (err) {
      if (!isRejection(err) || tokenOwners.length === 0) throw err;
      listed = [{ login: user.login, kind: "you" }];
    }
    const body: RepoOwnersResponse = {
      owners: withTokenOwners(listed, tokenOwners),
    };
    res.json(body);
  });

  // A page of the repos every token reaches, with no owner picked: one source's page at
  // a time, then the next source's (see pickerTokens). A source GitHub refuses is
  // skipped, so the others still list, unless it's the only one.
  async function acrossSources(
    user: User,
    query: string | undefined,
    raw: string | undefined,
  ): Promise<SearchReposResponse> {
    const { sources } = await pickerTokens(deps.db, user);
    const { index, cursor } = parseSourceCursor(raw);
    const source = sources[index];
    // Past the last source, like from a cursor kept while a token was removed.
    if (source === undefined) return { repos: [], nextCursor: null };
    const nextSource =
      index + 1 < sources.length ? sourceCursor(index + 1, null) : null;
    try {
      const octokit = await deps.github(user.id, { tokenId: source });
      const page = query
        ? await searchRepos(octokit, { query, cursor })
        : await listRepos(octokit, { cursor });
      return {
        repos: page?.repos ?? [],
        nextCursor:
          page?.nextCursor != null
            ? sourceCursor(index, page.nextCursor)
            : nextSource,
      };
    } catch (err) {
      if (sources.length > 1 && isRejection(err)) {
        return { repos: [], nextCursor: nextSource };
      }
      throw err;
    }
  }

  router.get("/repos", async (_req, res) => {
    const repos = await deps.db.watchedRepo.findMany({
      where: { userId: currentUser(res).id },
      orderBy: [{ owner: "asc" }, { name: "asc" }],
    });
    const body: WatchedReposResponse = { repos: repos.map(toDto) };
    res.json(body);
  });

  router.post("/repos", githubLimit, async (req, res) => {
    const user = currentUser(res);
    const { owner, name } = parseInput(addRepoBody, req.body);

    const count = await deps.db.watchedRepo.count({
      where: { userId: user.id },
    });
    if (count >= MAX_WATCHED_REPOS) {
      throw new HttpError(
        422,
        "too_many_repos",
        `You can watch up to ${MAX_WATCHED_REPOS} repos`,
      );
    }

    // Checks the repo exists and the user can see it, and gets its stable id.
    const repo = await findRepo(await deps.github(user.id), owner, name);
    if (!repo) throw notFound();

    // The database's unique rule decides duplicates, so two adds at once can't both pass.
    const created = await deps.db.watchedRepo
      .create({
        data: {
          userId: user.id,
          githubRepoId: repo.githubRepoId,
          owner: repo.owner,
          name: repo.name,
        },
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) {
          throw new HttpError(
            409,
            "already_watched",
            "You already watch this repo",
          );
        }
        throw err;
      });
    const body: AddRepoResponse = { repo: toDto(created) };
    res.status(201).json(body);
  });

  router.patch("/repos/:id", async (req, res) => {
    const changes = parseInput(updateRepoBody, req.body);
    const { count } = await deps.db.watchedRepo.updateMany({
      where: { id: req.params.id, userId: currentUser(res).id },
      data: sentFields(changes),
    });
    if (count === 0) throw notFound();
    const repo = await deps.db.watchedRepo.findUniqueOrThrow({
      where: { id: req.params.id },
    });
    res.json({ repo: toDto(repo) });
  });

  router.delete("/repos/:id", async (req, res) => {
    const { count } = await deps.db.watchedRepo.deleteMany({
      where: { id: req.params.id, userId: currentUser(res).id },
    });
    if (count === 0) throw notFound();
    res.sendStatus(204);
  });

  return router;
}
