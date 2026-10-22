import {
  addRepoBody,
  MAX_WATCHED_REPOS,
  searchReposQuery,
  updateRepoBody,
  type SearchReposResponse,
  type WatchedRepoDto,
} from "@pr-peek/core";
import express, { type Router } from "express";
import type { Octokit } from "octokit";
import type { Db } from "../db";
import type { WatchedRepo } from "../generated/prisma/client";
import { findRepo, searchRepos } from "../github/repos";
import { HttpError, parseInput } from "../http-error";
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
  };
}

const notFound = () => new HttpError(404, "not_found", "Repo not found");

export function reposRouter(deps: RepoDeps): Router {
  const router = express.Router();
  router.use(["/github/repos", "/repos"], requireUser(deps.db));

  // Repos the user could add, for the picker.
  router.get("/github/repos", async (req, res) => {
    const user = currentUser(res);
    const { query, cursor } = parseInput(searchReposQuery, req.query);
    const page = await searchRepos(await deps.github(user.id), {
      query,
      cursor,
    });

    const watched = await deps.db.watchedRepo.findMany({
      where: { userId: user.id },
      select: { githubRepoId: true },
    });
    const watchedIds = new Set(watched.map((repo) => repo.githubRepoId));

    const body: SearchReposResponse = {
      repos: page.repos.map((repo) => ({
        ...repo,
        watched: watchedIds.has(repo.githubRepoId),
      })),
      nextCursor: page.nextCursor,
    };
    res.json(body);
  });

  router.get("/repos", async (_req, res) => {
    const repos = await deps.db.watchedRepo.findMany({
      where: { userId: currentUser(res).id },
      orderBy: [{ owner: "asc" }, { name: "asc" }],
    });
    res.json({ repos: repos.map(toDto) });
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

    const existing = await deps.db.watchedRepo.findUnique({
      where: {
        userId_githubRepoId: {
          userId: user.id,
          githubRepoId: repo.githubRepoId,
        },
      },
    });
    if (existing) {
      throw new HttpError(
        409,
        "already_watched",
        "You already watch this repo",
      );
    }

    const created = await deps.db.watchedRepo.create({
      data: {
        userId: user.id,
        githubRepoId: repo.githubRepoId,
        owner: repo.owner,
        name: repo.name,
      },
    });
    res.status(201).json({ repo: toDto(created) });
  });

  router.patch("/repos/:id", async (req, res) => {
    const { enabled, muted } = parseInput(updateRepoBody, req.body);
    const { count } = await deps.db.watchedRepo.updateMany({
      where: { id: req.params.id, userId: currentUser(res).id },
      // Only the fields that were sent.
      data: {
        ...(enabled !== undefined && { enabled }),
        ...(muted !== undefined && { muted }),
      },
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
