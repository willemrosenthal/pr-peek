# 21. Settings redesign

**Goal:** Settings feels as good as the list on a phone. One home screen with a short page per topic, rows that never wrap, and hints moved out of the rows.

**Needs:** nothing. Only the web app changes. The settings API stays the same.

Mockups: [Git Buddy Settings Redesign](https://claude.ai/artifact/KjNx2Ze9bBJwKrr8oHUY1L). We picked option A (drill-down) and Rules option 1 (one line per rule).

## Why

- On an iPhone, most rows wrap: the label takes the line, and the control drops below it.
- Rules show three labeled controls on every row.
- General mixes unrelated things: notifications, list options, tokens, sign out, and help.

## Key decisions

### Pages

`/settings` is a home screen of grouped rows. Each row has a colored icon, a one-line status, and opens its own page:

| Group     | Row             | Page                      | Status line, like                 |
| --------- | --------------- | ------------------------- | --------------------------------- |
| (top)     | Account card    | `/settings/account`       | Signed in with GitHub             |
| Your list | Repositories    | `/settings/repos`         | 6 watched · 1 muted · 1 paused    |
|           | Rules           | `/settings/rules`         | 7 of 8 on · 4 notify              |
|           | Overdue reviews | `/settings/overdue`       | Orange after 24 h, red after 48 h |
|           | List display    | `/settings/display`       | Authors, section order, size      |
| Alerts    | Notifications   | `/settings/notifications` | Quiet 6:00 PM to 9:00 AM          |
| GitHub    | GitHub tokens   | `/settings/account`       | 1 expires in 5 days               |
|           | Admin           | `/settings/admin`         | Admins only                       |
| This Mac  | Menu bar        | `/settings/menu-bar`      | Mac app only                      |
| Help      | Privacy, bugs   | (links)                   |                                   |

- Every page has the list's header: the rainbow back arrow, then the page's name. Back goes to the home screen, and home's back goes to the list.
- Groups are white cards on the gray page, with a small gray label above and an optional footer below. Hints live in the footers.
- Old links still work: `/settings/general` goes to Account (it held the tokens), `/settings/timing` to Overdue reviews, and anything unknown to the home screen.

### Moves

- "Remind me again every" moves from Timing to Notifications, as "After red, remind me".
- Time zone stays with work hours, on Overdue reviews. Its footer says it also sets quiet hours.
- Notifications for this device move from General to Notifications.

### Controls

- Switches get bigger on touch screens: 44 by 26.
- Rules: one line per rule. A colored urgency chip (High, Normal, Low) opens the phone's own menu. A bell turns notify on and off. A switch turns the rule on. Column labels sit above each group. "Include draft PRs" is a small row under Review requested.
- Repos: watched repos grouped by owner, with a color dot and a Muted or Paused tag. Tap one for a sheet: a three-way choice (Notify, List only, Paused) in place of the Notify and Watch switches, color swatches with a preview row, and Remove. Swipe left to remove, like on the list. Adding repos gets its own page, `/settings/repos/add`. Onboarding keeps its own picker.
- Overdue reviews: a timeline bar, and − and + steppers. They step through 1, 2, 4, 8, and 12 hours, then whole days.
- Times (quiet hours, summary) show as pills that open the phone's time picker.
- Author pictures: a three-way choice (Off, My reviews, Everywhere), with a live preview of two list rows.
- Size: a full-width slider with a small and a big "A".

## Steps

Four PRs, one per group.

### 1. Home and pages (PR 1)

- [x] 1.1 Building blocks: the page header, groups with a label and footer, rows that keep their control on the right, and rows that open a page.
- [x] 1.2 The home screen, with a status line on each row.
- [x] 1.3 The pages: Account, Overdue reviews, Notifications, List display, Menu bar, and Admin. Repos and Rules move over as they are.
- [x] 1.4 Old links redirect. Links to the tokens (banners, the add by link error, the token reminder push) point at Account.
- [x] 1.5 Bigger switches on touch screens.

### 2. Rules (PR 2)

- [ ] 2.1 One line per rule, with the urgency chip, the bell, and the switch.
- [ ] 2.2 "Include draft PRs" as a small row under Review requested.

### 3. Repos (PR 3)

- [ ] 3.1 Watched repos grouped by owner, with the color dot and tag.
- [ ] 3.2 The repo sheet: Notify, List only, Paused; colors with a preview; Remove.
- [ ] 3.3 Swipe left to remove.
- [ ] 3.4 Add repos on its own page.

### 4. Controls (PR 4)

- [ ] 4.1 Overdue reviews: the timeline and the steppers.
- [x] 4.2 Time pills for quiet hours and the summary. Done early, in PR 1: the times sat badly under their switches.
- [ ] 4.3 Author pictures choice and the list preview.
- [ ] 4.4 The size slider.
- [ ] 4.5 Token rows that match the rest.

## Done when

- [ ] On an iPhone 15 or bigger, no settings row wraps its control onto a second line.
- [ ] Every setting from before is still there, and saves.
- [ ] Old links (`/settings/general`, `/settings/timing`) land on the right page.
- [ ] Settings works in the Mac menu bar dropdown and in a desktop browser.
- [ ] (You) Try each page on your phone, in light and dark mode.
