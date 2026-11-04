# 15. Automatic releases

**Goal:** merging a PR titled `feat: ...` or `fix: ...` releases it by itself. Once CI passes on `main`, a workflow picks the next version, tags it, deploys the web app by moving `prod` forward, and builds the Mac app if its code changed. A PR titled `chore`, `docs`, `test`, `refactor`, `ci`, or `style` releases nothing.

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
- **The type decides whether to release. The changed files decide what ships.** The scope, like `(web)` or `(desktop)`, is only a label for people: the workflow never reads it. The Mac app builds when `apps/desktop` changed, and Render rebuilds when anything outside `docs/` and `apps/desktop/` changed.
- The biggest change since the last release wins. A `feat` PR and a `fix` PR merged during one run make one minor release.
- `refactor` doesn't release. A refactor waits on `main` until the next `feat` or `fix` ships it.
- **Not chosen, release-please:** it waits for you to merge a release PR. We want releases to happen on merge.

## Key decision: one workflow, in order, only after CI passes

`release.yml` runs on every push to `main`. Its jobs, in order:

1. **Checks:** calls the existing CI workflows (`ci.yml`, `test-*.yml`, `check-desktop.yml`) as reusable workflows. They drop their own `push: main` trigger, so nothing runs twice. Pull requests run them as before.
2. **Version:** semantic-release decides whether to release. If so, it pushes the tag and nothing else: no commit back to `main`, no GitHub Release. The job then reads the version from the `v*` tag on the commit, not from semantic-release's output, so a re-run finds a tag an earlier attempt made. It also says whether `apps/desktop` changed since the last Mac release.
3. **Deploy web** and **Mac app**, side by side, only if there's a new version.

Everything happens in one workflow because a tag pushed with the workflow's own token can't start another workflow.

Runs never overlap (`concurrency: release`, not cancelled). If several merges land during a run, the next run covers all of them. If one lands while semantic-release runs, semantic-release sees `main` moved and skips, and the next run releases both.

**Not chosen, skip the checks on `main`:** PR checks run on the PR, and the squashed commit could differ if `main` moved since. Running them again before releasing is the one gate that doesn't depend on settings.

## Key decision: deploy by moving `prod` forward, never forcing it

The deploy job runs `git push origin <released commit>:prod`. Render deploys `prod` as it does today, and runs database migrations first (`preDeployCommand` in `render.yaml`).

- A plain push, no force. If `prod` has a commit `main` doesn't, the push fails loudly instead of losing it.
- Render skips the deploy by itself if only `docs/` or `apps/desktop/` changed (`buildFilter`).
- The tag and `prod` are pushed with a **deploy key**: an SSH key that can write to this repo only, kept as the secret `RELEASE_DEPLOY_KEY`. The workflow's own token can't, because GitHub refuses it any push whose history changes a workflow file. The first release is one, since it adds `release.yml`.
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
3. Publish it. Mark it latest only if its version is higher than the current latest Mac release, and otherwise say `--latest=false` out loud: GitHub marks a newly published release latest unless told not to. A re-run of an older release must never take "latest" back, or the updater would point at an old version.
4. Download `releases/latest/download/latest.json`. Check it has the new version, and entries for both chips (`darwin-aarch64` and `darwin-x86_64`). This is exactly what installed apps will see.

## Key decision: squash merge, and check the PR title

Each PR lands on `main` as one squashed commit, named after the PR title. So the title decides the release, and you can see what a PR will release before merging it. Commits inside a PR can say anything.

- A `pr-title` check fails any PR whose title doesn't follow the format, like "Small fix", which would otherwise never release. It blocks the merge until the title is fixed, and runs again when the title is edited.
- GitHub's "Revert" PRs, titled `Revert "..."`, are allowed. They release a patch.
- GitHub adds ` (#123)` to the end of each squashed title. That's fine.
- The squashed commit's body lists the PR's commits. semantic-release reads a `BREAKING CHANGE:` line anywhere in it, so commits must not say that unless a major version is agreed.
- **Not chosen, merge commits:** the PR title would only go in the merge commit's body, which semantic-release doesn't read. Every commit inside the PR would need checking instead.

## Safety, and what to do when something fails

