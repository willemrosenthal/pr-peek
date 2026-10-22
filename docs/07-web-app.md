# 07. Web app (PWA)

**Goal:** the React app people actually use, with sign in, onboarding, the list, and settings. It's installable on phone and desktop. Push notifications come in plan 08.

**Needs:** plan 06. The final row design from the design iteration (step 7.1).

**Split into these PRs:**

- **Part 1** (`plan-07-1-setup`): 7.2 project setup, sign in, and the design tokens from 7.3.
- **Part 2** (`plan-07-2-github-token`): the personal access token becomes an add-on to GitHub sign in, not a way to sign in. See Changes.
- **Part 3**, the list:
  - **3a** (`plan-07-3a-list`): sections, rows, header and refresh, banners, empty and error states, phone and desktop layouts, and their tests.
  - **3b** (`plan-07-3b-live`): live updates, marking items seen, the app badge, and tray mode.
  - **3c** (`plan-07-3c-tracking`): 7.9, track PRs once found, so a search that misses one doesn't drop it from the list.
  - **3d** (`plan-07-3d-update-branch`): 7.10, "Update branch" doesn't count as acting on your PR.
  - **3e** (`plan-07-3e-mentions`): 7.11, mentions.
  - **3f** (`plan-07-3f-one-row`): 7.11, one row per PR.
  - **3g** (`plan-07-3g-heal`): 7.12, every sync runs the rules on every tracked PR.
- **Part 4**, 7.6 onboarding and settings, in two PRs:
  - **4a** (`plan-07-4a-repos`): the settings tabs, the Repositories tab, and onboarding.
  - **4b** (`plan-07-4b-settings`): the rest of General, Rules, and a Devices placeholder.
  - **4c** (`plan-07-4c-timing`): Timing.
- **Part 5**, 7.7 PWA and 7.8 tests:
  - **5a** (`plan-07-5a-pwa`): installable. Manifest, icons, service worker, the update prompt, and cache headers.
  - **5b** (`plan-07-5b-install`): the `/install` page.
  - **5c** (`plan-07-5c-smoke`): the Playwright smoke test.

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
  - The token form (`components/GitHubToken.tsx`) is on the General tab.
- **`api.http` signs in with your browser's session cookie**, since token sign in is gone. Steps at the top of the file.
- **Settings tabs are links** (part 4a), like `/settings/repos`, with the tab list on the left as in the mockup, and a row that scrolls sideways on phones. Each tab has its own URL, so they use the router, not Base UI Tabs. `/settings` and unknown tabs open General.
- **Repositories tab:** the watch list, with a switch to pause each repo and a Remove button. Below it, search. With nothing typed, it lists your repos, most recently pushed first. Typing `owner/name` offers that repo even when search doesn't find it, like a repo in an org that blocks pr-peek. Search waits for typing to pause (300 ms).
  - **Each row adds on its own**, with a spinner and "Adding" while the server checks the repo with GitHub, so other rows stay clickable. Rows read "Watching" from the watch list, so a change never searches GitHub again. Search results no longer carry a `watched` flag.
  - **No confirm on Remove.** Adding the repo back restores everything on the next sync.
  - **Mute comes with plan 08.** It only stops notifications, so a switch would do nothing yet.
