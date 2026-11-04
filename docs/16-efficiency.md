# 16. Efficiency

**Goal:** Git Buddy stays cheap and keeps up as more people use it, on Supabase's free plan for now. Syncs run less often when nobody is looking, take fewer GitHub requests, and stop reading stored PR copies back from the database. You get a push if usage heads for a limit.

**Needs:** nothing new. Plan 10's step 10.4 asks for a worker concurrency setting and a sync lag log. Those move here.

## What we found

Today, every user who opened the app in the last 14 days syncs once a minute, all day and night. The Mac app's heartbeat counts as opening the app, so Mac users never slow down. Each sync:

1. Runs 5 GitHub searches, one after another.
2. Fetches full details only for PRs that changed. That part is already efficient: it compares each PR's `updatedAt` and check state to two small columns.
3. **Reads the stored snapshot of every tracked PR back from the database** and runs every rule on it again, even when nothing changed.
4. Reads the snapshots of every quiet PR too, to see if a new push should wake one.
5. Rewrites `lastSeenAt` on every PR the searches found.
6. Updates the user row about 4 times. Prisma sends the whole row back each time, encrypted tokens included.
7. Leaves a finished job row behind. pg-boss keeps those for 7 days: about 10,000 per user per week.

Also, with no users at all, pg-boss checks each of its 7 queues every 2 seconds. That's about 9 million small queries a month, maybe 1 to 2 GB of egress.

Step 3 is the cost. A user with 30 PRs can pull around 15 GB a month out of Supabase. The free plan allows 5 GB of egress (data sent out of the database). Saving and storing snapshots is cheap. Reading them all back every minute is not.

### What a snapshot is

Our trimmed copy of one PR's GitHub data, saved as JSON on the `PullRequest` row: reviewers, reviews, the last 30 review threads with up to 20 comments each, the last 30 comments, assignees, and checks. The rules need this history ("someone replied after **your** comment"), so a few timestamps can't replace it.

But the stored copy is only needed to work out items **without asking GitHub**. A sync that fetches a PR already has a fresh copy in memory. The other uses are rare, and GitHub can answer them when they happen. GitHub calls cost us nothing: each user syncs with their own token and rate limit.

## Expected cost

Estimates. They assume 30 PRs per user, 10 hours of quiet hours a night, and the app opened about 3 times a day. Step 16.0 measures the real numbers.

| Per user                    | Syncs a day | GitHub requests a day | Database egress a month |
| --------------------------- | ----------- | --------------------- | ----------------------- |
| Today                       | 1,440       | ~8,600                | ~15 GB                  |
| After this plan, phone/web  | ~260        | ~370                  | ~0.14 GB                |
| After this plan, Mac app on | ~460        | ~650                  | ~0.23 GB                |

- **Free plan:** about 20 to 25 users fit in the 5 GB of egress, depending on how many use the Mac app. Today, few or none do.
- **100 users:** about $39 a month ($25 Supabase Pro, $14 Render), well inside Pro's 250 GB. Today, about $150, and the worker couldn't keep up.

## Key decision: no stored snapshots

The rules run on the fresh copies a sync fetches, and nothing else. When the stored items could be out of date, the sync does a **full pass**: it fetches every tracked PR from GitHub again (about 1 request per 10 PRs) and runs the rules on all of them.

No rule reads the clock, so items only change when the PR, the user's settings, their teams, or the rules code change. A full pass runs:

- **After a deploy:** the worker remembers when it started. A user whose last full pass (`User.rulesRunAt`) is older gets one. New or fixed rules reach every PR.
- **After a settings change** that affects the rules (the ones that call `rerunRules` today): the setting saves right away, `rulesRunAt` is cleared, and a sync is queued. Settings shows "Updating your list…" until the list updates through live updates, a few seconds later. If a sync is already running, the next one does the pass, within about 2 minutes.
- **When the user's teams change:** the sync checks teams at most once an hour (one small request) and keeps them on the user's row. A full pass runs only if they're different.

