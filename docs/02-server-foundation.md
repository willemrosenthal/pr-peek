# 02. Server foundation and first deploy

**Goal:** an Express server with Prisma and Postgres, a background worker process, and both running on Render with auto deploy from `prod`. We deploy this early (with no features) so deploy problems show up while the app is still tiny.

**Needs:** plan 01. Docker (or another local Postgres). **(You)** A Render account.

**Split into two PRs:**

- **Part A** (`plan-02-1-local-server`): steps 2.1 to 2.6 and 2.8. Everything runs locally.
- **Part B** (`plan-02-2-render`): step 2.7. The Render Blueprint and first deploy.

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
- **Logs redact** cookie, authorization, and set-cookie headers.

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

### 2.7 Render Blueprint (part B)

- [ ] `render.yaml` at the root, defining:
  - **`pr-peek-web`**, a Node web service:
    - Branch `prod`, auto deploy on.
    - Build: `corepack enable && pnpm install --frozen-lockfile && pnpm build`
    - Pre deploy: `pnpm --filter @pr-peek/server db:deploy` (runs migrations before the new version goes live)
    - Start: `node apps/server/dist/index.js`
    - Health check path `/api/health`.
  - **`pr-peek-worker`**, a background worker, same branch and build. Start: `node apps/server/dist/worker.js`.
  - **`pr-peek-db`**, Postgres. `DATABASE_URL` from it is wired into both services.
  - An env group `pr-peek-secrets` shared by both services for secrets added in later plans.
- [ ] Set build filters so changes only under `apps/desktop` or `docs` don't trigger a deploy.
- [ ] Note: Render free web services sleep when idle, and background workers and pre deploy commands need a paid plan. Check Render's current pricing and pick the smallest paid plans for the web service and worker.
- [ ] **(You)** In Render, create a new Blueprint from the repo and approve the services.

### 2.8 Local dev scripts

- [x] `apps/server`: `dev` runs `dev:server` and `dev:worker` together, each with `tsx watch` and the root `.env`.
- [x] Root `pnpm dev` runs every package's `dev` (server and worker now, web from plan 07).

## Done when

- [x] `docker compose up -d && pnpm dev` starts the server and worker locally, and `curl localhost:3000/api/health` returns `ok: true`.
- [x] Tests (Vitest + Supertest) cover `/api/health`, API errors, PWA serving, config checks, and log redaction.
- [ ] Merging `main` into `prod` deploys both services on Render, the migration runs, and the public `/api/health` returns `ok: true`.
- [ ] Worker logs on Render show the heartbeat job every minute.
