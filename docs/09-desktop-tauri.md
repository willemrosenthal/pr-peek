# 09. Desktop app (Tauri)

**Goal:** a Mac menu bar app. It has an icon with a count and urgency color, a dropdown showing the same list as the PWA, native alerts, launch at login, and automatic updates.

**Needs:** plan 08. Rust installed locally (`rustup`), plus Xcode Command Line Tools.

## Key decision: load the hosted app

The Tauri window loads the **hosted web app** (`https://www.git-buddy.com/?shell=tray`) instead of bundling a copy of the UI.

- **Good:** UI changes ship through the normal Render deploy. The Mac app itself only needs a new release when native code changes. Sign in, cookies, and the API all work exactly like in the browser, because it's the same site.
- **Cost:** it needs internet to open. That's fine, since it needs GitHub anyway. It also needs Tauri's security settings (capabilities) to allow our domain to call the native features we expose, and nothing else.
- **Fallback if this causes trouble:** bundle `apps/web/dist` into the app and call the API with a token instead of a cookie. The React code stays the same.

## PRs

1. Setup and menu bar: 9.1 and 9.2, except the "Menu bar count" setting.
2. Bridge: 9.3, 9.4, and the "Menu bar count" setting.
3. No duplicate alerts: 9.5.
4. Launch at login and updates: 9.6 and 9.7, plus their two right click menu items.
5. Release pipeline: 9.8.

Run it with `pnpm desktop` (and `pnpm dev` for the web app it loads). The desktop package has no `dev` or `build` script on purpose, so `pnpm dev` and Render's `pnpm build` don't compile Rust.

## Steps

### 9.1 Project setup

- [x] `pnpm create tauri-app` into `apps/desktop` with no frontend template, since we load a URL.
  - Written by hand instead: the generator asks questions as it runs and makes files we don't need.
- [x] In `tauri.conf.json`:
  - The main window loads the app URL from an env based setting: `http://localhost:5173/?shell=tray` in dev, the prod URL in release builds.
  - The window starts hidden, with no decorations (title bar), fixed size about 380 by 600, and skips the taskbar.
  - The window is made in `src-tauri/src/lib.rs` instead, so the URL can depend on the build. `PR_PEEK_URL` overrides it.
- [x] Add `apps/desktop/src-tauri/target` and `apps/desktop/src-tauri/gen` to `.gitignore`.
- [x] Set the macOS activation policy to "accessory", so there's no Dock icon. The app lives only in the menu bar.

### 9.2 Menu bar icon and dropdown

- [x] Create a tray icon with a template image (a black and transparent PNG that macOS tints for light and dark menu bars). Use the Wavey octopus from `apps/web/public/icon.svg` (the white strokes only, at 1.5 stroke width).
  - Source: `src-tauri/icons/tray.svg`. Made into `tray.png` with `pnpm --filter @pr-peek/desktop tauri icon src-tauri/icons/tray.svg -o <folder>`, taking its `64x64.png`.
- [x] Left click toggles the window. Use the positioner plugin to place it just under the tray icon.
- [x] Hide the window when it loses focus, like a real menu.
- [x] Right click shows a small native menu: Refresh, Open in browser, Settings, Launch at login (checkbox), Check for updates, Quit.
  - Launch at login and Check for updates come with their plugins in PR 4.
- [x] A global shortcut (default Option+Command+P, changeable) toggles the window.
  - Changing it comes later, with the other Mac settings.
- [ ] A "Menu bar count" setting (total, split like `3 · 1 · 3`, or dot only), moved here from plan 07's General tab. Keep it on the Mac, since only the tray uses it. (PR 2.)
- [x] The single instance plugin stops a second copy from launching.

### 9.3 Bridge between the web app and native code

- [ ] Expose a few Tauri commands (Rust functions the web page can call):
  - `set_tray_state({ total, hasStale, hasFailing, countStyle })`: updates the tray title (the text next to the icon, e.g. `7` or `3 · 1 · 3`) and swaps the icon for stale or failing states. These are the states from the Icons artboard.
  - `notify({ title, body, url, itemId })`: shows a native Mac notification.
  - `open_external(url)`: opens a PR in the default browser.
  - `hide_window()`.