| Problem                                           | What happens                                   | Fix                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| CI fails on `main`                                | Nothing releases                               | Fix forward with a `fix:` PR                                                                              |
| The Mac build fails after the tag                 | The web still deploys. The draft stays a draft | "Re-run failed jobs" on that run. Or run "Desktop release" by hand with the tag                           |
| The deploy push fails (`prod` has moved)          | No deploy                                      | Find out why `prod` moved, then "Re-run failed jobs"                                                      |
| A bad release reached `prod`                      | It's live                                      | Render dashboard, Rollback. Then merge a revert PR, which releases a patch. Migrations aren't rolled back |
| A bad Mac release                                 | Users get offered it                           | Merge a `fix` PR that changes `apps/desktop`. The updater only moves forward                              |
| A Mac build fails and is never re-run             | Its draft stays. Nothing breaks                | The next release that changes `apps/desktop` includes its changes. Delete the old draft                   |
| An old release run is re-run                      | Nothing moves backwards                        | `prod` refuses a push that goes back. "Latest" only moves to a higher version                             |
| The deploy key is missing or revoked              | The version step fails. Nothing releases       | Make a new one (step 15.7), then "Re-run failed jobs"                                                     |
| GitHub errors on a push ("Internal Server Error") | Nothing releases, or that job stops            | "Re-run failed jobs". It happened once, on 1.1.0's tag push                                               |
| A workflow runs in someone's fork                 | It stops at once                               | The `version` job checks `github.repository`                                                              |
| Render ignores the workflow's push to `prod`      | No deploy                                      | Shouldn't happen: Render hears every push. If it does, the deploy job calls a Render deploy hook instead  |
| You need to deploy without a release              | Still possible                                 | `git push origin main:prod` from your machine. For emergencies only                                       |

## PRs

1. This plan.
2. All of the steps below, in one PR (about 300 lines). Titled `feat(ci): automatic releases`, so merging it makes the first release, 1.0.0. That deploys everything waiting on `main` (no database migrations as of this plan) and builds Mac app 1.0.0.

## Steps

### 15.1 Tools and config

- [x] Add `semantic-release`, `conventional-changelog-conventionalcommits`, `@commitlint/cli`, and `@commitlint/config-conventional` as root dev dependencies, so versions are pinned in the lockfile. commitlint checks PR titles, with the same rules semantic-release reads.
- [x] `.releaserc.json`:
  - `branches: ["main"]`, `tagFormat: "v${version}"`.
  - Plugins listed by hand, which drops the defaults that publish to npm and make GitHub Releases: only `commit-analyzer`, with the `conventionalcommits` preset.
  - No `release-notes-generator`: nothing reads its notes, since Mac releases use GitHub's own. It also broke the first release: the preset needs a newer notes writer than semantic-release ships.
  - Check the default rules give a patch for `perf`, and for a squashed GitHub revert (`Revert "feat: x" (#123)`, with "This reverts commit ..." in the body). Add `releaseRules` if not.
- [x] `commitlint.config.js`, extending `config-conventional`.
- [x] Run `pnpm exec semantic-release --dry-run --no-ci --branches <this branch>` locally (it only runs on its release branch otherwise). It should say 1.0.0.
- [x] Check commitlint passes `fix(web): x`, GitHub's `Revert "fix(web): x"`, and fails `Small fix`.

### 15.2 Version placeholders

- [x] Set `version` to `0.0.0` in `tauri.conf.json` and `Cargo.toml` (and `Cargo.lock`).
- [x] Check that `pnpm desktop:build --config '{"version":"9.9.9"}'` makes an app whose `Info.plist` says 9.9.9.

### 15.3 Reusable checks

