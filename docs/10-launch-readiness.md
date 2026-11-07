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
3. **Account controls** (10.2): `feat(web): delete my account, and clean up old data`.
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

- [ ] Settings, General, "Delete my account":
  1. Revoke the GitHub grant (`DELETE /applications/{client_id}/grant`).
  2. Delete all the user's rows.
  3. Destroy their sessions.
- [x] ~~"Export my data" as JSON~~: dropped. See Decisions.
- [ ] Clear old data on a schedule: resolved items after 30 days, notification logs after 30 days, closed PRs after 7 days.

### 10.3 Security review

- [ ] Run through: CSRF origin check on all writes, every query scoped by `userId`, rate limits on auth and sync, `helmet` headers including a Content Security Policy. With `/security-review`, below.
- [x] No tokens in logs: the logger also hides GitHub client errors' request headers and body, and any field named like a token (`token`, `accessToken`, `refresh_token`, …).
- [x] A dependency audit (`pnpm audit --prod --audit-level high`) on each PR and weekly, in its own workflow, so a new advisory never blocks an unrelated PR. It found two: `body-parser` (a denial of service, through Express) and `lodash` (through Prisma Studio). Both updated.
- [x] Dependabot (`.github/dependabot.yml`): monthly grouped updates, and security fixes as they come. App and Mac app updates are `fix(deps)`, so they release.
- [ ] **(You)** Turn on Dependabot alerts and security updates: the repo's Settings, Advanced Security (or Code security).
- [x] Use Supabase Pro's limits (8 GB of database, 250 GB of egress) on the admin page and in health alerts.
- [x] Encryption key rotation: `TOKEN_ENC_KEY_PREVIOUS`. Tokens read with either key, and are written with the new one. `pnpm --filter @pr-peek/server tokens:reencrypt` encrypts them all again with the new key.
- [ ] Run the `/security-review` command on the main branch before launch.

### 10.4 Limits and cost control

- [x] Caps per user: watched repos (50), devices (10), manual refreshes (once per 30 seconds). Done in plans 06 and 08.
- [x] A worker concurrency setting, and a log or metric for "sync queue lag" (how far behind schedule syncs are). If it grows, raise concurrency or upgrade the worker plan. Done in [plan 16](16-efficiency.md), step 16.4: `SYNC_CONCURRENCY`, and `lagging` in the "sync dispatch" log.
- [ ] Sign-up requests, approved by an admin, in place of invite codes or an allow list. See Decisions.
  - A user is pending, approved, or declined. Everyone signed up before this is approved.
  - A pending user sees "Your request is in", with Check again, Sign out, and Withdraw. Every other route answers 403, and the sync skips them.
  - Each new request pushes to the admins.
  - The admin page lists pending requests, with Approve and Decline. Declining or withdrawing deletes the user.

### 10.5 Monitoring

- [ ] Error tracking with Sentry (free tier) on server, worker, and web. Optional but recommended once others use it.
- [ ] Uptime check on `/api/health` (Render's own checks, or a free service like UptimeRobot).
- [x] Simple counters logged per hour: syncs run, sync failures, pushes sent, push failures, active users. Done in [plan 19](19-admin.md): the admin page.

### 10.6 Data safety

- [ ] **Backups before other people sign in.** The project is on Supabase Pro, which has daily backups kept 7 days. **(You)** Check they show under Database, Backups.
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
