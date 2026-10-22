import {
  addRepoBody,
  MAX_WATCHED_REPOS,
  searchReposQuery,
  updateRepoBody,
  type AddRepoResponse,
  type SearchReposResponse,
  type WatchedRepoDto,
  type WatchedReposResponse,
} from "@pr-peek/core";
import express, { type Router } from "express";
import type { Octokit } from "octokit";
import type { Db } from "../db";
import { Prisma, type WatchedRepo } from "../generated/prisma/client";
import { findRepo, searchRepos } from "../github/repos";
import { HttpError, parseInput, sentFields } from "../http-error";
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

// Prisma's code for "a row like this already exists".
const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

export function reposRouter(deps: RepoDeps): Router {
  const router = express.Router();
  router.use(["/github/repos", "/repos"], requireUser(deps.db));

  // Repos the user could add, for the picker.
  router.get("/github/repos", async (req, res) => {
    const { query, cursor } = parseInput(searchReposQuery, req.query);
    const body: SearchReposResponse = await searchRepos(
      await deps.github(currentUser(res).id),
      { query, cursor },
    );
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
