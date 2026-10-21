# pr-peek

A tool that watches the GitHub repos you care about and tells you what needs your attention: reviews you owe, replies to your comments, and problems on your own PRs. It runs as a web app you can install on your phone (a PWA), as a Mac menu bar app, and it sends push notifications to both.

This file describes **what** we are building and **how the pieces fit**. The step by step build plans are listed in the [docs README](README.md).

## 1. Features

### Other people's PRs

| Case | What you see |
| --- | --- |
| You've been asked to review a PR | Row in "Needs my review" |
| How long the request has been waiting | A pill like `3h` or `2d`, orange then red as it ages |
| Someone re-requested your review | Row marked "Re-requested", sorted to the top |
| Someone replied to your comment on their PR | Row in "Replies to me" |

### Your PRs

| Case | What you see |
| --- | --- |
| Someone reviewed your PR | Row showing "Approved" or "Changes requested" |
| Someone commented on your PR | Row with a short preview |
| A check failed on your PR | Red row with the failing check's name |

### Everywhere

- One sorted list, grouped into sections (design concept A in the [mockups](https://claude.ai/artifact/RiRMAZfxkrJMeSUzfw1ckb)).
- Push notifications to phone and desktop, controlled per rule.
- Quiet hours, a morning summary, and staleness limits.
- Snooze, mark done, and mute per item, PR, or repo.
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
                                 | every 1-2 min per user
+--------------------------------+--------------------------------+
| Render                                                          |
|                                                                 |
|  worker (pg-boss jobs)          web service (Express)           |
|   - sync each user's PRs         - GitHub sign in               |
|   - run rules                    - JSON API + live updates (SSE)|
|   - send Web Push                - serves the built PWA         |
|            \                       /                            |
|             +------ Postgres -----+                             |
+-----------------------------------------------------------------+
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

| Area | Choice |
| --- | --- |
| Repo | pnpm workspaces monorepo, TypeScript (strict), Node 24 LTS |
| Code quality | ESLint, Prettier, Vitest, GitHub Actions CI |
| Server | Express, Prisma, Postgres, Zod, pino (logging) |
| GitHub | Octokit (REST + GraphQL) with throttling and retry plugins |
| Auth | GitHub OAuth App, cookie sessions stored in Postgres, tokens encrypted at rest |
| Background jobs | pg-boss (job queue inside Postgres), run by a separate worker process |
| Push | `web-push` with VAPID keys (the key pair that proves pushes come from us) |
| Live updates | Server-Sent Events |
| Web app | Vite, React, React Router, TanStack Query, Base UI, CSS Modules |
| PWA | vite-plugin-pwa with a custom service worker |
| Shared logic | `packages/core`: types, rules, urgency score, formatting |
| Desktop (phase 2) | Tauri 2 with tray, positioner, autostart, updater, notification, global shortcut, single instance plugins |
| Hosting | Render Blueprint (`render.yaml`): web service, background worker, Postgres. Auto deploy from `prod` |
| Desktop releases | GitHub Actions with `tauri-action`, published to GitHub Releases, self updating |

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

| Case | How |
| --- | --- |
| Review requested | GraphQL search `is:pr is:open review-requested:@me` limited to watched repos |
| Staleness | Time since the latest `ReviewRequestedEvent` for you in the PR timeline (not the PR's "updated" time, which changes on every push) |
| Re-requested | A `ReviewRequestedEvent` for you that is newer than your last submitted review |
| Reply to your comment | In a review thread you commented in, a newer comment by someone else. Or a PR conversation comment after yours that mentions you |
| Your PR was reviewed | New reviews by others on PRs from `author:@me` |
| Comment on your PR | New conversation or review comments by others on PRs from `author:@me` |
| Check failed | `statusCheckRollup` on the latest commit is `FAILURE` or `ERROR`. List the failing checks by name |

Items close on their own when the condition goes away (you submitted the review, the check passed, the PR merged).

## 6. Branches and deploys

- `main` is where work lands, through PRs.
- `prod` is what's live. Merging `main` into `prod` makes Render deploy the web service and worker, and run database migrations.
- Desktop app releases are made by pushing a `desktop-v*` tag (phase 2).

## 7. Accounts you will need

| Account | When | Why |
| --- | --- | --- |
| GitHub OAuth Apps (one for dev, one for prod) | Plan 03 | "Sign in with GitHub" |
| Render | Plan 02 | Hosting |
| Apple Developer Program (about $99 a year) | Plan 09, optional | Signing the Mac app so other people can open it without warnings |
