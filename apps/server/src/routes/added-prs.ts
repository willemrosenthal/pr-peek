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
import type { GitHubFor } from "../github/client";
import type { Db } from "../db";
import { lookUpPr, type LookedUpPr } from "../github/pull-lookup";
import { HttpError, parseInput } from "../http-error";
import { publishItemsChanged } from "../items";
import { userLimiter } from "../rate-limit";
import { NEVER_SYNCED } from "../sync";
import { currentUser, requireUser } from "./auth";
import { updatePr } from "./items";

export interface AddedPrDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: GitHubFor;
  // Queues a sync for the user. False if one was already queued or running.
  requestSync: (userId: string) => Promise<boolean>;
  now?: () => Date;
}

// Each lookup or add asks GitHub. The dialog looks up once a link parses, not per key.
const ASKS_PER_MINUTE = 30;

const fail = (status: number, code: AddPrErrorCode, message: string) =>
  new HttpError(status, code, message);

// Adding PRs by their link: looking one up for the dialog, and adding it. Unflagging an
// added PR is in items.ts.
export function addedPrsRouter(deps: AddedPrDeps): Router {
  const router = express.Router();
  const { db } = deps;
  const now = () => (deps.now ?? (() => new Date()))();
  // On each route, not `router.use`, which would cover every path under /prs.
  const signedIn = requireUser(db);
  const limiter = userLimiter(60 * 1000, ASKS_PER_MINUTE);

  // The PR a link names, or why it can't be added.
  async function lookUp(userId: string, link: string): Promise<LookedUpPr> {
    const ref = parsePrLink(link);
    if (!ref) {
      throw fail(400, "not_a_pr_link", "That doesn't look like a PR link.");
    }
    const pr = await lookUpPr(
      await deps.github(userId, { owner: ref.owner }),
      ref,
    );
    if (pr === "issue") {
      throw fail(422, "not_a_pr", "That's an issue, not a pull request.");
    }
    if (!pr) {
      throw fail(404, "not_found", "Your GitHub token can't see this PR.");
    }
    return pr;
  }

  // The user's row for the PR, if the list shows it: open or merged, and in a watched
  // repo or added. A row that ended, like one in a repo the user stopped watching, stays
  // stored a while, but isn't on the list.
  async function listedRow(userId: string, pr: LookedUpPr) {
    const [row, watched] = await Promise.all([
      db.pullRequest.findUnique({
        where: { userId_githubNodeId: { userId, githubNodeId: pr.nodeId } },
        select: { id: true, importantAt: true, addedAt: true, state: true },
      }),
      db.watchedRepo.count({
        where: { userId, githubRepoId: pr.githubRepoId, enabled: true },
      }),
    ]);
    const live = row?.state === "open" || row?.state === "merged";
    return live && (row.addedAt || watched > 0) ? row : null;
  }

  router.get("/prs/lookup", signedIn, limiter, async (req, res) => {
    const userId = currentUser(res).id;
    const pr = await lookUp(userId, parseInput(prLookupQuery, req.query).link);
    const row = await listedRow(userId, pr);
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

  // Flags a PR already on the user's list. It isn't marked added: the searches found it
  // on their own, so unflagging it works as it always has.
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
    const listed = await listedRow(userId, pr);
    if (listed) {
      res.json(await flagTracked(userId, listed));
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
    const fields = {
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
      mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
      // The next sync sees it as changed, fetches its details, and runs the rules.
      githubUpdatedAt: NEVER_SYNCED,
      importantAt: at,
      addedAt: at,
      quietAt: null,
      listGroup: "watching",
    };
    // Updates a row that ended, so it comes back as added.
    const { id } = await db.$transaction(async (tx) => {
      const row = await tx.pullRequest.upsert({
        where: { userId_githubNodeId: { userId, githubNodeId: pr.nodeId } },
        create: { userId, githubNodeId: pr.nodeId, ...fields },
        update: fields,
        select: { id: true },
      });
      await publishItemsChanged(tx, userId);
      return row;
    });

    await deps.requestSync(userId).catch((err: unknown) => {
      req.log.warn({ err }, "queueing a sync after adding a PR failed");
    });
    const body: AddPrResponse = { id, alreadyFlagged: false };
    res.status(201).json(body);
  });

  return router;
}
