# 06. API and live updates

**Goal:** a typed JSON API that the web app (and later the Tauri app) uses for everything, plus a live stream that tells open screens when something changed.

**Needs:** plan 05.

**Split into three PRs:**

- **Part A** (`plan-06-1-items`): 6.1, plus the items, seen, and summary endpoints.
- **Part B** (`plan-06-2-settings`): the settings, rules, and sync endpoints, and re-running rules when settings change.
- **Part C** (`plan-06-3-stream`): 6.3 live updates, the `.http` file, and the last tests.

## Changes from the original plan

- **Item sections** come from each item's kind (`ITEM_GROUPS` in `packages/core/src/api/items.ts`): review requests and re-requests are `review`, replies are `replies`, and the rest are `mine`.
- **`age`** is the real time since `waitingSince`, or since the latest event for items without one. **`staleLevel`** is only set for review requests.
- **Muted repos' items are still listed.** Muting only stops notifications (plan 08).
- **`POST /items/seen`** skips ids that aren't the user's, without an error, and keeps the first seen time.
- **The urgency sort takes `unseen`**, not `seenAt`, so it can sort the API's items directly.

## Steps

### 6.1 Shared API types (part A)

- [x] Define request and response shapes as Zod schemas in `packages/core/src/api/`. The server uses them to validate input. The web app uses the inferred TypeScript types. This way both sides always agree. Items: `api/items.ts`.
- [x] Every error response uses `{ error: { code, message } }` (done since plan 04, `HttpError`).

### 6.2 Endpoints

All under `/api`. All require sign in except auth and health.

**Items** (part A, done: `routes/items.ts` and `item-list.ts`)

| Method and path    | What it does                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /items`       | Open items, grouped into `review`, `replies`, and `mine`, sorted by urgency. Each item includes PR title, repo, number, url, kind, summary, age, stale level, severity, unseen flag |
| `POST /items/seen` | Body `{ ids }`. Marks items as seen when the list is opened                                                                                                                         |

There are no done or snooze endpoints. Items clear on their own (see [plan 05](completed/05-rules-engine.md#when-an-item-clears)).

**Repos:** the endpoints from plan 04.1.

**Settings**

| Method and path        | What it does                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `GET /settings`        | User settings plus each rule with its name, group, defaults, and the user's choices       |
| `PATCH /settings`      | Update user settings (timezone, staleness, quiet hours, digest time, bots, team requests) |
| `PATCH /rules/:ruleId` | Update `enabled`, `severity`, `channels`                                                  |

Rules only run when a PR changes on GitHub (plan 05). So after `PATCH /settings` (hide bots, team requests) or `PATCH /rules/:ruleId`, re-run the rules on the user's stored PR snapshots and save the items, the same way `syncUser` does.

`PATCH /settings` must reject unknown timezones (check against `Intl.supportedValuesOf("timeZone")`). The waiting time code in `packages/core/src/urgency.ts` throws on one.

**Sync**

| Method and path    | What it does                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `POST /sync`       | "Refresh now". Enqueues a sync for this user right away. Rate limited to once per 30 seconds |
| `GET /sync/status` | `lastSyncedAt`, `syncError`, and whether a sync is running                                   |

**Counts (for badges)** (part A, done)

| Method and path | What it does                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /summary`  | `{ total, review, replies, mine, hasStale, hasFailing }`. Used by the app badge and later the menu bar icon |

### 6.3 Live updates with SSE

- [ ] `GET /api/stream` keeps a connection open using Server-Sent Events.
- [ ] The web service runs `LISTEN` on the Postgres channel the worker publishes to (`user_items_changed`, with the user id as the message, plan 05.5). When a message arrives for a user, it sends `event: items-changed` with the new summary to that user's open streams.
- [ ] Send a comment line every 25 seconds as a keep-alive, so proxies don't close idle connections.
- [ ] The client reconnects on its own (the browser's `EventSource` does this). The client also refetches on reconnect in case it missed something.

### 6.4 Tests

- [ ] Supertest tests for each endpoint: auth required, validation errors, happy path, and one user can't touch another user's items. Items, seen, and summary done in part A.
- [ ] A test that publishing a change sends an SSE event to the right user only.

## Done when

- [ ] Every endpoint above works locally against real synced data. A small `.http` file (for the VS Code REST Client extension) or Bruno collection is checked in for manual testing.
- [ ] Submitting a review on GitHub removes that item from `GET /items` after the next sync.
- [ ] With `curl -N` on `/api/stream`, a new GitHub event shows up as an SSE message within one sync cycle.
