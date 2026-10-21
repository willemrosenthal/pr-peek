# 04. GitHub sync engine

**Goal:** the worker keeps an up to date copy of every PR each user cares about, refreshed every 1 to 2 minutes, without wasting API calls.

**Needs:** plan 03.

## Background

Each sync for a user answers three questions:

1. Which open PRs in my watched repos involve me? (Review requested, authored by me, or I commented.)
2. Which of those changed since last time?
3. For the ones that changed, what are the full details? (Timeline, reviews, comments, checks.)

We use GitHub's **GraphQL API** because one request can fetch a PR plus its reviews, comments, timeline, and checks. GitHub limits GraphQL by "points" per hour per user token. Check GitHub's docs for the current limits. Each user's sync uses that user's own token, so users don't eat into each other's limits.

## Steps

### 4.1 Watched repos

- [ ] `GET /api/github/repos?query=` lists repos the user can see (their own, their orgs'), for the repo picker. Search with GraphQL, paginated.
- [ ] `POST /api/repos` and `DELETE /api/repos/:id` add and remove `WatchedRepo` rows. `PATCH /api/repos/:id` sets `enabled` or `muted`.
- [ ] Limit each user to a sensible number of watched repos (start at 50) to keep sync cost predictable.

### 4.2 Finding relevant PRs

- [ ] Build search queries scoped to the user's enabled repos (`repo:owner/name` for each). If the query gets too long, split repos into batches.
- [ ] Run three GraphQL searches, each returning PR id, number, repo, and `updatedAt`:
  - `is:pr is:open review-requested:@me` (use `user-review-requested:@me` if the user turned off team requests)
  - `is:pr is:open author:@me`
  - `is:pr is:open commenter:@me -author:@me` (for "replies to me")
- [ ] Merge the results into one set keyed by PR node id, remembering which searches matched (the "reasons").

### 4.3 Skipping unchanged PRs

- [ ] Compare each PR's `updatedAt` with our stored `githubUpdatedAt`. Only fetch details for PRs that are new or changed.
- [ ] Exception: check results can change without `updatedAt` changing. For the user's own PRs, always do a cheap check fetch (the latest commit's `statusCheckRollup.state` only).
- [ ] PRs that dropped out of all searches (merged, closed, review no longer requested) get their open items resolved in plan 05. Delete them from storage after 7 days.

### 4.4 Fetching details

- [ ] One GraphQL query per batch of up to about 10 changed PRs (use aliases to fetch several in one request). For each PR fetch:
  - Basics: title, url, author, draft state, head commit sha, `updatedAt`.
  - `reviewRequests` (who's currently asked, users and teams).
  - `timelineItems` of types `ReviewRequestedEvent`, `ReviewRequestRemovedEvent`, `PullRequestReview` (latest 50). This gives exact request times for staleness and re-requests.
  - `reviews` (latest 20): author, state, submitted time.
  - `reviewThreads` (latest 30), each with its comments (latest 20): author, body preview, created time, reply to.
  - `comments` (conversation comments, latest 30): author, body preview, created time.
  - Latest commit `statusCheckRollup`: overall state, plus each failing check run or status context with name and link.
- [ ] Put the queries in `apps/server/src/github/queries/*.graphql` and generate TypeScript types with GraphQL Code Generator. That way a typo in a field name fails the build.
- [ ] Save a trimmed, normalized version as `PullRequest.snapshot`. Define the snapshot type in `packages/core` so the rules (plan 05) can be tested without GitHub.

### 4.5 Scheduling

- [ ] A pg-boss scheduled job `sync:dispatch` runs every minute. It finds users who are due (based on `lastSyncedAt`, their interval, and no `syncError`) and enqueues one `sync:user` job each.
- [ ] `sync:user` jobs use a `singletonKey` of the user id so the same user never syncs twice at once.
- [ ] Run several jobs at once (start with 5) so one slow user doesn't hold up everyone.
- [ ] Users who haven't opened the app in 14 days drop to a sync every 15 minutes. Their next visit brings them back to normal right away.

### 4.6 Being a good API citizen

- [ ] The Octokit throttling plugin waits and retries when GitHub says we hit a limit.
- [ ] Log the remaining GraphQL points after each sync. If a user gets low, slow down their schedule.
- [ ] Optional speed up: call `GET /notifications` with `If-Modified-Since` first. If GitHub returns 304 (nothing new) and no check fetch is due, skip the searches. Needs the `notifications` scope.

### 4.7 Errors

- [ ] On failure, save `syncError` and back off: 2, 4, 8 minutes, up to 30.
- [ ] 401 from GitHub sets `syncError = "reauth"` (see plan 03).
- [ ] One PR failing to parse shouldn't fail the whole sync. Log it and move on.

### 4.8 Tests

- [ ] Record real GraphQL responses (with personal details replaced) as fixtures in `apps/server/test/fixtures/`.
- [ ] Mock GitHub with MSW (Mock Service Worker, a library that intercepts network calls in tests).
- [ ] Test: change detection, batching, a PR dropping out, rate limit retry, and 401 handling.

## Done when

- [ ] Add your real repos locally and watch the worker fill `PullRequest` rows within 2 minutes.
- [ ] A second sync with nothing changed makes only the search calls (and check calls for your PRs), visible in logs.
- [ ] Pushing a commit to one of your PRs updates its `headSha` and `checkState` on the next sync.
- [ ] Tests pass for all cases in 4.8.
