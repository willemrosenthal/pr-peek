# 16. Efficiency

**Goal:** Git Buddy stays cheap and keeps up as more people use it, on Supabase's free plan for now. Syncs run less often when nobody is looking, take fewer GitHub requests, and stop reading stored PR copies back from the database. You get a push if usage heads for a limit.

**Needs:** nothing new. Plan 10's step 10.4 asks for a worker concurrency setting and a sync lag log. Those move here.

## What we found

Today, every user who opened the app in the last 14 days syncs once a minute, all day and night. The Mac app counts as opening the app all the time: its heartbeat, and its page polling while the dropdown is hidden. So Mac users never slow down. Each sync:

1. Runs 5 GitHub searches, one after another.
2. Fetches full details only for PRs that changed. That part is already efficient: it compares each PR's `updatedAt` and check state to two small columns.
3. **Reads the stored snapshot of every tracked PR back from the database** and runs every rule on it again, even when nothing changed.
4. Reads the snapshots of every quiet PR too, to see if a new push should wake one.
5. Rewrites `lastSeenAt` on every PR the searches found.
6. Updates the user row about 4 times. Prisma sends the whole row back each time, encrypted tokens included.
7. Leaves a finished job row behind. pg-boss keeps those for 7 days: about 10,000 per user per week.

Also, with no users at all, pg-boss checks each of its 7 queues every 2 seconds. That's about 9 million small queries a month, maybe 1 to 2 GB of egress.

Step 3 is the cost. Measured on 4 November 2026: about 21 open PRs per user, and 4.5 KB per snapshot as sent. That's about 95 KB per sync, or around 4.5 GB a month per user out of Supabase. The free plan allows 5 GB of egress (data sent out of the database). Saving and storing snapshots is cheap. Reading them all back every minute is not.

### What a snapshot is

Our trimmed copy of one PR's GitHub data, saved as JSON on the `PullRequest` row: reviewers, reviews, the last 30 review threads with up to 20 comments each, the last 30 comments, assignees, and checks. The rules need this history ("someone replied after **your** comment"), so a few timestamps can't replace it.

But the stored copy is only needed to work out items **without asking GitHub**. A sync that fetches a PR already has a fresh copy in memory. The other uses are rare, and GitHub can answer them when they happen. GitHub calls cost us nothing: each user syncs with their own token and rate limit.

## Expected cost

Estimates. Snapshot sizes are measured (step 16.0). The rest assumes 10 hours of quiet hours a night, and the app opened about 3 times a day. After this plan, the numbers don't depend on snapshot size.

| Per user                    | Syncs a day | GitHub requests a day | Database egress a month |
| --------------------------- | ----------- | --------------------- | ----------------------- |
| Today                       | 1,440       | ~8,600                | ~4.5 GB                 |
| After this plan, phone/web  | ~260        | ~650                  | ~0.14 GB                |
| After this plan, Mac app on | ~460        | ~1,150                | ~0.23 GB                |

- **Free plan:** about 20 to 25 users fit in the 5 GB of egress, depending on how many use the Mac app. Today, about 1 does: 2 users plus pg-boss's polling come to around 10 GB a month.
- **100 users:** about $39 a month ($25 Supabase Pro, $14 Render), well inside Pro's 250 GB. Today, about $57, and the worker couldn't keep up, so syncs and pushes would run late.

## Key decision: no stored snapshots

The rules run on the fresh copies a sync fetches, and nothing else. When the stored items could be out of date, the sync does a **full pass**: it fetches every tracked PR from GitHub again (about 1 request per 10 PRs) and runs the rules on all of them.

No rule reads the clock, so items only change when the PR, the user's settings, their teams, or the rules code change. A full pass runs:

