# 10. Launch readiness

**Goal:** make pr-peek safe and supportable for people other than you. We hold their GitHub tokens, so this matters.

**Needs:** plan 08 (plan 09 if the desktop app is part of the launch). Parts can start any time after plan 03.

## Steps

### 10.1 Privacy and trust

- [ ] A plain English `/privacy` page covering:
  - What we store: GitHub profile, encrypted token, PR titles and comment previews for watched repos, push subscriptions.
  - Why we store it.
  - How long we keep it.
  - That we never write to GitHub. (Until plan 11 adds actions. Then say exactly which.)
- [ ] The sign in screen links to it and explains the `repo` scope (plan 03 background).
- [ ] Store only short comment previews (first 200 characters), not full bodies.

### 10.2 Account controls

- [ ] Settings, General, "Delete my account":
  1. Revoke the GitHub grant (`DELETE /applications/{client_id}/grant`).
  2. Delete all the user's rows.
  3. Destroy their sessions.
- [ ] "Export my data" as JSON. Optional, cheap to add.
- [ ] Clear old data on a schedule: resolved items after 30 days, notification logs after 30 days, closed PRs after 7 days.

### 10.3 Security review

- [ ] Run through: CSRF origin check on all writes, every query scoped by `userId`, rate limits on auth and sync, `helmet` headers including a Content Security Policy, no tokens in logs (add a pino redaction rule), and dependency audit in CI (`pnpm audit`).
- [ ] Encryption key rotation: support a `TOKEN_ENC_KEY_PREVIOUS` env var. Read with either key, write with the new one, and add a one-off script that re-encrypts all tokens.
- [ ] Run the `/security-review` command on the main branch before launch.

### 10.4 Limits and cost control

- [ ] Caps per user: watched repos (50), devices (10), manual refreshes (once per 30 seconds).
- [ ] A worker concurrency setting, and a log or metric for "sync queue lag" (how far behind schedule syncs are). If it grows, raise concurrency or upgrade the worker plan.
- [ ] Optional invite codes or an allow list for a closed beta.

### 10.5 Monitoring

- [ ] Error tracking with Sentry (free tier) on server, worker, and web. Optional but recommended once others use it.
- [ ] Uptime check on `/api/health` (Render's own checks, or a free service like UptimeRobot).
- [ ] Simple counters logged per hour: syncs run, sync failures, pushes sent, push failures, active users.

### 10.6 Data safety

- [ ] **(You)** Confirm Supabase backups are on for your plan (and point-in-time recovery if you want it), and test restoring once.
- [ ] Prisma migrations only add or change in ways that work with the version currently running. Render runs migrations before swapping versions, so for a short time the old code runs against the new schema.

### 10.7 Polish for new users

- [ ] A custom domain on Render, with HTTPS (automatic).
- [ ] A short landing section on `/signin`: what it does, a screenshot, install buttons.
- [ ] Friendly states for: no repos yet, nothing needs you, GitHub is down, sync error.
- [ ] A feedback link (GitHub issues or an email).

## Done when

- [ ] A friend can sign up from the landing page, install on their phone, get pushes, and delete their account, without your help.
- [ ] Sentry and the uptime check alert you when something breaks.
- [ ] The security review checklist is done and findings are fixed.
