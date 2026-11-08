# 10. Launch readiness

**Goal:** make pr-peek safe and supportable for people other than you. We hold their GitHub tokens, so this matters.

**Needs:** plan 08 (plan 09 if the desktop app is part of the launch). Parts can start any time after plan 03.

Mockups: [Git Buddy Launch Screens](https://claude.ai/artifact/S8wiHXmBHmT9WpXGWqgDgJ): sign in with a landing section, the screen while a request waits, the admin page's sign-up requests, and deleting an account.

## Decisions (7 November 2026)

- **Sign-up requests, approved by an admin.** Anyone can sign in with GitHub. Until an admin approves them, they see "Your request is in", and nothing syncs. Each new request pushes to the admins. The admin page lists requests, with Approve and Decline. Declining deletes what we have. Everyone signed up before this is approved. We don't have people's email, so the waiting screen says to come back later.
- **Backups:** the Supabase project is on Pro, which has daily backups kept 7 days. Nothing to build: check they're there, and test a restore once.
- **Supabase Pro limits:** 8 GB of database and 250 GB of egress a month, not the free plan's 500 MB and 5 GB. The admin page and health alerts use them.
- **Errors go to Sentry,** on its free plan. The privacy page says so.
- **Feedback:** GitHub issues for bugs and ideas, and an email for privacy questions and account problems.
- **No "Export my data".** Almost everything we keep comes from GitHub. The privacy page offers a copy by email instead.
- **What's already done** by later plans: CSRF checks, security headers, rate limits, the repo, device, and refresh caps (10.4), comment bodies aren't stored at all (previews load live from GitHub), and hourly counters with health alerts ([plan 16](16-efficiency.md), [plan 19](19-admin.md)).

## PRs

1. **Limits and security** (10.3, the Pro limits): `feat(server): use Supabase Pro limits, rotate keys, and hide more in logs`.
2. **Sign-up requests** (10.4): `feat(web): sign-up requests, approved from the admin page`. Has a migration.
3. **Account controls** (10.2): `feat(web): delete my account, and clean up old data`. Open.
4. **Privacy and the landing section** (10.1, 10.7): `feat(web): a privacy page, and a landing section on sign in`.
5. **Monitoring** (10.5): `feat(server): Sentry, and an uptime check`. Needs accounts from you.

## Steps

### 10.1 Privacy and trust

- [ ] A plain English `/privacy` page covering:
  - What we store: GitHub profile, encrypted token (from the GitHub sign in, or the personal access token you pasted), PR titles and comment previews for watched repos, push subscriptions.
  - That a pasted personal access token can do anything you can do on GitHub, and how to revoke it.
  - Why we store it.
  - How long we keep it.
  - That we never write to GitHub. (Until plan 11 adds actions. Then say exactly which.)
- [ ] The sign in screen links to it and explains the `repo` scope (plan 03 background).
- [x] Store only short comment previews (first 200 characters), not full bodies. Done another way: comments aren't stored at all. The preview sheet loads them live from GitHub (plan 13).

### 10.2 Account controls

- [x] Settings, General, "Delete my account":
  1. Revoke the GitHub grant (`DELETE /applications/{client_id}/grant`).
  2. Delete all the user's rows.
  3. Destroy their sessions.
  - As built (PR 3): `deleteAccount` in `account.ts`. It refreshes the sign in token if needed, then revokes the grant. If GitHub won't, it still deletes. Sessions on every device go, from the `session` table. The confirm says personal access tokens stay on GitHub, since only the user can delete those.
- [x] ~~"Export my data" as JSON~~: dropped. See Decisions.
- [x] Clear old data on a schedule: resolved items after 30 days, closed PRs after 7 days. Push logs go with their items. Logs of open items stay, since reminders check them so each stage pushes once.
  - As built: `cleanup.ts`, run by the worker's hourly job. "Closed PRs" uses the rule each sync already uses for its own user (`unseenPrs`): no search found it for 7 days and nothing is open, keeping important PRs. This also covers users who stopped syncing.

### 10.3 Security review

- [x] Run through: CSRF origin check on all writes, every query scoped by `userId`, rate limits on auth and sync, `helmet` headers including a Content Security Policy. With `/security-review`, below. As built (8 November), a pass over the whole server, web app, and Mac app:
  - Fine already: the origin check covers every API write. Every route with an id checks it belongs to the user. Sign in checks a random state once and gets a new session id. Cookies are httpOnly, `SameSite=Lax`, and secure in production. Push endpoints must be a browser maker's push service, so the server can't be made to call other URLs. GitHub's HTML in previews goes through an allow list. The live stream only sends the user's own events. The Mac app gives its native commands to the hosted site only, and opens only http(s) links. The web app reads no env vars, so no secrets reach the browser.
  - Fixed: test pushes had no limit, so a loop could get our push key throttled. Now 20 a minute. Adding a repo now counts toward the picker's limit of 60 GitHub asks a minute. Checking, saving, and replacing a token were limited by IP, so a company sharing one IP shared the limit. Now it's per user (30 per 15 minutes).
  - Added: a check for how many proxies Render puts in front of us. Sign in is limited by IP, which only works if the server sees real IPs. `TRUST_PROXY_HOPS` (default 1) sets it, and `GET /api/admin/ip` shows what the server sees. See [security.md](security.md), "Rate limits and IPs".
  - Left as is: the Mac app also gives its commands to `http://localhost:5173`, for development. Only a program already running on the Mac could use that.
- [ ] **(You)** Once it's live, check `GET /api/admin/ip` shows your own IP (steps in [security.md](security.md), "Rate limits and IPs").
- [x] No tokens in logs: the logger also hides GitHub client errors' request headers and body, and any field named like a token (`token`, `accessToken`, `refresh_token`, …).
- [x] A dependency audit (`pnpm audit --prod --audit-level high`) on each PR and weekly, in its own workflow, so a new advisory never blocks an unrelated PR. It found two: `body-parser` (a denial of service, through Express) and `lodash` (through Prisma Studio). Both updated.
- [x] Dependabot (`.github/dependabot.yml`): monthly grouped updates, and security fixes as they come. App and Mac app updates are `fix(deps)`, so they release.
- [ ] **(You)** Turn on Dependabot alerts and security updates: the repo's Settings, Advanced Security (or Code security).
- [x] Use Supabase Pro's limits (8 GB of database, 250 GB of egress) on the admin page and in health alerts.
- [x] Encryption key rotation: `TOKEN_ENC_KEY_PREVIOUS`. Tokens read with either key, and are written with the new one. `pnpm --filter @pr-peek/server tokens:reencrypt` encrypts them all again with the new key.
- [x] Run the `/security-review` command on the main branch before launch. That command only reviews a branch's changes, so the whole-code pass above took its place.
- [x] Move `tauri-apps/tauri-action` from v0 to v1 by hand, with a Mac release of its own, not mixed with other Mac changes. Dependabot skips its majors. v1 renames the update file (`.app.tar.gz`) to include the version, changes the links in `latest.json`, and rewrites an existing release's title and notes. Pass `releaseName` and `releaseBody`, or check ours survive. Then check the release page, and that an installed app updates. Moved here from [plan 09](completed/09-desktop-tauri.md). As built (8 November), from v1's source:
  - Title and notes: v1 only renames a release it finds by `tagName`. We pass `releaseId`, so ours stay. `tagName` is ignored then, so it's gone.
  - Links: `latest.json` now points at GitHub API links (`api.github.com/.../releases/assets/<id>`). Those only send the file when asked for `application/octet-stream`, which Tauri's updater does when it downloads (tauri-plugin-updater 2.14.1). Before publishing, the release now downloads the update from the draft's `latest.json` the same way, for both Mac chips, and checks it's an archive.
  - The renamed `.app.tar.gz` needs nothing: only `latest.json` names it. Both Mac chips still get their entries for a universal build.
  - A change to `desktop-release.yml` now builds the Mac app on release too, so this ships as its own Mac release.
- [ ] **(You)** After the release: check the Mac release page keeps its title and notes, and that an installed app updates to it.

### 10.4 Limits and cost control

- [x] Caps per user: watched repos (50), devices (10), manual refreshes (once per 30 seconds). Done in plans 06 and 08.
- [x] A worker concurrency setting, and a log or metric for "sync queue lag" (how far behind schedule syncs are). If it grows, raise concurrency or upgrade the worker plan. Done in [plan 16](16-efficiency.md), step 16.4: `SYNC_CONCURRENCY`, and `lagging` in the "sync dispatch" log.
- [x] Sign-up requests, approved by an admin, in place of invite codes or an allow list. See Decisions.
  - [x] A user is waiting or approved: `User.approvedAt`, empty while waiting. Declining deletes the user, so "declined" is never stored. Everyone signed up before this is approved.
  - [x] A waiting user sees "Your request is in", with Check again, Sign out, and Withdraw. Every other route answers 403 (code `pending`), and opening the app doesn't sync them.
  - [x] Each new request pushes to the admins who aren't in quiet hours.
  - [x] The admin page lists waiting requests, with Approve and Decline. Declining or withdrawing deletes the user.
  - [x] Declining and withdrawing delete our data, but don't revoke the GitHub grant yet. PR 3's "Delete my account" adds that, for all three. Done: all three use `deleteAccount`.

### 10.5 Monitoring

- [ ] Error tracking with Sentry (free tier) on server, worker, and web. Optional but recommended once others use it.
- [ ] Uptime check on `/api/health` (Render's own checks, or a free service like UptimeRobot).
- [x] Simple counters logged per hour: syncs run, sync failures, pushes sent, push failures, active users. Done in [plan 19](19-admin.md): the admin page.

### 10.6 Data safety

- [x] **Backups before other people sign in.** The project is on Supabase Pro, which has daily backups kept 7 days. **(You)** Check they show under Database, Backups. Checked on 7 November 2026.
- [ ] **(You)** Test restoring a backup into a fresh database once.
- [ ] Prisma migrations only add or change in ways that work with the version currently running. Render runs migrations before swapping versions, so for a short time the old code runs against the new schema.

### 10.7 Polish for new users

- [x] A custom domain on Render, with HTTPS (automatic). Done early: `www.git-buddy.com`, bought at Porkbun. `git-buddy.com` redirects to it.
- [ ] A short landing section on `/signin`: what it does, a screenshot, install buttons.
- [ ] Friendly states for: no repos yet, nothing needs you, GitHub is down, sync error.
- [ ] A feedback link: GitHub issues for bugs and ideas, and an email for privacy questions.

## Done when

- [ ] A friend can sign up from the landing page, install on their phone, get pushes, and delete their account, without your help.
- [ ] Sentry and the uptime check alert you when something breaks.
- [ ] The security review checklist is done and findings are fixed.
