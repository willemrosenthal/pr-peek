# 16. Efficiency

**Goal:** Git Buddy stays cheap and keeps up as more people use it. The server reads far less from the database on each sync, syncs less often when nobody is looking, and handles more users with the same worker.

**Needs:** nothing new. Plan 10's step 10.4 asks for a worker concurrency setting and a sync lag log. Those move here.

## What we found

Today, every user who opened the app in the last 14 days syncs once a minute, all day and night. Each sync:

1. Runs 5 GitHub searches, one after another.
2. Fetches full details only for PRs that changed. That part is already efficient.
3. **Reads the stored snapshot of every tracked PR back from the database** and runs every rule on it again, even when nothing changed.
4. Reads the snapshots of every quiet PR too, to see if a new push should wake one.
5. Rewrites `lastSeenAt` on every PR the searches found.
6. Leaves a finished job row behind. pg-boss keeps those for 7 days: about 10,000 per user per week.

Steps 3 and 4 are the big ones. A snapshot can be a few KB to over 100 KB, so a user with 30 PRs can pull around 13 GB a month out of Supabase. Supabase's free plan allows 5 GB of egress (data sent out of the database), and the paid plan charges for it past 250 GB.

The web app reads snapshots too: `/items` loads full PR rows for idle and merged PRs, and the snapshots of assigned PRs, each time a list loads.

### What a snapshot is, and why we keep it

A snapshot is our trimmed copy of one PR's GitHub data, saved as JSON on the `PullRequest` row: reviewers and review requests, reviews, the last 30 review threads with up to 20 comments each, the last 30 comments, assignees, and checks. Comments are cut to 200 characters. It's not a full copy of the PR, but it holds the conversation history the rules need.

We keep it because:

- **The rules need history,** not just the current state. "Someone replied to you" means finding your comment in a thread and a newer one after it.
- **Settings changes run the rules again without GitHub** (`rerunRules`). Turning a rule off or hiding bots updates the list right away.
- **The preview** shows reviewers and failing checks from it, and **quiet PRs** compare the old and new snapshot to wake on a new push.

Fetching from GitHub each time instead would cost API points and make every list slower. So the snapshot stays. The fix is to stop reading it when nothing changed.

**No rule reads the clock.** `RuleContext` has a `now`, but no rule uses it. Staleness is worked out when the list is read, not by the rules. So the rules give the same items for an unchanged snapshot, unless the user's settings, their teams, or the rules code changed.

## Key decision: run the rules only on PRs that changed

A normal sync runs the rules only on the PRs it just fetched. `saveItems` already only resolves items of the PRs it's given, so passing fewer is safe.

A **full pass** over every tracked PR still runs when the rules could give a different answer:

- **After a deploy:** the worker remembers when it started. A user whose last full pass is older than that gets one. A new or fixed rule reaches every PR this way.
- **Once an hour:** this picks up team changes (the teams cache already lasts an hour) and heals anything that went wrong.
- **Settings changes** already run `rerunRules`. No change there.

A new column, `User.rulesRunAt`, records the last full pass.

**Not chosen, shrinking the snapshot:** once it's only read when a PR changes, its size barely matters. Trimming it would risk breaking rules for little gain.

## Key decision: sync as often as someone is looking

| The user                                           | Syncs every |
| -------------------------------------------------- | ----------- |
| Used the app in the last hour, or the Mac app runs | 1 minute    |
| Neither                                            | 5 minutes   |
| In their quiet hours                               | 15 minutes  |
| Hasn't opened the app in 14 days                   | 30 minutes  |

- "Used the app" is `lastActiveAt`. It's saved at most once an hour today, so that becomes every 10 minutes.
- The Mac app counts as looking, since its menu bar count is always on screen. Its heartbeat already sets `desktopSeenAt`.
- **The cost:** with the app closed, a push can arrive up to 5 minutes after the event, not 1. Pull to refresh and "Refresh now" still sync right away.
- Quiet hours hold most pushes anyway. A high severity push that breaks quiet hours can be up to 15 minutes late.

## Key decision: one GitHub request for all 5 searches

GraphQL lets one request run several searches, each under its own alias. The first page of all 5 comes back in one round trip. Only a search with more than 100 results asks for more pages, one at a time.

- Most syncs go from 5 requests in a row to 1, so each takes far less time and the worker keeps up with more users.
- It costs about the same GitHub points.
- Requests stay one at a time per user, as GitHub asks.

## Key decision: the list doesn't read snapshots

When a sync saves a PR, it also saves two small columns worked out from the snapshot:

- `listGroup`: the section a PR with no items shows in (what `prGroup` works out today).
- `assignedState`: what an assigned PR needs next, like "Ready to merge".

`/items` then reads only the columns it shows. The preview still reads the snapshot, since it opens one PR at a time.

## PRs