- **Onboarding** has three steps: repos, timezone, and "You're set". Leaving the repo step starts a first sync, so the list fills in sooner. The timezone is a native dropdown, not Base UI Select, since it has about 400 options. Installing and notifications join the last step in plans 07 part 5 and 08.
- **Count style moves to plan 09.** It only changes the menu bar title, and the server doesn't store it.
- **The list refetches every minute** (items and sync status), since ages, stale colors, and "Updated 3m ago" change with time. The live stream (3b) refetches right away when something changes.
- **Empty sections are hidden.** When all three are empty, the list says "Nothing needs you right now", or asks for repos if none are watched.
- **Unseen rows** have a bold title and a dot, and screen readers hear "New".
- **One icon per item kind.** "Reviewed" has one icon for approvals and change requests, since items don't say which.
- **Refresh** spins until `lastSyncedAt` or `syncError` changes, or 2 minutes pass. A refresh refused because the token stopped working shows the banner, not an error.
- **Rows are links** (`target="_blank"`), so middle click and "open in new tab" work.
- **Marking seen happens when you leave the list** (part 3b): you hide the tab, or go to another page. It marks the new items that were in open sections while the tab showed. Marking reorders rows a little (unseen adds 25 to the urgency score), and the bold goes away. Waiting until you leave means nothing moves while you look. The request uses `keepalive`, so it finishes after the tab closes. If it fails, the next visit tries again.
- **The stream and the badge run on every signed in page** (`components/SignedIn.tsx`), not just the list, so the menu bar app's hidden window stays current (plan 09). The badge reads `GET /api/summary`, which the stream's event updates.
- **A stream the server refuses** (signed out, or a deploy in progress) is closed by the browser for good. The app checks `/api/me`, which sends a signed out user to sign in, and opens a new stream 30 seconds later.
- **Fixed: a signed out check looped** between `/signin` and `/`, because a failed `/api/me` check keeps the old data. Also, a failed check other than 401 no longer replaces the page with an error once you're signed in.
- **Tray mode** (`?shell=tray`) is kept in `sessionStorage`, so it holds on other pages. The footer has "Open in browser". Quit comes in plan 09, since it needs the desktop app.
- **Base UI** is used for the collapsible sections and switches so far.
- **The service worker only runs in production builds** (part 5a), not on the Vite dev server. Check it on Render. Locally, Express on port 3000 serves the build, but sign in sends you back to 5173.
- **The service worker is in `src/sw/sw.ts`**, not `src/sw.ts`. It has its own `tsconfig.json`, since it runs in a worker, not a page.
- **The app icon is a placeholder:** the pull request glyph in white on the accent blue. `public/icon.svg` is the source. Run `pnpm --filter @pr-peek/web icons` after changing it.
- **The update prompt also checks for a new version every hour**, since the app often stays open for days.
- **Icons and the manifest also get `no-cache`.** The browser still keeps them, and checks with the server before using them.
- **The `/install` page** (part 5b) shows what fits the device it's open on first: "installed", an Install button, or steps. Steps for the other devices are below. Anyone can open it, signed in or not.
  - Chrome sends its install offer once, soon after the app loads. `install.ts` listens from the start (`main.tsx` imports it), so the button works even when you open `/install` later. If you close Chrome's dialog, the page shows the menu steps instead.
  - The iPhone steps end with "sign in again", since Home Screen apps on iPhone don't share Safari's cookies.
  - Onboarding's last step shows the same "this device" part, with a link to `/install`. The Devices tab links to it too. Neither shows in tray mode.
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

- [x] Note: Base UI's npm package was renamed around its 1.0 release (`@base-ui-components/react` became `@base-ui/react`). Check npm for the current name when installing.

### 7.4 The list (part 3a: `pages/ListPage.tsx`, part 3b: live updates)

- [x] `ItemList` with three collapsible sections: "Needs my review", "Replies to me", "My PRs". Each shows a count. Remember which sections are collapsed in `localStorage`.
- [x] `ItemRow`, matching design A2 (divided two-line list):
  - Thin divider lines between rows.
  - Line 1: a small colored state icon, the PR title, and the age on the right, colored by stale level.
  - Line 2: what happened ("jlee re-requested your review", "e2e-tests failed"), and the short repo and number on the right.
  - An unseen marker: a bold title and a dot.
- [x] Clicking a row opens the PR on GitHub in a new tab. That's the only row action. There's no snooze or done. Marking seen happens when the row is on screen (3b, see Changes).
- [x] Header: last synced time, refresh button (calls `POST /api/sync`), settings link.
  - Spin the refresh button from the `202` until `lastSyncedAt` changes. `GET /api/sync/status` shows `running: false` for a few seconds while the worker picks up the job.
- [x] Banners:
  - "Reconnect GitHub" when `needsReauth`.
  - "Your token stopped working" when `githubToken.invalid`, linking to the token form.
  - "Sync problem, retrying" when `syncError`.
- [x] `useLiveUpdates()` hook: opens `/api/stream` and invalidates the `items` and `summary` queries on each event.
  - The event is named `ITEMS_CHANGED_EVENT` (from `@pr-peek/core`). Its data is the new summary, so the `summary` query can be set directly.
  - Also invalidate both on the `open` event, so a reconnect catches anything missed while the stream was down. The server doesn't replay old events.
- [x] Mark items seen (`POST /api/items/seen`) when you leave the list. Changed, see Changes.
- [x] Set the app icon badge with `navigator.setAppBadge(total)` where supported.

### 7.5 Layouts

- [x] **Phone:** full screen list, sticky header, large touch targets (44px or more).
- [x] **Desktop browser:** the list in a centered column (about 420px wide), settings in a wider layout.
- [x] **Tray mode** (`?shell=tray`, for plan 09): no outer page chrome, fixed width, a compact header with refresh and settings, and a footer with "Open in browser" and "Quit". Build it now behind the flag so plan 09 is mostly wiring. Quit comes in plan 09.

### 7.6 Onboarding and settings

- [x] Onboarding:
  1. Repo picker, using search from plan 04.1.
  2. Timezone, detected from the browser and confirmable.
  3. Install prompt (part 5b). Notifications join it in plan 08.