- **After a deploy:** the worker remembers when it started. A user whose last full pass (`User.rulesRunAt`) is older gets one. New or fixed rules reach every PR.
- **After a settings change** that affects the rules (the ones that called `rerunRules`): the setting saves right away, `User.rulesStaleAt` records when, and a sync is queued. A full pass runs when `rulesRunAt` is older than that. Not clearing `rulesRunAt`, as first planned: a full pass already running would set it again when it ends, and the change would wait for the next deploy. Settings shows "Updating your list…" until the list updates through live updates, a few seconds later. If a sync is already running, the next one does the pass, within about 2 minutes.
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
- "Used the app" is `lastActiveAt`. It's saved at most once an hour today, so that becomes every 10 minutes. **Only requests from the app while it has focus count.** The web app adds a header (`X-Pr-Peek-Looking`) while `document.hasFocus()`. Focus, not visibility: the Mac app's page counts as visible while its window is hidden, even before it's first shown. Opening the Mac dropdown counts. Background refetches, the live stream, and the hidden Mac app's polling and heartbeat don't. The heartbeat only sets `desktopSeenAt`, which means the Mac app is running.
- Using the app beats quiet hours. If you open it at night, it's fresh.
- **Sync on open:** when someone comes back to the app (their first request in 10 minutes or more) and their last sync is older than 2 minutes, a sync is queued right away. Not for users who must sign in again, or whose syncs are backing off after failures. The list is fresh within seconds, not after the next scheduled sync.
- **The cost:** a push can arrive up to 2 minutes after the event while you use the app or the Mac app runs, and up to 5 with neither. A high severity push that breaks quiet hours can be up to 15 minutes late. Pull to refresh and "Refresh now" still sync right away.

## Key decision: two searches instead of five

GitHub's `involves:@me` matches PRs the user authored, is assigned to, is mentioned in, or commented on. That's four of our five searches in one. The other is review requests.

- Each sync goes from 5 search requests in a row to 2.
- Measured on 4 November 2026: each search takes about 3 to 4 seconds. `involves:@me` took 3.7 seconds and found exactly the PRs the four searches did, which took 12.7 together. So the searches go from about 16 seconds to about 7.
- Requests stay one at a time per user, as GitHub asks.
- **Not chosen, all 5 searches in one request** (each under its own alias), the first plan: GitHub runs them one after another, and stops any request that runs over 10 seconds. It failed all 3 times we tried (502 and 504, after about 11 seconds). Two searches in one request would sit close to that limit too.

## Key decision: quieter background work

- pg-boss checks `sync-user`, `notify-items`, and `notify-merged` every 10 seconds, and the scheduled queues (dispatch, summary, reminders, heartbeat) every 30. A push may wait up to 10 more seconds. That's fine next to a sync interval of minutes.
- Updates that don't need the row back ask for nothing back. The sync's user updates are merged where they can be.

## Key decision: raise the worker's limits now, and alert on trouble

- **6 syncs at once** (up from 3). A ceiling costs nothing while idle. Each sync holds a few MB, well inside Render Starter's 512 MB.
- **The database pool stays at 5.** Supabase's session pooler, which we connect through, allows 15 connections in all on the free plan (Database settings, Connection pooling, Pool Size: checked, 15). Web 5 + live updates 1 + worker 5 is already 11, and Render briefly runs old and new copies side by side during a deploy. Syncs mostly wait on GitHub, and only hold a connection for short reads and their save, so 6 syncs share 5 connections fine. A save that finds none free waits for one (up to 10 seconds, `ITEMS_TX`).
- **Alerts:** a worker job, once an hour, sends a push to the admin (you) when:
  - the database passes 70% of the free plan's 500 MB,
  - users are 15 minutes or more past their sync interval,
  - or more than a quarter of the users who sync keep failing (3 failed syncs in a row or more).

  Each alert sends at most once a day, and waits out the admin's quiet hours. A small `AdminAlert` table remembers when each last went out, so a restart or deploy doesn't send it again. The admin is set by GitHub login in an env var, `ADMIN_LOGIN`. With it unset, alerts are only logged.

