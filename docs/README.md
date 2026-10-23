# Docs

## Status

Updated after every step. Read this first when picking work back up.

|                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Current plan**   | [09. Desktop app (Tauri)](09-desktop-tauri.md). PRs 1 to 4a (#54), the tray click fix (#68), and repo colors (#69) merged. Side work: quiet mode (swipe a PR to quiet it until something new happens; mockups Q1 to Q5 on the design canvas), as 2 stacked PRs. Author avatars after that, not started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Branch**         | `quiet-mode-server` (PR 1: data, API, wake on new activity). `quiet-mode-list` next, stacked on it (PR 2: swipe and the Quiet section)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **PR**             | Quiet mode PR 1: being opened. `desktop.test.ts` "opens new window and other site links" fails on `main` too, not from this work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Last step done** | 9.6, launch at login                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Next step**      | PR 4b: updates (9.7). Needs the updater signing key's public half from you                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Waiting on you** | Make the updater signing key: `pnpm --filter @pr-peek/desktop tauri signer generate -w ~/.tauri/pr-peek.key`, pick a password, and send the public key (PR 4b). Make the repo public (GitHub, Settings, General, Danger Zone, Change visibility), before the first app release. Try PR 3b in the menu bar app (its "How to test"): one native alert on the Mac, not two, and the phone still gets its push. Try PR 2 in the menu bar app: the count next to the icon, orange and red icons, PR links opening in your browser. Check it stays live on battery. Plan 08 "Done when": a re-request pushes to your iPhone with the app closed, tapping opens the PR, quiet hours hold pushes, and the morning summary arrives on time. A reminder arrives when a review turns orange (PR #47). Phone sign in on `www.git-buddy.com`, then the install checks from PR #32. Plan 07 "Done when" checks. Add repos, then the part 3b stream check in DevTools (PR #23, steps 3 and 4). Plan 04, 05, and 06 "Done when" checks. Plan 02 worker heartbeat. Branch protection for `main`, `prod` |

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

| #   | Plan                                                                       | Result                                                                        |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 01  | ✅ [Repo setup](completed/01-repo-setup.md)                                | Empty monorepo that builds, lints, and tests in CI                            |
| 02  | ✅ [Server foundation and first deploy](completed/02-server-foundation.md) | Express + Prisma live on Render with Supabase Postgres, deploying from `prod` |
| 03  | ✅ [GitHub sign in](completed/03-github-auth.md)                           | Users can sign in with GitHub. Tokens stored encrypted                        |
| 04  | ✅ [GitHub sync engine](completed/04-github-sync.md)                       | Worker pulls each user's PRs on a schedule and stores them                    |
| 05  | ✅ [Rules and attention items](completed/05-rules-engine.md)               | PR data turned into sorted "needs you" items, all 7 cases                     |
| 06  | ✅ [API and live updates](completed/06-api.md)                             | JSON API for items, repos, settings. SSE stream                               |
| 07  | ✅ [Web app (PWA)](completed/07-web-app.md)                                | The list (design A2), onboarding, settings. Installable                       |
| 08  | ✅ [Push notifications](completed/08-push-notifications.md)                | Web Push to phone and desktop, quiet hours, morning summary                   |

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