- [ ] In Tauri capabilities, allow only the app's own domain (prod and localhost) to call these commands.
- [ ] In `apps/web`, a `desktop.ts` module detects Tauri (`isTauri()` from `@tauri-apps/api/core`) and:
  - Calls `set_tray_state` whenever the summary changes.
  - Routes "open PR" clicks through `open_external`.
  - Does nothing in a normal browser.

### 9.4 Keeping it live while hidden

- [ ] The hidden window keeps the page and its SSE connection alive. Summary updates keep the tray count current.
- [ ] Turn off the web view's background throttling so SSE and timers keep running when the window is hidden. Verify on battery power.
- [ ] After sleep or wake, or a network change, reconnect SSE and refetch.
- [ ] Check that hiding the window sets `document.visibilityState` to `hidden`. The list marks items seen then (plan 07 part 3b). If it doesn't, mark them seen on the window's own hide event.
- [ ] Add the Quit button to the tray footer (`ListPage.tsx`, plan 07 part 3b), and route "Open in browser" through `open_external`.

### 9.5 Notifications without duplicates

The Mac browser may also have a push subscription, so the same alert could arrive twice.

- [ ] The Tauri app registers itself as a device of type `desktop-app` through a new `POST /api/devices` endpoint. It sends a heartbeat every minute while running.
- [ ] Server rule: while a user's `desktop-app` device is online (heartbeat in the last 3 minutes), skip web push to that user's Mac browser subscriptions. Phone pushes are unaffected.
- [ ] The server sends `event: notify` over SSE to the desktop app with the same payload as a push. The web app calls the native `notify` command.
- [ ] Clicking a native notification opens the PR. Check whether Tauri's notification plugin supports click handling and action buttons on macOS desktop in the version you install. If not, clicking opens pr-peek's window, which is fine for v1.

### 9.6 Launch at login

- [ ] The autostart plugin, on by default after first launch. A toggle in the right click menu and in Settings, General (shown only inside Tauri).

### 9.7 Auto updates

- [ ] Generate an updater signing key pair with `pnpm tauri signer generate`. The public key goes in `tauri.conf.json`. **(You)** Save the private key and password as GitHub Actions secrets.
- [ ] Updater plugin settings:
  - Check on launch and every 6 hours.
  - Show "Update ready. Restart?" in the dropdown footer rather than restarting on its own.
- [ ] **Where updates are hosted:** release files on a **private** repo's GitHub Releases can't be downloaded by other people's apps. Pick one:
  - Make the repo public, or
  - Publish releases to a separate public `pr-peek-releases` repo, or
  - Serve `latest.json` from our server (`/api/desktop/latest.json`), pointing at the release files.

  Decide before the first public release.

### 9.8 Build and release pipeline

- [ ] `.github/workflows/desktop-release.yml`, triggered by pushing a tag like `desktop-v0.1.0`:
  1. Run on `macos-latest`.
  2. Install Rust, pnpm, and Node.
  3. Use `tauri-apps/tauri-action` to build a universal (Apple Silicon and Intel) `.dmg`, sign the update files, and create a GitHub Release with `latest.json`.
- [ ] Apple signing and notarization (Apple's automated malware check, needed so other people's Macs open the app without warnings):
  - **(You)** Join the Apple Developer Program.
  - **(You)** Create a "Developer ID Application" certificate and an App Store Connect API key.
  - **(You)** Add them as GitHub secrets.
  - `tauri-action` uses these secrets automatically.
- [ ] Until signing is set up, builds work for you. Right click, then Open the first time to get past the warning.
- [ ] Add a "Download for Mac" link on the `/install` page that points at the latest release.
- [ ] Check the Rust code in CI on PRs that change `apps/desktop`: `cargo fmt --check` and `cargo clippy -- -D warnings`. CI's Linux runner checks only the web and server code today.

## Done when

- [ ] The menu bar shows the icon and live count, and the color changes when something goes stale or a check fails.
- [ ] Clicking opens the list under the icon. Clicking away hides it. The global shortcut works.
- [ ] A GitHub event produces one native Mac alert (not two) while the app is running, and the phone still gets its push.
- [ ] Launch at login works after a restart.
- [ ] Tagging `desktop-v0.1.1` builds a release, and an installed `0.1.0` offers the update and installs it.
