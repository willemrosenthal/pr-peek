# 05. Rules and attention items

**Goal:** turn stored PR snapshots into **items**, the rows in your list, for all 7 cases. Items are sorted by urgency, close on their own when no longer relevant, and never duplicate.

**Needs:** plan 04.

## Background

A **rule** is a small, pure function: it takes one PR snapshot plus some context and returns the items that PR should produce. "Pure" means no database or network, which makes rules easy to test and to add later.

Rules live in `packages/core`, so the web app can reuse their names, groups, and defaults for the settings screen.

## Steps

### 5.1 Core types (`packages/core`)

- [ ] `PrSnapshot`: the normalized PR shape from plan 04.
- [ ] `RuleContext`: `viewerLogin`, `now`, the user's settings, `isBot(login)`.
- [ ] `DetectedItem`: `kind`, `dedupeKey`, `latestEventId`, `eventCount`, `actorLogin`, `summary`, `occurredAt`, `waitingSince` (for staleness).
- [ ] `Rule`: `id`, `name`, `group` ("Other PRs" or "My PRs"), `defaultSeverity` (low, normal, high), `defaultChannels` (list, push), `detect(snapshot, ctx) => DetectedItem[]`.
- [ ] `ItemKind` union: `review_requested`, `re_requested`, `reply`, `reviewed`, `commented`, `check_failed`.

### 5.2 One item per PR per kind

To keep the list short, each PR gets at most one item per kind. New events update that item instead of adding rows. For example, three new comments make one "3 new comments" row, not three rows.

- `dedupeKey` decides when it's a **new item**.
- `latestEventId` changing means **something new happened** on an existing item. Plan 08 uses that to decide whether to notify.

| Kind | `dedupeKey` | New item when |
| --- | --- | --- |
| `review_requested` | `rr:<pr>:<requestEventId>` | You're asked for the first time |
| `re_requested` | `rrr:<pr>:<requestEventId>` | You're asked again after you already reviewed |
| `reply` | `reply:<pr>` | Someone replies after your comment |
| `reviewed` | `reviewed:<pr>` | Someone reviews your PR |
| `commented` | `commented:<pr>` | Someone comments on your PR |
| `check_failed` | `check:<pr>:<headSha>` | Checks fail on a new commit |

### 5.3 The built in rules

Each rule ignores events by you, and events by bots when the user turned on "hide bots".

- [ ] **Review requested.** You're in `reviewRequests` (or one of your teams is, if team requests are on). `waitingSince` is the latest `ReviewRequestedEvent` for you or your team. Skip draft PRs unless the user opts in.
- [ ] **Review re-requested.** Same as above, but you've already submitted a review older than that request event. Replaces the plain "review requested" item for that PR.
- [ ] **Reply to my comment.** Either of these:
  - A review thread with a comment by you has a later comment by someone else.
  - A conversation comment after your latest one mentions `@you`.

  The summary is a preview of the latest reply, like `sam-r: "Good call, moved it in 3f2c1a"`.
- [ ] **My PR was reviewed.** You're the author, and there are reviews by others since you last marked the item done. The summary shows the latest state: "jlee approved", "jlee requested changes".
- [ ] **New comment on my PR.** You're the author, and there are conversation or review comments by others since you last marked it done. The summary is a count plus the latest preview.
- [ ] **Check failed on my PR.** You're the author, and the latest commit's rollup is `FAILURE` or `ERROR`. The summary lists failing check names, like "e2e-tests, lint".
- [ ] Register all rules in one `rules` array. Adding a case later means adding one file to that array.

### 5.4 Staleness and urgency (`packages/core`)

- [ ] `waitingFor(waitingSince, now, settings)` returns a duration. When `workHoursOnly` is on, it counts only Monday to Friday, 9 to 6, in the user's timezone. Use `date-fns` with `@date-fns/tz`.
- [ ] `staleLevel(duration, settings)` returns `fresh`, `warn` (orange), or `late` (red).
- [ ] `formatAge(duration)` returns `12m`, `3h`, `2d`.
- [ ] `urgencyScore(item, settings, now)`, higher means more urgent:
  - Severity: high 300, normal 200, low 100.
  - Plus staleness: warn +50, late +100.
  - Plus re-requested +40.
  - Plus unseen +25.
  - Ties broken by newest event.

  Keep the weights in one object so they're easy to tune.
- [ ] Unit tests for all of the above, including work hours across a weekend and a timezone change.

### 5.5 Applying rules on the server

- [ ] After each PR detail fetch in plan 04, run every enabled rule on it.
- [ ] In one transaction:
  - **Upsert** items by `(userId, dedupeKey)`. New ones start `open`. Existing ones keep their status, except that a `done` item whose `latestEventId` changes goes back to `open`.
  - **Resolve** open items for that PR that rules no longer produce (you reviewed, checks passed). Set `status = resolved`.
- [ ] PRs that left the search results (merged, closed): resolve all their items.
- [ ] Snoozed items whose `snoozedUntil` has passed go back to `open`. Handled in the dispatch job.
- [ ] For every item that is new or has a changed `latestEventId`, enqueue a `notify:item` job. Plan 08 handles it. For now it just logs.
- [ ] After changes, publish a "user items changed" message for SSE (plan 06). Postgres `NOTIFY` works for this, since the worker and web service are separate processes.

### 5.6 Rule settings

- [ ] When a user is created, seed `RuleSetting` rows from each rule's defaults.
- [ ] Rules check `RuleSetting.enabled` before running. Severity and channels come from the user's setting, falling back to the rule's defaults.

### 5.7 Tests

- [ ] Snapshot fixtures for each case: plain request, re-request, team request, reply in thread, reply by mention, approval, changes requested, comment by bot (ignored), comment by you (ignored), failing check, check fixed (resolves).
- [ ] An end to end test: fixture snapshot in, then the expected `Item` rows in a test database.

## Done when

- [ ] Your real PRs produce the right items in the database for all 7 cases. Test each by hand on a sandbox repo with a friend or a second GitHub account.
- [ ] Submitting a review resolves the "review requested" item on the next sync.
- [ ] A re-request after your review shows up as `re_requested`.
- [ ] Fixing a failing check resolves the item.
- [ ] All rule and urgency tests pass.
