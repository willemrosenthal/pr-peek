# 14. Assigned to me

**Goal:** a new list section, "Assigned to me", for PRs where you're an assignee. Teams use assignees in different ways: "you review this", "you own getting this merged", or on-call and release duty. In each case the PR is your job until it's done. So each row shows **what the PR needs next**, like "Ready to merge" or "Checks failing", not just that you were assigned.

**Needs:** plans 05 to 08. Works in the PWA, the Mac app, and the iPhone app, since they all show the web app.

## Key decision: show the PR's state, worked out when the list is read

The row's state comes from the stored snapshot (the copy of the PR we save on each sync) each time the list is read. It isn't part of the item.

- A state change updates the row, but doesn't mark it unread or send a push. Only a new assignment does.
- **Not chosen, a new item per state:** every check run or review would mark the row unread. Too noisy for something you already own.

States, first match wins:

| PR state                        | Label             | Icon (lucide)       | Color    |
| ------------------------------- | ----------------- | ------------------- | -------- |
| Draft                           | Draft             | `SquircleDashed`    | muted    |
| Merge conflict                  | Has conflicts     | `TriangleAlert`     | warning  |
| Checks failing                  | Checks failing    | `CircleX`           | failed   |
| Changes requested               | Changes requested | `MessageSquareText` | comment  |
| Approved, checks pass (or none) | Ready to merge    | `GitMerge`          | approved |
| Checks running                  | Checks running    | `CircleDashed`      | muted    |
| Anything else                   | Waiting on review | `CircleUserRound`   | muted    |

Drafts are a state of their own, first in the order. Item rows don't know if a PR is a draft (only the idle rows under My PRs do), and a draft has nothing for you to do yet anyway.

"Approved" and "Changes requested" come from GitHub's `reviewDecision`. Repos whose branch rules don't require reviews have none, so then each reviewer's latest verdict decides, the same way the preview shows reviewers.

Running checks block "Ready to merge" even once approved. A merge state GitHub hasn't worked out yet (`UNKNOWN`) doesn't count as a conflict.

**Known gap:** a conflict caused by the base branch moving doesn't change the PR's `updatedAt`, so the sync doesn't fetch it again. "Has conflicts" can show late, until something else changes on the PR.

## Key decision: its own color, teal

The section's icon is `CircleUserRound` in a new teal: `--color-kind-assigned`, `#0a9fae` light and `#3ed2df` dark. Teal fills the gap between the green (approved) and blue (review) hues, so it doesn't look like any other kind. The light color has about 3.1:1 contrast on white, enough for icons. The state icon keeps its own color, so teal says which section a row is in, and the state color says what to do.

## Key decision: one row per PR

The list already shows one row per PR. If you're both assigned and asked to review, the row stays in "Review requests" with a small "Assigned" tag. It doesn't show twice.

## Key decision: no changes to My PRs

PRs you opened are left out of this section, since they're already in My PRs. My PRs doesn't change.

## PRs

Two PRs, since the server side and the screen are each a good size:

1. `plan-14-1-assigned-rule`: steps 14.1 to 14.3, plus the first two parts of 14.4. Adding a kind breaks the web app's types until it has an icon, so the token and icon came early.
2. `plan-14-2-assigned-section`: the rest of 14.4, then 14.5 and 14.6.

## Steps

### 14.1 Sync assigned PRs

- [x] Add the search `assignee:@me -author:@me` to `findRelevantPrs` in [pull-search.ts](../apps/server/src/github/pull-search.ts).
- [x] Fetch the PR's assignees, its assign and unassign events (who, whom, when), `reviewDecision`, and `mergeable` in [pull-details.ts](../apps/server/src/github/pull-details.ts).
- [x] Add them to the snapshot in [pr-snapshot.ts](../packages/core/src/pr-snapshot.ts). Make them optional, so snapshots saved before this still parse.
- [x] Fetch an assigned PR again when only its checks change, like the user's own PRs. A check finishing doesn't change `updatedAt`, so without this "Checks running" would never move on.
- [x] Tests for the new fields, and for old snapshots without them.

### 14.2 The `assigned` rule

- [x] New kind `assigned` in group "Assigned to me". Default severity normal, channels list and push.
- [x] One item while the viewer is assigned and isn't the author. The actor is whoever assigned them, and `waitingSince` is when.
- [x] The dedupe key (the ID that tells items apart) includes the assign event. Unassigned, then assigned again, is a new item.
- [x] The item closes when the viewer is unassigned, or the PR is merged or closed.
- [x] Assigning yourself makes an item, but it starts seen and doesn't push. Done with a new `startsSeen` flag on detected items.
- [x] Respects "Hide bots": with it on, a bot assigning you (like a round robin) still lists the PR, but it starts seen and doesn't push. Leaving the PR out would hide work you own.
- [x] Summary: "alice assigned you", plus ", with bob" when someone else is assigned too. No "@", like the other summaries.
- [x] Tests for each of the above.

### 14.3 API

- [x] New group `assigned` in `ITEM_GROUPS` and `ItemGroups` in [items.ts](../packages/core/src/api/items.ts).
- [x] `ItemDto` gets `assignedState` (one of the states above), filled from the snapshot for assigned rows. Null for other rows.
- [x] `ItemDto` gets `assigned: boolean`, for the tag on review rows.
- [x] When a PR has both a review item and an assigned item, its row goes in the review group.
- [x] Stale colors from the time you were assigned: orange after 3 days, red after 7. Longer than reviews, since assigned work takes longer.
- [x] No reminder pushes for assigned PRs, and they don't color the menu bar icon. Those stay for review requests.
- [x] `SummaryResponse` gets an `assigned` count, and `total` includes it, so the app badge and menu bar count it.
- [x] The morning summary counts "assigned PRs".
- [x] Tests for the state order, the review group winning, and the counts.

### 14.4 Color and icons

- [x] Add `--color-kind-assigned` to [tokens.css](../apps/web/src/styles/tokens.css), light and dark.
- [x] `assigned` in `KIND_ICONS` in [ItemRow.tsx](../apps/web/src/components/ItemRow.tsx): `CircleUserRound`, teal.
- [ ] Assigned rows show the state's icon and label in the summary line.
- [ ] Review rows with `assigned` show an "Assigned" tag, like "Waiting on author".

### 14.5 The section

- [ ] "Assigned to me" in [ListPage.tsx](../apps/web/src/pages/ListPage.tsx), after Replies and before My PRs. It can be collapsed like the others.
- [ ] Hidden when empty, so teams that don't use assignees never see it.
- [ ] Quiet and Important work on its rows like any other.

### 14.6 Settings and push

- [ ] The rule shows in the Rules tab, on by default, with its own push toggle.
- [x] Push text: "alice assigned you" with the PR title. Already works: the push title is the item's summary.
- [ ] The menu bar's count style that splits by section (`review · replies · mine`) adds the assigned count.
- [ ] A teal tile for this kind on the iPhone app's rich notifications (plan 12), when that's built.
- [ ] The test notification button covers the new kind.

## Done when

- [ ] Being assigned to someone else's PR puts it in "Assigned to me" and sends a push.
- [ ] A PR you opened and are assigned to stays only in My PRs.
- [ ] The row's state changes as checks and reviews change, without marking it unread.
- [ ] Unassigning you removes the row.
- [ ] A PR you're assigned to and asked to review shows once, in Review requests, with the "Assigned" tag.
- [ ] With no assigned PRs, the section doesn't show.
- [ ] Teal looks right in light mode, dark mode, and the Mac app.
