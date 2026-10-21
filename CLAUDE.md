# pr-peek

A tool that tracks GitHub PRs that need your attention. Web app (PWA), Mac menu bar app (Tauri), push notifications.

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
2. Review and merge this PR.
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

## Branches

- `main`: work lands here through PRs.
- `prod`: what's live. Merging `main` into `prod` deploys to Render.
