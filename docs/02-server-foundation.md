# 02. Server foundation and first deploy

**Goal:** an Express server with Prisma and Postgres, a background worker process, and both running on Render with auto deploy from `prod`. We deploy this early (with no features) so deploy problems show up while the app is still tiny.

**Needs:** plan 01. A local Postgres (Docker or Postgres.app). **(You)** A Render account.

## Steps

### 2.1 Local Postgres

- [ ] Add `docker-compose.yml` at the root with one Postgres service, a named volume, and port `5432`. (Skip if you prefer Postgres.app.)
- [ ] Add `DATABASE_URL` to `.env.example`.

### 2.2 Config

- [ ] `apps/server/src/config.ts`: read `process.env` once at startup and check it with a Zod schema. If anything is missing or wrong, crash with a clear message. Export a typed `config` object.
- [ ] Start with: `NODE_ENV`, `PORT`, `DATABASE_URL`, `APP_URL` (the public URL, e.g. `http://localhost:5173` in dev), `LOG_LEVEL`.

### 2.3 Express app

- [ ] `apps/server/src/app.ts` builds the app, `src/index.ts` starts it. Keeping them separate lets tests create the app without opening a port.
- [ ] Middleware, in order:
  - `pino-http` for request logs.
  - `helmet` for safe default security headers.
  - `express.json()` with a small body size limit.
  - Our routes under `/api`.
  - Static files for the built PWA, with a fallback to `index.html` for any non `/api` route so React Router can handle it. (The PWA build only exists from plan 07 on. Until then this serves nothing.)
  - A final error handler that logs the error and returns `{ error: { code, message } }` JSON. Never leaks stack traces in production.
- [ ] `GET /api/health` returns `{ ok: true, version }` and checks it can reach the database.
- [ ] Graceful shutdown: on `SIGTERM`, stop taking new requests, finish open ones, close the database connection. Render sends `SIGTERM` on every deploy.

### 2.4 Prisma

- [ ] Add Prisma to `apps/server`, schema at `apps/server/prisma/schema.prisma`.
- [ ] Create the first models. Later plans add fields as needed, but sketching them now keeps the data model coherent:

| Model              | Purpose                              | Key fields                                                                                                                                                                                                |
| ------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`             | One per GitHub account               | `githubId` (unique), `login`, `name`, `avatarUrl`, `accessTokenEnc`, `tokenScopes`, `lastSyncedAt`, `syncError`                                                                                           |
| `UserSettings`     | One per user                         | `timezone`, `staleWarnHours` (4), `staleLateHours` (24), `workHoursOnly`, `quietStart`, `quietEnd`, `quietWeekends`, `digestTime`, `includeTeamRequests`, `hideBots`                                      |
| `WatchedRepo`      | Repos a user picked                  | `userId`, `githubRepoId`, `owner`, `name`, `enabled`, `muted`. Unique on `(userId, githubRepoId)`                                                                                                         |
| `PullRequest`      | Our copy of a PR, per user           | `userId`, `githubNodeId`, `repoOwner`, `repoName`, `number`, `title`, `url`, `authorLogin`, `isDraft`, `state`, `headSha`, `checkState`, `githubUpdatedAt`, `snapshot` (JSON of the details we fetched)   |
| `Item`             | One "needs your attention" thing     | `userId`, `pullRequestId`, `kind`, `dedupeKey` (unique per user), `latestEventId`, `eventCount`, `actorLogin`, `summary`, `occurredAt`, `waitingSince`, `status` (open, resolved), `resolvedAt`, `seenAt` |
| `RuleSetting`      | A user's choices per rule            | `userId`, `ruleId`, `enabled`, `severity`, `channels` (array), `options` (JSON)                                                                                                                           |
| `PushSubscription` | One per device that accepted push    | `userId`, `endpoint` (unique), `p256dh`, `auth`, `label`, `platform`, `lastSuccessAt`, `failureCount`                                                                                                     |
| `NotificationLog`  | What we sent, so we never send twice | `userId`, `itemId`, `channel`, `sentAt`, `status`                                                                                                                                                         |
| `Session`          | Sign in sessions                     | managed by the session store in plan 03                                                                                                                                                                   |

- [ ] Note: PRs are stored per user, not shared, because each user's token decides what they're allowed to see. We can share data between users later if it ever matters for speed.
- [ ] Run the first migration (`prisma migrate dev`) and commit it.
- [ ] A single shared `PrismaClient` in `src/db.ts`.

### 2.5 Worker process

- [ ] Add pg-boss. It creates its own tables in a `pgboss` schema in the same Postgres.
- [ ] `apps/server/src/worker.ts`: a second entry point that starts pg-boss, registers job handlers, and shuts down cleanly on `SIGTERM`.
- [ ] One placeholder scheduled job (`heartbeat`, every minute) that logs a line. Real jobs arrive in plan 04.

### 2.6 Build

- [ ] Bundle the server with `tsup` (a zero config bundler built on esbuild) into `apps/server/dist/index.js` and `dist/worker.js`. Bundling pulls in `@pr-peek/core` source so there's nothing extra to build.
- [ ] Root script `build:render` that builds core consumers in order: web (once it exists), then server.

### 2.7 Render Blueprint

- [ ] `render.yaml` at the root, defining:
  - **`pr-peek-web`**, a Node web service:
    - Branch `prod`, auto deploy on.
    - Build: `corepack enable && pnpm install --frozen-lockfile && pnpm build:render && pnpm --filter @pr-peek/server exec prisma generate`
    - Pre deploy: `pnpm --filter @pr-peek/server exec prisma migrate deploy` (runs migrations before the new version goes live)
    - Start: `node apps/server/dist/index.js`
    - Health check path `/api/health`.
  - **`pr-peek-worker`**, a background worker, same branch and build. Start: `node apps/server/dist/worker.js`.
  - **`pr-peek-db`**, Postgres. `DATABASE_URL` from it is wired into both services.
  - An env group `pr-peek-secrets` shared by both services for secrets added in later plans.
- [ ] Set build filters so changes only under `apps/desktop` or `docs` don't trigger a deploy.
- [ ] Note: Render free web services sleep when idle, and background workers and pre deploy commands need a paid plan. Check Render's current pricing and pick the smallest paid plans for the web service and worker.
- [ ] **(You)** In Render, create a new Blueprint from the repo and approve the services.

### 2.8 Local dev scripts

- [ ] `pnpm dev` in `apps/server` runs `tsx watch src/index.ts`, and `pnpm dev:worker` runs `tsx watch src/worker.ts`.
- [ ] Root `pnpm dev` runs server, worker, and (later) web together.

## Done when

- [ ] `docker compose up -d && pnpm dev` starts the server and worker locally, and `curl localhost:3000/api/health` returns `ok: true`.
- [ ] A test (Vitest + Supertest) calls `/api/health` against the app.
- [ ] Merging `main` into `prod` deploys both services on Render, the migration runs, and the public `/api/health` returns `ok: true`.
- [ ] Worker logs on Render show the heartbeat job every minute.
