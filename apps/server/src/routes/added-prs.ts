import {
  addPrBody,
  MAX_ADDED_PRS,
  parsePrLink,
  prLookupQuery,
  type AddPrErrorCode,
  type AddPrResponse,
  type PrLookupResponse,
} from "@pr-peek/core";
import express, { type Router } from "express";
import type { Octokit } from "octokit";
import type { Db } from "../db";
import { Prisma } from "../generated/prisma/client";
import { lookUpPr, type LookedUpPr } from "../github/pull-lookup";
import { HttpError, parseInput } from "../http-error";
import { publishItemsChanged } from "../items";
import { attemptLimiter } from "../rate-limit";
import { NEVER_SYNCED } from "../sync";
import { currentUser, requireUser } from "./auth";
import { updatePr } from "./items";

export interface AddedPrDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: (userId: string) => Promise<Octokit>;
  // Queues a sync for the user. False if one was already queued or running.
  requestSync: (userId: string) => Promise<boolean>;
  now?: () => Date;
}

const fail = (status: number, code: AddPrErrorCode, message: string) =>
  new HttpError(status, code, message);

// Prisma's code for "a row like this already exists".
const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

// Adding PRs by their link: looking one up for the dialog, and adding it. Unflagging an
// added PR is in items.ts.
export function addedPrsRouter(deps: AddedPrDeps): Router {
  const router = express.Router();
  const { db } = deps;
  const now = () => (deps.now ?? (() => new Date()))();
  // On each route, not `router.use`, which would cover every path under /prs. Each one
  // asks GitHub.
  const signedIn = requireUser(db);
  const limiter = attemptLimiter();

  // The PR a link names, or why it can't be added.
  async function lookUp(userId: string, link: string): Promise<LookedUpPr> {
    const ref = parsePrLink(link);
    if (!ref) {
      throw fail(400, "not_a_pr_link", "That doesn't look like a PR link.");
    }
    const pr = await lookUpPr(await deps.github(userId), ref);
    if (pr === "issue") {
      throw fail(422, "not_a_pr", "That's an issue, not a pull request.");
    }
    if (!pr) {
      throw fail(404, "not_found", "Your GitHub token can't see this PR.");
    }
    return pr;
  }

  const trackedRow = (userId: string, pr: LookedUpPr) =>
    db.pullRequest.findUnique({
      where: { userId_githubNodeId: { userId, githubNodeId: pr.nodeId } },
      select: { id: true, importantAt: true },
    });

  router.get("/prs/lookup", signedIn, limiter, async (req, res) => {
    const userId = currentUser(res).id;
    const pr = await lookUp(userId, parseInput(prLookupQuery, req.query).link);
    const row = await trackedRow(userId, pr);
    const body: PrLookupResponse = {
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      author: pr.author,
      state: pr.state,
      tracked: row !== null,
      flagged: row?.importantAt != null,
    };
    res.json(body);
  });

  // Flags a PR the user already tracks. It isn't marked added: the searches found it on
  // their own, so unflagging it works as it always has.
  async function flagTracked(
    userId: string,
    row: { id: string; importantAt: Date | null },
  ): Promise<AddPrResponse> {
    if (row.importantAt) return { id: row.id, alreadyFlagged: true };
    await updatePr(db, userId, row.id, { importantAt: now() });
    return { id: row.id, alreadyFlagged: false };
  }

  router.post("/prs", signedIn, limiter, async (req, res) => {
    const userId = currentUser(res).id;
    const pr = await lookUp(userId, parseInput(addPrBody, req.body).link);
    const tracked = await trackedRow(userId, pr);
    if (tracked) {
      res.json(await flagTracked(userId, tracked));
      return;
    }

    const added = await db.pullRequest.count({
      where: { userId, addedAt: { not: null } },
    });
    if (added >= MAX_ADDED_PRS) {
      throw fail(
        422,
        "too_many_added",
        `You've added ${MAX_ADDED_PRS} PRs, the most you can. Unflag one to add another.`,
      );
    }

    const at = now();
    const id = await db
      .$transaction(async (tx) => {
        const row = await tx.pullRequest.create({
          data: {
            userId,
            githubNodeId: pr.nodeId,
            githubRepoId: pr.githubRepoId,
            repoOwner: pr.owner,
            repoName: pr.repo,
            number: pr.number,
            title: pr.title,
            url: pr.url,
            authorLogin: pr.author,
            isDraft: pr.isDraft,
            state: pr.state,
            headSha: pr.headSha,
            ...(pr.mergedAt && { mergedAt: new Date(pr.mergedAt) }),
            // The next sync sees it as changed, fetches its details, and runs the rules.
            githubUpdatedAt: NEVER_SYNCED,
            importantAt: at,
            addedAt: at,
            listGroup: "watching",
          },
          select: { id: true },
        });
        await publishItemsChanged(tx, userId);
        return row.id;
      })
      .catch((err: unknown) => {
        // A sync or another add saved it first.
        if (isUniqueViolation(err)) return null;
        throw err;
      });
    if (!id) {
      const row = await trackedRow(userId, pr);
      res.json(await flagTracked(userId, row!));
      return;
    }

    await deps.requestSync(userId).catch((err: unknown) => {
      req.log.warn({ err }, "queueing a sync after adding a PR failed");
    });
    const body: AddPrResponse = { id, alreadyFlagged: false };
    res.status(201).json(body);
  });

  return router;
}
