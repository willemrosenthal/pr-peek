# 07. Web app (PWA)

**Goal:** the React app people actually use, with sign in, onboarding, the list, and settings. It's installable on phone and desktop. Push notifications come in plan 08.

**Needs:** plan 06. The final row design from the design iteration (step 7.1).

**Split into five PRs:**

- **Part 1** (`plan-07-1-setup`): 7.2 project setup, sign in, and the design tokens from 7.3.
- **Part 2** (`plan-07-2-github-token`): the personal access token becomes an add-on to GitHub sign in, not a way to sign in. See Changes.
- **Part 3** (`plan-07-3-list`): 7.4 the list, 7.5 layouts, and their tests.
- **Part 4** (`plan-07-4-settings`): 7.6 onboarding and settings.
- **Part 5** (`plan-07-5-pwa`): 7.7 PWA, and the Playwright smoke test.

## Changes from the original plan

- **No separate design pass.** The screens step 7.1 still lists (phone layout, dark mode, empty and error states, sign in, onboarding) are built in code from A2's look, then adjusted in the real app.
- **Dev runs on the Vite server.** `APP_URL` is `http://localhost:5173` in dev. Vite passes `/api` to Express on 3000. The dev OAuth App already allows that callback (plan 03). Update your `.env` to match `.env.example`.
- **`GET /api/me` no longer returns `settings`.** It sent the raw database row. The app reads settings from `GET /api/settings`. The response type is `MeResponse` in `packages/core/src/api/auth.ts`.
- **`build:render` didn't need a change.** `pnpm build` builds every package, and the server only reads `apps/web/dist` when it starts.
- **Sign in is a page, not a dialog.**
- **Everyone signs in with GitHub. A personal access token is an optional add-on** (part 2). Before, a pasted token was a way to sign in, which had two problems. Every new device or browser needed the token pasted again. And signing in with GitHub replaced the pasted token, which quietly stopped syncs of repos in orgs that block our OAuth App. Now:
  - Signing in with GitHub works even when an org blocks our app. The block only stops the app reading that org's repos.
  - `PUT /api/github-token` adds or replaces the token. It must belong to the signed in GitHub account. `DELETE` removes it. `POST /api/auth/token` is gone.
  - Syncs use the token when there is one. They never fall back to the sign in token, which may not see the org's repos.
  - A token GitHub stops accepting sets `syncError` to `"token"`. Syncs stop until the user adds a new one. `"reauth"` still means sign in with GitHub again.
  - `/api/me` has `githubToken` (expiry, scopes, `invalid`) instead of `authMethod`. The `authMethod` column stays for now, so old servers keep working during a deploy. Drop it in a later migration.
  - The migration moves tokens pasted at sign in into the new columns. Those users sign in with GitHub next time.
  - The token form (`components/GitHubToken.tsx`) sits on the placeholder home page until settings and onboarding exist (part 4).
- **`api.http` signs in with your browser's session cookie**, since token sign in is gone. Steps at the top of the file.
- **Onboarding** sends you to the list until part 4 builds it.
- **Showing GitHub avatars needs a CSP change.** Helmet only allows images from our own site. Add `https://avatars.githubusercontent.com` to `img-src` when the first avatar appears.

## Steps

### 7.1 Finish the design (can start earlier)