**No hourly pass.** A pass over the same data can't find anything new. A bug that saved wrong items is fixed by a deploy, and the deploy runs a full pass.

The other uses of the snapshot move:

| Use                                     | Moves to                                                      |
| --------------------------------------- | ------------------------------------------------------------- |
| Preview: reviewers and failing checks   | The preview's own GitHub request, which already reads reviews |
| Quiet PRs wake on a new push            | A `lastPushSha` column                                        |
| The list's section for idle PRs         | A `listGroup` column                                          |
| An assigned PR's "Ready to merge" state | An `assignedState` column                                     |

The new columns are filled from the existing snapshots when PR 5 deploys. That covers rows no sync fetches again, like merged PRs marked important.

Rows keep their short preview of the latest comment (`alice: "looks good but..."`), stored on the item as today.

**Not chosen, keep snapshots and only read them on a full pass:** about as cheap, with instant settings changes. But storing less of your coworkers' review text matters at a company, and the data model ends up simpler.

## Key decision: sync as often as someone is looking

| The user                         | Syncs every |
| -------------------------------- | ----------- |
| Used the app in the last hour    | 2 minutes   |
| In their quiet hours             | 15 minutes  |
| Has the Mac app running          | 2 minutes   |
| Hasn't opened the app in 14 days | 30 minutes  |
| None of these                    | 5 minutes   |

The first row that matches wins. **All the numbers live in one file, `apps/server/src/sync-timing.ts`,** so they're easy to change later.

- **It's per account, not per device.** One sync serves all of a user's devices: phone, Mac, and browser. Using the app on any of them counts, and a second device never adds syncs. The fastest row any device earns wins.
- "Used the app" is `lastActiveAt`. It's saved at most once an hour today, so that becomes every 10 minutes. Opening the Mac dropdown counts. **The Mac heartbeat doesn't:** it only sets `desktopSeenAt`, which means the Mac app is running.
- Using the app beats quiet hours. If you open it at night, it's fresh.
- **Sync on open:** when someone comes back to the app (their first request in 10 minutes or more) and their last sync is older than 2 minutes, a sync is queued right away. Not for users who must sign in again, or whose syncs are backing off after failures. The list is fresh within seconds, not after the next scheduled sync.
- **The cost:** a push can arrive up to 2 minutes after the event while you use the app or the Mac app runs, and up to 5 with neither. A high severity push that breaks quiet hours can be up to 15 minutes late. Pull to refresh and "Refresh now" still sync right away.

## Key decision: one GitHub request for all 5 searches

GraphQL lets one request run several searches, each under its own alias. The first page of all 5 comes back in one round trip. Only a search with more than 100 results asks for more pages.

- Most syncs go from 5 requests in a row to 1.
- About the same GitHub points.
- Requests stay one at a time per user, as GitHub asks.

## Key decision: quieter background work

- pg-boss checks `sync-user`, `notify-items`, and `notify-merged` every 10 seconds, and the scheduled queues (dispatch, summary, reminders, heartbeat) every 30. A push may wait up to 10 more seconds. That's fine next to a sync interval of minutes.
- Updates that don't need the row back ask for nothing back. The sync's user updates are merged where they can be.

## Key decision: raise the worker's limits now, and alert on trouble

- **6 syncs at once** (up from 3), and a worker database pool of **10** (up from 5). A ceiling costs nothing while idle. Each sync holds a few MB, well inside Render Starter's 512 MB. 10 + 5 (web) + 1 (live updates) connections is well under Supabase's free limit.
- **Alerts:** a worker job, once an hour, sends a push to the admin (you) when:
  - the database passes 70% of the free plan's 500 MB,
  - users are 15 minutes or more past their sync interval,
  - or more than a quarter of syncs failed in the last hour.

  Each alert sends at most once a day. The admin is set by GitHub login in an env var, `ADMIN_LOGIN`. With it unset, alerts are only logged.