- **Egress can't be read from inside the database.** Check Supabase's Usage page once a week for the first month instead (You).
- **A crashed worker can't alert.** The check runs in the worker. Render emails when a service fails, if its notifications are on (You: Render, Account settings, Notifications).

## PRs

1. This plan.
2. **Sync less** (16.1, 16.2): `perf(server): sync less often when nobody is looking`.
3. **Faster syncs** (16.3, 16.4): `perf(server): two GitHub searches instead of five`.
4. **Alerts** (16.5): `feat(server): alert the admin when usage nears a limit`.
5. **No snapshots** (16.6), in two PRs, since it's big:
   - 5a, the sync: `perf(server): run the rules only on PRs that changed`. The new columns, filled from the snapshots on start. Full passes, teams on the user row, quiet PRs by `lastPushSha`, settings by `rulesStaleAt`. Still writes snapshots, so the list and preview work as before. Has a migration.
   - 5b, the readers. Over 900 lines once built, so three PRs, in order:
     - 5b-1, the preview: `perf(server): get the preview's reviewers and checks from GitHub`.
     - 5b-2, the list: `perf(server): stop storing PR snapshots`. The list reads the new columns, and snapshots stop being written. Needs 5b-1, so nothing reads them once they stop. Has a migration.
     - 5b-3, Settings: `feat(web): show when the list is updating after a settings change`.
6. **Drop the column** (16.7): `chore(server): drop the snapshot column`. Once PR 5b has been live for a release, so a server mid-deploy never reads a missing column. And after [plan 17](completed/17-add-by-link.md) PR 2a is live: its migration has the backfill re-sort merged PRs from their snapshots, once.

PRs 2 to 5b-3 release a patch or minor version and deploy. PR 6 releases nothing by itself, and ships with the next release. Each is about 150 to 300 lines with tests. PR 2 is first: quick, no migration, and most of the savings that don't need PR 5.

## Steps

### 16.0 Measure first (You)

- [x] In the Supabase SQL editor, run this. The editor only shows the last statement's result, so it's one query. `bytes_sent` is what counts for egress: snapshots are stored compressed, but sent in full.
  ```sql
  select
    count(*) as open_prs,
    count(distinct "userId") as users,
    avg(octet_length(snapshot::text))::int as avg_bytes_sent,
    max(octet_length(snapshot::text)) as max_bytes_sent,
    avg(pg_column_size(snapshot))::int as avg_bytes_stored,
    pg_size_pretty(pg_database_size(current_database())) as db_size
  from "PullRequest"
  where state = 'open';
  ```
  4 November 2026: 42 open PRs, 2 users, 4,509 bytes sent on average (32,078 at most), 2,118 stored, 49 MB database.
- [x] Where the 49 MB goes: the biggest tables.
  ```sql
  select n.nspname || '.' || c.relname as "table",
         pg_size_pretty(pg_total_relation_size(c.oid)) as size
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname not in ('pg_catalog', 'information_schema')
  order by pg_total_relation_size(c.oid) desc
  limit 10;
  ```
  4 November 2026: `pgboss.job_common` is 36 MB, finished jobs kept 7 days. The app's own tables are about 1 MB together (`PullRequest` 560 kB, `Item` 168 kB, `NotificationLog` 136 kB). Postgres keeps the space freed by 16.2 for new rows, so the table stops growing rather than shrinking. `VACUUM FULL pgboss.job_common;` gives it back, if ever needed.
- [ ] In Supabase, Usage: note the egress for the last 7 days.
- [ ] In Render, the worker's logs: note a few `ms` values from "sync done" lines.

### 16.1 Sync cadence