1. This plan.
2. **Sync reads less** (16.1 and 16.2): `perf(server): read less from the database on each sync`. Releases a patch.
3. **Sync less often** (16.3): `perf(server): sync less often when nobody is looking`. Releases a patch.
4. **Faster syncs** (16.4 and 16.5): `perf(server): one GitHub request for all searches`. Releases a patch.
5. **Lighter list** (16.6): `perf(server): load the list without snapshots`. Has a migration. Releases a patch.

Each is about 150 to 250 lines with tests. PR 2 saves the most, so it goes first.

## Steps

### 16.0 Measure first (You)

- [ ] In the Supabase SQL editor, run this and note the numbers:
  ```sql
  select count(*), avg(pg_column_size(snapshot)), max(pg_column_size(snapshot))
  from "PullRequest" where state = 'open';
  ```
- [ ] In Supabase, Reports: note the egress for the last 7 days.
- [ ] In Render, the worker's logs: note a few `ms` values from "sync done" lines.

### 16.1 Rules only on changed PRs

- [ ] Add `User.rulesRunAt DateTime?`, with a migration.
- [ ] The worker records its start time. `syncUser` takes it as `rulesChangedAt`.
- [ ] `syncUser` runs a full pass (today's behavior) when `rulesRunAt` is null, older than `rulesChangedAt`, or older than an hour. It then sets `rulesRunAt`. Otherwise it runs the rules only on `details.snapshots`, and doesn't call `trackedPrs`.
- [ ] `quietPrs` takes the fetched PR ids and reads only those quiet PRs. Only a fetched PR can wake on a push.
- [ ] Add `fullPass: boolean` to `SyncResult`, so the "sync done" log shows it.
- [ ] Tests: an unchanged PR's snapshot isn't read on a normal sync. A full pass runs after the start time moves, and after an hour. An item on an unchanged PR stays open, and isn't resolved.

### 16.2 Fewer writes and job rows

- [ ] `lastSeenAt` updates only rows where it's older than an hour. It's only checked against 7 days.
- [ ] Finished `sync-user`, `sync-dispatch`, and `heartbeat` jobs are deleted after an hour (`deleteAfterSeconds`). `createQueue` does nothing for a queue that already exists, so also call `updateQueue` with the same options.
- [ ] Tests: `lastSeenAt` is left alone when recent, and moved when old.

### 16.3 Sync cadence

- [ ] `syncInterval` takes `lastActiveAt`, `desktopSeenAt`, and the user's quiet hours, and returns the table's intervals. Quiet hours use `isQuiet` from `packages/core`.
- [ ] `dueUserIds` selects the extra fields. Users with no settings row keep the 1 and 5 minute intervals.
- [ ] `markActive` saves at most every 10 minutes instead of every hour.
- [ ] Tests for each row of the table, and quiet hours that cross midnight.

### 16.4 One search request

- [ ] `findRelevantPrs` sends one query with the 5 searches as aliases (`review`, `authored`, `commented`, `mentioned`, `assigned`), 100 results each.
- [ ] Any search with `hasNextPage` keeps paging on its own with today's query, up to 10 pages.
- [ ] Tests: one request when every search fits in a page. Paging for the one that doesn't. `includeTeamRequests` still picks the right search.

### 16.5 Worker settings

- [ ] `SYNC_CONCURRENCY` comes from config, default 6. Raise `DB_POOL_MAX`'s default for the worker to 10. Add both to `.env.example`.
- [ ] The dispatch log adds `lagging`: the users more than 2 minutes past their interval. If it stays above 0, raise the concurrency.
- [ ] Plan 10, step 10.4: its concurrency and sync lag item points here.
- [ ] Set `SYNC_CONCURRENCY` and `DB_POOL_MAX` in Render's worker settings, if the defaults don't fit (You).

### 16.6 The list without snapshots

- [ ] Add `PullRequest.listGroup` and `PullRequest.assignedState`, both nullable, with a migration.
- [ ] The sync sets both on each PR it saves. A full pass fills them for older rows.
- [ ] `idlePrs` and `mergedPrs` select only the fields they show, and read `listGroup`. `openItems` reads `assignedState`. Both fall back to today's code when the column is null.
- [ ] `/items` loads the user's settings, rule settings, and repo colors once, not once per part of the list.
- [ ] Tests: the list is the same as before, with and without the new columns set.

## Done when

- [ ] A normal sync with nothing new reads no snapshots. Check with the "sync done" log (`fullPass: false`, `fetched: 0`).
- [ ] Supabase egress drops by at least 5 times, compared to 16.0's numbers (You).
- [ ] With the app closed, a new review request pushes within 5 minutes. With it open, within a minute (You).
- [ ] Most syncs make one search request. Sync times in the logs drop, compared to 16.0 (You).
- [ ] The job table stays small: the pg-boss job table stays near the number of users times 60 (You).
