# 19. Admin page

**Goal:** an admin page that shows how Git Buddy is running and what it costs. Database egress per day and per month, the busiest queries, worker load, GitHub requests, and people and pushes. Each reading says whether it's fine.

**Needs:** nothing. Covers plan 16's last checks (egress, the job table, a test alert).

Mockup: [Git Buddy Admin](https://claude.ai/artifact/3GL8qsGnFvXdf6D3Yet4EX).

## Cost rules

The page exists to keep traffic down, so watching must not add to it. Every part follows these rules:

- **Count in memory, write once an hour.** Each process (web and worker) adds up its numbers in memory and saves them with one `INSERT` an hour, and when it shuts down. No reads, and the insert returns nothing. A crash loses at most an hour of counts.
- **No new jobs, no polling.** Saving rides on a timer in each process. Cleaning up old rows rides on the hourly health check that runs already.
- **Read only when the page opens.** The page asks the server once when it opens. No live updates, no refresh on focus, and React Query keeps the answer for 5 minutes. Its route is rate limited.
- **Small answers.** Every read groups and limits in SQL, so the page gets tens of rows, not thousands: 30 days of totals, the top 8 queries, the top 8 kinds of read.
- **Few rows kept.** Most counts are per day. Only jobs per hour are kept per hour. About 150 rows a day in all, kept 90 days: a few MB.

## Key decisions

### Who is an admin

A `role` column on `User`, `user` or `admin`, default `user`. You set yours to `admin` in Supabase by hand. Admin alerts go to every admin, so `ADMIN_LOGIN` goes away.

### Egress, counted exactly

Prisma, the session store, and pg-boss share one `pg` pool. When the pool opens a connection, we wrap its `query`. After each query, the bytes its socket received since the last count go to that query's kind of read, like "PullRequest select" or "pgboss.job select". That's the real number of bytes Postgres sent, not a guess from the rows, and it costs one subtraction per query. Bytes from opening a connection count as "connect".

Supabase has no API for egress, so this is the only way to see it in the app. It should land close to Supabase's own count. We compare the two once.

### What else is counted

- **GitHub requests**, from a hook on the GitHub client: requests, the lowest budget left (`x-ratelimit-remaining`), and rate limited answers.
- **Worker jobs**, per queue: how many, total and slowest time, and failures. Plus jobs per hour, for the chart. pg-boss can't give this: it deletes finished jobs of frequent queues after an hour.

### Read live, when the page opens

- Database size, job table rows, late and failing syncs: the same small queries the health check runs.
- The busiest queries, from Postgres's own query stats (`pg_stat_statements`, on by default in Supabase). Top 8, query text cut to 160 characters. If our role can't read them, the page says so.
- Users, and pushes per day, from `User` and `NotificationLog`, grouped in SQL.

### Not in this plan

- Supabase's own egress number. Its usage page has it, and the page links there.

## PRs

1. **Counting** (19.1, 19.2): `feat(server): an admin role, and hourly usage counts`. Has a migration. Counting starts as soon as it's live, so the page has history when it lands.
2. **The page** (19.3, 19.4): `feat(web): an admin page`.

Both release a minor version and deploy.

## Steps

### 19.1 The admin role

- [x] Migration: a `Role` enum (`user`, `admin`), `User.role` defaulting to `user`.
- [x] Health alerts go to every admin, each outside their own quiet hours. Each alert is still claimed once a day, before sending.
- [x] Remove `ADMIN_LOGIN` from the config and `.env.example`.
- [x] Tests: alerts reach each admin, skip an admin in quiet hours, and nothing sends with no admins.
- [ ] **(You)** Once it's live, in Supabase: `UPDATE "User" SET role = 'admin' WHERE login = 'willemrosenthal';`. Until then, alerts are only logged. Then remove `ADMIN_LOGIN` from Render.

### 19.2 Counting

- [x] Migration: a `UsageStat` table: `bucket` (the day or hour), `source` (`web` or `worker`), `metric`, `key`, `count`, `total`, `low`, `high`.
- [x] `usage.ts`: adds up counts in memory, and saves them in one `INSERT … ON CONFLICT` that adds to the row. `low` keeps the lowest and `high` the highest. At most 200 rows waiting, the rest as "other". A day uses about 70 per process, and the hour after midnight holds two days. Saves every hour and on shutdown.
- [x] The pool counts bytes per query as above, in both processes. So does the web service's LISTEN connection, which is outside the pool: its messages count as "notify".
- [x] The GitHub client counts requests, the budget, and rate limits.
- [x] The worker counts each job: per queue per day, and all jobs per hour.
- [x] The hourly health check deletes rows older than 90 days.
- [x] Tests: adding and saving, a second save adding to the first, `low` and `high`, the key cap, real queries counted with their bytes and kind, GitHub counts, job counts and failures, and the cleanup. The 429 case checks the rule alone: Octokit's throttling holds a 429 for its whole wait, so a real request would stall the test.

### 19.3 The admin API

- [ ] `GET /api/admin/overview`: everything the page shows, in one answer. Admins only, rate limited.
- [ ] `POST /api/admin/test-alert`: a test push to the admin's devices.
- [ ] `isAdmin` in `/api/me`.
- [ ] Tests: each part of the answer, admins only, and its size stays small.

### 19.4 The page

- [ ] `/admin`, linked from Settings for admins. The mockup's sections. Small hand-made charts, no chart library.
- [ ] Fetched once on open: 5 minutes fresh, no refetch on focus.
- [ ] Tests: each section, a non-admin sees nothing, and the test alert button.

## Done when

- [ ] The admin page shows each section with real numbers (You).
- [ ] Its egress for a day is within about 20% of Supabase's for that day (You).
- [ ] Opening the page makes one request, and its answer is under 50 KB.
- [ ] A day of counting adds about 150 rows to `UsageStat`.
- [ ] The test alert reaches your phone (You).
