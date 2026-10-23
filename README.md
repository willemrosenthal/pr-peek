# pr-peek

Tracks the GitHub PRs that need your attention. A web app (PWA), a Mac menu bar app, and push notifications.

- What we're building: [docs/overview.md](docs/overview.md)
- Build plans and status: [docs/README.md](docs/README.md)

## Run it locally

### You need

- Node 24 (see `.nvmrc`) and pnpm 9.
- Docker Desktop, for the local database.

### First time only

1. Install packages: `pnpm install`
2. Copy `.env.example` to `.env` and fill in the empty values. The comments in the file say how.
3. Start the database: `pnpm db:up`
4. Set up its tables: `pnpm db:migrate`

### Every time

1. Open Docker Desktop.
2. Start the database: `pnpm db:up`
3. Start the app: `pnpm dev`
4. Open http://localhost:5173

When you're done, stop the app with Ctrl+C. Stop the database with `pnpm db:down`. Your data stays.

### Ports

| Port | What                                               |
| ---- | -------------------------------------------------- |
| 5173 | The web app. Open this one                         |
| 3001 | The API server. Set by `PORT` in `.env`            |
| 5433 | The database, in Docker                            |

If a port is taken by another app, change `PORT` in `.env`. The web app follows it.

## Other commands

| Command              | What it does                                    |
| -------------------- | ----------------------------------------------- |
| `pnpm test`          | Runs the tests                                  |
| `pnpm lint`          | Checks the code for mistakes                    |
| `pnpm typecheck`     | Checks the TypeScript types                     |
| `pnpm format`        | Formats every file with Prettier                |
| `pnpm build`         | Builds everything for production                |
| `pnpm desktop`       | Runs the Mac menu bar app (needs `pnpm dev` too) |
| `pnpm desktop:build` | Builds the Mac menu bar app                     |
| `pnpm db:migrate`    | Applies new database changes                    |

## Branches

- `main`: work lands here through PRs.
- `prod`: what's live. Merging `main` into `prod` deploys to Render.