- [ ] Settings tabs, matching the mockup (the tabs and Repositories in part 4a, the rest in 4b):
  - [x] **General:** hide bots, team requests, personal access token (`GitHubToken`), sign out. Count style moved to plan 09.
  - [x] **Repositories:** add, remove, enable. Mute moved to plan 08.
  - [x] **Rules:** toggle, severity ("Urgency"), channels ("Notify" turns push on or off, and the list always shows the rule), and "Include draft PRs" on review requested. Grouped by other people's PRs and mine.
  - [x] **Timing** (part 4c): staleness hours, work hours only, quiet hours, weekends, morning summary time.
    - Describe "work hours only" as changing only when rows turn orange or red, like "Only count weekdays, 9 to 6, toward overdue". Age labels always show real time.
    - Also the timezone, since onboarding was the only place to set it.
    - Hours save when you leave the box. Orange must come before red, and both are whole hours, 1 to 720.
    - Quiet hours and the morning summary each have a switch. Turning one on starts at 6pm to 9am, or 9am.
  - [x] **Devices:** placeholder, filled in by plan 08.
- [x] Each switch and dropdown saves on its own and shows the new value while it saves. After a save, the list and its counts reload, since these settings change what's on it.

### 7.7 Making it a PWA

- [x] `vite-plugin-pwa` with the `injectManifest` strategy, so we write our own service worker in `src/sw/sw.ts`. Plan 08 adds push handling there.
- [x] Web app manifest: name, short name, theme colors, `display: "standalone"`, `start_url: "/"`, icons (192, 512, maskable), Apple touch icon.
- [x] The service worker precaches the app shell (HTML, JS, CSS, icons) so the app opens instantly. It never caches `/api`.
- [x] Update flow: when a new version is deployed, show a "New version available. Reload" toast instead of reloading on its own.
- [x] Express serves `apps/web/dist`:
  - Hashed asset files with long cache headers.
  - `index.html`, `sw.js`, and the manifest with `no-cache`.
- [x] Update `build:render` (plan 02.6) to build web before server. Not needed, see Changes.
- [x] `/install` page (part 5b):
  - **iPhone:** Share, then Add to Home Screen. Required before push works on iOS.
  - **Android and desktop Chrome or Edge:** use the browser's install prompt (`beforeinstallprompt`) with an Install button.
  - **Mac Safari:** File, then Add to Dock.

### 7.8 Tests

- [x] Vitest + Testing Library for `ItemRow` states (each kind and stale level), section collapse, and the reauth banner.
- [ ] One Playwright smoke test (a tool that drives a real browser) against a seeded local server: sign in with a test session, see items, click one to open the PR.

### 7.9 Tracking PRs (part 3c)

**Why:** each sync runs three GitHub searches, and any PR the searches don't return has its items resolved. That's how merged PRs leave the list. But GitHub's search index lags behind changes, so right after "Update branch" a PR can be missing from one sync's results. It vanishes, then comes back a minute later.

**The change:** searches find PRs. They never remove them. A stored PR is tracked until it's merged, closed, or gone, or it has nothing for you for 7 days.

- [x] Search results carry each PR's live `state`. Only `OPEN` ones count as found. A PR the index still lists right after it merges is skipped.
- [x] Each sync checks every tracked PR the searches missed, by id, in one small query: state, updated time, and checks. Same shape as a search result.
  - Still open: treated like a found PR. Details are fetched only if it changed.
  - Merged or closed: its `state` is saved and its items are resolved.
  - Gone or hidden (`NOT_FOUND` or `FORBIDDEN`, like an org that later blocks pr-peek): saved as `gone`, the same as closed. These errors don't fail the sync.
- [x] A PR in a repo that's no longer watched or enabled is saved as `unwatched`, and its items are resolved too.
- [x] Resolved items stay stored with their PR, so if the PR reopens or the repo is turned back on, the items reopen without a new notification.
- [x] Rows are deleted once they have no open items and no search has found them for 7 days.
- [x] Re-running rules after a settings change uses every open tracked PR.
- [x] Your own PRs are spotted by their stored author, not by which search found them, so a tracked PR's check changes are still fetched.
- [x] Tests: one search missing an open PR keeps its items. Merged, closed, gone, and paused-repo PRs resolve theirs. A row with open items lives past 7 days.
- After the deploy: a PR the last old sync wrongly dropped stayed off the list until it next changed on GitHub. It wasn't rare. Part 3g fixes it.

### 7.10 "Update branch" doesn't count (part 3d)

**Why:** "Update branch" on GitHub adds a merge commit to your PR. The rules treat any new commit as you acting on it, so it clears "changes requested", new comments, and failed checks. A merge from the base branch doesn't fix any of those.

