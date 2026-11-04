# 15. Automatic releases

**Goal:** merging a PR with a `feat` or `fix` commit releases it by itself. Once CI passes on `main`, a workflow picks the next version, tags it, deploys the web app by moving `prod` forward, and builds the Mac app if its code changed. A PR with only `chore`, `docs`, `test`, `refactor`, `ci`, or `style` commits releases nothing.

**Needs:** plan 09 PR 5 (#107), the release pipeline. Replaces its tag-triggered start: tags now come from this workflow.

## Key decision: semantic-release, with versions from commit types

[semantic-release](https://semantic-release.gitbook.io) reads the commits since the last `v*` tag:

| Commit                                 | Version        | Releases? |
| -------------------------------------- | -------------- | --------- |
| `feat: ...`                            | 1.2.0 to 1.3.0 | Yes       |
| `fix: ...`, `perf: ...`                | 1.2.0 to 1.2.1 | Yes       |
| GitHub's "Revert" commits              | 1.2.0 to 1.2.1 | Yes       |
| `feat!: ...`, or `BREAKING CHANGE:`    | 1.2.0 to 2.0.0 | Yes       |
| `chore`, `docs`, `test`, `refactor`... | none           | No        |

- One version for the whole repo, tagged `v1.2.3`. It starts at **1.0.0**.
- The biggest change in a run wins. A PR with a `feat` and three `fix` commits is one minor release.
- `refactor` doesn't release. A refactor waits on `main` until the next `feat` or `fix` ships it.
- Merge commits ("Merge pull request #...") are skipped. The commits inside the PR decide.
- **Not chosen, release-please:** it waits for you to merge a release PR. We want releases to happen on merge.

## Key decision: one workflow, in order, only after CI passes

`release.yml` runs on every push to `main`. Its jobs, in order:

1. **Checks:** calls the existing CI workflows (`ci.yml`, `test-*.yml`, `check-desktop.yml`) as reusable workflows. They drop their own `push: main` trigger, so nothing runs twice. Pull requests run them as before.
2. **Version:** semantic-release decides whether to release. If so, it pushes the tag and nothing else: no commit back to `main`, no GitHub Release. It also says whether `apps/desktop` changed since the last Mac release.
3. **Deploy web** and **Mac app**, side by side, only if there's a new version.

Everything happens in one workflow because a tag pushed with the workflow's own token can't start another workflow.

Runs never overlap (`concurrency: release`, not cancelled). If several merges land during a run, the next run covers all of them.

## Key decision: deploy by moving `prod` forward, never forcing it

The deploy job runs `git push origin <released commit>:prod`. Render deploys `prod` as it does today, and runs database migrations first (`preDeployCommand` in `render.yaml`).

- A plain push, no force. If `prod` has a commit `main` doesn't, the push fails loudly instead of losing it.
- Render skips the deploy by itself if only `docs/` or `apps/desktop/` changed (`buildFilter`).
- **What changes for you:** no more merging `main` into `prod` by hand. "Try it once it's live" checks happen after the automatic deploy.

## Key decision: a Mac release only when the Mac app changed

The Mac app shows the hosted web app, so web changes reach it through the deploy. A new Mac build for a web change would change nothing, and still ask every user to restart.

- The Mac app builds only when `apps/desktop` changed since the last published Mac release. Mac versions skip numbers (1.2.0, then 1.5.0), which is fine.
- **Web-only versions get a tag, not a GitHub Release.** The updater reads `releases/latest/download/latest.json`, and the download link opens `releases/latest`. Both mean GitHub's latest **Release**, so it must always be a Mac release. That address is built into every installed copy, so it can't change later.

## Key decision: the version comes from the tag, at build time

The build passes the version in: `--config '{"version":"1.2.3"}'`. So:

- Nothing commits a version bump to `main`, and branch protection never needs a bot exception.
- `tauri.conf.json` and `Cargo.toml` hold `0.0.0`, only for dev builds. A local `pnpm desktop:build` is older than any release, so the updater replaces it with the real one.

## Key decision: a Mac release is a draft until it's complete

If a build fails halfway, a half-empty release must never become "latest", or installed apps would stop finding updates.

1. Create the Release as a **draft**, with notes listing the PRs since the last Mac release (`gh release create --draft --generate-notes`).
2. `tauri-action` builds and uploads into that draft (`releaseId`).
3. Publish it and mark it latest (`gh release edit --draft=false --latest`).
4. Download `releases/latest/download/latest.json` and check it has the new version. This is exactly what installed apps will see.

## Key decision: check commit messages on every PR

A commit like "small fix" doesn't match any type, so it would never release, and nobody would notice. A `commitlint` check on each PR fails on commits that don't follow the format. GitHub's own merge and revert commits are allowed.

## Safety, and what to do when something fails

| Problem                                  | What happens                                   | Fix                                                                                                       |
| ---------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| CI fails on `main`                       | Nothing releases                               | Fix forward with a `fix:` PR                                                                              |
| The Mac build fails after the tag        | The web still deploys. The draft stays a draft | "Re-run failed jobs" on that run. Or run "Desktop release" by hand with the tag                           |
| The deploy push fails (`prod` has moved) | No deploy                                      | Find out why `prod` moved, then "Re-run failed jobs"                                                      |
| A bad release reached `prod`             | It's live                                      | Render dashboard, Rollback. Then merge a revert PR, which releases a patch. Migrations aren't rolled back |
| A bad Mac release                        | Users get offered it                           | Merge a `fix(desktop):` PR. The updater only moves forward                                                |
| A workflow runs in someone's fork        | It stops at once                               | Every job checks `github.repository`                                                                      |
| You need to deploy without a release     | Still possible                                 | `git push origin main:prod` from your machine. For emergencies only                                       |

## PRs

1. This plan.
2. All of the steps below, in one PR (about 300 lines). When it merges, its own `feat` commit makes the first release, 1.0.0. That deploys the 12 commits waiting on `main` (none add database migrations) and builds Mac app 1.0.0.

## Steps

### 15.1 Tools and config

- [ ] Add `semantic-release`, `@semantic-release/exec`, `conventional-changelog-conventionalcommits`, `@commitlint/cli`, and `@commitlint/config-conventional` as root dev dependencies, so versions are pinned in the lockfile.
- [ ] `.releaserc.json`:
  - `branches: ["main"]`, `tagFormat: "v${version}"`.
  - Plugins listed by hand, which drops the defaults that publish to npm and make GitHub Releases: `commit-analyzer` and `release-notes-generator` with the `conventionalcommits` preset, then `exec`.
  - `exec`'s `successCmd` writes the new version to `$GITHUB_OUTPUT`.
  - Check the default rules give a patch for `perf` and for GitHub's `Revert "..."` commits. Add `releaseRules` if not.
- [ ] `commitlint.config.js`, extending `config-conventional`.
- [ ] Run `pnpm exec semantic-release --dry-run --no-ci` locally. It should say 1.0.0 and list the `feat` and `fix` commits.

### 15.2 Version placeholders

- [ ] Set `version` to `0.0.0` in `tauri.conf.json` and `Cargo.toml` (and `Cargo.lock`).
- [ ] Check that `pnpm desktop:build --config '{"version":"9.9.9"}'` makes an app whose `Info.plist` says 9.9.9.

### 15.3 Reusable checks

- [ ] Add `workflow_call` to `ci.yml`, `test-core.yml`, `test-server.yml`, `test-web.yml`, and `check-desktop.yml`. Remove their `push: main` triggers. Their `pull_request` triggers stay.
- [ ] `commitlint.yml`, on pull requests: checks every commit from the PR's base to its head.

### 15.4 Mac release workflow

- [ ] Rewrite `desktop-release.yml` as a reusable workflow, with one input: the tag. It can also be run by hand from the Actions tab (`workflow_dispatch`) to rebuild a tag.
- [ ] Steps: check out the tag, set up Node, pnpm, and Rust, create or reuse the draft Release, build into it with `tauri-action`, publish it as latest, then check `latest.json` has the new version.
- [ ] The `--config` passes `version`, `createUpdaterArtifacts`, and the stand-in signature, all in one JSON.

### 15.5 Release workflow

- [ ] `release.yml`, on push to `main`. `concurrency: { group: release, cancel-in-progress: false }`. Every job has `if: github.repository == 'willemrosenthal/pr-peek'`.
- [ ] Job `checks`: calls the reusable checks.
- [ ] Job `version` (`contents: write`): check out with full history, run semantic-release, output `version`. Then output `desktop`: true if there's no published Mac release yet, or `git diff` shows changes in `apps/desktop` since the latest one.
- [ ] Job `deploy` (`contents: write`), if there's a version: push the released commit to `prod`, with no force.
- [ ] Job `desktop`, if there's a version and `desktop` is true: calls `desktop-release.yml` with the tag, passing the updater secrets.
- [ ] Each job writes a line to the run's summary page: the version, "Deployed", "Mac app built" or "Mac app unchanged".

### 15.6 Docs

- [ ] `CLAUDE.md`:
  - Commit types: which ones release, and to use `chore`, `docs`, `test`, `refactor`, or `ci` for changes that shouldn't deploy. Breaking changes (`!`) only when agreed.
  - Branches: `prod` moves forward by itself. Push to it by hand only in an emergency.
  - The PR template's "What to do next": deploying is automatic, so it lists only what to try once it's live.
- [ ] Plan 09: 9.8 now starts from this workflow, and its "Done when" update check uses a `fix(desktop):` PR instead of a tag.

### 15.7 GitHub settings (You)

After the PR merges, add rulesets in GitHub, Settings, Rules, Rulesets:

- [ ] **`main`:** require a pull request, and require these checks to pass: `check`, `test-core`, `test-server`, `test-web`, `commitlint`. Not `check-desktop`, since it only runs when `apps/desktop` changes, and a check that didn't run would block the merge. Block force pushes.
- [ ] **`prod`:** block force pushes and deletion. Don't require a pull request, or the workflow couldn't move it forward.
- [ ] **Tags `v*`:** block deletion and updates, so a release tag can't be moved. Leave creation open for the workflow.

## Done when

- [ ] A PR with only a `docs:` commit merges, and nothing releases or deploys.
- [ ] A PR with a `fix(web):` commit merges. A patch version is tagged, `prod` moves to it, Render deploys, and no Mac release is made.
- [ ] A PR with a `fix(desktop):` commit merges. A Mac release is published with the new version, and an installed Mac app offers the update and installs it.
- [ ] A PR with a commit like "small fix" fails the `commitlint` check.
- [ ] A Mac build that fails leaves a draft, not a broken latest release, and "Re-run failed jobs" finishes it.