- [x] `sync-timing.ts` holds every interval, with the rules written out next to them.
- [x] `syncIntervalMs` takes `lastActiveAt`, `desktopSeenAt`, and the user's quiet hours, and returns the table's intervals. Quiet hours use `isQuiet` from `packages/core`. The Mac app check uses `isDesktopOnline`.
- [x] `dueUserIds` selects the extra fields. Users with no settings row have no quiet hours. Dispatch counts from the start of its minute, not when the worker got to it, and counts a sync up to 45 seconds short of its interval as due (was 15). A sync starts up to 40 seconds after its minute (both polling intervals), so this keeps a 2 minute interval at 2 minutes, never 1 or 3.
- [x] `markActive` saves at most every 10 minutes instead of every hour.
- [x] Activity moves out of `requireUser` into its own middleware, `routes/activity.ts`, mounted once before the other routers. It only counts requests with the looking header. That's simpler than passing a way to queue syncs into every router.
- [x] Sync on open: when `markActive` saves and `lastSyncedAt` is older than the active interval, the middleware queues a sync. The queue already ignores a second sync for the same user.
- [x] Tests for each row of the table: using the app during quiet hours, the Mac app during quiet hours, quiet hours that cross midnight. Requests without the header, like the hidden Mac app's, don't move `lastActiveAt`. The web app sends the header only while it has focus. Opening the app after a while queues a sync.

### 16.2 Quieter background work

- [x] `lastSeenAt` updates only rows where it's older than an hour. It's only checked against 7 days.
- [x] Finished `sync-user`, `sync-dispatch`, and `heartbeat` jobs are deleted after an hour (`deleteAfterSeconds`). `createQueue` does nothing for a queue that already exists, so also call `updateQueue` with the same options. pg-boss refuses an empty update, so queues with no options skip it.
- [x] `boss.work` polling: 10 seconds for `sync-user`, `notify-items`, and `notify-merged`. 30 seconds for the scheduled queues (`pollingIntervalSeconds`).
- [x] User row updates in the sync, `markActive`, and the Mac heartbeat return nothing (`updateMany`). The end of a sync clears `syncStartedAt` in the same update that saves the result.
- [x] Tests: `lastSeenAt` is left alone when recent, and moved when old. The queues are set up right, including ones made before.

### 16.3 Two searches

- [x] Try one request with all 5 searches against GitHub. It timed out, so: `findRelevantPrs` runs review requests, then `involves:@me`, one after another. Paging stays as it was, up to 10 pages per search.
- [x] The test fake answers `involves:@me` with the PRs of the four searches it replaces, each once.
- [x] Tests: two searches, merged by PR. `includeTeamRequests` still picks the right search. Up to 10 pages each.

### 16.4 Worker limits

- [x] `SYNC_CONCURRENCY` comes from config, default 6. Add it to `.env.example`.
- [x] `DB_POOL_MAX` stays at 5 for both services. The plan said 10 for the worker, but the session pooler's limit is 15 connections in all.
- [x] The dispatch log adds `lagging`: the due users more than 2 minutes past their interval. `dueUserIds` becomes `dueUsers`, which says how late each one is.
- [x] Plan 10, step 10.4: its concurrency and sync lag item points here.

### 16.5 Alerts

- [x] Config: `ADMIN_LOGIN`, optional. Add it to `.env.example`.
- [x] An hourly worker job (`health.ts`) checks the database size (`pg_database_size`), how many due users are 15 minutes or more past their interval, and how many of the users who sync keep failing. It logs the numbers every time, as "health". The plan said "the share of failed syncs in the last hour", but we don't keep when a sync failed, so it counts users with 3 failed syncs in a row or more.
- [x] Past a limit, it sends a push to the admin's devices through `deliver`, with what's wrong and the number. Once a day per alert, claimed in a new `AdminAlert` table before sending. Not during the admin's quiet hours: it sends once they end.
- [x] Tests: each limit alerts, quiet below it, once a day, the admin's quiet hours, and nothing sent without `ADMIN_LOGIN`.
- [ ] Set `ADMIN_LOGIN` to your GitHub login in Render's env group (You).

### 16.6 No snapshots

PR 5a, the sync:

