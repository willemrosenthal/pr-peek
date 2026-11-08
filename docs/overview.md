# Git Buddy

Git Buddy is the product name. The code still uses its first name, `pr-peek`, for package names, storage keys, events, and the repo.

A tool that watches the GitHub repos you care about and tells you what needs your attention: reviews you owe, replies to your comments, and problems on your own PRs. It runs as a web app you can install on your phone (a PWA), as a Mac menu bar app, and it sends push notifications to both.

This file describes **what** we are building and **how the pieces fit**. The step by step build plans are listed in the [docs README](README.md).

## 1. Features

### Other people's PRs

| Case                                        | What you see                                         |
| ------------------------------------------- | ---------------------------------------------------- |
| You've been asked to review a PR            | Row in "Needs my review"                             |
| How long the request has been waiting       | A pill like `3h` or `2d`, orange then red as it ages |
| Someone re-requested your review            | Row marked "Re-requested", sorted to the top         |
| You commented but haven't approved yet      | Row tagged "Waiting on author", dimmed, sorted last  |
| Someone replied to your comment on their PR | Row in "Replies to me"                               |

### Your PRs

| Case                         | What you see                                  |
| ---------------------------- | --------------------------------------------- |
| Someone reviewed your PR     | Row showing "Approved" or "Changes requested" |
| Someone commented on your PR | Row with a short preview                      |
| A check failed on your PR    | Red row with the failing check's name         |

### Everywhere

