import { formatAge, previewQuery, type PrPreviewResponse } from "@pr-peek/core";
import express, { type Router } from "express";
import type { Octokit } from "octokit";
import type { Db } from "../db";
import { fetchPrPreview } from "../github/pull-preview";
import { HttpError, parseInput } from "../http-error";
import { userLimiter } from "../rate-limit";
import { reviewersOf } from "../reviewers";
import { currentUser, requireUser } from "./auth";

// Each preview is a GitHub request on the user's rate limit.
const PREVIEWS_PER_MINUTE = 30;

export interface PreviewDeps {
  db: Db;
  // A GitHub client acting as the user (see github/client.ts).
  github: (userId: string) => Promise<Octokit>;
  now?: () => Date;
}

const notFound = () => new HttpError(404, "not_found", "PR not found");

export function previewRouter(deps: PreviewDeps): Router {
  const router = express.Router();
  const now = () => (deps.now ?? (() => new Date()))();
  const limiter = userLimiter(60 * 1000, PREVIEWS_PER_MINUTE);
  router.use("/prs/:id/preview", requireUser(deps.db), limiter);

  // More about one of the user's PRs, for the preview sheet.
  router.get("/prs/:id/preview", async (req, res) => {
    const { item } = parseInput(previewQuery, req.query);
    const user = currentUser(res);
    const pr = await deps.db.pullRequest.findFirst({
      where: { id: req.params.id, userId: user.id },
      select: {
        githubNodeId: true,
        // No item id matches "".
        items: { where: { id: item ?? "" }, select: { latestEventId: true } },
      },
    });
    if (!pr) throw notFound();

    const octokit = await deps.github(user.id);
    const preview = await fetchPrPreview(
      octokit,
      pr.githubNodeId,
      pr.items[0]?.latestEventId ?? null,
    );
    if (!preview) throw notFound();

    const at = now();
    const body: PrPreviewResponse = {
      bodyHtml: preview.bodyHtml,
      openedAge: formatAge(preview.createdAt, at),
      failingChecks: preview.failingChecks,
      reviewers: reviewersOf(preview, user.login),
      comments: preview.comments.map((comment) => ({
        ...comment,
        author: comment.author.login,
        age: formatAge(comment.createdAt, at),
      })),
      focusId: preview.focusId,
    };
    res.json(body);
  });

  return router;
}
