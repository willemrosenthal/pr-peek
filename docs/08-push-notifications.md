# 08. Push notifications

**Goal:** the right alerts reach the right devices, even when the app is closed. No duplicates. Quiet hours and the morning summary are respected.

**Needs:** plan 07.

## Background

**Web Push** works like this:

1. The browser gives us a **subscription**: a URL at the browser maker's push service (Apple, Google, Mozilla) plus two keys.
2. We save it.
3. To alert that device, the server sends an encrypted message to that URL, signed with our **VAPID keys** (a key pair that proves the message came from us).
4. The browser wakes our service worker, which shows the notification.

No third party account is needed. The `web-push` npm package handles the encryption and signing.

**Platform notes:**

| Platform        | Notes                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| iPhone and iPad | Works only for PWAs added to the Home Screen (iOS 16.4 and later). Permission must be asked in response to a tap         |
| Android         | Works in Chrome, installed or not                                                                                        |
| Mac             | Works in Safari (including "Add to Dock" apps), Chrome, Edge, Firefox. Chrome and Edge must be running to receive pushes |

## PRs

1. Push API (server): 8.1, the device routes, and sending with the 404/410 rule from 8.4.
2. Devices (web), in two PRs:
   - 2a: 8.5, the "Turn on notifications" button in Settings, Devices, and the device list with Send test and Remove.
   - 2b: the rest of 8.2: the button in onboarding, per-device severity, renaming, re-checking on open, and the repo Mute switch.
   - Then a small PR for step 8.8: database enums.
3. Notify: 8.3 except staleness and batching, plus the rest of 8.4. Also drop "once those arrive" from the Rules tab and the Notifications group on the Timing tab.
4. Schedules, in three PRs:
   - 4a: the morning summary (8.6).
   - 4b: staleness reminders, with a "remind every" setting.
   - 4c: batching.

## Steps

### 8.1 Keys and config

- [ ] **(You)** Generate VAPID keys once with `pnpm --filter @pr-peek/server exec web-push generate-vapid-keys`. One pair for your `.env`, another for production.
- [x] Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` contact address) to config and `.env.example`. They're optional: with none set, push is off and the push routes answer 503.
- [ ] **(You)** Add the prod keys to the Render env group. Never change them later: existing subscriptions would stop working.
- [x] `GET /api/push/key` returns the public key for the browser.
- [x] Device routes: `GET`, `POST`, `PATCH`, `DELETE /api/push/subscriptions`, and `POST /api/push/subscriptions/:id/test`. Posting a device that's already saved updates its keys. Endpoints must be a known push service (Google, Mozilla, Apple, Microsoft), since the server sends requests to them. Up to 20 devices per user.

### 8.2 Subscribing a device

- [x] A "Turn on notifications" button (in onboarding and Settings, Devices). It must be a user tap, which iOS requires. It:
  1. Calls `Notification.requestPermission()`.
  2. Calls `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
  3. Sends the subscription to `POST /api/push/subscriptions` with a device label ("iPhone", "Mac, Safari") guessed from the user agent and editable.
- [x] On iPhone, if the app isn't installed to the Home Screen, show the install steps instead of the button.
- [x] Settings, Devices lists each subscription with its label, last success time, a "Send test" button, and Remove. Removing this browser's device also unsubscribes it.
- [x] Each device can choose which severities it gets. For example: phone gets high only, Mac gets everything. Add a `minSeverity` field to `PushSubscription`. (The field and API are in part 1.)
- [x] Re-check the subscription each time the app opens. If the browser changed it, update it on the server.
  - The browser remembers the endpoint it saved (in localStorage). If its subscription changed, the old device moves to the new one with `PATCH /api/push/subscriptions/:id`, keeping its name and severity. A device removed from another device isn't added back. (`recheckPush` in `apps/web/src/push.ts`.)
- [x] Add a Mute switch to each repo in Settings, Repositories (`components/WatchedRepos.tsx`, plan 07 part 4a). `PATCH /api/repos/:id` already takes `muted`.

### 8.3 Deciding whether to notify

The `notify:item` job from plan 05.5:

- [x] Load the item, its rule setting, the user's settings, and their devices.
- [x] Skip if:
  - The rule's channels don't include push.
  - The item isn't open.
  - The item's repo is muted.
  - `NotificationLog` already has this `(itemId, latestEventId)`.
  - Also: the user already saw the item, or no device takes its severity.
  - (`notifyItem` in `apps/server/src/notify.ts`. It claims the log row before sending, so a retry or a second run never sends twice.)
