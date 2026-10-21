# 01. Repo setup

**Goal:** an empty pnpm monorepo with the folder layout from [overview.md](../overview.md#4-repo-layout), shared TypeScript settings, linting, formatting, tests, and CI. No app features yet.

**Needs:** Node 24 LTS and pnpm installed locally.

## Changes from the original plan

- **Module resolution:** every package uses `"bundler"`, including the server. The server is bundled by tsup (plan 02), so it can import `packages/core` source without `.js` file extensions.
- **TypeScript is pinned to 6.0.** TypeScript 7 (the new native compiler) is out, but `typescript-eslint` only supports up to 6.0. Move to 7 once `typescript-eslint` supports it.
- **Vitest projects:** Vitest 5 uses `test.projects` in a root `vitest.config.ts` instead of a separate `vitest.workspace.ts` file.
- **pnpm 9.15.4** is pinned, matching what's installed. pnpm 12 is out. Upgrading is a separate, small task.
- **`pnpm build`** does nothing yet. Plan 02 adds the server build and plan 07 the web build.
- **Pre-commit hooks** (the optional step) were skipped. CI runs the same checks.

## Steps

### 1.1 Root workspace

- [x] Add `.nvmrc` with `24` so every tool uses the same Node version.
- [x] Pin pnpm with `"packageManager"` in the root `package.json`.
- [ ] **(You, optional)** Run `corepack enable` so your machine uses the pinned pnpm version automatically.
- [x] Create `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
- [x] Root `package.json` scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `format`, `format:check`.
- [x] Create empty packages, each with its own `package.json` and a placeholder `src/index.ts`:
  - `packages/core` (name `@pr-peek/core`)
  - `apps/server` (name `@pr-peek/server`)
  - `apps/web` (name `@pr-peek/web`)
- [x] Leave `apps/desktop` out until plan 09.

### 1.2 TypeScript

- [x] `tsconfig.base.json` at the root: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: "bundler"`, `target: "ES2023"`.
- [x] Each package extends the base config.
- [x] `packages/core` is consumed as TypeScript source: its `exports` point at `src/index.ts`.

### 1.3 Lint and format

- [x] ESLint flat config (`eslint.config.js`) with type aware `typescript-eslint`, `eslint-plugin-react-hooks` for `apps/web`, and `eslint-config-prettier`.
- [x] Prettier config (`.prettierrc`) and `.prettierignore`.
- [ ] Optional pre-commit hooks. Skipped.

### 1.4 Tests

- [x] Vitest with a root `vitest.config.ts` that runs every package as a project.
- [x] One trivial test in `packages/core`.

### 1.5 Environment variables

- [x] Root `.env.example`, empty for now except comments.
- [x] `.gitignore` covers `.env`, `.env.*`, and `dist`.

### 1.6 CI

- [x] `.github/workflows/ci.yml`, on every PR and push to `main`: install, format check, lint, typecheck, test, build.
- [ ] **(You)** In GitHub repo settings, protect `main` and `prod`: require the CI check to pass and require PRs.

### 1.7 Branches

- [ ] **(You)** Create the `prod` branch from `main` and push it. Nothing deploys from it yet.

## Done when

- [x] `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass locally.
- [x] The same steps pass in GitHub Actions on a PR (PR #2).
- [x] `apps/server` can import something from `@pr-peek/core` and type checks.
