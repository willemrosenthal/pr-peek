# 05. Rules and attention items

**Goal:** turn stored PR snapshots into **items**, the rows in your list, for all 7 cases. Items are sorted by urgency, close on their own when no longer relevant, and never duplicate.

**Needs:** plan 04.

## Background

A **rule** is a small, pure function: it takes one PR snapshot plus some context and returns the items that PR should produce. "Pure" means no database or network, which makes rules easy to test and to add later.

Rules live in `packages/core`, so the web app can reuse their names, groups, and defaults for the settings screen.

**Split into three PRs:**

- **Part A** (`plan-05-1-rules`): steps 5.1 to 5.3. Types and the six rules, with a test for each case.
- **Part B** (`plan-05-2-urgency`): step 5.4. Staleness, work hours, and the urgency score.
- **Part C** (`plan-05-3-apply`): steps 5.5 to 5.7. Running rules in the worker, saving items, rule settings, and the end to end test.

## Changes from the original plan

- **`RuleContext.viewerTeams`.** The snapshot names requested teams as `org/team`, but not which teams you're on. Part C fetches your teams (needs the `read:org` scope). With none, team requests are ignored.
- **No `isBot(login)` in the context.** Every actor in the snapshot already has `isBot`.
- **"Include drafts" lives in the review rules' `RuleSetting.options`.** There's no settings column for it. Part C passes it in as `ctx.settings.includeDrafts`.
- **Missing request event.** The sync fetches only the latest 50 request events. If yours isn't among them, the item's key ends in `:current` and it has no `waitingSince`.
- **Review requests also clear when you've reviewed since the request.** GitHub can leave a team request in place after a team member reviews.
- **Reply:** only on other people's PRs (your own PR's comments are the "commented" rule). Counts comments after your latest comment or review anywhere on the PR. Mentions only count if you've commented or reviewed before. Resolved threads are ignored.
- **My PR was reviewed:** only `APPROVED` and `CHANGES_REQUESTED` reviews count, each reviewer's latest. A change request with thread comments also shows up as "commented". The snapshot can't link the two.
  - Watch out in plan 08: `latestEventId` can go back to an older review. If jlee approves, then sam requests changes, then you push, sam's review clears and the id returns to jlee's. Only notify for an id not seen before.
- **Comment and reply summaries** show the latest comment, plus "(+2 more)" when there are more.
- **Check failed:** `occurredAt` is the commit time, since checks have no finish time. `latestEventId` is the commit sha, so more failures on the same commit don't notify again.
- **Rules run on fetched PRs only** (new or changed), plus PRs back in the searches after the last sync missed them. So:
  - PRs stored before this change get items on their next change on GitHub, not on deploy.
  - Changing "hide bots", turning a rule off, or joining a team applies to each PR when it next changes. Plan 06 adds a way to re-run rules on stored PRs.
  - If re-fetching a PR that came back fails, its items stay resolved until the PR changes. Rare.