- [x] Migration: add `User.rulesRunAt`, `User.rulesStaleAt`, `User.teams String[]`, `User.teamsCheckedAt`, and `PullRequest.lastPushSha`, `listGroup`, `assignedState`.
- [x] Backfill (`backfill.ts`): on start, the worker fills the three new PR columns from the stored snapshot for every row without them. Merged and ended PRs included.
- [x] The sync sets the three new PR columns from each fetched copy.
- [x] A normal sync runs the rules only on the PRs it fetched. A full pass fetches every open PR, runs the rules on all of them, and sets `rulesRunAt`. Full pass when `rulesRunAt` is null, or older than the worker's start or `rulesStaleAt`, or when the teams changed.
- [x] Teams: checked at most once an hour per user, only with team requests on. Kept on the user row, replacing the in-memory cache. Saved only when the sync succeeds, so a failed sync never hides a team change.
- [x] Settings changes: replace `rerunRules` with setting `rulesStaleAt` and queueing a sync.
- [x] Quiet PRs: wake when a fetched own PR's last push differs from `lastPushSha`. Only quiet PRs the sync fetched are read.
- [x] Add `fullPass: boolean` to `SyncResult`, so the "sync done" log shows it.
- [x] Tests: a normal sync fetches and checks only changed PRs, and leaves other items alone. A full pass on the first sync, after a deploy, after a settings change (even one saved during a sync), and after a team change. The backfill fills merged PRs, and skips one it can't read. Quiet PRs wake on a push.

PR 5b-1, the preview:

- [x] Preview: add the author, review requests, and the head commit's failing checks to its GitHub request. `reviewersOf` takes those. Check runs hidden from a fine-grained token are skipped, like in the sync.
- [x] Tests: the preview shows reviewers and failing checks, without a snapshot.

PR 5b-2, the list:

- [x] Migration: `snapshot` becomes optional. The sync stops writing it. Rows keep the snapshot they have until 16.7, so the backfill can still fill them.
- [x] The list reads `listGroup` and `assignedState`, and selects only the fields it shows. `/items` loads the user's settings, rule settings, and repo colors once, not once per part. A row with no `listGroup` goes by its author. Pushes read only the PR fields they show, not the whole row.
- [x] Tests: the list shows the stored section and state, and falls back for unknown ones. `idleGroup` has its own test. The backfill still fills rows that have a snapshot.

PR 5b-3, Settings:

- [x] After a setting that changes what the rules find saves, Settings shows "Updating your list…" until a sync that started after the save ends, or 2 minutes pass. The save's answer has `listUpdatingSince`, the server's time for it. Then the list reloads. Not "until the next items update", as first planned: a change that finds the same items sends no update.
- [x] Tests: the saves return `listUpdatingSince` only for changes the rules use. The notice stays through a sync that started before the save, and ends after one that started after it, or after 2 minutes.

### 16.7 Drop the column

- [x] Once PR 5 has been released, and plan 17 PR 2a (#128), whose migration had the backfill re-sort merged PRs once: a migration drops `PullRequest.snapshot`, and the backfill is removed. Nothing reads `prSnapshot` from the database any more. It only checks the shape of what GitHub sends.

## Done when

- [x] A normal sync with nothing new reads no snapshots and makes two search requests. The sync test "only searches when nothing changed" checks it. You can confirm it live in the "sync done" log (`fullPass: false`, `fetched: 0`).
- [x] A settings change, like hiding bots, shows "Updating your list…", then the list changes within a few seconds. Settings tests check the notice, and the sync tests check the full pass.
- [ ] With the app closed, a new review request pushes within 5 minutes. With the app open or the Mac app running, within 2 (You).
- [ ] Opening the app after an hour away shows a fresh list within seconds (You).
- [ ] Supabase egress drops by at least 10 times, compared to 16.0 (You).
- [ ] The pg-boss job table stays near the number of users times 60 rows (You).
- [ ] A test alert reaches your phone: on a dev server with `ADMIN_LOGIN` set, mark the users as failing (`syncError = 'failed'`, `syncFailures = 3`, `syncRetryAt` a day on), and wait for the top of the hour (You).