- **Egress can't be read from inside the database.** Check Supabase's Usage page once a week for the first month instead (You).

## PRs

1. This plan.
2. **Sync less** (16.1, 16.2): `perf(server): sync less often when nobody is looking`.
3. **Faster syncs** (16.3, 16.4): `perf(server): one GitHub request for all searches`.
4. **Alerts** (16.5): `feat(server): alert the admin when usage nears a limit`.
5. **No snapshots** (16.6): `perf(server): stop storing PR snapshots`. Has a migration.
6. **Drop the column** (16.7): `chore(server): drop the snapshot column`. Once PR 5 has been live for a release, so a server mid-deploy never reads a missing column.

PRs 2 to 5 release a patch or minor version and deploy. PR 6 releases nothing by itself, and ships with the next release. Each is about 150 to 300 lines with tests. PR 2 is first: quick, no migration, and most of the savings that don't need PR 5.

## Steps

### 16.0 Measure first (You)

- [ ] In the Supabase SQL editor, run this and note the numbers:
  ```sql
  select count(*), avg(pg_column_size(snapshot)), max(pg_column_size(snapshot))
  from "PullRequest" where state = 'open';
  select pg_size_pretty(pg_database_size(current_database()));
  ```
- [ ] In Supabase, Usage: note the egress for the last 7 days.
- [ ] In Render, the worker's logs: note a few `ms` values from "sync done" lines.

### 16.1 Sync cadence

- [x] `sync-timing.ts` holds every interval, with the rules written out next to them.
- [x] `syncIntervalMs` takes `lastActiveAt`, `desktopSeenAt`, and the user's quiet hours, and returns the table's intervals. Quiet hours use `isQuiet` from `packages/core`. The Mac app check uses `isDesktopOnline`.
- [x] `dueUserIds` selects the extra fields. Users with no settings row have no quiet hours. Dispatch counts a sync up to 45 seconds short of its interval as due (was 15), since the dispatch job can now start up to 30 seconds late.
- [x] `markActive` saves at most every 10 minutes instead of every hour.
- [x] Activity moves out of `requireUser` into its own middleware, `routes/activity.ts`, mounted once before the other routers. It skips the Mac heartbeat. That's simpler than passing a way to queue syncs into every router.
- [x] Sync on open: when `markActive` saves and `lastSyncedAt` is older than the active interval, the middleware queues a sync. The queue already ignores a second sync for the same user.
- [x] Tests for each row of the table: using the app during quiet hours, the Mac app during quiet hours, quiet hours that cross midnight. The heartbeat doesn't move `lastActiveAt`. Opening the app after a while queues a sync.

### 16.2 Quieter background work

- [x] `lastSeenAt` updates only rows where it's older than an hour. It's only checked against 7 days.
- [x] Finished `sync-user`, `sync-dispatch`, and `heartbeat` jobs are deleted after an hour (`deleteAfterSeconds`). `createQueue` does nothing for a queue that already exists, so also call `updateQueue` with the same options. pg-boss refuses an empty update, so queues with no options skip it.
- [x] `boss.work` polling: 10 seconds for `sync-user`, `notify-items`, and `notify-merged`. 30 seconds for the scheduled queues (`pollingIntervalSeconds`).
- [x] User row updates in the sync, `markActive`, and the Mac heartbeat return nothing (`updateMany`). The end of a sync clears `syncStartedAt` in the same update that saves the result.
- [x] Tests: `lastSeenAt` is left alone when recent, and moved when old. The queues are set up right, including ones made before.

### 16.3 One search request

- [ ] `findRelevantPrs` sends one query with the 5 searches as aliases (`review`, `authored`, `commented`, `mentioned`, `assigned`), 100 results each.
- [ ] Any search with `hasNextPage` keeps paging on its own with today's query, up to 10 pages.
- [ ] Tests: one request when every search fits in a page. Paging for the one that doesn't. `includeTeamRequests` still picks the right search.

