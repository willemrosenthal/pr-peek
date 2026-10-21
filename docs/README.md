# Docs

## Status

Updated after every step. Read this first when picking work back up.

|                    |                                                                                 |
| ------------------ | ------------------------------------------------------------------------------- |
| **Current plan**   | [01. Repo setup](completed/01-repo-setup.md), all steps done                    |
| **Branch**         | `plan-01-repo-setup`                                                            |
| **PR**             | Opening now                                                                     |
| **Last step done** | 1.6 CI. Everything passes locally                                               |
| **Next step**      | Confirm CI passes on the PR, then start [plan 02](02-server-foundation.md)      |
| **Waiting on you** | Merge the PR. Create the `prod` branch. Turn on branch protection (plan 01 1.6) |

- [overview.md](overview.md): what we're building, the architecture, and the tech stack.
- The numbered files below: build plans, run in order. Each ends with a "Done when" list. Don't start the next plan until those all pass.
- [completed/](completed/): finished plans.

## When a plan is finished

1. Tick every box in its "Done when" list.
2. Move the file into `completed/`, keeping its name (e.g. `completed/01-repo-setup.md`).
3. Update its link in the tables below to point at `completed/`, and add a ✅ in front of its name.
4. Fix any links in other plans that pointed at it.

Plans can be edited while in progress when we learn something. Completed plans are a record of what was done, so only fix mistakes in them.

## Phase 1: server and PWA

| #   | Plan                                                          | Result                                                            |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| 01  | ✅ [Repo setup](completed/01-repo-setup.md)                   | Empty monorepo that builds, lints, and tests in CI                |
| 02  | [Server foundation and first deploy](02-server-foundation.md) | Express + Prisma + Postgres live on Render, deploying from `prod` |
| 03  | [GitHub sign in](03-github-auth.md)                           | Users can sign in with GitHub. Tokens stored encrypted            |
| 04  | [GitHub sync engine](04-github-sync.md)                       | Worker pulls each user's PRs on a schedule and stores them        |
| 05  | [Rules and attention items](05-rules-engine.md)               | PR data turned into sorted "needs you" items, all 7 cases         |
| 06  | [API and live updates](06-api.md)                             | JSON API for items, repos, settings. SSE stream                   |
| 07  | [Web app (PWA)](07-web-app.md)                                | The list (design A2), onboarding, settings. Installable           |
| 08  | [Push notifications](08-push-notifications.md)                | Web Push to phone and desktop, quiet hours, morning summary       |

**Milestone:** after plan 08, pr-peek is fully usable on phone and desktop browser, for you and others.

## Phase 2: Mac menu bar app

| #   | Plan                                       | Result                                                               |
| --- | ------------------------------------------ | -------------------------------------------------------------------- |
| 09  | [Desktop app (Tauri)](09-desktop-tauri.md) | Menu bar icon with count, dropdown list, native alerts, auto updates |

## Phase 3: opening it up

| #   | Plan                                       | Result                                                                               |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| 10  | [Launch readiness](10-launch-readiness.md) | Safe and supportable for other people: privacy, limits, monitoring, account deletion |
| 11  | [Future features](11-future.md)            | GitHub App webhooks, PR actions, team views, Slack, and more                         |

## Running in parallel

- **Design iteration** can happen any time before plan 07. Rows use A2 for now. Still to design: phone layout, dark mode, empty and error states, sign in and onboarding. The mockups are on the [design canvas](https://claude.ai/artifact/RiRMAZfxkrJMeSUzfw1ckb).
- Plan 10 items like the privacy page can start any time after plan 03.

## Conventions for every plan

- Work on a branch, open a PR into `main`. Merge `main` into `prod` to deploy.
- Every new piece of logic in `packages/core` or the sync engine gets Vitest tests.
- Secrets live in `.env` locally (never committed) and in Render env groups in production. `.env.example` lists every variable.
- Steps marked **(You)** need you to do something by hand, like creating an account or pasting a secret.
