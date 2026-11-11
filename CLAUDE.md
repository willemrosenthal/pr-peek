# Git Buddy (code name pr-peek)

A tool that tracks GitHub PRs that need your attention. Web app (PWA), Mac menu bar app (Tauri), push notifications.

- Call it **Git Buddy** in anything people see: UI text, notifications, docs.
- Keep `pr-peek` for internal names: packages, storage keys, DOM events, the database. The Mac and iPhone apps' ID (`com.git-buddy.pr-peek`) must never change, or users lose their login and launch at login, and the iPhone app its App Store listing and pushes.

- What we're building and the tech stack: [docs/overview.md](docs/overview.md)
- Build plans, in order: [docs/README.md](docs/README.md)
- Design mockups: https://claude.ai/artifact/RiRMAZfxkrJMeSUzfw1ckb

## Writing style

Keep all writing short, simple, and clear. This covers PR descriptions, chat messages, docs, and code comments.

- Short sentences. Plain words.
- Explain a technical term in a few words the first time.
- No em dashes.

## Working on a plan

Follow these steps every time. Committing and opening a PR are required parts of this workflow.

### 0. Pick up where we left off

At the start of every session, before anything else:

- Read the **Status** table at the top of [docs/README.md](docs/README.md).
- Check it against reality: `git branch --show-current`, `git status --short`, and `gh pr list --author @me --state open`.
- If they disagree, trust git and GitHub, fix the Status table, and tell the user what you found.
- Continue from **Next step**.

Keep the Status table current:

- Update it after every numbered step, and whenever a PR opens, merges, or something is waiting on the user.
- Commit it with the work on the plan branch, so it travels with the PR.

### 1. Start

- Read the plan in `docs/` and the plans it depends on.
- Make sure the previous plan's PR is merged. If it isn't, ask: wait, or build on top of its branch?
- Update `main` (`git pull`), then create a branch: `plan-<number>-<short-name>`. Example: `plan-02-server-foundation`.

### 2. Size of a PR

- One PR per plan by default.
- If a plan is big (roughly over 400 changed lines, or it mixes unrelated parts), split it into one PR per numbered step group. Name branches like `plan-02-1-config`.
- Tell the user up front how you'll split it.

### 3. Build

- Do the plan's steps. Tick the checkboxes in the plan file as you go.
- Skip steps marked **(You)**. List them for the user instead.
- If you learn something that changes the plan, update the plan file in the same PR and mention it.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before committing (once plan 01 sets them up). Run Prettier on changed files.

### 4. Finish the plan

In the last PR for a plan:

- Check every "Done when" item you can check. Mark the ones the user must check.
- Move the plan into `docs/completed/` and update the links (see [docs/README.md](docs/README.md)).

### 5. Commit and open the PR

- Use the `git-commit` skill to commit and the `git-create-pr` skill to push and open the PR.
- Never commit to `main` or `prod` directly.
- Give the PR a title like `type(scope): what it does`. See [Releases](#releases): the title decides whether merging it releases.

### 6. PR description

Use this template. Keep each part to a few bullets.

```md
## What

- What this PR adds, in plain words.

## Why

- Which plan and step this is. Link the plan file.

## How to test

1. Exact steps to try it.

## What to do next

1. Things you need to do by hand (accounts, secrets, settings). Say exactly where.
2. Review and merge this PR. Say whether merging releases it, and what to try once it's live.
3. What comes next: the next plan or step.
```

### 7. Tell the user in chat

After the PR is up, send a short message with:

- The PR link.
- One or two lines on what it does.
- **What to do next**, as a numbered list. Same as the PR, so it can be done from either place.

## Shell commands

- Run git and gh from the repo root as plain `git ...` or `gh ...`. Don't use `git -C <path>`. It stops the permission allow list from matching.
- Keep commit messages on one line with `-m`, and add the co-author trailer with a second `-m`.
- The user wants as few permission prompts as possible. Before running a command, check it matches a rule in `.claude/settings.local.json` or `~/.claude/settings.json`. If it doesn't, prefer a form that does: a `pnpm` script, or a plain command without pipes, `&&`, `$VARS`, or `$(...)`. These always prompt.
- Don't probe for tools outside the repo (`ls /opt/...`, `echo $PATH`). If a tool is missing, tell the user.

## Database migrations

- Every migration must work with the code that's live, since Render migrates before swapping versions. Removing, renaming, or making a column required takes two releases. See [Migrations that are safe to deploy](docs/overview.md#migrations-that-are-safe-to-deploy).

## Branches

- `main`: work lands here through PRs, squash merged.
- `prod`: what's live. The release workflow moves it forward, and Render deploys it. Push to it by hand only in an emergency.

## Releases

Merging a PR can release it. PRs are squash merged, so the PR title becomes the commit on `main`, and its type decides. A `pr-title` check blocks PRs whose title doesn't follow the format. Details: [docs/completed/15-auto-release.md](docs/completed/15-auto-release.md).

| Title starts with                                  | Merging it                                             |
| -------------------------------------------------- | ------------------------------------------------------ |
| `feat`                                             | Releases a minor version (1.2.0 to 1.3.0), and deploys |
| `fix`, `perf`                                      | Releases a patch (1.2.0 to 1.2.1), and deploys         |
| `chore`, `docs`, `test`, `refactor`, `ci`, `style` | Nothing. It ships with the next release                |

- Scopes: `web`, `server`, `core`, `desktop`, `ios`, `ci`, `deps`. Like `fix(desktop): keep the dropdown open`. The scope is only a label: the changed files decide what ships.
- A change that must ship but isn't a feature, like a security update to a dependency, is `fix(deps): ...`.
- A release deploys the web app, and builds the Mac app only when `apps/desktop` or `.github/workflows/desktop-release.yml` changed since the last Mac release.
- Breaking changes (`feat!:`, or `BREAKING CHANGE:` in any commit message) release a major version. Only when the user agrees.
- Commits inside a PR use the same format, out of habit, but only the title counts.