### 16.4 Worker limits

- [ ] `SYNC_CONCURRENCY` comes from config, default 6. Add it to `.env.example`.
- [ ] `render.yaml`: the worker sets `DB_POOL_MAX` to 10. The web service keeps 5.
- [ ] The dispatch log adds `lagging`: the due users more than 2 minutes past their interval.
- [ ] Plan 10, step 10.4: its concurrency and sync lag item points here.

### 16.5 Alerts

- [ ] Config: `ADMIN_LOGIN`, optional. Add it to `.env.example`.
- [ ] An hourly worker job checks the database size (`pg_database_size`), how many due users are 15 minutes or more past their interval, and the share of failed syncs in the last hour (`syncError = 'failed'` against users synced). It logs the numbers every time.
- [ ] Past a limit, it sends a push to the admin's devices through `deliver`, with what's wrong and the number. Once a day per alert.
- [ ] Tests: each limit alerts, quiet below it, once a day, and nothing sent without `ADMIN_LOGIN`.
- [ ] Set `ADMIN_LOGIN` to your GitHub login in Render's env group (You).

### 16.6 No snapshots

- [ ] Migration: `snapshot` becomes optional. Add `User.rulesRunAt`, `User.teams String[]`, `User.teamsCheckedAt`, and `PullRequest.lastPushSha`, `listGroup`, `assignedState`.
- [ ] Backfill: on start, the worker fills the three new PR columns from the stored snapshot for every row that has one and doesn't have them yet. Merged and ended PRs included.
- [ ] The sync stops writing `snapshot`, and sets the three new PR columns from each fetched copy.
- [ ] A normal sync runs the rules only on the PRs it fetched. A full pass fetches every tracked PR, runs the rules on all of them, and sets `rulesRunAt`. Full pass when `rulesRunAt` is null or older than the worker's start time, or when the teams changed.
- [ ] Teams: fetched at most once an hour per user, only with team requests on. Kept on the user row, replacing the in-memory cache.
- [ ] Settings changes: replace `rerunRules` with clearing `rulesRunAt` and queueing a sync.
- [ ] Web: after a rule setting saves, Settings shows "Updating your list…" until the next items update arrives, or 2 minutes pass.
- [ ] Quiet PRs: wake when a fetched own PR's last push differs from `lastPushSha`.
- [ ] Preview: add review requests and the head commit's failing checks to its GitHub request. `reviewersOf` takes those.
- [ ] The list reads `listGroup` and `assignedState`, and selects only the fields it shows. `/items` loads the user's settings, rule settings, and repo colors once, not once per part.
- [ ] Add `fullPass: boolean` to `SyncResult`, so the "sync done" log shows it.
- [ ] Tests: a normal sync fetches and checks only changed PRs, and leaves other items alone. A full pass after the start time moves, after a settings change, and after a team change. The backfill fills merged PRs. Quiet PRs wake on a push. The preview shows reviewers and failing checks. The list is the same as before.

### 16.7 Drop the column

- [ ] Once PR 5 has been released: a migration drops `PullRequest.snapshot`, the backfill is removed, and `prSnapshot` stops being read from the database anywhere.

## Done when

- [ ] A normal sync with nothing new reads no snapshots and makes one search request. Check with the "sync done" log (`fullPass: false`, `fetched: 0`).
- [ ] A settings change, like hiding bots, shows "Updating your list…", then the list changes within a few seconds.
- [ ] With the app closed, a new review request pushes within 5 minutes. With the app open or the Mac app running, within 2 (You).
- [ ] Opening the app after an hour away shows a fresh list within seconds (You).
- [ ] Supabase egress drops by at least 20 times, compared to 16.0 (You).
- [ ] The pg-boss job table stays near the number of users times 60 rows (You).
- [ ] A test alert reaches your phone: set a limit low on a dev server and run the check (You).
