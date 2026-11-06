import {
  addRepoBody,
  MAX_WATCHED_REPOS,
  searchReposQuery,
  updateRepoBody,
  type AddRepoResponse,
  type RepoOwnersResponse,
  type WatchedRepoDto,
  type WatchedReposResponse,
} from "@pr-peek/core";
import express, { type Router } from "express";
import type { Octokit } from "octokit";
import type { Db } from "../db";
import { Prisma, type WatchedRepo } from "../generated/prisma/client";
import { findRepo, listOwners, listRepos, searchRepos } from "../github/repos";
import { HttpError, parseInput, sentFields } from "../http-error";
import { userLimiter } from "../rate-limit";
import { currentUser, requireUser } from "./auth";

export interface RepoDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: (userId: string) => Promise<Octokit>;
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
  router.use(
    ["/github/repos", "/github/owners"],
    userLimiter(60 * 1000, PICKER_ASKS_PER_MINUTE),
  );

  // Repos the user could add, for the picker: a list, or a search with `query`.
  router.get("/github/repos", async (req, res) => {
    const { query, owner, cursor } = parseInput(searchReposQuery, req.query);
    const octokit = await deps.github(currentUser(res).id);
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

  // The owners the picker offers.
  router.get("/github/owners", async (_req, res) => {
    const octokit = await deps.github(currentUser(res).id);
    const body: RepoOwnersResponse = { owners: await listOwners(octokit) };
    res.json(body);
  });

  router.get("/repos", async (_req, res) => {
    const repos = await deps.db.watchedRepo.findMany({
      where: { userId: currentUser(res).id },
      orderBy: [{ owner: "asc" }, { name: "asc" }],
    });
    const body: WatchedReposResponse = { repos: repos.map(toDto) };
    res.json(body);
  });

  router.post("/repos", async (req, res) => {
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