- One sorted list, grouped into sections. Rows use design A2, a divided two-line list (see the [mockups](https://claude.ai/artifact/RiRMAZfxkrJMeSUzfw1ckb)). This may still change.
- Push notifications to phone and desktop, controlled per rule.
- Quiet hours, a morning summary, and staleness limits.
- No snooze or done buttons. An item stays until you act on it (review, reply, fix the check) or the PR closes. See [plan 05](completed/05-rules-engine.md#when-an-item-clears).
- Mute a whole repo in settings.
- Many users, each signing in with their own GitHub account.

### Later

- Mac menu bar app (phase 2).
- Instant updates through a GitHub App and webhooks, actions like approve or re-run checks, team views, Slack alerts (phase 3).

## 2. Architecture

```
                 +-------------------------------+
                 |  GitHub (REST + GraphQL API)  |
                 +---------------+---------------+
                                 ^
                                 | every 2-15 min per user (sync-timing.ts)
+--------------------------------+--------------------------------+
| Render                                                          |
|                                                                 |
|  worker (pg-boss jobs)          web service (Express)           |
|   - sync each user's PRs         - GitHub sign in               |
|   - run rules                    - JSON API + live updates (SSE)|
|   - send Web Push                - serves the built PWA         |
|            \                       /                            |
+-------------\---------------------/-----------------------------+
               \                   /
          +-----------------------------+
          |  Supabase (Postgres)        |
          +-----------------------------+
           |                     |                       |
     Web Push               HTTPS + SSE             HTTPS + SSE
           v                     v                       v
   Phone (PWA on          Desktop browser         Mac menu bar app
   Home Screen)           (installed PWA)         (Tauri, phase 2)
```

- **The server does all the real work.** It signs users in, checks GitHub, runs the rules, remembers what each user has seen, and sends pushes.
- **Every screen is the same React app.** The phone, the browser, and the Tauri app all show the same UI, served by the web service.
- **SSE** (Server-Sent Events, a simple one way live connection) pushes changes to open screens right away.
- **Web Push** (the browser's built in push system) reaches phones and browsers even when the app is closed.

## 3. Tech stack

| Area              | Choice                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Repo              | pnpm workspaces monorepo, TypeScript (strict), Node 24 LTS                                                |
| Code quality      | ESLint, Prettier, Vitest, GitHub Actions CI                                                               |
| Server            | Express, Prisma, Postgres, Zod, pino (logging)                                                            |
| GitHub            | Octokit (REST + GraphQL) with throttling and retry plugins                                                |
| Auth              | GitHub OAuth App, cookie sessions stored in Postgres, tokens encrypted at rest                            |
| Background jobs   | pg-boss (job queue inside Postgres), run by a separate worker process                                     |
| Push              | `web-push` with VAPID keys (the key pair that proves pushes come from us)                                 |
| Live updates      | Server-Sent Events                                                                                        |
| Web app           | Vite, React, React Router, TanStack Query, Base UI, CSS Modules, Lucide icons                             |
| PWA               | vite-plugin-pwa with a custom service worker                                                              |
| Shared logic      | `packages/core`: types, rules, urgency score, formatting                                                  |
| Desktop (phase 2) | Tauri 2 with tray, positioner, autostart, updater, notification, global shortcut, single instance plugins |
| Hosting           | Render Blueprint (`render.yaml`): web service and background worker. Auto deploy from `prod`              |
| Database          | Postgres on Supabase in production, Docker locally                                                        |
| Desktop releases  | GitHub Actions with `tauri-action`, published to GitHub Releases, self updating                           |

## 4. Repo layout

```
pr-peek/
  apps/
    server/        Express API, sign in, sync worker, push sending
    web/           React PWA
    desktop/       Tauri shell (phase 2)
  packages/
    core/          shared types, rules, urgency score, formatting
  docs/            overview and build plans
    completed/     plans that are finished
  render.yaml      Render Blueprint
```

## 5. How each case is detected

| Case                  | How                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Review requested      | GraphQL search `is:pr is:open review-requested:@me` limited to watched repos                                                       |
| Staleness             | Time since the latest `ReviewRequestedEvent` for you in the PR timeline (not the PR's "updated" time, which changes on every push) |
| Re-requested          | A `ReviewRequestedEvent` for you that is newer than your last submitted review                                                     |
| Waiting on author     | You commented or left a "Comment" review since the request, and the author hasn't replied or pushed since                          |
| Reply to your comment | In a review thread you commented in, a newer comment by someone else. Or a PR conversation comment after yours that mentions you   |
| Your PR was reviewed  | New reviews by others on PRs from `author:@me`                                                                                     |
| Comment on your PR    | New conversation or review comments by others on PRs from `author:@me`                                                             |
| Check failed          | `statusCheckRollup` on the latest commit is `FAILURE` or `ERROR`. List the failing checks by name                                  |

Items close on their own when the condition goes away (you approved or asked for changes, the check passed, the PR merged). A "Comment" review doesn't close a review request. GitHub drops the request anyway, so we keep it open until it's removed by hand or you give a verdict.

## 6. Branches and deploys

- `main` is where work lands, through PRs.
- `prod` is what's live. Merging `main` into `prod` makes Render deploy the web service and worker, and run database migrations.
- A release builds the Mac app too when it changed. See [Releases in CLAUDE.md](../CLAUDE.md#releases).

### Migrations that are safe to deploy

Render runs migrations before it swaps in the new version. So for a minute or so, the old code runs against the new schema. Each migration must work with the code that's live now:

- **Adding** a table, or a column that's optional or has a default, is safe.
- **Removing or renaming** takes two releases. First, ship code that stops using the old column or table. Then remove it in a later release. A rename is: add the new one, copy the data, switch the code over, then remove the old one.
- **Making a column required** takes two releases too: first fill it in and have the code always set it, then add the rule.
- **Changing a column's type** is a rename in disguise. Add a new column instead.

Check this in review for any PR with a file in `apps/server/prisma/migrations`.

## 7. Accounts you will need

| Account                                       | When              | Why                                                              |
| --------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| GitHub OAuth Apps (one for dev, one for prod) | Plan 03           | "Sign in with GitHub"                                            |
| Render                                        | Plan 02           | Hosting the server and worker                                    |
| Supabase (Pro plan, in its own org)           | Plan 02           | The production Postgres database                                 |
| Apple Developer Program (about $99 a year)    | Plan 09, optional | Signing the Mac app so other people can open it without warnings |
