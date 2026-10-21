# 11. Future features

Ideas for after launch, roughly in order of value. Each would get its own detailed plan when we pick it up. The architecture already leaves room for all of them.

## GitHub App with webhooks

**What:** replace or complement the OAuth App with a **GitHub App**. Orgs install it on their repos, and GitHub sends our server an event (a **webhook**) the moment something happens.

**Why:**
- Alerts within seconds instead of 1 to 2 minutes.
- Far fewer API calls.
- Read-only permissions instead of the broad `repo` scope.

**Notes:**
- Needs an org admin to install it, so keep OAuth polling as the fallback for repos without the App.
- Webhook handler: check the signature, enqueue a `sync:pr` job for each affected user, and reuse the plan 04 detail fetch and plan 05 rules.

## Actions from the app

All are GitHub API calls through the user's token. Each needs a confirm step, and a privacy page update (plan 10.1).

- Approve a PR or request changes, with a short comment.
- Re-run failed checks.
- Reply to a comment.
- Merge when approved and green.

## More rules

Each is one new file in `packages/core` rules:

- A PR you reviewed got new commits since your review.
- Your PR has merge conflicts.
- Your PR is approved and green, ready to merge.
- You were @mentioned anywhere in a watched repo.
- A PR touches files you own (CODEOWNERS).
- Your PR has waited N days with no review.
- A custom rule builder in Settings (pick a kind, filters, severity, channels).

## Team view

- A shared dashboard per team: who's waiting on whom, the oldest open review requests, review load per person.
- Needs a `Team` model and membership, and probably the GitHub App for org-wide data.

## Other channels

- Slack or Microsoft Teams direct messages, as another channel next to push.
- An email digest.

## AI summaries

- "What changed since my last review", or a 2 line summary of a long comment thread, shown in the row details.
- Uses an LLM API. Keep it opt-in, and say so in the privacy page.

## Multiple accounts

- Link a work and a personal GitHub account to one pr-peek login, or support GitHub Enterprise Server URLs.
- Needs a `GitHubAccount` model between `User` and tokens. Worth keeping in mind so plan 03's `User` table doesn't get too tied to one token.

## Native extras (would need Swift)

- Mac or iPhone widgets, Apple Watch. Not planned. Listed only so the trade-off stays visible.
