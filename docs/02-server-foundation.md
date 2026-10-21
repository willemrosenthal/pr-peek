# 02. Server foundation and first deploy

**Goal:** an Express server with Prisma and Postgres, a background worker process, and both running on Render with auto deploy from `prod`. The production database is on Supabase. We deploy this early (with no features) so deploy problems show up while the app is still tiny.

**Needs:** plan 01. Docker (or another local Postgres). **(You)** A Render account and a Supabase project.

**Split into two PRs:**

- **Part A** (`plan-02-1-local-server`): steps 2.1 to 2.6 and 2.8. Everything runs locally.
- **Part B** (`plan-02-2-render`): step 2.7. Supabase, the Render Blueprint, and the first deploy.

## Changes from the original plan

- **Postgres runs on port 5433** in Docker, so it doesn't clash with a Postgres already on 5432.
- **Prisma 7** works differently from earlier versions:
  - Settings live in `apps/server/prisma.config.ts`, which also loads the root `.env` for CLI commands.
  - The client is generated into `apps/server/src/generated/prisma` (gitignored) and talks to Postgres through `@prisma/adapter-pg`.
  - `prisma generate` runs on `pnpm install` (a `postinstall` script), so builds and type checks always have the client.
  - Prisma's npm `latest` tag points at an 8.0 release candidate, so all Prisma packages are pinned to `~7.10.1`.
- **No `build:render` script.** The server reads the web build only at runtime, so build order doesn't matter. Render runs `pnpm build`.
- **No `Session` model yet.** The session store in plan 03 creates its own table.
- **`NotificationLog` has an `eventId`** and is unique on `(itemId, eventId, channel)`, so the database itself stops duplicate alerts.
- **`/api/health` returns 503** with `ok: false` when the database is down, so Render's health check catches it.
- **Logs redact** cookie, authorization, and set-cookie headers, and skip successful health checks (Render calls them every few seconds).
- **Missing files get a 404**, not `index.html`, so a stale asset link fails clearly instead of loading HTML as JavaScript.
- **Indexes on foreign keys** that the original schema left out (`Item.pullRequestId`, `PushSubscription.userId`, `NotificationLog.userId`), added in a second migration.
- **The production database is Supabase**, not Render Postgres. Render hosts only the web service and worker.

## Steps

### 2.1 Local Postgres

- [x] `docker-compose.yml` with one Postgres 17 service, a named volume, and port `5433`.
- [x] `DATABASE_URL` and the other variables in `.env.example`.

### 2.2 Config

- [x] `apps/server/src/config.ts`: `loadConfig()` checks env vars with Zod and throws a clear message naming each bad one.
- [x] Variables: `NODE_ENV`, `PORT`, `DATABASE_URL`, `APP_URL`, `LOG_LEVEL`, plus Render's optional `RENDER_GIT_COMMIT` for the version.

### 2.3 Express app

- [x] `src/app.ts` builds the app from its dependencies (logger, version, database check, web folder). `src/index.ts` starts it. Tests build the app without a database or open port.
- [x] Middleware in order: `pino-http`, `helmet`, `express.json()` (100kb limit), `/api` routes, JSON 404 for unknown `/api` routes, the PWA with `index.html` fallback (only if the build exists), and an error handler.
- [x] The error handler returns `{ error: { code, message } }`. It never sends stack traces or internal messages.
- [x] `GET /api/health` returns `{ ok: true, version }`, or 503 if the database is unreachable.
- [x] Graceful shutdown (`src/shutdown.ts`, shared with the worker): on `SIGTERM` or `SIGINT`, stop taking requests, finish open ones, close the database. Forces exit after 10 seconds.

### 2.4 Prisma

- [x] Schema at `apps/server/prisma/schema.prisma` with `User`, `UserSettings`, `WatchedRepo`, `PullRequest`, `Item`, `RuleSetting`, `PushSubscription`, `NotificationLog`.
- [x] PRs are stored per user, because each user's token decides what they can see.
- [x] First migration (`init`) created and committed.
- [x] `src/db.ts`: `createDb()` and `checkDb()`.

### 2.5 Worker process

- [x] pg-boss 12. It creates its own tables in a `pgboss` schema.
- [x] `src/worker.ts`: starts pg-boss, registers jobs, shuts down gracefully.
- [x] A `heartbeat` job every minute that logs a line.

### 2.6 Build

- [x] `tsup` bundles `src/index.ts` and `src/worker.ts` into `apps/server/dist/`, with `@pr-peek/core` bundled in.

### 2.7 Supabase and Render Blueprint (part B)

**Supabase database (free plan)**