- [x] Add `workflow_call` to `ci.yml`, `test-core.yml`, `test-server.yml`, `test-web.yml`, and `check-desktop.yml`. Remove their `push: main` triggers. Their `pull_request` triggers stay.
- [x] Add [actionlint](https://github.com/rhysd/actionlint) to `ci.yml`'s `check` job. A mistake in `release.yml` would otherwise only show up after merging, on `main`.
- [x] `pr-title.yml`, on pull requests (`opened`, `edited`, `synchronize`, `reopened`): runs commitlint on the PR title. Job name `pr-title`.
  - The title goes in through an environment variable, never pasted into the script. Anyone can open a PR on a public repo, and a title like `$(...)` must not run.
  - A failure says what's wrong and shows an example, like `fix(web): keep the list sorted`.

### 15.4 Mac release workflow

- [x] Rewrite `desktop-release.yml` as a reusable workflow, with one input: the tag. It can also be run by hand from the Actions tab (`workflow_dispatch`) to rebuild a tag. It stops unless the tag looks like `v1.2.3` and exists. The tag reaches scripts through an environment variable.
- [x] `concurrency` per tag, so a hand run and a release run never build the same tag at once.
- [x] Steps: check out the tag, set up Node, pnpm, and Rust, create or reuse the Release (draft), build into it with `tauri-action`, publish it, mark it latest if it's the newest, then check `latest.json`.
- [x] The `--config` passes `version`, `createUpdaterArtifacts`, and the stand-in signature, all in one JSON.

### 15.5 Release workflow

- [x] `release.yml`, on push to `main`. `concurrency: { group: release, cancel-in-progress: false }`. The `version` job has `if: github.repository == 'willemrosenthal/pr-peek'`, and everything that pushes or publishes needs it.
- [x] Job `checks`: calls the reusable checks.
- [x] Job `version`: check out with full history and the deploy key, run semantic-release, then output `version` from the `v*` tag on the commit (empty if none). Then output `desktop`: true if there's no published Mac release yet, or if this version is higher than the latest one and `git diff` shows changes in `apps/desktop` since it.
- [x] Job `deploy`, if there's a version: check out with full history and the deploy key, then push the released commit to `prod`, with no force. Pushing a commit `prod` already has does nothing, so re-runs are safe.
- [x] Job `desktop`, if there's a version and `desktop` is true: calls `desktop-release.yml` with the tag. It grants `contents: write` and passes the two updater secrets by name, not `secrets: inherit`.
- [x] Job `checks` gets only `contents: read`.
- [x] Each job writes a line to the run's summary page: the version, "Deployed", "Mac app built" or "Mac app unchanged".

### 15.6 Docs

- [x] `CLAUDE.md`:
  - PR titles: `type(scope): what it does`, like `feat(desktop): auto updates`. Which types release, and to use `chore`, `docs`, `test`, `refactor`, or `ci` for changes that shouldn't deploy. Breaking changes (`!`) only when agreed.
  - Commits inside a PR still use the same format, out of habit, but only the title counts.
  - A change that must ship but isn't a feature, like a security update to a dependency, is titled `fix(deps): ...`.
  - Branches: `prod` moves forward by itself. Push to it by hand only in an emergency.
  - The PR template's "What to do next": deploying is automatic, so it lists only what to try once it's live.
- [x] Plan 09: 9.8 now starts from this workflow, and its "Done when" update check uses a `fix` PR that changes `apps/desktop`, instead of a tag. Its Apple signing step must also pass the Apple secrets through `release.yml` to `desktop-release.yml`, since reusable workflows only get the secrets they're given.

### 15.7 GitHub and Render settings (You)

Before PR 2 merges. First the deploy key (see "deploy by moving `prod` forward"):

- [x] Make an SSH key with no passphrase. Add its public half in GitHub, Settings, Deploy keys, with **Allow write access**. Add its private half as the Actions secret `RELEASE_DEPLOY_KEY`. Then delete both files.

Then, so that PR 2 is squashed too, in GitHub, Settings, General, Pull Requests:

- [x] Turn on **Allow squash merging**, with **Default commit message** set to **Pull request title and commit details**. That keeps each commit's co-author line.
- [x] Turn off **Allow merge commits** and **Allow rebase merging**.
- [x] In Settings, General, Releases: leave **Immutable releases** off. It stops files being added to a release after it's made, which breaks the Mac upload.
- [x] In Render, for both services: keep **Auto-Deploy** on **On Commit**, not **After CI Checks Pass**. The release run is still building the Mac app when `prod` moves, so Render would wait for it, and skip the deploy if it failed.
- [x] In Render, Account Settings, Notifications: make sure failed deploys email you. The workflow can't see whether Render's deploy worked.

After PR 2 merges, add rulesets in GitHub, Settings, Rules, Rulesets:

- [x] **`main`:** require a pull request, with 0 approvals (you can't approve your own PRs), and require these checks to pass: `check`, `test-core`, `test-server`, `test-web`, `pr-title`. Not `check-desktop`, since it only runs when `apps/desktop` changes, and a check that didn't run would block the merge. Block force pushes.
- [x] **`prod`:** block force pushes and deletion. Don't require a pull request, or the workflow couldn't move it forward.
- [x] **Tags `v*`:** block deletion and updates, so a release tag can't be moved. Leave creation open for the workflow.

## Done when

- [x] Merging PR 2 makes 1.0.0. `prod` deploys, and Mac app 1.0.0 is the latest release, with both chips in `latest.json`.
  - Done with #110, after #109's run failed in the release notes plugin. All 8 jobs passed, and `latest.json` links point at `v1.0.0`.
- [x] A PR titled `docs: ...` merges, and nothing releases or deploys.
  - Done with #111 (`ci:`): the checks ran, no tag, no deploy, no Mac build.
- [x] A `fix` PR that changes only web code merges. A patch version is tagged, `prod` moves to it, Render deploys, and no Mac release is made.
  - Done with #112, a `feat` (1.1.0). Settings on the live site shows "Version 1.1.0", so Render's copy has the tags. The first try at the tag push got a 500 from GitHub, and "Re-run failed jobs" finished it.
- [ ] A `fix` PR that changes `apps/desktop` merges. A Mac release is published with the new version, and an installed Mac app offers the update and installs it.
- [x] A PR titled "Small fix" fails the `pr-title` check and can't merge. Renaming it to `fix(web): ...` passes.
  - Done with #112: "Show the version in Settings" failed `pr-title`, GitHub marked it blocked, and renaming it to `feat(web): ...` passed.
- [ ] A GitHub revert PR passes `pr-title`, and releases a patch.
- [ ] A Mac build that fails leaves a draft, not a broken latest release, and "Re-run failed jobs" finishes it.
