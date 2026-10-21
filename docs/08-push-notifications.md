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

## Steps

### 8.1 Keys and config

- [ ] Generate VAPID keys once with `npx web-push generate-vapid-keys`.
- [ ] Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` contact address) to config and `.env.example`.
- [ ] **(You)** Add the prod keys to the Render env group. Never change them later: existing subscriptions would stop working.
- [ ] `GET /api/push/key` returns the public key for the browser.

### 8.2 Subscribing a device

- [ ] A "Turn on notifications" button (in onboarding and Settings, Devices). It must be a user tap, which iOS requires. It:
  1. Calls `Notification.requestPermission()`.
  2. Calls `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
  3. Sends the subscription to `POST /api/push/subscriptions` with a device label ("iPhone", "Mac, Safari") guessed from the user agent and editable.
- [ ] On iPhone, if the app isn't installed to the Home Screen, show the install steps instead of the button.
- [ ] Settings, Devices lists each subscription with its label, last success time, a "Send test" button, and Remove.
- [ ] Each device can choose which severities it gets. For example: phone gets high only, Mac gets everything. Add a `minSeverity` field to `PushSubscription`.
- [ ] Re-check the subscription each time the app opens. If the browser changed it, update it on the server.

### 8.3 Deciding whether to notify

The `notify:item` job from plan 05.5:

- [ ] Load the item, its rule setting, the user's settings, and their devices.
- [ ] Skip if:
  - The rule's channels don't include push.
  - The item isn't open.
  - The item's repo is muted.
  - `NotificationLog` already has this `(itemId, latestEventId)`.
- [ ] **Staleness reminders:** a scheduled job finds review requests that just crossed the warn or late threshold and notifies once per threshold. It repeats at the user's "remind every" interval.
- [ ] **Quiet hours:** inside quiet hours (or on a quiet weekend), don't send. Leave it for the morning summary. High severity can optionally break through quiet hours, as a setting, off by default.
- [ ] **Batching:** if 3 or more notifications for the same user would go out within 30 seconds (like after a long offline period), send one "5 new things need you" push instead.

### 8.4 Sending

- [ ] For each device whose `minSeverity` allows it, send with `web-push`. Use a payload like `{ title, body, url, tag, itemId }`.
  - `tag` is the item id, so a newer alert for the same item replaces the old one instead of stacking.
  - Set a TTL (how long the push service keeps trying, e.g. 12 hours) and urgency (`high` for high severity).
- [ ] Write a `NotificationLog` row per send.
- [ ] If the push service returns 404 or 410 (subscription gone), delete the subscription. On other errors, bump `failureCount` and remove after 5 in a row.

### 8.5 Service worker

- [ ] In `src/sw.ts`:
  - `push` event: show the notification with title, body, icon, `tag`, and `data.url`. Also update the app badge with the count in the payload.
  - `notificationclick` event: focus an open pr-peek window if there is one, otherwise open one. Then go to the PR URL, or open it on GitHub. Mark the item seen through the API.
- [ ] No action buttons on notifications for now. Tapping one opens the PR.

### 8.6 Morning summary

- [ ] A scheduled job runs every 15 minutes. It finds users whose `digestTime` (in their timezone) just passed and who haven't had today's summary.
- [ ] It sends one push like "3 reviews waiting (oldest 2d), 1 failing check, 1 approval". Clicking it opens the list.
- [ ] Skip it if there's nothing open.

### 8.7 Tests

- [ ] Unit tests for the decision logic: dedupe, quiet hours across midnight and timezones, weekend rule, severity per device, batching.
- [ ] A test with a fake `web-push` sender: a 410 deletes the subscription.

## Done when

- [ ] With the PWA installed on your iPhone and notifications on, a re-request on GitHub produces a push within one sync cycle, while the app is closed and the Mac is asleep.
- [ ] Tapping it opens the PR.
- [ ] The same event never alerts twice, even after a worker restart.
- [ ] Nothing arrives during quiet hours, and the morning summary arrives at the set time.
- [ ] Removing a device in Settings stops its pushes.