Hosting names are `git-buddy` on both Supabase and Render. The code and repo keep the `pr-peek` name.

- [x] **(You)** In Supabase, create a new **free organization**. A project inside your paid organization is billed at that organization's rate, so it has to live in its own free one.
- [x] **(You)** In that organization, create a project named `git-buddy`. Save the database password somewhere safe. The project is in Supabase "US East (Ohio)", so `render.yaml` uses Render's `ohio` region. Same area means lower delay on every query.
- [x] Free plan limits to know about (check Supabase's pricing page for current numbers):
  - **No backups.** Fine while it's just you. Plan 10 covers backups before other people sign in.
  - **Pauses after about a week with no activity.** The worker queries every minute, so this only happens if the worker is down for days. If it pauses, restore it from the Supabase dashboard.
  - **Small storage and lower connection limits.** Both are plenty for us.
- [x] **(You)** Copy the **session pooler** connection string: Supabase dashboard, Connect, then "Session pooler". It looks like `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
  - Use the session pooler, not the transaction pooler (port 6543). pg-boss and the live updates in plan 06 need a steady connection per client, which the transaction pooler doesn't give.
  - The session pooler works over IPv4. Supabase's direct connection may need IPv6, which Render may not support.
- [ ] **(You)** Add `?sslmode=require` to the end of the string if it isn't there, before pasting it into Render. Supabase requires encrypted connections.
- [x] Keep connection counts small. `DB_POOL_MAX` (default 5) sets both Prisma's and pg-boss's pool size, so two services stay well under the free plan's limit.

**Render Blueprint**

- [x] `render.yaml` at the root, defining:
  - **`git-buddy-web`**, a Node web service on the `starter` plan in `ohio`:
    - Branch `prod`, auto deploy on.
    - Build: `pnpm render:build`. The root `render:build` script runs `pnpm install --frozen-lockfile --prod=false && pnpm build`. `--prod=false` makes pnpm install dev dependencies (Prisma CLI, tsup) even though `NODE_ENV=production`.
    - No `corepack enable`. It fails on Render with "read-only file system" because it tries to replace `/usr/bin/pnpm`. Render already has pnpm installed.
    - Render's pnpm may be newer than our pinned 9.15.4. pnpm 10+ skips dependency install scripts unless they're allowed, and Prisma needs its script to download the engine that runs migrations. The root `package.json` lists the allowed ones in `pnpm.onlyBuiltDependencies` (`@prisma/engines`, `esbuild`, `prisma`), so every pnpm version behaves the same. Add to that list if a new dependency needs an install script.
    - Pre deploy: `pnpm --filter @pr-peek/server db:deploy` (runs migrations before the new version goes live)
    - Start: `node apps/server/dist/index.js`
    - Health check path `/api/health`.
  - **`git-buddy-worker`**, a background worker, same plan, region, branch, build, and pre deploy. Start: `node apps/server/dist/worker.js`.
    - It migrates too, because Render deploys both services at once. Without it, new worker code could start before the web service's migration runs. Prisma locks the database while migrating, so two runs at once are safe.
  - An env group `git-buddy-env` shared by both services:
    - `NODE_VERSION=24` and `NODE_ENV=production`.
    - `DATABASE_URL` and `APP_URL` with `sync: false`, so their values are never stored in the repo. Render did **not** ask for them when creating the Blueprint, so they were added by hand in Environment Groups, `git-buddy-env`. Do the same for secrets in later plans.
- [x] Build filters, so changes only under `apps/desktop` or `docs` don't trigger a deploy.
- [x] Plans: `starter` for both. Render free web services sleep when idle, and background workers and pre deploy commands need a paid plan. Check Render's current pricing; change `plan` in `render.yaml` if you want a different tier.
- [ ] **(You)** In Render, create a new Blueprint from the repo, paste `DATABASE_URL` and `APP_URL` when asked, and approve the services.

### 2.8 Local dev scripts

- [x] `apps/server`: `dev` runs `dev:server` and `dev:worker` together, each with `tsx watch` and the root `.env`.
- [x] Root `pnpm dev` runs every package's `dev` (server and worker now, web from plan 07).

## Done when

- [x] `docker compose up -d && pnpm dev` starts the server and worker locally, and `curl localhost:3000/api/health` returns `ok: true`.
- [x] Tests (Vitest + Supertest) cover `/api/health`, API errors (including hidden 500 details), PWA serving and missing files, config checks, and log redaction.
- [ ] Merging `main` into `prod` deploys both services on Render, the migration runs against Supabase, and the public `/api/health` returns `ok: true`.
- [ ] Worker logs on Render show the heartbeat job every minute.
