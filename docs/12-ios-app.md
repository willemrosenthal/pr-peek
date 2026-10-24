# 12. iPhone app (Capacitor)

**Goal:** an iPhone app with the rich notifications from the [design canvas](https://claude.ai/artifact/HWBgeX8c3Nh5oMR9jDHKpJ). The person's picture is on the left with a small Git Buddy badge on it, and a colored tile for the kind of action is on the right. The PWA can't do this. iOS shows only the home screen icon in a web push.

**Needs:** plan 08. Plan 09 is not needed, but its "load the hosted app" approach is reused here. A Mac with Xcode. An Apple Developer account.

## Key decision: wrap the web app with Capacitor

Capacitor puts the web app in a native iPhone app. The screens stay the React app we have. Only the notification parts are native.

- **Why not Tauri for iOS:** it would keep one toolchain, but its support for push from a server is thinner. It likely needs a community plugin or our own Swift plugin. Capacitor has a mature push plugin. Check Tauri's current state once in 12.1 before committing.
- **Why not React Native or Swift:** both mean building the screens a second time.
- **Feel:** the app is a list with swipes and links. It runs in the same browser engine (WebKit) as the Mac app, so the swipe and animation work carries over.

## Key decision: load the hosted app

Like plan 09, the app loads `https://www.git-buddy.com/?shell=ios` instead of bundling a copy of the UI.

- **Good:** UI changes ship through the normal Render deploy. Sign in, cookies, and the API work like in Safari. GitHub sign in works inside the app's web view.
- **Cost:** needs internet to open, and Apple may question an app that is "just a website" in App Store review. Native push helps. TestFlight (for you only) skips that review.
- **Fallback:** bundle `apps/web/dist` and call the API with a token instead of a cookie, as in plan 09.

## Key decision: the picture on the right comes with the app

The extension (12.4) shows the tile for each kind from images inside the app. The push only says which kind it is. So there's no download for the tile, and it can't fail.

## PRs

1. Shell: 12.1 and 12.2.
2. Server: 12.3, Apple push next to web push. Does nothing until an iPhone app registers.
3. App push: 12.4, register, tap to open, badge count.
4. Rich notifications: 12.5, the notification extension.
5. No duplicates: 12.6.

## Steps

### 12.1 Accounts and check

- [ ] **(You)** Join the Apple Developer Program ($99 a year): developer.apple.com, Account, Enroll.
- [ ] **(You)** In Certificates, Identifiers & Profiles, Keys: make an APNs key (Apple Push Notification service). Download the `.p8` file once and keep it safe. Note its Key ID and your Team ID.
- [ ] Check Tauri's iOS push support. If it now handles server push and notification extensions well, say so in this plan and ask before switching.

### 12.2 The shell

- [ ] A new workspace package, `apps/ios`, with Capacitor and its iOS project (`ios/`). The bundle ID is `com.git-buddy.pr-peek` (the same rule as the Mac app: never change it).
- [ ] `capacitor.config.ts` points `server.url` at `https://www.git-buddy.com/?shell=ios`. Allow only our domain to call native code.
- [ ] App icon from `apps/web/public/icon.svg` (the full size iOS icon, no padding).
- [ ] The web app knows it's in the iPhone app (`?shell=ios`, kept like the tray shell). It then:
  - hides the "Add to Home Screen" steps and the web push switch,
  - respects the safe areas (notch and home bar),
  - opens PR links in Safari (or the GitHub app), not inside the app.
- [ ] GitHub sign in works inside the app and returns to the list.
- [ ] **(You)** In Xcode, sign in with your Apple account, pick your team, and run the app on your iPhone.
- [ ] **(You)** Upload a build to TestFlight and install it from there.

### 12.3 Apple push on the server

- [ ] Store iPhone app devices. Decide in the PR: a new `AppleDevice` table, or a `platform` column on `PushSubscription`. Prefer the new table if it keeps the web push code simple. Each one has the device token, label, severity setting, and failure count, like today's devices.
- [ ] An endpoint for the app to register and unregister its token.
- [ ] Send with token based auth (the `.p8` key), over HTTP/2 to Apple. Env vars: `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` (the bundle ID). Pick a small library, or sign the JWT ourselves.
- [ ] The Apple payload carries the same title, body, URL, and badge as a web push, plus:
  - `mutable-content: 1`, so the extension runs,
  - `kind`, for the tile,
  - `actor` (login) and `avatar` (picture URL), when a person did it.
- [ ] Approved and "requested changes" share the `reviewed` kind today. Pass the review state too, so each gets its own tile (green check, orange alert).
- [ ] Remove a token when Apple says it's gone, like web push devices.
- [ ] "Send test" goes through the same samples (`TEST_PUSHES`), with `kind` and `actor` set.
- [ ] Settings, Devices lists iPhone app devices with the others.
- [ ] **(You)** Add the APNs env vars on Render, for the web service and the worker.

### 12.4 App push

- [ ] Use `@capacitor/push-notifications`: ask for permission, get the token, send it to 12.3's endpoint.
- [ ] Tapping a notification opens its PR, and marks the item seen (like the service worker does now).
- [ ] The app icon's badge shows the open count.

### 12.5 Rich notifications (Swift)

A Notification Service Extension: a small Swift target in the Xcode project that runs on the phone before each notification shows.

- [ ] Add the extension target, the Push Notifications and Communication Notifications capabilities, and `INSendMessageIntent` in `NSUserActivityTypes`.
- [ ] When there's an `actor`: download the avatar, make an `INPerson`, and turn the notification into a communication notification (`INSendMessageIntent`, then `content.updating(from:)`). iOS then shows the picture on the left with the app icon as a badge. iOS draws the badge from the app icon itself, so the separate "arm + face" badge from the canvas can't be used.
- [ ] Attach the kind's tile as a thumbnail (`UNNotificationAttachment`). The tiles are PNGs in the extension, made from the Candy colors and the Lucide icons the list uses.
- [ ] If anything fails or runs out of time, show the plain notification. Never drop it.
- [ ] Check early that the tile still shows on the right of a communication notification. If iOS hides it, decide between the avatar and the tile.

### 12.6 No duplicates

- [ ] If the same phone has the PWA and the app, both get each notification. Simplest: the app tells you to turn off notifications for the PWA in Settings, Devices. Better: when an iPhone app device exists, skip web push devices on iPhones. Decide in the PR.

## Done when

- [ ] **(You)** The app installs from TestFlight, signs in, and shows the list.
- [ ] **(You)** A real review request reaches the phone with the app closed. It shows the person's picture with the Git Buddy badge, and the blue review tile on the right.
- [ ] **(You)** "Send test" shows each kind with the right tile, and the checks failed test with no person shows the plain app icon.
- [ ] Tapping a notification opens the PR.
- [ ] One notification per event on the phone, not two.
