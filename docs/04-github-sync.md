# 04. GitHub sync engine

**Goal:** the worker keeps an up to date copy of every PR each user cares about, refreshed every 1 to 2 minutes, without wasting API calls.

**Needs:** plan 03.

## Background

Each sync for a user answers three questions:

1. Which open PRs in my watched repos involve me? (Review requested, authored by me, or I commented.)
2. Which of those changed since last time?
3. For the ones that changed, what are the full details? (Timeline, reviews, comments, checks.)

We use GitHub's **GraphQL API** because one request can fetch a PR plus its reviews, comments, timeline, and checks. GitHub limits GraphQL by "points" per hour per user token. Check GitHub's docs for the current limits. Each user's sync uses that user's own token, so users don't eat into each other's limits.

**Split into four PRs:**

- **Part 0** (`plan-04-0-token-sign-in`): step 4.0, sign in with a personal access token.
- **Part A** (`plan-04-1-repos`): step 4.1, the watched repos API.
- **Part B** (`plan-04-2-fetch`): steps 4.2 to 4.4. Find relevant PRs, skip unchanged ones, fetch details, save snapshots.
- **Part C** (`plan-04-3-schedule`): steps 4.5 to 4.7. The worker schedule, backoff, and rate limit logging.

## Changes from the original plan

- **Search once, not per repo batch.** GitHub search queries max out at 256 characters, so 50 `repo:` filters would need about 9 batches per search, per user, per sync. Instead each search runs once across all of GitHub, and we keep only results in watched repos. Three searches per sync, whatever the repo count.
- **Zod instead of GraphQL Code Generator.** Codegen needs GitHub's whole schema (about 10 MB) in the repo. Each query's response is checked with a Zod schema instead, which gives the TypeScript types and fails clearly if GitHub changes a field.
- **Fake GitHub with an injected `fetch`, not MSW.** Same approach as plan 03. `test/github.ts` has `fakeGraphQL`.
- **Octokit spaces out GraphQL calls** (its throttling treats them as writes, about one per second). Fine for a few calls per sync, but keep the number of calls per sync low. Tests turn throttling off.
- **Added `GET /api/repos`** to list the watch list. The settings screen needs it.
- **No separate check fetch.** The searches return each PR's latest check state too, so seeing whether your PR's checks changed costs no extra call.
- **`nodes(ids:)` instead of aliases** to fetch a batch of PRs in one query. Simpler, and GitHub returns the others when one PR is gone.
- **Review events come from `reviews`, not the timeline.** The timeline only fetches review request events. Fetching reviews in both places would double the cost.
- **New `PullRequest` columns:** `lastSeenAt` (for deleting PRs after 7 days, and for plan 05 to resolve their items) and `githubRepoId`.
- **Added step 4.0, token sign in.** Many company orgs block OAuth Apps until an org owner approves them. Our app can sign people in, but GitHub hides the org's private repos from it. A **personal access token** (PAT, a password-like key the user makes in their own GitHub settings) acts as the user and isn't affected by that block, unless the org also bans classic tokens. Added after part A.

## Steps

### 4.0 Sign in with a personal access token (part 0)

- [x] `POST /api/auth/token` (`{ token }`): checks the token with GitHub's `GET /user`, then signs the user in like the OAuth callback does (same user row, new session id, rate limit, CSRF check). Returns `{ isNew }` as JSON.
- [x] Classic tokens must have the `repo` or `public_repo` scope, read from GitHub's `X-OAuth-Scopes` header. Fine-grained tokens have no scopes, so they're accepted and GitHub decides what they can see.
- [x] The token's expiry comes from GitHub's `GitHub-Authentication-Token-Expiration` header. There's no refresh token, so when it expires the user is marked "needs reauth" and must paste a new one.
- [x] New `User.authMethod` column (`oauth` or `pat`), returned by `/api/me`. The web app uses it to show the right "sign in again" screen.
- [x] Request and response shapes in `packages/core/src/api/auth.ts`.
- [x] Tests: good token, bad token, missing scope, fine-grained token, switching between OAuth and a token, bad input, CSRF, rate limit, and an expiring token asking for a new one.
- [ ] **(You)** Make a classic token with `repo` and `read:org` (authorize it for SSO if your org uses it). With the dev server running, sign in with it and search for your work repo:
  ```
  curl -c pp-cookies.txt -H "Origin: http://localhost:3000" -H "Content-Type: application/json" -d '{"token":"YOUR_TOKEN"}' http://localhost:3000/api/auth/token
  curl -b pp-cookies.txt http://localhost:3000/api/me
  curl -b pp-cookies.txt "http://localhost:3000/api/github/repos?query=WORK_REPO_NAME"
  ```
  The last call should list the work repo. Delete `pp-cookies.txt` after.
- `read:org` isn't required by the server, but without it org repos and team review requests can go missing. The sign in steps ask for it.
- Limit: we can't tell if a classic token was authorized for the org's single sign-on (SSO). `GET /user` works either way. Without it, adding an org repo fails with "not found". The sign in screen (plan 07) must tell users to do that step.

