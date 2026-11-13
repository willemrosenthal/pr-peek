# Security and limits

How Git Buddy keeps tokens safe, and the limits it watches.

## GitHub tokens

Git Buddy asks for nothing that can write to GitHub (plan 22). The server has the key, since it reads tokens to sync, so a server break-in would expose them. Keeping them read-only limits what that exposes.

- Sign in asks only for `read:org`. It reads public repos and the user's teams.
- Private repos come only through fine-grained tokens. Classic tokens are refused, since reading private repos with one needs `repo`, which can also write.
- A fine-grained token is only read-only if the user makes it so. GitHub has no API to read a fine-grained token's permissions, so we can't check. The token steps ask for read-only.
- Sign ins and classic tokens from before plan 22 may still be able to write, until plan 22's cutover removes them. That includes someone who signs in again without revoking first: GitHub may keep the old `repo` grant.

We store each user's GitHub tokens encrypted with `TOKEN_ENC_KEY`. It's AES-256-GCM: a standard cipher that also catches changed data.

- The sign in tokens live on the `User` row.
- Personal access tokens live in the `GitHubToken` table, one row per token (plan 20). Each also keeps a SHA-256 hash of the token, to spot one added twice. A hash can't be turned back into the token.

### Change the key

Do this if the key may have leaked.

1. Make a new key: `openssl rand -base64 32`
2. In Render, on both the web service and the worker:
   - Set `TOKEN_ENC_KEY_PREVIOUS` to the current key.
   - Set `TOKEN_ENC_KEY` to the new key.
3. Wait for both to deploy. Tokens now read with either key.
4. Open a Render shell on the web service and run:
   `pnpm --filter @pr-peek/server tokens:reencrypt`
   It encrypts every token again with the new key, in both places, and logs how many users it changed.
5. Remove `TOKEN_ENC_KEY_PREVIOUS` from both services.

The script is safe to run twice, and safe to run while the app is live.

## Logs

The logger hides secrets before they're written:

- Cookies and `Authorization` headers on requests.
- The request headers and body inside GitHub errors.
- Any field named like a token: `token`, `accessToken`, `refreshToken`, `access_token`, `refresh_token`, `client_secret`.

The list is in `apps/server/src/logger.ts`. Add to it if you log something new that holds a secret.

## Error reports (Sentry)

Errors go to Sentry, in two projects in the `willem-rosenthal` org: `git-buddy-server` (the server and the worker, told apart by the `service` tag) and `git-buddy-web` (the web app, and the Mac app, which shows it).

- **What's sent:** the error, its stack, its log message, and the request's method and path, or the page. Also timings for 10% of requests and page loads.
- **What's never sent:** cookies, headers, request and response bodies, URL query strings, database query values, job data, or variable values. Each is turned off by name (`NO_EXTRA_DATA` in `packages/core/src/error-reports.ts`, used by both apps), since an option left out can default to on. Every URL in a report, a breadcrumb (the steps before an error), or a timing loses its query string, and GitHub URLs keep only their host, since their paths can name private repos (`cleanReports`, same file). Checked against real Sentry data on 10 November.
- **When:** the server and worker only report on Render (`RENDER_GIT_COMMIT` is set). The web app only reports on `www.git-buddy.com`. Local runs, tests, and CI send nothing.
- **How:** every `logger.error(...)` goes to Sentry (`createLogger` in `logger.ts`), so new code needs no extra call. A failed worker job is logged, so it goes too. A failed health check is only a warning: Render checks every few seconds, and the uptime monitor already reports outages. The same error (same log message and error text) goes at most once every 5 minutes from each process, so a burst, like every poll failing while the database is down, can't use up the free plan. Sentry's counts can read low because of it. `index.ts` and `worker.ts` start Sentry, then load the app (`run-server.ts`, `run-worker.ts`), so Sentry can trace Express and the database.
- **Source maps:** the server's stack traces point at the TypeScript files on their own. The web app's need `SENTRY_AUTH_TOKEN` on Render at build time, which uploads its source maps and then deletes them.
- **Alerts:** each project emails on new high priority issues. The "Git Buddy health" uptime monitor checks `/api/health` every minute, and opens an issue after 3 failures in a row.

## Rate limits and IPs

Sign in is rate limited by IP: 30 tries per 15 minutes. Routes that ask GitHub or send pushes are limited per signed in user instead, since people at one company often share an IP.

The IP limit only works if the server sees each user's real IP. Render's proxies sit in front of us, and `TRUST_PROXY_HOPS` says how many. The default is 2: Cloudflare, then Render's own (checked 8 November 2026). If Render changes that, sign-in limits quietly lump users together, so check it once in a while:

1. Sign in as an admin and open `https://www.git-buddy.com/api/admin/ip`.
2. `ip` should be your own IP (search "what is my IP" to compare).
3. If it isn't, find your IP in `forwardedFor`. Count the entries after it, add 1, and set `TRUST_PROXY_HOPS` to that in Render (Environment). Render restarts the server with it. Then check again.
4. If your IP isn't in `forwardedFor` at all, leave it at 2. Render passes it some other way, which needs a code change.

Too low, and everyone shares one sign-in limit. Too high, and someone could fake their IP to skip it.

## Dependency audit

The **Audit** workflow checks our dependencies for known security problems. It runs on every PR and every Monday.

- It only checks what ships, and only high or critical problems.
- It isn't a required check, so it never blocks an unrelated PR.
- If it fails, update the package it names. Run it yourself with `pnpm audit --prod --audit-level high`.

## Dependabot

Dependabot opens PRs that update our dependencies. The setup is in `.github/dependabot.yml`.

- Once a month, grouped: one PR for app packages, one for dev tools, one for the Mac app, and one for GitHub Actions.
- Security fixes come sooner, one PR each.
- Major versions come one PR each, since they can break things.
- The title decides the release. `fix(deps)` changes what ships, so merging it releases. `chore(deps)` and `ci(deps)` don't.
- A Mac app (`cargo`) update also builds a new Mac release.
- It skips new major versions of `@types/node` (they follow the Node version in `.nvmrc`) and of `tauri-action` (only a real Mac release can test it).
- It skips Tauri, the Mac app's framework. Its npm package (`@tauri-apps/*`) and Rust crates (`tauri*`) must be on the same version, so update them together by hand. Security fixes for them still come.

Review them like any PR: check CI passes, then merge.

## Supabase limits

We're on Supabase Pro. It includes:

| What              | Limit     | Warning at |
| ----------------- | --------- | ---------- |
| Database size     | 8 GB      | 70%        |
| Egress (data out) | 250 GB/mo | 80%        |

The admin page shows both. Past the database warning, admins get a push.

Pro also keeps daily backups for 7 days. Find them in Supabase under Database, Backups.

If the plan changes, update `DB_LIMIT_BYTES` in `apps/server/src/health.ts` and `EGRESS_LIMIT_BYTES` in `apps/server/src/admin.ts`.
