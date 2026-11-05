# 17. Add a PR by link

**Goal:** you can add any PR to your list by its link, for PRs Git Buddy would never find on its own. It's flagged important and kept up to date like the rest. Unflag it and Git Buddy stops tracking it.

**Needs:** [plan 16](16-efficiency.md) PR 5 (5a and 5b) merged. Both change the sync and how the list picks a section, and so does this plan.

Mockups: [Add a PR by link](https://claude.ai/artifact/78kChcGwpm9tirbuf9SCx2). We picked B (a row at the end of the list) and C (paste anywhere).

## How you add one

- **The "Add a PR by link" row** at the end of the list, and on the empty "Nothing needs you right now" screen. It opens a dialog: paste the link, see the PR's title, then **Add as important**.
- **Paste anywhere on the list** (⌘V or Ctrl+V) with a PR link copied. It adds right away, no dialog, and shows a toast with Undo.
- **Drop a link** onto the list: from the browser's address bar onto the Mac dropdown, or onto the web app in a browser.
- **Share to Git Buddy** on Android, from the GitHub app or a browser. It opens the dialog with the link filled in. iPhone home screen apps can't receive shares, so iPhone waits for [plan 12](12-ios-app.md).

Any link shape works: `https://github.com/owner/repo/pull/123`, with `/files`, `/commits`, `#discussion_r…` or a query on the end, or the short form `owner/repo#123`.

## Key decisions

### A Watching section

Flagged PRs stay in their usual section today. An added PR you didn't write, aren't reviewing, and aren't assigned to has nowhere to go. The list puts any such PR under Needs my review, which says you owe a review when you don't.

So a new **Watching** section holds PRs with nothing to do that fit no other section. It comes after My PRs by default, and can be reordered in settings like the others. If something happens on one, like a review request, it moves to that section, as any PR would.

No "Added" tag on the row. Every row in Watching is flagged, since only flagged PRs with nothing to do land there, so rows in it show no flag either.

Swiping a Watching row says **Stop watching**, with a crossed-out eye, instead of "Remove flag". So does the preview's button, opened from Watching. The row leaves the list either way, and that's what the label says. Not "Untrack": a flagged PR the searches found can land in Watching too, and it stays tracked after.

If a Watching PR moves to another section, it shows its flag there, and "Remove flag", as today.

### Added PRs ignore watched repos

Today the sync skips PRs in repos you don't watch, marks them `unwatched`, and the list hides them. An added PR is one you asked for by name, so it's tracked no matter the repo, paused or not watched at all. A new `PullRequest.addedAt` column marks them.

### Unflag to stop tracking

Unflagging an added PR clears `importantAt` and `addedAt`. It leaves the list right away: the list only shows PRs with nothing to do if they're yours or flagged.

The row isn't deleted on the spot. Unflagging also sets its `lastSeenAt` back 7 days and queues a sync, so the sync's usual cleanup decides. If the searches still find it, it stays as a normal PR. If not, and it has no open items, it's deleted. Deleting it on the spot could lose a PR the searches also track, and a new row would notify again about old events.

### Already on the list? Just flag it

Adding a PR you already track flags it, closes the dialog, and scrolls to its row with a short highlight. Not an error. It doesn't set `addedAt`, since the searches found it on their own, so unflagging it later works as it does today.

### Cost

Each sync already checks tracked PRs the searches missed, by ID, up to 100 per GitHub request (`fetchPrStatuses` in `sync.ts`). Added PRs join that batch. So a sync with nothing new makes no extra requests most of the time. Details load only when the PR changes, like any other.

Adding one costs a lookup or two, once. The dialog looks the PR up only after the link parses, never per keystroke.

A cap of **25 added PRs** per person keeps the worst case small. Merged ones still on the list count.

### Clear errors

| What went wrong                         | What the dialog says                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------- |
| Not a GitHub PR link                    | "That doesn't look like a PR link."                                                    |
| A link to an issue                      | "That's an issue, not a pull request."                                                 |
| GitHub says not found, or no access     | "Your GitHub token can't see this PR. Check its repo access in Settings." With a link. |
| 25 already added                        | "You've added 25 PRs, the most you can. Unflag one to add another."                    |
| GitHub is down, or the token is expired | The usual message for that error, as elsewhere in the app.                             |

Fine-grained tokens limited to some repos are the usual cause of "can't see", so that one links to the token settings.

## PRs

1. This plan.
2. **The server** (17.1 to 17.3), in two PRs, since it's over 400 lines:
   - 2a (17.1, 17.3): `feat(web): a Watching section, and tracking added PRs`. The column, the sync and list changes, and the Watching section on screen, together, so no PR is ever in a section the web app doesn't show. Has a migration.
   - 2b (17.2): `feat(server): add a PR by link`. The routes.
3. **The web and Mac app** (17.4 to 17.7): `feat(web): add a PR by link, paste, or drop`. The dialog, paste, drop, the Android share target, and the Mac window change.

Both release a minor version and deploy. PR 3 also builds the Mac app, since it changes `apps/desktop`. Each is about 250 to 350 lines with tests.

## Steps

### 17.1 Track added PRs

- [x] Migration: `PullRequest.addedAt DateTime?`.
- [x] Sync: added PRs count as watched. They're checked by ID with the other missed PRs, never marked `unwatched` (at the start, or when a PR moved repos), and their details load when they change. A user with no watched repos still syncs their added PRs, and skips the searches, which only find PRs in watched repos.
- [x] Clean up as today: merged ones stay until unflagged, closed ones leave after 7 days. No change needed.
- [x] The list: added PRs show whatever their repo. Merged added PRs show too, though `mergedPrs` hides other merged PRs in repos you don't watch.
- [x] A new `ListSection` type in `packages/core`: the item groups plus `watching`. Not a new `ItemGroup`, since no item goes in Watching, and the list's item groups would get an always empty one. `idleGroup` in `item-list.ts` picks the section for a PR with no item to go by: yours, reviewing, assigned, or else Watching (was: Needs my review). The sync saves it as `listGroup`. A row without one goes by its author, else Watching.
- [x] Stored rows keep their old `listGroup` until refetched. The full pass after the deploy refetches open PRs. Merged rows aren't, so the migration clears `lastPushSha` on merged rows whose `listGroup` is `review` and that still have a snapshot. The plan 16 backfill (`backfill.ts`) picks rows by an empty `lastPushSha`, and refills all three columns from their snapshot, with the new `idleGroup`. `lastPushSha` only matters for open PRs, so clearing it on merged ones is safe. Rows first saved after plan 16 PR 5b-2 have no snapshot, so merged ones among them stay in Needs my review until unflagged. Rows fetched after 5b-2 have an older snapshot than their `listGroup`, so a review made since then is missed, and the PR moves to Watching. Few, if any, since 5b-2 went live the same day. This must ship before plan 16 step 16.7 drops the snapshots.
- [x] Tests: an added PR in an unwatched repo syncs and merges like any other, and stays when a search finds it or it moves repos. One sync with an added PR makes one status request with the other missed PRs. A user with only added PRs syncs, without searching. `idleGroup` picks Watching. A merged added PR shows.

### 17.2 The routes

- [ ] `parsePrLink(text)` in `packages/core`, used by the server and the web app. Takes every shape above, and also finds a link inside longer text, like an Android share ("Check this out https://github.com/…").
- [ ] `GET /api/prs/lookup?link=…`: looks the PR up with one GraphQL request (`repository { issueOrPullRequest(number) }`), so an issue can be told from a PR. Returns its title, repo, author, state, and whether you already track it.
- [ ] `POST /api/prs` with `{ link }`: if you track it, flags it and returns its ID, with `alreadyFlagged` if it was. If not, checks the cap, looks it up, and saves it with `importantAt`, `addedAt`, and `listGroup: "watching"`. Sends the usual live update, and queues a sync for you.
- [ ] That first sync must not push about the PR's old comments, mentions, or reviews. Every item on a newly saved PR counts as new today, which is right for one a search just found, but not for one you added with weeks of history. Save its first items as seen, and send nothing.
- [ ] That sync must fetch the new PR's details and run the rules on it. Since plan 16 PR 5a, a sync only does that for PRs whose `githubUpdatedAt` changed (`needsDetails`). So the route saves `githubUpdatedAt` as the epoch, and the sync sees it as changed.
- [ ] `DELETE /prs/:id/important`: for an added PR, clears `addedAt` too, sets `lastSeenAt` back, and queues a sync, as in [Unflag to stop tracking](#unflag-to-stop-tracking).
- [ ] Both new routes use `attemptLimiter`. Errors return a code the web app turns into the messages in [Clear errors](#clear-errors).
- [ ] Tests: each link shape, each error, the cap (merged ones count), adding one you already track, and that the next sync fills in a new one's items. Unflagging an added PR: deleted by the next sync when the searches don't find it, kept when they do, kept with open items.

### 17.3 The Watching section on screen

- [x] Add `{ group: "watching", title: "Watching" }` to `SECTIONS` in `sections.ts`. Saved section orders that don't name it put it at the end, which `orderSections` already does.
- [x] Rows in Watching hide the flag. Their swipe and the preview's button say "Stop watching" with `EyeOff`, in place of "Remove flag" with `FlagOff`. `ItemSection` gets `watching` and passes it down.
- [x] Tests: Watching shows, and can be reordered. Its rows show no flag, and their swipe and preview say "Stop watching". A flagged PR in another section shows its flag.

### 17.4 The dialog

- [ ] An "Add a PR by link" row at the end of the list, and on the empty screen. It opens `AddPrDialog`.
- [ ] The dialog parses as you type, then looks the PR up (with a short wait after typing stops). It shows the title, repo, and author, or the error. The button says **Add as important**, or **Flag it** when you already track it.
- [ ] After adding: the dialog closes, and the list scrolls to the row with a short highlight. Rows need a `data-pr-id` to find them.
- [ ] Tests: each state, and adding one you already track.

### 17.5 Paste and drop

- [ ] A `paste` listener on the list page. Ignored when typing in a field. If the text is a PR link, add it right away and show a toast: "Added owner/repo#123", with Undo (unflags it). If it was already flagged, the toast says "Already on your list", with no Undo, so Undo never unflags something you flagged before. On an error, the toast shows the message instead.
- [ ] A small `Toast` component. There isn't one yet.
- [ ] Drop: the list page takes `dragover` and `drop`, reading `text/uri-list`, then `text/plain`. While a link is dragged over, the list shows an outline and "Drop to add". Then it works like paste.
- [ ] Mac app: call `.disable_drag_drop_handler()` on the window in `lib.rs`. Without it, Tauri catches drops for its own file drop events, and the page never sees them. We don't use those events.
- [ ] Tests: paste and drop add a PR, other text is ignored, Undo unflags, and an already flagged PR shows no Undo.

### 17.6 Share on Android

- [ ] Add a `share_target` to the manifest in `vite.config.ts`: `GET /add` with `title`, `text`, and `url`.
- [ ] A `/add` route: finds a PR link in those, goes to the list, and opens the dialog filled in. Nothing found: the dialog opens empty, with the error.
- [ ] Tests: a share with the link in `text`, and one in `url`.

### 17.7 Try it (You)

- [ ] Add a PR from a repo you don't watch, by the row, by paste, and by drop on the Mac dropdown.
- [ ] Share a PR to Git Buddy from the GitHub app on Android. Android only offers it once the app is reinstalled or updated, so the new manifest is read.

## Done when

- [ ] A PR from a repo you don't watch shows in Watching within seconds of adding it, flagged (You).
- [ ] It moves to Needs my review when someone asks you to review it, and stays flagged.
- [ ] When it merges, you get the "merged" push, and it shows as Merged until you unflag it.
- [ ] Unflagging it removes it from the list, and it's gone after a refresh.
- [ ] Paste, drop on the Mac dropdown, and share on Android all add a PR (You).
- [ ] Each error in [Clear errors](#clear-errors) shows its message.
- [ ] A sync with 3 added PRs and nothing new makes at most one more GitHub request than before, and none when other PRs were missed too.
