# 03. GitHub sign in

**Goal:** anyone can click "Sign in with GitHub", approve access, and get a session. Their GitHub token is stored encrypted and is ready for the sync engine.

**Needs:** plan 02.

## Background

We use a **GitHub OAuth App**, the standard "Sign in with GitHub" setup. When a user approves it, GitHub gives us an **access token** (a password-like string that lets us call the GitHub API as that user).

OAuth App permissions ("scopes") are coarse:

| Scope           | Why we need it                                      | Downside                                                                               |
| --------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `repo`          | Read PRs, reviews, and checks in **private** repos  | It also grants write access. GitHub has no read-only private repo scope for OAuth Apps |
| `read:org`      | See team review requests and org repo lists         | None really                                                                            |
| `notifications` | Optional cheap "something changed" signal (plan 04) | None really                                                                            |

The `repo` scope is the main reason a GitHub App (plan 11) is a good upgrade later, since GitHub Apps can ask for read-only access. For now, be upfront about it on the sign in screen. Offer a "public repos only" option that asks for `public_repo` instead of `repo`.

**Split into two PRs:**

- **Part A** (`plan-03-1-sessions`): steps 3.2 and 3.3. Token encryption, sessions, CSRF.
- **Part B** (`plan-03-2-sign-in`): steps 3.1, 3.4, and 3.5. OAuth Apps, the sign in flow, `/api/me`, and the GitHub client.

## Changes from the original plan

- **No web app until plan 07.** In dev, `APP_URL` and the OAuth callback point at Express on port 3000. Plan 07 moves both to the Vite dev server on 5173. Until then, sign in ends on a 404 page; check `/api/me` instead.
- **The `session` table is in the Prisma schema**, matching `connect-pg-simple`'s `table.sql`. That way Prisma migrations create it and don't see it as unexpected drift.
- **One database pool** (`createPool` in `db.ts`) is shared by Prisma and the session store, to keep connections low on Supabase.
- **Default `RuleSetting` rows come in plan 05**, where the rules are defined. New users get `UserSettings` now.
- **Hosting names:** the prod OAuth App is `git-buddy`, and its secrets go in Render's `git-buddy-env` group.
- **Tokens expire.** Both OAuth Apps have "Expire user access tokens" on. Access tokens last about 8 hours and come with a refresh token. `github/tokens.ts` refreshes them before they expire, while holding a lock on the user's row. GitHub only accepts each refresh token once, so without the lock the web service and worker could both refresh and one would fail.
- **The dev OAuth App also allows the port 5173 callback**, so plan 07 doesn't need to change it.
- **Tests use a real database** (`prpeek_test` locally, a Postgres service in CI). It's created and migrated automatically before the server tests run. Server test files run one at a time because they share it.
- **After `db:migrate`, run `db:generate`.** Prisma 7's `migrate dev` no longer regenerates the client, so new columns don't show up in types until you do.

## Steps

### 3.1 Create the OAuth Apps (You)

- [x] **(You)** In GitHub, Settings, Developer settings, OAuth Apps, create **git-buddy (dev)**:
  - Homepage: `http://localhost:3000`
  - Callbacks: `http://localhost:3000/api/auth/github/callback` and `http://localhost:5173/api/auth/github/callback`
  - "Expire user access tokens" on.
- [x] **(You)** Create **git-buddy** for production:
  - Homepage: `https://git-buddy-web.onrender.com`
  - Callback: `https://git-buddy-web.onrender.com/api/auth/github/callback`
  - "Expire user access tokens" on.
- [x] Add to `.env.example`: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
- [x] **(You)** Put the prod values in Render's `git-buddy-env` group.

### 3.2 Token encryption (part A)

- [x] `apps/server/src/crypto.ts` with `encrypt(text, key)` and `decrypt(blob, key)`:
  - AES-256-GCM (a standard encryption method that also detects tampering) using Node's built in `crypto`.
  - A fresh random IV (a random starting value, so the same token never encrypts to the same output) per call.
  - Stored as `v1:<iv>:<authTag>:<ciphertext>` in base64. The `v1` prefix lets us rotate keys later.