- [x] The details query also reads the last 20 commits: sha, time, parent count, and check state.
- [x] The snapshot gets `lastPush`: the latest commit that isn't a merge (one parent), with its sha, time, and whether a check failed. It's optional, so stored snapshots still read. Without it, the rules use the head commit, as before.
  - "A check failed" comes from GitHub's count of runs by result, not its overall state. The overall state counts cancelled runs as failures, and "Update branch" often cancels the last push's run.
- [x] "My PR was reviewed" and "New comment on my PR" use `lastPush` time, not the head commit's.
- [x] "Check failed" keys on the `lastPush` sha, so a failure after "Update branch" is the same item, with no new notification. While the merge commit's checks run (or if it has none), the item stays if the `lastPush` commit's checks failed, with the summary "Checks failed before the branch update". Passing checks clear it.
- [x] Limit: "Update with rebase" rewrites the commits, so it still counts as a push.

### 7.11 Mentions (part 3e), and one row per PR (part 3f)

Part 3e:

- [x] A fourth search, `mentions:@me -author:@me`, finds PRs where someone @mentions you, even ones you never touched.
- [x] A new rule and kind, `mention`: someone @mentioned you after your latest comment or review on the PR. Clears when you comment or review. Shown in "Replies to me" with an `@` icon.
  - It looks in the PR description too, since the search finds PRs that only mention you there, like "cc @you". The snapshot gets an optional `description`, in the shape of a comment by the PR's author when it was opened. A mention added to the description later, after you commented, is missed.
  - It looks in each review's summary text too, like "@you thoughts?". Reviews in the snapshot get optional `bodyPreview` and `mentions`.
- [x] "New comment on my PR" now counts "Comment" reviews with summary text. Before, a review that was only a summary didn't show up at all. Approvals and change requests stay with "My PR was reviewed".
  - The reply rule now only counts replies in review threads you commented in. The mention rule skips those threads, so one comment never makes two items.
- After the deploy: tracked PRs get mention items, and their reply items lose the mentions, on the next sync (part 3g).

Part 3f:

- [x] One row per PR. Items stay one per kind in the database, since clearing rules and notifications need them. `groupItems` and `summarize` pick one item per PR (`onePerPr` in `item-list.ts`), so the list, badge, and menu bar count agree.
  - The pick uses each rule's severity, then this order: re-requested, review requested, check failed, reviewed, reply, mention, new comments. Not the urgency score, which adds points for unseen items, so a new mention would push a review request's row aside, then flip back once seen.
  - Sorting between PRs still uses the urgency score: each row takes the place of its PR's most urgent item.
  - The summary's "stale" and "failing" flags still look at every item, not just each row's.
- [x] The row is unseen if any of the PR's items is, and marking seen covers all of them (`otherIds` on each row).
- [x] The row shows the top item's summary, plus "+N more" when the PR has other open items. The count stays when a long summary is cut off.
- [x] Notifications stay one per event (plan 08). Which kinds push is already a per-rule setting (`channels`). The Rules tab (4b) shows it.

### 7.12 Every sync runs every rule (part 3g)

**Why:** the rules only ran on PRs that changed on GitHub. An item resolved by mistake stayed resolved until someone touched the PR. A paused repo, a bug, or a deploy changeover could leave whole sections empty. Production lost "My PRs" and "Replies to me" this way, and changing a setting brought them back.

- [x] Every sync runs the rules on every tracked PR. Changed PRs use their fresh details, and the rest use their stored snapshots. No extra GitHub calls.
  - Measured with 19 tracked PRs: 87 KB read in about 70 ms, and about 3 ms for the rules.
- [x] Saving items writes only what changed, and resolves gone items in one query. A sync where nothing changed writes nothing and sends no live event.
- [x] A reopened item keeps its event, so it doesn't notify again.
- [x] The user's team list is kept for an hour, since PRs that ask a team to review are now checked every sync.
- [x] Re-running rules after a settings change sends a live event only if something changed.
- [x] Tests: an item resolved by mistake reopens on the next sync without a new fetch or notification. A rule turned back on reaches unchanged PRs. A sync with no changes writes nothing. Teams are asked for once an hour.

## Done when

- [ ] On your phone, `www.git-buddy.com` installs to the Home Screen and opens full screen with your real items.
- [ ] On desktop, the list updates on its own within a sync cycle when something happens on GitHub.
- [ ] Acting on GitHub (submitting a review, fixing a check) removes the item on both phone and desktop within a sync cycle.
- [ ] Settings changes take effect on the next sync.
- [ ] Lighthouse PWA and accessibility checks pass with no major issues.