- [x] Pick a row style in the [design canvas](https://claude.ai/artifact/RiRMAZfxkrJMeSUzfw1ckb). Current choice: **A2, divided two-line list**. It may still change.
- [x] Also design (built in code instead, see Changes):
  - The phone layout (full screen list).
  - Dark mode.
  - Empty, loading, and error states.
  - The sign in and onboarding screens.
- [x] Write down the final tokens (colors, type sizes, spacing, radii) for step 7.3. In `apps/web/src/styles/tokens.css`.

### 7.2 Project setup (part 1, done)

- [x] Vite + React + TypeScript in `apps/web`.
- [x] Vite dev server on `5173`, proxying `/api` to Express on `3000`. Same origin in dev and prod means cookies and CSRF checks behave the same.
- [x] React Router routes. `/signin` is done. The others come in later parts:

| Route            | Screen                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `/signin`        | Sign in with GitHub, with a clear note about permissions and a "public repos only" option |
| `/onboarding`    | Pick repos, set timezone, prompt to install and turn on notifications                     |
| `/`              | The list                                                                                  |
| `/settings/:tab` | General, Repositories, Rules, Timing, Devices                                             |
| `/install`       | How to install on iPhone, Android, Mac                                                    |

- [x] A personal access token form, for users whose org blocks our OAuth App (plan 04, step 4.0). Changed in part 2: it's in the app after sign in, not on `/signin`, and posts to `PUT /api/github-token`. Show the error message from the server. Short steps above the box:
  1. GitHub, Settings, Developer settings, Personal access tokens, **Tokens (classic)**, Generate new token (classic).
  2. Tick `repo` (its sub-boxes tick with it) and `read:org`. Leave the rest. For public repos only, tick just `public_repo` instead of `repo`. Pick an expiry you're happy with. You'll paste a new token when it runs out.
  3. If your company uses single sign-on, click **Configure SSO**, then **Authorize** next to your org. Without this, work repos won't show up.
  4. Copy the token and paste it here.
- [x] When the token stops working (`githubToken.invalid` in `/api/me`), ask for a new one.
- [x] TanStack Query for all server data. One small `api.ts` wrapper around `fetch` that uses the shared types from `packages/core`, sends cookies, and turns error JSON into thrown errors.
- [x] If `/api/me` returns 401, send the user to `/signin`.
- [x] Keep dots out of route paths. The server treats any path with a file extension as a file and returns 404 if it's missing (plan 02). A repo name like `next.js` belongs in a query string, not the path.

### 7.3 Styling and components

- [x] Design tokens as CSS custom properties in `src/styles/tokens.css`, with a dark set under `@media (prefers-color-scheme: dark)`. Components only use tokens, never raw hex values.
- [x] `src/styles/global.css` for resets and base type (system font stack, so it looks native on Apple devices).
- [x] One `*.module.css` file next to each component.
- [ ] Base UI (from part 3, as each piece is needed) (unstyled, accessible components from the MUI team) for anything interactive:

| Need                                     | Base UI part             |
| ---------------------------------------- | ------------------------ |
| Collapsible list sections                | Collapsible or Accordion |
| Settings toggles                         | Switch                   |
| Settings dropdowns                       | Select                   |
| Settings tabs                            | Tabs                     |
| Confirm dialogs (remove repo, sign out)  | Dialog / Alert Dialog    |
| Short messages ("New version available") | Toast                    |
| Hover hints                              | Tooltip                  |

- [ ] Note: Base UI's npm package was renamed around its 1.0 release (`@base-ui-components/react` became `@base-ui/react`). Check npm for the current name when installing.

### 7.4 The list

- [ ] `ItemList` with three collapsible sections: "Needs my review", "Replies to me", "My PRs". Each shows a count. Remember which sections are collapsed in `localStorage`.
- [ ] `ItemRow`, matching design A2 (divided two-line list):
  - Thin divider lines between rows.
  - Line 1: a small colored state icon, the PR title, and the age on the right, colored by stale level.
  - Line 2: what happened ("jlee re-requested your review", "e2e-tests failed"), and the short repo and number on the right.
  - An unseen marker (style to be decided).
- [ ] Clicking a row opens the PR on GitHub in a new tab, and marks it seen. That's the only row action. There's no snooze or done.
- [ ] Header: last synced time, refresh button (calls `POST /api/sync`), settings link.
  - Spin the refresh button from the `202` until `lastSyncedAt` changes. `GET /api/sync/status` shows `running: false` for a few seconds while the worker picks up the job.
- [ ] Banners:
  - "Reconnect GitHub" when `needsReauth`.
  - "Your token stopped working" when `githubToken.invalid`, linking to the token form.
  - "Sync problem, retrying" when `syncError`.
- [ ] `useLiveUpdates()` hook: opens `/api/stream` and invalidates the `items` and `summary` queries on each event.
  - The event is named `ITEMS_CHANGED_EVENT` (from `@pr-peek/core`). Its data is the new summary, so the `summary` query can be set directly.
  - Also invalidate both on the `open` event, so a reconnect catches anything missed while the stream was down. The server doesn't replay old events.
- [ ] Mark visible items as seen when the list opens (`POST /api/items/seen`).
- [ ] Set the app icon badge with `navigator.setAppBadge(total)` where supported.

### 7.5 Layouts

- [ ] **Phone:** full screen list, sticky header, large touch targets (44px or more).
- [ ] **Desktop browser:** the list in a centered column (about 420px wide), settings in a wider layout.
- [ ] **Tray mode** (`?shell=tray`, for plan 09): no outer page chrome, fixed width, a compact header with refresh and settings, and a footer with "Open in browser" and "Quit". Build it now behind the flag so plan 09 is mostly wiring.

### 7.6 Onboarding and settings

- [ ] Onboarding:
  1. Repo picker, using search from plan 04.1.
  2. Timezone, detected from the browser and confirmable.
  3. Install and notification prompt (filled in by plan 08).
- [ ] Settings tabs, matching the mockup:
  - **General:** count style, hide bots, team requests, personal access token (`GitHubToken`), sign out.
  - **Repositories:** add, remove, enable, mute.
  - **Rules:** toggle, severity, channels.
  - **Timing:** staleness hours, work hours only, quiet hours, weekends, morning summary time.
    - Describe "work hours only" as changing only when rows turn orange or red, like "Only count weekdays, 9 to 6, toward overdue". Age labels always show real time.
  - **Devices:** placeholder, filled in by plan 08.

### 7.7 Making it a PWA

- [ ] `vite-plugin-pwa` with the `injectManifest` strategy, so we write our own service worker in `src/sw.ts`. Plan 08 adds push handling there.
- [ ] Web app manifest: name, short name, theme colors, `display: "standalone"`, `start_url: "/"`, icons (192, 512, maskable), Apple touch icon.
- [ ] The service worker precaches the app shell (HTML, JS, CSS, icons) so the app opens instantly. It never caches `/api`.
- [ ] Update flow: when a new version is deployed, show a "New version available. Reload" toast instead of reloading on its own.
- [ ] Express serves `apps/web/dist`:
  - Hashed asset files with long cache headers.
  - `index.html`, `sw.js`, and the manifest with `no-cache`.
- [x] Update `build:render` (plan 02.6) to build web before server. Not needed, see Changes.
- [ ] `/install` page:
  - **iPhone:** Share, then Add to Home Screen. Required before push works on iOS.
  - **Android and desktop Chrome or Edge:** use the browser's install prompt (`beforeinstallprompt`) with an Install button.
  - **Mac Safari:** File, then Add to Dock.

### 7.8 Tests

- [ ] Vitest + Testing Library for `ItemRow` states (each kind and stale level), section collapse, and the reauth banner.
- [ ] One Playwright smoke test (a tool that drives a real browser) against a seeded local server: sign in with a test session, see items, click one to open the PR.

## Done when

- [ ] On your phone, the Render URL installs to the Home Screen and opens full screen with your real items.
- [ ] On desktop, the list updates on its own within a sync cycle when something happens on GitHub.
- [ ] Acting on GitHub (submitting a review, fixing a check) removes the item on both phone and desktop within a sync cycle.
- [ ] Settings changes take effect on the next sync.
- [ ] Lighthouse PWA and accessibility checks pass with no major issues.
