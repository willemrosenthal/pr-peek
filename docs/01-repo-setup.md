# 01. Repo setup

**Goal:** an empty pnpm monorepo with the folder layout from [overview.md](overview.md#4-repo-layout), shared TypeScript settings, linting, formatting, tests, and CI. No app features yet.

**Needs:** Node 24 LTS and pnpm installed locally.

## Steps

### 1.1 Root workspace

- [ ] Add `.nvmrc` with `24` so every tool uses the same Node version.
- [ ] Turn on Corepack (Node's built in tool for managing pnpm versions) and pin pnpm with `"packageManager"` in the root `package.json`.
- [ ] Create `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
- [ ] Root `package.json` scripts, each running across all packages with `pnpm -r`:
  - `dev`, `build`, `lint`, `typecheck`, `test`, `format`, `format:check`
- [ ] Create empty packages, each with its own `package.json` and a placeholder `src/index.ts`:
  - `packages/core` (name `@pr-peek/core`)
  - `apps/server` (name `@pr-peek/server`)
  - `apps/web` (name `@pr-peek/web`)
- [ ] Leave `apps/desktop` out until plan 09.

### 1.2 TypeScript

- [ ] `tsconfig.base.json` at the root:
  - `strict: true`
  - `noUncheckedIndexedAccess: true` (array and object lookups might be `undefined`)
  - `exactOptionalPropertyTypes: true`
  - `moduleResolution: "bundler"` for web, `"nodenext"` for server (set per package)
  - `target: "ES2023"`
- [ ] Each package extends the base config.
- [ ] `packages/core` is consumed as TypeScript source by the other packages: point its `exports` at `src/index.ts` for dev and type checks, and let each app's build bundle it. This avoids a separate build step for core.

### 1.3 Lint and format

- [ ] ESLint flat config (`eslint.config.js`) at the root with `typescript-eslint` (type aware rules), `eslint-plugin-react-hooks` for `apps/web`, and `eslint-config-prettier` so ESLint doesn't fight Prettier.
- [ ] Prettier config (`.prettierrc`) and `.prettierignore` (build output, `pnpm-lock.yaml`, generated Prisma client).
- [ ] Optional: `lint-staged` with a `simple-git-hooks` pre-commit hook that runs Prettier and ESLint on staged files.

### 1.4 Tests

- [ ] Vitest in each package, plus a root `vitest.workspace.ts` so `pnpm test` runs everything.
- [ ] One trivial test in `packages/core` to prove the setup works.

### 1.5 Environment variables

- [ ] Root `.env.example`, empty for now except comments. Each later plan adds its variables here.
- [ ] Confirm `.gitignore` covers `.env` and `.env.*` (it already does) and `dist`.

### 1.6 CI

- [ ] `.github/workflows/ci.yml`, on every PR and push to `main`:
  1. Check out the code, set up pnpm and Node from `.nvmrc`, with pnpm caching.
  2. `pnpm install --frozen-lockfile`
  3. `pnpm format:check`
  4. `pnpm lint`
  5. `pnpm typecheck`
  6. `pnpm test`
  7. `pnpm build`
- [ ] **(You)** In GitHub repo settings, protect `main` and `prod`: require the CI check to pass and require PRs.

### 1.7 Branches

- [ ] **(You)** Create the `prod` branch from `main` and push it. Nothing deploys from it yet.

## Done when

- [ ] `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass locally.
- [ ] The same steps pass in GitHub Actions on a PR.
- [ ] `apps/server` can import something from `@pr-peek/core` and type checks.
