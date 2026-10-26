# 13. PR preview

**Goal:** long press a row to see more of the PR without opening GitHub: the full title, the repo, the description, and the comment that put it on your list. Quiet and Open sit at the top. This is design A3 ("grouped cards") from the [preview canvas](https://claude.ai/artifact/Y1DD5Y6HUca7nypJShZ6nA).

**Needs:** plan 07. Works in the PWA, the Mac app, and the iPhone app (plan 12), since they all show the web app.

## Key decision: fetch the details from GitHub when the preview opens

The sync stores only the first 200 characters of each comment and description, on one line. The preview needs the full text.

- **Live fetch:** one small GraphQL query for the PR when the preview opens. Always fresh. It starts 150ms into a press, so most of it is done by the time the long press fires, and taps and scrolls don't ask GitHub for anything.
- **Not chosen, store full text:** the preview would open with everything at once, but every sync would save much more for every PR, and most are never previewed.
- What the list already knows (title, repo, why it's there) shows right away. Failing check names come from the stored snapshot.

## Key decision: show the whole conversation, in order

The preview lists the PR's comments, reviews, and comments on files together, oldest first, like GitHub's conversation tab. Comments on files say which file and line. Comments hidden on GitHub (spam, outdated) are left out.

Each item points at the comment or review that made it (`latestEventId`). When that's in the conversation, "For you" shows it, marked, with the comment before it and everything after. Older ones are behind "See N earlier comments". Otherwise (review requests, failed checks, mentions in the description), "For you" shows why it's on the list, and the conversation comes after the description.

## Key decision: GitHub's HTML, cleaned again

Descriptions and comments come as GitHub's HTML (`bodyHTML`): Markdown already rendered, with links and mentions resolved. The web app reads it with `DOMParser`, which runs nothing, and builds React elements from a short list of safe tags and attributes. No HTML is injected, and no new library is needed. Styles follow GitHub's: headings, code blocks, lists, quotes, tables, task lists.

## PRs

One PR for all of it.

## Steps

### 13.1 Preview endpoint

- [x] `GET /api/prs/:id/preview?item=<itemId>` answers with the description, when the PR was opened, the failing check names, the conversation, and which comment is the item's.
- [x] One GraphQL query by the PR's node ID. Comments are capped, like the sync's queries.
- [x] Limited to 30 previews a minute per user, to protect the user's GitHub rate limit.
- [x] Tests for the conversation's order, the item's comment, a PR on someone else's list, and a PR gone from GitHub.

### 13.2 Long press

- [x] A press held for 450ms on a row opens the preview. Moving first (a swipe or a scroll) cancels it. Letting go after it fires doesn't open the link.
- [x] Right click opens it too, for the Mac app and desktop browsers.
- [x] The fetch starts 150ms into the press. Taps don't fetch.
- [x] A short buzz when it opens, where the phone supports it (Android).
- [x] No iOS link callout on rows.

### 13.3 The sheet (design A3)

- [x] A bottom sheet (Base UI Drawer) at one height, 95% of the screen. Swipe down or tap outside to close. The closing slide always plays to the end. The list's page holds the sheet, so it stays when a section goes away.
- [x] Top bar: Quiet (or Bring back) on the left, Open on the right.
- [x] Focus goes to the sheet, not its first button. No text gets selected by the press that opened it.
- [x] Cards: the PR (repo, title, the author with their picture, failing checks), fixed under the top bar so it never scrolls away. Below it, scrolling: "For you" (the conversation, or why it's on the list), the description, then the conversation when "For you" doesn't have it.
- [x] Descriptions and comments formatted like on GitHub.
- [x] Permalinks to code and suggested changes as numbered lines under their file, with GitHub's syntax colors.
- [x] "See N earlier comments" shows the rest of the conversation with a fast, short animation. Reduced motion turns it off.
- [x] Loading and error states. Retry on error.
- [ ] Works in dark mode and in the Mac app's small window.

## Done when

- [ ] Long press on a phone opens the preview, and a tap still opens GitHub.
- [ ] Right click in the Mac app opens the preview.
- [ ] A reply shows the conversation in order, and "See N earlier comments" expands smoothly.
- [ ] A description with headings, lists, and code looks like it does on GitHub.
- [ ] Quiet from the preview moves the row, like a swipe.
- [ ] A PR with a long description scrolls inside the sheet, and swiping down closes it smoothly.