- **Teams are fetched only when a fetched PR asks a team to review**, and need the `read:org` scope. Without it, team requests are skipped.
- **Names:** the job queue is `notify-item` (pg-boss doesn't allow colons). The `NOTIFY` channel is `user_items_changed`, with the user id as the message.
- **3 syncs at once, not 5.** Each sync holds a database connection while it saves, and pg-boss shares the pool (`DB_POOL_MAX`, 5 by default).
- **Default severity and channels**, which part C seeds into `RuleSetting`:

  | Rule                 | Severity | Channels   |
  | -------------------- | -------- | ---------- |
  | Review requested     | normal   | list, push |
  | Review re-requested  | high     | list, push |
  | Reply to my comment  | normal   | list, push |
  | My PR was reviewed   | normal   | list, push |
  | New comment on my PR | low      | list       |
  | Check failed         | high     | list, push |

## Steps

### 5.1 Core types (`packages/core`, part A)

All in `packages/core/src/rules/`.

- [x] `PrSnapshot`: the normalized PR shape from plan 04.
- [x] `RuleContext`: `viewerLogin`, `viewerTeams`, `now`, and the settings rules read (`includeTeamRequests`, `hideBots`, `includeDrafts`).
- [x] `DetectedItem`: `kind`, `dedupeKey`, `latestEventId`, `eventCount`, `actorLogin`, `summary`, `occurredAt`, `waitingSince` (for staleness). Matches the `Item` table.
- [x] `Rule`: `id`, `name`, `group` ("Other PRs" or "My PRs"), `defaultSeverity` (low, normal, high), `defaultChannels` (list, push), `detect(snapshot, ctx) => DetectedItem[]`.
- [x] `ItemKind` union: `review_requested`, `re_requested`, `reply`, `reviewed`, `commented`, `check_failed`. Each rule's `id` is the kind it makes.

### 5.2 One item per PR per kind

To keep the list short, each PR gets at most one item per kind. New events update that item instead of adding rows. For example, three new comments make one "3 new comments" row, not three rows.

- `dedupeKey` decides when it's a **new item**.
- `latestEventId` changing means **something new happened** on an existing item. Plan 08 uses that to decide whether to notify.

| Kind               | `dedupeKey`                 | New item when                                 |
| ------------------ | --------------------------- | --------------------------------------------- |
| `review_requested` | `rr:<pr>:<requestEventId>`  | You're asked for the first time               |
| `re_requested`     | `rrr:<pr>:<requestEventId>` | You're asked again after you already reviewed |
| `reply`            | `reply:<pr>`                | Someone replies after your comment            |
| `reviewed`         | `reviewed:<pr>`             | Someone reviews your PR                       |
| `commented`        | `commented:<pr>`            | Someone comments on your PR                   |
| `check_failed`     | `check:<pr>:<headSha>`      | Checks fail on a new commit                   |

### 5.3 The built in rules (part A)

Each rule ignores events by you, and events by bots when the user turned on "hide bots". See "Changes from the original plan" for details the plan left open.

- [x] **Review requested.** You're in `reviewRequests` (or one of your teams is, if team requests are on). `waitingSince` is the latest `ReviewRequestedEvent` for you or your team. Skip draft PRs unless the user opts in.
- [x] **Review re-requested.** Same as above, but you've already submitted a review older than that request event. Replaces the plain "review requested" item for that PR.
- [x] **Reply to my comment.** Either of these:
  - A review thread with a comment by you has a later comment by someone else.
  - A conversation comment after your latest one mentions `@you`.

  The summary is a preview of the latest reply, like `sam-r: "Good call, moved it in 3f2c1a"`.

- [x] **My PR was reviewed.** You're the author, and there are reviews by others that you haven't acted on yet (see the table below). The summary shows the latest state: "jlee approved", "jlee requested changes".
- [x] **New comment on my PR.** You're the author, and there are conversation or review comments by others that you haven't acted on yet. The summary is a count plus the latest preview.
- [x] **Check failed on my PR.** You're the author, and the latest commit's rollup is `FAILURE` or `ERROR`. The summary lists failing check names, like "e2e-tests, lint".
- [x] Register all rules in one `rules` array (`rules/index.ts`). Adding a case later means adding one file to that array.

#### When an item clears

There are no snooze or done buttons. An item stays in the list until you act on it, or the PR is merged or closed. Each rule decides what "acted on" means. These are starting defaults and may change.

| Kind                                  | Clears when                                                                |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Review requested, re-requested        | You submit a review, or you're removed as a reviewer                       |
| Reply to my comment                   | You reply in that thread, or comment on the PR after the reply             |
| My PR was reviewed: changes requested | You push a new commit, or reply to the review                              |
| My PR was reviewed: approved          | The PR is merged or closed                                                 |
| New comment on my PR                  | You reply, or push a new commit after the comment                          |
| Check failed                          | The checks pass, or you push a new commit (a new failure makes a new item) |

- [x] Each rule returns no item once its "clears when" condition is true. Step 5.5 then resolves it.

### 5.4 Staleness and urgency (`packages/core`, part B)

All in `packages/core/src/urgency.ts`.

- [x] `waitingFor(waitingSince, now, settings)` returns a duration in milliseconds. When `workHoursOnly` is on, it counts only Monday to Friday, 9 to 6, in the user's timezone. Use `date-fns` with `@date-fns/tz`.
- [x] `staleLevel(duration, settings)` returns `fresh`, `warn` (orange), or `late` (red).
- [x] `formatAge(since, now)` returns `12m`, `3h`, `2d`, rounded down. The label always shows real time passed, so `1d` is 24 hours. "Work hours only" changes only the stale level, not the label.
- [x] `urgencyScore(item, settings, now)`, higher means more urgent:
  - Severity: high 300, normal 200, low 100.
  - Plus staleness: warn +50, late +100.
  - Plus re-requested +40.
  - Plus unseen +25.
  - Ties broken by newest event.

  Keep the weights in one object (`URGENCY_WEIGHTS`) so they're easy to tune. `byUrgency(settings, now)` is a sort function that applies the score and the tie break.

  The item's severity isn't on the `Item` table. It comes from the user's `RuleSetting` for that kind (part C and plan 06 join them). Items with no `waitingSince` count as fresh.

- [x] Unit tests for all of the above, including work hours across a weekend and the clocks changing (New York, Nov 1, 2026).

### 5.5 Applying rules on the server (part C)

In `apps/server/src/items.ts`, called from `syncUser` in `sync.ts`.

- [x] After each PR detail fetch in plan 04, run every enabled rule on it.
- [x] In one transaction, together with saving the PR rows:
  - **Upsert** items by `(userId, dedupeKey)`. New ones start `open`. Existing ones update their summary, `latestEventId`, and `eventCount`, and reopen if they were resolved. `seenAt` resets only when `latestEventId` changes.
  - **Resolve** open items for that PR that rules no longer produce (you reviewed, checks passed). Set `status = resolved` and `resolvedAt`.
- [x] PRs that left the search results (merged, closed): resolve all their items.
- [x] For every item that is new or has a changed `latestEventId`, enqueue a `notify-item` job after the transaction. Plan 08 handles it. For now it just logs.
- [x] After changes, `pg_notify('user_items_changed', <userId>)` inside the transaction, so it's sent on commit. Plan 06 listens for SSE.

### 5.6 Rule settings (part C)

- [x] When a user is created, seed `RuleSetting` rows from each rule's defaults.
- [x] Rules check `RuleSetting.enabled` before running. Severity and channels come from the user's setting, falling back to the rule's defaults (`loadRuleSettings`). Users without rows get the defaults.

### 5.7 Tests

- [x] Snapshot fixtures for each case: plain request, re-request, team request, reply in thread, reply by mention, approval, changes requested, comment by bot (ignored), comment by you (ignored), failing check, check fixed (resolves). Built with `rules/test-helpers.ts`, one test file per rule (part A).
- [x] An end to end test: fixture snapshot in, then the expected `Item` rows in a test database (`sync.test.ts`, part C).

## Done when

- [ ] **(You)** Your real PRs produce the right items in the database for all 7 cases. Test each by hand on a sandbox repo with a friend or a second GitHub account.
- [ ] **(You)** Submitting a review resolves the "review requested" item on the next sync.
- [ ] **(You)** A re-request after your review shows up as `re_requested`.
- [ ] **(You)** Fixing a failing check resolves the item.
- [x] All rule and urgency tests pass.
