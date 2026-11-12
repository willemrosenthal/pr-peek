# 12. iPhone app (Capacitor)

**Goal:** an iPhone app that feels native. Rich notifications from the [design canvas](https://claude.ai/artifact/HWBgeX8c3Nh5oMR9jDHKpJ): the person's picture on the left with a small Git Buddy badge, and a colored tile for the kind of action on the right. Haptic ticks for long presses, pull to refresh, and switches. Sharing a PR link into the app. The PWA can't do these. iOS shows only the home screen icon in a web push, and the web can only tick right after a tap.

**Needs:** plan 08. Plan 09 is not needed, but its "load the hosted app" approach is reused here. A Mac with Xcode. An Apple Developer account.

## Key decision: wrap the web app with Capacitor

Capacitor puts the web app in a native iPhone app. The screens stay the React app we have. Only push, haptics, and sharing are native.

- **Why not Tauri for iOS:** it would keep one toolchain, but its support for push from a server is thinner. Checked in 12.1 (November 2026): Tauri still has no official push plugin for iOS, only community ones (`tauri-plugin-remote-push`, `tauri-plugin-mobile-push`), and the notification extension is hand-made in Xcode either way. Capacitor has official push and haptics plugins. Capacitor stays.
- **Why not React Native or Swift:** both mean building the screens a second time.
- **Feel:** the app is a list with swipes and links. It runs in the same browser engine (WebKit) as the Mac app, so the swipe and animation work carries over.

## Key decision: load the hosted app

Like plan 09, the app loads `https://www.git-buddy.com/?shell=ios` instead of bundling a copy of the UI.

- **Good:** UI changes ship through the normal Render deploy. No new app build, and no Apple review. Sign in, cookies, and the API work like in Safari.
- **Cost:** needs internet to open. Apple may question an app that is "just a website" in App Store review. Native push, haptics, and sharing help.
- **A new native part needs a new app build.** The web app checks a plugin is there (`Capacitor.isPluginAvailable`) before using it, so an older app keeps working after a deploy.
- **Fallback:** bundle `apps/web/dist` and call the API with a token instead of a cookie, as in plan 09.

## Key decision: TestFlight first

You and invited testers install the app from TestFlight. The App Store comes later, once it's settled (see "Later: the App Store").

- TestFlight builds for you and your team need no App Store review. Inviting people outside your team needs a light beta review, once per version.
- A TestFlight build lasts 90 days. Releases make new ones (12.8).

## Key decision: the tiles come with the app

The notification extension (12.6) draws each kind's tile from images inside the app. The push only says which kind it is. So there's no download for the tile, and it can't fail. The person's picture is downloaded, and the notification shows without it if that fails.

## Key decision: native haptics in the app

The web's tick (`haptics.ts`) only works right after a tap or a finger lifting, so on an iPhone pull to refresh ticks on release, and long presses don't tick at all. Inside the app, `@capacitor/haptics` ticks at any moment. `haptics.ts` uses it when it's there, and keeps today's ticks everywhere else.

## Releases

- **Web changes:** ship with every deploy, as today. The app picks them up the next time it loads.
- **App changes** (`apps/ios`, or a new plugin): like the Mac app, a release builds the app only when `apps/ios` changed since the last app build (12.8). The build goes to TestFlight, and testers get it automatically.
- **Versions:** the app's version is the release's, like 1.45.0. Each upload gets a new build number (the workflow's run number).
- **Signing:** an App Store Connect API key signs and uploads from CI. No certificates in the repo.

## PRs

1. Shell: 12.1 and 12.2.
2. Server: 12.3, Apple push next to web push. Does nothing until an iPhone app registers. Split in two:
   - 2a: the device table, endpoints, the Apple sender, sending from `deliver()`, and no duplicates.
   - 2b: the payload extras for the tiles, and "Send a test".
3. App push: 12.4. Split in two:
   - 3a: the push plugin and the app's own plugin, saving the token, tap to open, banners while open, the badge, and sign out.
   - 3b: Settings' "This iPhone" with "Send a test", and onboarding's last step.
4. Haptics: 12.5.
5. Rich notifications: 12.6, the notification extension.
6. Sharing: 12.7, the share extension.
7. Releases: 12.8, builds to TestFlight from CI.

## Steps

### 12.1 Accounts and check

- [x] **(You)** Join the Apple Developer Program ($99 a year). Done for the Mac app's signing, as an Individual ([plan 09](completed/09-apple-signing.md)). The same membership and Team ID cover the iPhone app.
- [x] **(You)** In Certificates, Identifiers & Profiles, Keys: make an APNs key (Apple Push Notification service). Download the `.p8` file once and keep it safe. Note its Key ID and your Team ID. Done, and saved on Render in `git-buddy-env` as `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, and `APNS_TOPIC`.
- [x] Check Tauri's iOS push support. If it now handles server push and notification extensions well, say so in this plan and ask before switching. It doesn't yet: see "Why not Tauri for iOS" above.
- [x] **(You)** Install Xcode from the Mac App Store. Xcode 27.2.
- [x] **(You)** Accept Xcode's license and point the command line at it, once, in Terminal: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, then `sudo xcodebuild -license accept`.

### 12.2 The shell

- [x] A new workspace package, `apps/ios`, with Capacitor 8 and its iOS project (`ios/`), which uses Swift Package Manager, not CocoaPods. The bundle ID is `com.git-buddy.pr-peek` (the same rule as the Mac app: never change it). Capacitor's CLI refuses dashes in app IDs (an Android rule), so the project was made with a stand-in ID, then given the real one. `cap sync` accepts it.
- [x] `capacitor.config.ts` points `server.url` at `https://www.git-buddy.com/?shell=ios`. Only our site and `github.com` (for signing in) load inside the app. Anything else opens in Safari. Capacitor's bridge also reaches GitHub's sign in pages, so the app only adds plugins that are safe to call from them: push, haptics, and the app's own.
- [x] App icon and launch screen from `apps/web/public/icon.svg` (`pnpm --filter @pr-peek/ios icons`). The icon is a full square: iOS rounds the corners.
- [x] The web app knows it's in the iPhone app (`?shell=ios`, kept like the tray shell). It then:
  - hides the "Add to Home Screen" steps and the web push switch,
  - respects the safe areas (notch and home bar), with Capacitor's `contentInset`,
  - opens PR links in Safari (or the GitHub app), not inside the app, with `window.open`.
- [ ] GitHub sign in works inside the app and returns to the list. Built, but only a real build can show it: **(You)** check it once Xcode is in.
- [ ] Check on the phone, and fix what's off:
  - In dark mode, the area behind the notch and under the page is dark too. It's the light gray today (`backgroundColor`).
  - A long press on a row opens our preview, not iOS's own link preview. Turn off the web view's link previews if it shows.
  - Pull to refresh works, and the page doesn't bounce under it.
  - Copy link (the Open button's menu) copies. If the web view refuses, use `@capacitor/clipboard`.
- [ ] **(You)** In Xcode, sign in with your Apple account, pick your team, and run the app on your iPhone.

### 12.3 Apple push on the server

- [x] A new `AppleDevice` table, kept apart from web push devices (`PushSubscription`) so web push stays simple. Each has the device token, a label, whether it's a development build (Xcode builds use Apple's sandbox, TestFlight builds don't), and the last success and failure count, like web push devices.
- [x] Endpoints for the app to register and unregister its token. Signing out unregisters it (the app does that, in 12.4). Deleting the account deletes them, like other devices.
- [x] Send with token based auth (the `.p8` key), over HTTP/2 to Apple. Env vars: `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` (the bundle ID). We sign the token ourselves with `node:crypto`, and send with `node:http2`: no library needed.
- [x] Send from `deliver()` (`push.ts`), so every push reaches the app: list items, merged PRs, the morning summary, token reminders, and admin alerts. The menu bar app's rule stays: it only skips web push on Macs.
- [x] No duplicates: when someone has the iPhone app, skip their web push devices on iPhones and iPads (Apple's push service, and not `onMac`). Their Mac's Safari still gets web push. Apple push only sends while web push (the VAPID keys) is set up too, since every sender checks that first.
- [x] The Apple payload carries the same title, body, URL, tag, item, and badge as a web push, plus `mutable-content: 1`, so the extension runs, and `thread-id` from the tag, so a PR's notifications group together.
- [x] In 2b, the payload also carries:
  - `kind`, for the tile: each rule's kind, with a review split into `approved` and `changes_requested`, so each gets its own tile, and `merged`. None for batches, the summary, token reminders, and admin alerts. The list (`PUSH_KINDS`) is in `@pr-peek/core`.
  - `actor` (login) and `avatar` (picture URL), when a person did it. Never for a bot.
  - To know what a review said, items now keep it (`reviewState`). Items from before fill it in on the next sync, without a new push.
- [x] Remove a token when Apple says it's gone, like web push devices.
- [x] A "Send a test" endpoint (`POST /api/apple-devices/test`) that sends one sample of each kind to the user's iPhone apps, with their own picture, then a plain one like the summary. For 12.4's button and 12.6's check. Each phone's samples go one at a time and stop at a failure, so a bad moment counts once against the phone.
- [x] **(You)** Add the APNs env vars on Render, for the web service and the worker. Done in 12.1.

### 12.4 App push

- [x] Use `@capacitor/push-notifications`: ask for permission, get the token, send it to 12.3's endpoint, with whether it's a development build. The web app loads Capacitor's code only inside the app (`native.ts`). The app's own small plugin (`AppPlugin.swift`, `PrPeek` in the web app) says whether it's an Xcode build, and sets the badge. The token is saved again each time the app opens, since Apple can change it.
- [ ] Settings, Notifications shows "This iPhone": a Turn on button, On, or "Turned off in iPhone Settings" with a way there. It replaces the web push row in the app. A "Send a test" button sends 12.3's samples.
- [x] Tapping a notification opens its PR, and marks the item seen, like the service worker does. PRs open in Safari, Git Buddy's own pages in the app.
- [x] A notification that arrives while the app is open still shows as a banner (`presentationOptions`).
- [x] The app icon's badge shows the open count, and keeps up as the list changes in the app (`appBadge.ts`), not only when a push arrives.
- [x] Signing out removes the phone from the server first (`signOut.ts`), so it stops getting that account's notifications.
- [ ] Onboarding's last step offers to turn on notifications in the app.

### 12.5 Haptics

- [ ] Add `@capacitor/haptics`. `haptics.ts` calls it in the app, with three strengths, and keeps today's ticks on the web:
  - **Firm** (medium impact): a long press opens the PR preview, and a long press on Open opens its copy menu.
  - **Light** (light impact): pull to refresh crosses the line, at that moment, not on release. A swipe crosses into quiet or important, as today.
  - **Selection**: a switch flips, an urgency is picked, a segmented choice changes, the bell turns on or off.
  - **Success**: a link is copied.
- [ ] Android's web app also ticks on the long presses, since `navigator.vibrate` works any time there.
- [ ] Tests check each place asks for the right strength.

### 12.6 Rich notifications (Swift)

A Notification Service Extension: a small Swift target in the Xcode project that runs on the phone before each notification shows.

- [ ] Add the extension target, the Push Notifications and Communication Notifications capabilities, and `INSendMessageIntent` in `NSUserActivityTypes`.
- [ ] When there's an `actor`: download the avatar, make an `INPerson`, and turn the notification into a communication notification (`INSendMessageIntent`, then `content.updating(from:)`). iOS then shows the picture on the left with the app icon as a badge. iOS draws the badge from the app icon itself, so the badge is the violet mascot with rainbow legs, like the canvas's "rainbow legs, arm and face" option.
- [ ] Attach the kind's tile as a thumbnail (`UNNotificationAttachment`). The tiles are PNGs in the extension, made by a script from the list's kind colors (`--color-kind-*` in `tokens.css`) and its Lucide icons, so they match the list:
  - review requested: blue eye, re-requested: blue arrows,
  - approved: green check, changes requested: orange alert,
  - new comment: pink message, reply and mention: purple,
  - check failed: red X, assigned: teal person, merged: purple merge.
- [ ] No person (review requests, checks failed, merged PRs, the summary, reminders): the plain notification, with the app icon. Review requests don't know who asked yet: the sync doesn't read the request's actor.
- [ ] If anything fails or runs out of time, show the plain notification. Never drop it.
- [ ] Check early that the tile still shows on the right of a communication notification. If iOS hides it, decide between the avatar and the tile.

### 12.7 Sharing (Swift)

- [ ] A Share Extension target: sharing a link from Safari or the GitHub app shows Git Buddy in the share sheet.
- [ ] It hands the link to the app, which opens `/add` with it, the same page the web app's share target uses (plan 17). That page looks the PR up and offers to add it.
- [ ] Only GitHub PR links are offered. Anything else says so.

### 12.8 Releases to TestFlight

- [ ] **(You)** In App Store Connect, add the app (bundle ID `com.git-buddy.pr-peek`), and make an App Store Connect API key with the App Manager role. Note its Issuer ID and Key ID, and download the `.p8`.
- [ ] **(You)** Add them as GitHub secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY` (the `.p8`), and `APPLE_TEAM_ID`.
- [ ] An `ios-release.yml` workflow, like `desktop-release.yml`: on a release, when `apps/ios` or the workflow changed since the last app build, on a macOS runner. It sets the version and build number, archives with automatic signing through the API key, and uploads to TestFlight.
- [ ] It can also run by hand, for a first build or a retry.
- [ ] **(You)** Add yourself as a tester in TestFlight, and install the app from there.

## Later: the App Store

Not part of this plan. When it's time:

- A listing: name, description, screenshots, and the privacy labels (what Git Buddy keeps, from the privacy page).
- Review notes: a test account, and why it signs in with GitHub. Apps that only sign in to one service, like a GitHub client, don't need Sign in with Apple.
- Deleting the account in the app is already there (plan 10), which Apple asks for.
- `ios-release.yml` submits a build for review, by hand.

## Done when

- [ ] **(You)** The app installs from TestFlight, signs in, and shows the list.
- [ ] **(You)** A real review request reaches the phone with the app closed. It shows the person's picture with the Git Buddy badge, and the blue review tile on the right.
- [ ] **(You)** "Send a test" shows each kind with the right tile, and the checks failed test with no person shows the plain app icon.
- [ ] Tapping a notification opens the PR.
- [ ] One notification per event on the phone, not two.
- [ ] **(You)** The long presses, pull to refresh, and switches tick.
- [ ] **(You)** Sharing a PR link from Safari adds it.
- [ ] A change to `apps/ios` reaches TestFlight through a release, with no steps by hand.