- [x] `TOKEN_ENC_KEY` (32 random bytes, base64) in config, checked for the right length. Generate with `openssl rand -base64 32`.
- [x] Unit tests: round trip, no plain text in the output, different output each time, wrong key fails, tampered data fails, bad format fails.
- [ ] **(You)** Add `TOKEN_ENC_KEY` to Render's `git-buddy-env` group **before** this reaches `prod`. Use a new value, not the dev one.

### 3.3 Sessions (part A)

- [x] `express-session` with `connect-pg-simple` (stores sessions in the `session` Postgres table), in `src/session.ts`.
- [x] Cookie settings:
  - `httpOnly` (JavaScript can't read it)
  - `secure` in production (HTTPS only)
  - `sameSite: "lax"`
  - 30 day rolling expiry (each visit pushes the expiry forward)
  - No cookie until something is saved in the session.
- [x] `SESSION_SECRET` in config (at least 32 characters).
- [x] `app.set("trust proxy", 1)` so secure cookies work behind Render's proxy.
- [x] CSRF protection (stopping other sites from making requests as the user), in `src/csrf.ts`: every non GET `/api` request needs an `Origin` header that matches `APP_URL`. Since the API and PWA share one domain, this is enough.
- [ ] **(You)** Add `SESSION_SECRET` to Render's `git-buddy-env` group **before** this reaches `prod`. Use a new value, not the dev one.

### 3.4 Sign in flow

### 3.4 Sign in flow (part B)

All in `src/routes/auth.ts`, with GitHub's endpoints in `src/github/oauth.ts` and saving users in `src/users.ts`.

- [x] `GET /api/auth/github?scope=full|public`:
  1. Create a random `state` value (stops someone faking the callback) and save it in the session.
  2. Redirect to `https://github.com/login/oauth/authorize` with client id, scopes, state, and callback URL.
- [x] `GET /api/auth/github/callback`:
  1. Check `state` matches the session, then forget it, so each state works once. If not, redirect to `/signin?error=state`.
  2. Exchange `code` for tokens. The granted scopes come back with them.
  3. Call `GET /user` to get id, login, name, and avatar.
  4. Upsert (create or update) the `User` by `githubId`, with tokens encrypted. New users get `UserSettings`. Signing in again clears a "needs reauth" flag.
  5. Regenerate the session (prevents session fixation, where an attacker plants a known session id) and store `userId`.
  6. Redirect to `/onboarding` for new users, `/` otherwise.
  7. Errors redirect to `/signin?error=denied` (user clicked Cancel), `github` (GitHub said no), or `server`.
- [x] `POST /api/auth/signout`: destroys the session and clears the cookie.
- [x] `GET /api/me`: returns the user (id, login, name, avatar, scopes), their settings, and `needsReauth`.
- [x] `requireUser(db)` middleware, plus `currentUser(res)` for routes after it. It returns 401 if there's no session or the user is gone.
- [x] Rate limit on the auth routes: 30 requests per 15 minutes per IP.

### 3.5 GitHub client per user (part B)

- [x] `src/github/tokens.ts`: `getAccessToken` returns a working token, refreshing it (under a row lock) if it expires within 5 minutes. A missing or expired refresh token, or GitHub rejecting it, marks the user `syncError = "reauth"`.
- [x] `src/github/client.ts`: `getOctokit(deps, userId)` returns Octokit (with its built in retry and rate limit handling) acting as the user. A 401 from GitHub marks the user `syncError = "reauth"`, so `/api/me` reports `needsReauth: true`. Stopping syncs for those users comes in plan 04.

## Done when

- [x] **(You)** Locally: open `http://localhost:3000/api/auth/github`, approve on GitHub, land back (on a 404 until plan 07), and `http://localhost:3000/api/me` returns your login.
- [x] Tokens are stored encrypted, never as plain text (tested in `users.test.ts`). **(You)** can also check the real row after signing in.
- [x] A 401 from GitHub marks the user `needsReauth` (tested in `client.test.ts`). **(You)** can also try it for real by revoking the app in GitHub settings, once plan 04 makes GitHub calls.
- [x] A cross origin `POST` to `/api/auth/signout` is rejected (tested in `auth.test.ts`).
- [x] **(You)** Works the same on the Render deployment with the prod OAuth App (on commit `dce934c`).
