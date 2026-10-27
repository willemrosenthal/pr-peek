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
| Merge conflict                  | Has conflicts     | `TriangleAlert`     | warning  |
| Checks failing                  | Checks failing    | `CircleX`           | failed   |
| Changes requested               | Changes requested | `MessageSquareText` | comment  |
| Approved, checks pass (or none) | Ready to merge    | `GitMerge`          | approved |
| Checks running                  | Checks running    | `CircleDashed`      | muted    |
| Anything else                   | Waiting on review | `CircleUserRound`   | muted    |

Drafts keep the "Draft" tag the list already has.

## Key decision: its own color, teal

The section's icon is `CircleUserRound` in a new teal: `--color-kind-assigned`, `#0a9fae` light and `#3ed2df` dark. Teal fills the gap between the green (approved) and blue (review) hues, so it doesn't look like any other kind. The light color has about 3.1:1 contrast on white, enough for icons. The state icon keeps its own color, so teal says which section a row is in, and the state color says what to do.

## Key decision: one row per PR

The list already shows one row per PR. If you're both assigned and asked to review, the row stays in "Review requests" with a small "Assigned" tag. It doesn't show twice.

## Key decision: no changes to My PRs

PRs you opened are left out of this section, since they're already in My PRs. My PRs doesn't change.

## PRs

Two PRs, since the server side and the screen are each a good size:

1. `plan-14-1-assigned-rule`: steps 14.1 to 14.3.
2. `plan-14-2-assigned-section`: steps 14.4 to 14.6.

## Steps

### 14.1 Sync assigned PRs

- [ ] Add the search `assignee:@me -author:@me` to `findRelevantPrs` in [pull-search.ts](../apps/server/src/github/pull-search.ts).
- [ ] Fetch the PR's assignees, its assign and unassign events (who, whom, when), `reviewDecision`, and `mergeable` in [pull-details.ts](../apps/server/src/github/pull-details.ts).
- [ ] Add them to the snapshot in [pr-snapshot.ts](../packages/core/src/pr-snapshot.ts). Make them optional, so snapshots saved before this still parse.
- [ ] Tests for the new fields, and for old snapshots without them.

### 14.2 The `assigned` rule

- [ ] New kind `assigned` in group "Assigned to me". Default severity normal, channels list and push.
- [ ] One item while the viewer is assigned and isn't the author. The actor is whoever assigned them, and `waitingSince` is when.
- [ ] The dedupe key (the ID that tells items apart) includes the assign event. Unassigned, then assigned again, is a new item.
- [ ] The item closes when the viewer is unassigned, or the PR is merged or closed.
- [ ] Assigning yourself makes an item, but it starts seen and doesn't push.
- [ ] Respects "Hide bots" when a bot did the assigning.
- [ ] Summary: "@alice assigned you", plus "with @bob" when someone else is assigned too.
- [ ] Tests for each of the above.

### 14.3 API

- [ ] New group `assigned` in `ITEM_GROUPS` and `ItemGroups` in [items.ts](../packages/core/src/api/items.ts).
- [ ] `ItemDto` gets `assignedState` (one of the states above), filled from the snapshot for assigned rows. Null for other rows.
- [ ] `ItemDto` gets `assigned: boolean`, for the tag on review rows.
- [ ] When a PR has both a review item and an assigned item, its row goes in the review group.
- [ ] Stale colors from the time you were assigned: orange after 3 days, red after 7. Longer than reviews, since assigned work takes longer.
- [ ] `SummaryResponse` gets an `assigned` count, and `total` includes it, so the app badge and menu bar count it.
- [ ] Tests for the state order, the review group winning, and the counts.

### 14.4 Color and icons

- [ ] Add `--color-kind-assigned` to [tokens.css](../apps/web/src/styles/tokens.css), light and dark.
- [ ] `assigned` in `KIND_ICONS` in [ItemRow.tsx](../apps/web/src/components/ItemRow.tsx): `CircleUserRound`, teal.
- [ ] Assigned rows show the state's icon and label in the summary line.
- [ ] Review rows with `assigned` show an "Assigned" tag, like "Waiting on author".

### 14.5 The section

- [ ] "Assigned to me" in [ListPage.tsx](../apps/web/src/pages/ListPage.tsx), after Replies and before My PRs. It can be collapsed like the others.
- [ ] Hidden when empty, so teams that don't use assignees never see it.
- [ ] Quiet and Important work on its rows like any other.

### 14.6 Settings and push

- [ ] The rule shows in the Rules tab, on by default, with its own push toggle.
- [ ] Push text: "@alice assigned you" with the PR title. Uses the teal tile on the iPhone app's rich notifications (plan 12), when that's built.
- [ ] The test notification button covers the new kind.

## Done when

- [ ] Being assigned to someone else's PR puts it in "Assigned to me" and sends a push.
- [ ] A PR you opened and are assigned to stays only in My PRs.
- [ ] The row's state changes as checks and reviews change, without marking it unread.
- [ ] Unassigning you removes the row.
- [ ] A PR you're assigned to and asked to review shows once, in Review requests, with the "Assigned" tag.
- [ ] With no assigned PRs, the section doesn't show.
- [ ] Teal looks right in light mode, dark mode, and the Mac app.
