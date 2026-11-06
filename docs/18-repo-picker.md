# 18. Pick repos by owner

**Goal:** adding a repo to watch is easy. You pick an owner (you, one of your orgs, someone who shares repos with you, or any other name), then filter that owner's repos as you type. The filter runs in the browser, so it's instant and forgives typos.

**Needs:** nothing. It only changes the repo picker and the route behind it.

Mockup: [Repo Picker Redesign](https://claude.ai/artifact/PUXopMyFNQe9csB83rw6YK).

## Why

- Typing in the picker today runs GitHub's global search (`<query> in:name`). Typing `api` matches every public repo on GitHub, and yours get buried.
- The list shown before you type is broken too. It asks GitHub with both `affiliations` and `ownerAffiliations: ORGANIZATION_MEMBER`, and GitHub then returns personal repos of everyone in your orgs. For someone in a bootcamp org that's 120,000 repos, mostly strangers'. With `ownerAffiliations` alone it's 921, the right number.

## Key decisions

### The owner menu

A native `<select>`, grouped with `<optgroup>`, so phones show their own picker:

- **All my repos**: yours, shared with you, and your orgs', most recently pushed first. The default the first time.
- **You**: your own account.
- **Your orgs**: from `viewer.organizations`. We already ask for `read:org`, so no new permission.
- **Shared with you**: owners of repos where you're a collaborator, minus you and your orgs. From the owners of your first 100 collaborator repos.
- **Other…**: a text box for any GitHub user or org. Shows the repos you can see there, which for a stranger means public ones.

The last pick is remembered in `localStorage` (the browser's own storage).

### Load the list, filter in the browser

- One owner's repos load 100 at a time, most recently pushed first. The first page shows right away, and the rest load in the background.
- The filter uses Fuse.js, a small fuzzy search library, over the repos loaded so far, and highlights the matched letters.
- At most 10 pages (1,000 repos) per owner. If an owner has more and you've typed something, the picker also asks GitHub search, limited to that owner (`user:<owner> in:name`), and adds what it finds below.
- Archived repos are never listed. Forks are hidden unless you turn on **Show forks**.
- Typing `owner/name`, or a GitHub repo link, offers that repo from any owner, as today.

### Cost

Opening the picker costs one request for the owners and one per 100 repos. Filtering costs nothing. React Query keeps each owner's list for 5 minutes, so switching back and forth doesn't reload it.

### Not in this plan

- Orgs that limit which OAuth apps can see their data hide their private repos from us. The picker shows what GitHub returns, which is the public ones. A "Needs access" tag and a link to ask for approval can come later.
- Repo counts in the menu. They cost a request per org, and one slow org made GitHub time out in testing.

## PRs

1. **The server** (18.1): `feat(server): list repos by owner, and fix the picker showing strangers' repos`. Works with today's picker, which gets the fix right away.
2. **The picker** (18.2): `feat(web): pick repos by owner, with an instant filter`.

Both release a minor version and deploy.

## Steps

### 18.1 The server

- [x] Fix the default list: `ownerAffiliations` only, no `affiliations`.
- [x] `GET /api/github/repos?owner=x`: one owner's repos, owned by them, not archived, most recently pushed first. 404 if no user or org has that name.
- [x] Lists come 100 per page. Search stays at 20.
- [x] `?query=` with `owner` limits search to that owner (`user:x`, which matches orgs too).
- [x] Repos say whether they're forks, and when they were last pushed.
- [x] `GET /api/github/owners`: you, your orgs, and owners who share repos with you, in that order. Each sorted by name, ignoring case.
- [x] Tests: each of the above, and an unknown owner.

### 18.2 The picker

- [ ] Owner `<select>`, the "Other…" box, and the remembered pick.
- [ ] Load every page of an owner's list in the background, up to 10.
- [ ] Fuse.js filter with highlights, a count, and **Show forks**.
- [ ] Search fallback for owners with over 1,000 repos.
- [ ] `owner/name` and repo links still offered from any owner.
- [ ] Arrow keys move through the list, and Enter adds the selected repo.
- [ ] Tests: switching owners, filtering, a typo still matching, forks, Other, the fallback, and pasting `owner/name`.

## Done when

- [ ] Picking an org and typing part of a repo name shows only that org's matching repos, as you type.
- [ ] "All my repos" lists only repos you own, share, or reach through an org. No strangers' repos.
- [ ] Other… with a public org's name lists its public repos.
- [ ] An owner with over 1,000 repos still finds a repo by name.
- [ ] Try it on your phone and in the Mac app (You).