### 4.1 Watched repos (part A)

- [x] `GET /api/github/repos?query=&cursor=`: without a query, the user's repos (own, collaborator, org member), most recently pushed first. With a query, a GitHub search by name across repos they can see. 20 per page, archived repos skipped, each marked `watched` if already added.
- [x] `GET /api/repos` lists the watch list. `POST /api/repos` (`{ owner, name }`) checks the repo on GitHub and adds it. `PATCH /api/repos/:id` sets `enabled` or `muted`. `DELETE /api/repos/:id` removes it. All scoped to the signed in user.
- [x] Limit of 50 watched repos (`MAX_WATCHED_REPOS` in `packages/core`).
- [x] Request and response shapes in `packages/core/src/api/repos.ts`, shared with the web app later.
- [x] `HttpError` (`src/http-error.ts`) for clear 4xx answers. `NeedsReauthError` is one, so a revoked token becomes a 401 with code `reauth`.

### 4.2 Finding relevant PRs (part B)

All in `src/github/pull-search.ts`.

- [x] Three GraphQL searches across all of GitHub (see "Search once" above), newest first, following pages up to 10 (GitHub's 1000 result limit):
  - `review-requested:@me` (`user-review-requested:@me` if the user turned off team requests)
  - `author:@me`
  - `commenter:@me -author:@me` (for "replies to me")
  - Each starts with `is:pr is:open archived:false sort:updated-desc`.
- [x] Each result has the PR id, repo `databaseId`, `updatedAt`, and the latest commit's check state.
- [x] Results merge into one map keyed by PR node id, remembering which searches matched (the "reasons").
- [x] The sync keeps only PRs in enabled watched repos (muted ones included), matched on `githubRepoId`, so a renamed repo keeps syncing.

### 4.3 Skipping unchanged PRs (part B)

All in `src/sync.ts`. `syncUser(deps, userId)` runs one full sync.

- [x] Details are fetched only for PRs that are new, or whose `updatedAt` differs from our `githubUpdatedAt`.
- [x] Exception: checks can change without `updatedAt` changing. For the user's own PRs, a changed check state (from the search) also means a fetch.
- [x] Every PR found gets `lastSeenAt` set to now. PRs not seen for 7 days are deleted (their items go with them). Plan 05 resolves items for PRs whose `lastSeenAt` is older than the latest sync.
- [x] No watched repos means no GitHub calls at all.
- [x] Sets `User.lastSyncedAt`. Returns counts (found, fetched, failed, deleted) for logging.
- [x] `pnpm --filter @pr-peek/server sync:once <login>` runs one sync by hand, until part C's worker does it on a schedule.
- [ ] **(You)** Add a watched repo with open PRs that involve you, run `sync:once`, and check the `PullRequest` rows (see the part B PR for the exact commands).

### 4.4 Fetching details (part B)

All in `src/github/pull-details.ts`.

- [x] One GraphQL `nodes(ids: [...])` query per batch of up to 10 changed PRs. For each PR:
  - Basics: title, url, author, draft state, head commit sha and date, `updatedAt`.
  - `reviewRequests` (who's asked right now, users and teams).
  - `timelineItems` of types `ReviewRequestedEvent` and `ReviewRequestRemovedEvent` (latest 50), for exact request times.
  - `reviews` (latest 20): author, state, submitted time. Unsent (pending) reviews are skipped.
  - `reviewThreads` (latest 30), each with its comments (latest 20): author, body preview, created time, reply to.
  - `comments` (conversation comments, latest 30): author, body preview, created time.
  - Latest commit `statusCheckRollup`: overall state, plus each failing check run or status context with name and link.
- [x] Each response is checked with Zod. Body previews are cut to 200 characters on one line. Each comment also lists the logins it @mentions, taken from the full text first, so plan 05's "mentions you" rule works for long comments. Bots are marked with `isBot`. Deleted accounts become `ghost`.
- [x] Saved as `PullRequest.snapshot`. The `PrSnapshot` type and Zod schema are in `packages/core/src/pr-snapshot.ts`, so plan 05 can read snapshots back and test rules without GitHub.

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
- [x] One PR failing to parse, or gone, doesn't fail the whole sync. It's skipped and listed in the sync result's `failed` (done in part B). The worker logs it in part C.

### 4.8 Tests

- [x] GitHub-shaped test data in `apps/server/test/pulls.ts`, served by `fakeGraphQL`. Written by hand, since real responses would contain other people's data. The queries were run once against real GitHub to confirm every field exists.
- [x] Tests for change detection, check changes, batching, a PR dropping out and being deleted, partial "not found" answers, and the snapshot shape (part B).
- [ ] Tests for rate limit retry and 401 handling (part C).

## Done when

- [ ] Add your real repos locally and watch the worker fill `PullRequest` rows within 2 minutes.
- [ ] A second sync with nothing changed makes only the search calls (and check calls for your PRs), visible in logs.
- [ ] Pushing a commit to one of your PRs updates its `headSha` and `checkState` on the next sync.
- [ ] Tests pass for all cases in 4.8.
