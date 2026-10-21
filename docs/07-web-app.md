# 07. Web app (PWA)

**Goal:** the React app people actually use, with sign in, onboarding, the concept A list, item actions, and settings. It's installable on phone and desktop. Push notifications come in plan 08.

**Needs:** plan 06. The final row design from the design iteration (step 7.1).

## Steps

### 7.1 Finish the design (can start earlier)

- [ ] Iterate on concept A in the [design canvas](https://claude.ai/artifact/RiRMAZfxkrJMeSUzfw1ckb): clearer, more compact rows that read as one item each.
- [ ] Also design:
  - The phone layout (full screen list).
  - Dark mode.
  - Empty, loading, and error states.
  - The sign in and onboarding screens.
- [ ] Write down the final tokens (colors, type sizes, spacing, radii) for step 7.3.

### 7.2 Project setup

- [ ] Vite + React + TypeScript in `apps/web`.
- [ ] Vite dev server on `5173`, proxying `/api` to Express on `3000`. Same origin in dev and prod means cookies and CSRF checks behave the same.
- [ ] React Router routes:

| Route | Screen |
| --- | --- |
| `/signin` | Sign in with GitHub, with a clear note about permissions and a "public repos only" option |
| `/onboarding` | Pick repos, set timezone, prompt to install and turn on notifications |
| `/` | The list (concept A) |
| `/snoozed` | Snoozed items |
| `/settings/:tab` | General, Repositories, Rules, Timing, Devices |
| `/install` | How to install on iPhone, Android, Mac |

- [ ] TanStack Query for all server data. One small `api.ts` wrapper around `fetch` that uses the shared types from `packages/core`, sends cookies, and turns error JSON into thrown errors.
- [ ] If `/api/me` returns 401, send the user to `/signin`.

### 7.3 Styling and components

- [ ] Design tokens as CSS custom properties in `src/styles/tokens.css`, with a dark set under `@media (prefers-color-scheme: dark)`. Components only use tokens, never raw hex values.
- [ ] `src/styles/global.css` for resets and base type (system font stack, so it looks native on Apple devices).
- [ ] One `*.module.css` file next to each component.
- [ ] Base UI (unstyled, accessible components from the MUI team) for anything interactive:

| Need | Base UI part |
| --- | --- |
| Collapsible list sections | Collapsible or Accordion |
| Row "more" actions (snooze, mute, open) | Menu |
| Settings toggles | Switch |
| Settings dropdowns | Select |
| Settings tabs | Tabs |
| Confirm dialogs (remove repo, sign out) | Dialog / Alert Dialog |
| "Marked done. Undo" messages | Toast |
| Hover hints | Tooltip |

- [ ] Note: Base UI's npm package was renamed around its 1.0 release (`@base-ui-components/react` became `@base-ui/react`). Check npm for the current name when installing.

### 7.4 The list

- [ ] `ItemList` with three collapsible sections: "Needs my review", "Replies to me", "My PRs". Each shows a count. Remember which sections are collapsed in `localStorage`.
- [ ] `ItemRow`, matching the final design:
  - Repo and number.
  - PR title.
  - Summary line (who did what).
  - Age pill, colored by stale level.
  - Status pill (Re-requested, Failing, Changes, Approved).
  - An unseen dot.
- [ ] Clicking a row opens the PR on GitHub in a new tab, and marks it seen.
- [ ] Row actions:
  - Desktop: on hover or focus.
  - Phone: swipe left to snooze, swipe right for done, or a long press menu.
  - Both: a "more" menu.
- [ ] Done and snooze update the list right away (optimistic update), roll back if the request fails, and show an Undo toast.
- [ ] Header: last synced time, refresh button (calls `POST /api/sync`), settings link.
- [ ] Banners:
  - "Reconnect GitHub" when `needsReauth`.
  - "Sync problem, retrying" when `syncError`.
- [ ] `useLiveUpdates()` hook: opens `/api/stream` and invalidates the `items` and `summary` queries on each event.
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
  - **General:** count style, hide bots, team requests, sign out.
  - **Repositories:** add, remove, enable, mute.
  - **Rules:** toggle, severity, channels.
  - **Timing:** staleness hours, work hours only, quiet hours, weekends, morning summary time.
  - **Devices:** placeholder, filled in by plan 08.

### 7.7 Making it a PWA

- [ ] `vite-plugin-pwa` with the `injectManifest` strategy, so we write our own service worker in `src/sw.ts`. Plan 08 adds push handling there.
- [ ] Web app manifest: name, short name, theme colors, `display: "standalone"`, `start_url: "/"`, icons (192, 512, maskable), Apple touch icon.
- [ ] The service worker precaches the app shell (HTML, JS, CSS, icons) so the app opens instantly. It never caches `/api`.
- [ ] Update flow: when a new version is deployed, show a "New version available. Reload" toast instead of reloading on its own.
- [ ] Express serves `apps/web/dist`:
  - Hashed asset files with long cache headers.
  - `index.html`, `sw.js`, and the manifest with `no-cache`.
- [ ] Update `build:render` (plan 02.6) to build web before server.
- [ ] `/install` page:
  - **iPhone:** Share, then Add to Home Screen. Required before push works on iOS.
  - **Android and desktop Chrome or Edge:** use the browser's install prompt (`beforeinstallprompt`) with an Install button.
  - **Mac Safari:** File, then Add to Dock.

### 7.8 Tests

- [ ] Vitest + Testing Library for `ItemRow` states, section collapse, optimistic done with rollback, and the reauth banner.
- [ ] One Playwright smoke test (a tool that drives a real browser) against a seeded local server: sign in with a test session, see items, mark one done.

## Done when

- [ ] On your phone, the Render URL installs to the Home Screen and opens full screen with your real items.
- [ ] On desktop, the list updates on its own within a sync cycle when something happens on GitHub.
- [ ] Done, snooze, and undo work on phone and desktop.
- [ ] Settings changes take effect on the next sync.
- [ ] Lighthouse PWA and accessibility checks pass with no major issues.