- [x] **Staleness reminders:** a scheduled job finds review requests that just crossed the warn or late threshold and notifies once per threshold. It repeats at the user's "remind every" interval.
  - Every 5 minutes (`sendDueReminders` in `apps/server/src/reminders.ts`). The stage ("warn", "late", "late+1", ...) is part of the logged event id, so each stage sends once. The interval only repeats after red, and counts work hours only if that setting is on.
  - It sends the current stage, so on first deploy each request already past orange gets one reminder.
- [x] **Quiet hours:** inside quiet hours (or on a quiet weekend), don't send. Leave it for the morning summary. High severity can optionally break through quiet hours, as a setting, off by default. (`isQuiet` in core. The setting is `highBreaksQuiet`, "Let high urgency through" on the Timing tab.)
- [ ] **Batching:** if 3 or more notifications for the same user would go out within 30 seconds (like after a long offline period), send one "5 new things need you" push instead.

### 8.4 Sending

- [x] For each device whose `minSeverity` allows it, send with `web-push`. Use a payload like `{ title, body, url, tag, itemId }`.
  - `tag` is the item id, so a newer alert for the same item replaces the old one instead of stacking.
  - Set a TTL (how long the push service keeps trying, e.g. 12 hours) and urgency (`high` for high severity).
  - The title is the item's summary ("jlee asked for your review"). The body is the PR title, then the repo and number.
- [x] Write a `NotificationLog` row per send. One row per item event, `pending` until the send ends, then `sent` or `failed`.
- [x] If the push service returns 404 or 410 (subscription gone), delete the subscription. On other errors, bump `failureCount` and remove after 5 in a row. (`pushToDevice` in `apps/server/src/push.ts`.)

### 8.5 Service worker

- [x] In `apps/web/src/sw/sw.ts`:
  - `push` event: show the notification with title, body, icon, `tag`, and `data.url`.
  - `notificationclick` event: links to pr-peek itself focus an open pr-peek window and go there. Links to GitHub open in a new window, so the app stays where it was. Then mark the item seen through the API.
- [x] Update the app badge with a count in the payload.
- [x] No action buttons on notifications for now. Tapping one opens the PR.

### 8.6 Morning summary

- [x] A scheduled job runs every 15 minutes. It finds users whose `digestTime` (in their timezone) just passed and who haven't had today's summary.
  - "Just passed" means within the hour after, so a worker that was briefly down still sends it. `UserSettings.lastSummaryDate` (the user's local date) is claimed before sending, so it goes once a day.
- [x] It sends one push like "3 reviews waiting (oldest 2d), 1 failing check, 1 approval". Clicking it opens the list.
  - It goes to every device, whatever its severity setting, and ignores quiet hours: the user picked the time.
- [x] Skip it if there's nothing open.

### 8.7 Tests

- [ ] Unit tests for the decision logic: dedupe, quiet hours across midnight and timezones, weekend rule, severity per device, batching.
  - All but batching are done (`quiet-hours.test.ts`, `notify.test.ts`). Batching comes in part 4.
- [x] A test with a fake `web-push` sender: a 410 deletes the subscription.

### 8.8 Database enums

After part 2b, before part 3. Text columns that only ever hold a few fixed values become Postgres enums, so the database refuses anything else.

- [x] `Severity` enum for `RuleSetting.severity` and `PushSubscription.minSeverity`. Then remove the `as Severity` cast in `routes/push.ts`.
- [x] `Channel` enum list for `RuleSetting.channels`.
- [x] Enums for `PullRequest.state` (open, merged, closed, gone, unwatched) and `User.syncError`.
- [x] Drop the unused `PushSubscription.platform` column.
- [x] Edit each generated migration to convert the column in place (`ALTER COLUMN ... TYPE ... USING ...`). Prisma's default drops and re-adds the column, which loses the data.
  - The migration first fixes any value the app never writes, so a cast can't fail.
- [x] Leave `Item.kind` and `PullRequest.checkState` as text. New rules and GitHub's own values would otherwise need a migration.
- In part 3, `NotificationLog.channel` and `status` start out as enums.

## Done when

- [ ] With the PWA installed on your iPhone and notifications on, a re-request on GitHub produces a push within one sync cycle, while the app is closed and the Mac is asleep.
- [ ] Tapping it opens the PR.
- [ ] The same event never alerts twice, even after a worker restart.
- [ ] Nothing arrives during quiet hours, and the morning summary arrives at the set time.
- [ ] Removing a device in Settings stops its pushes.
