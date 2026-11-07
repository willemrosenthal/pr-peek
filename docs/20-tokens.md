# 20. Several personal access tokens

**Goal:** let a user add several personal access tokens, and make token handling sturdier. A fine-grained token only reaches one org, so someone in two strict orgs needs two tokens.

**Needs:** plan 10 PR 1 (key rotation), merged. Build it after plan 10 PR 2 (sign-up requests) and before PR 4 (the privacy page), so the privacy page describes tokens as they'll be at launch. New users in strict orgs hit this first.

Mockups: [Git Buddy Tokens](https://claude.ai/artifact/FvtNWFdpKt6o49E6KEaUXa): the list of tokens and which owner each syncs, adding a token, both again at phone size, and a token about to expire.

## How it works

- Tokens move out of the `User` row into their own table, one row per token.
- Each token knows which owners (users or orgs) it reaches. We find out by listing its repos when it's added, and once a day.
- Each sync picks a token for each owner of a watched repo: a working token that reaches it, else the GitHub sign in.
- The searches run once per token in use (the sign in counts, when an owner falls back to it), and the results are merged. So each token adds a search to every sync. That's why there's a cap.
- One token failing no longer stops every sync. Only its owners fall back to the sign in, and the user gets a banner and a push.

## Decisions (7 November 2026)

- **Cap:** 5 tokens per user. Each adds about 2 GitHub calls per sync (plan 16).
- **Expiry reminders:** a push and a banner 7 days before a token expires, and a push on the day it stops.
- **Names:** a token starts named after the org it reaches. The user can change it when adding or replacing the token. No separate rename, to keep the screen simple.
- **Duplicates:** the same token can't be added twice. We keep a SHA-256 hash of it to check. A hash can't be turned back into the token.
- **Classic tokens** are still allowed. They reach everything the account can, so most people need only one.

## PRs

1. **The table** (20.1): `feat(server): store personal access tokens in their own table`. Has a migration. No change on screen yet.
2. **Syncs use them** (20.2): `feat(server): sync each owner with the token that reaches it`.
3. **The settings page** (20.3, 20.4): `feat(web): add several personal access tokens`.
4. **Reminders and key checks** (20.5, 20.6): `feat(server): remind before a token expires, and check the key on start`.

## Steps

### 20.1 The table

- [ ] A `GitHubToken` table: `id`, `userId`, `name`, `tokenEnc`, `tokenHash`, `kind` (classic or fine-grained, from the `ghp_` or `github_pat_` prefix), `scopes`, `expiresAt`, `owners` (string list), `ownersCheckedAt`, `status` (working or stopped), `stoppedAt`, `expiryRemindedAt`, `lastUsedAt`, `createdAt`. Unique on `userId` and `tokenHash`.
- [ ] Copy each user's `patEnc`, `patExpiresAt`, and `patScopes` into a row. The encrypted text copies as is.
- [ ] The current `/github-token` routes and the sync read and write the table, as a list of one. So nothing changes for users yet, and nothing is lost after the deploy.
- [ ] Keep the old columns for one release, so the running version still works during the deploy (10.6). Drop them in a later PR.
- [ ] `tokens:reencrypt` also covers the new table. Update [security.md](security.md).

### 20.2 Syncs use them

- [ ] When a token is added, and once a day, list the repos it can reach (`GET /user/repos`, at most 10 pages) and save their owners.
- [ ] First, check with a real fine-grained token what `/user/repos` returns. If it also lists public repos outside the token's org, count only owners whose private repos it lists, or find another way. Update this plan with what you learn.
- [ ] Pick a token per owner: a working token that reaches it, newest first, else the sign in.
- [ ] Run the searches once per token in use, then merge by PR id. Fetch each PR's details with its owner's token.
- [ ] The repo picker, the PR preview, and add by link use the owner's token too.
- [ ] When GitHub rejects a token, mark only that token stopped. Its owners fall back to the sign in. `syncError: "token"` is only for when nothing works.
- [ ] Tests: two fine-grained tokens for two orgs, one stopped token, an owner nothing reaches, and the GitHub call count per sync.

### 20.3 The settings page

- [ ] Settings, General, "GitHub tokens": each token's name, kind, owners, expiry, and status, with Replace and Remove. See the mockup.
- [ ] Add a token: paste, check, then see what it reaches before saving. Name it, starting as its org.
- [ ] Messages for: not accepted, another account's token, already added, reaches no watched repo (can still save), and the cap.
- [ ] "Which token syncs each owner": the owners of watched repos and what syncs each. An owner nothing reaches links to adding a token.

#### On phones

Most people make a token on GitHub and paste it on the same phone, so this has to be easy there.

- [ ] Buttons that open GitHub's new token pages. The classic one ticks `repo` and `read:org` already (`/settings/tokens/new?scopes=repo,read:org`).
- [ ] A Paste button next to the token field. Inputs use 16px text, so iPhones don't zoom in.
- [ ] Token cards stack, with Replace and Remove side by side at full width. Every target is at least 44px.
- [ ] Remove asks first, and says which repos fall back to the sign in.
- [ ] "Which token syncs each owner" is a list, not a table, so nothing scrolls sideways.
- [ ] Adding a token is its own screen on phones, in two steps: make one on GitHub, then paste and check.

### 20.4 The API

- [ ] `GET /github-tokens`, `POST /github-tokens`, `PUT /github-tokens/:id` (replace, with a new name if given), `DELETE /github-tokens/:id`. Each checks the token belongs to the user.
- [ ] `/me` returns the list, without the tokens themselves.
- [ ] Remove the old `/github-token` routes once the web app stops calling them.

### 20.5 Reminders

- [ ] A push 7 days before a token expires, and one when it stops working. Once each per token.
- [ ] A banner on the list for a token expiring within 7 days or stopped, with a link to replace it.

### 20.6 Key checks

- [ ] On start, the server and worker decrypt one stored token. If no key fits, log an error and alert the admins: the wrong `TOKEN_ENC_KEY` was probably set.
- [ ] The admin page counts tokens by status: working, expiring soon, and stopped.

## Done when

- [ ] A user in two orgs that only allow fine-grained tokens adds a token for each, and PRs from both show up.
- [ ] Removing or revoking one token stops only its org's PRs, with a banner saying so.
- [ ] A push arrives 7 days before a token expires.
- [ ] Each extra token adds no more than 2 or 3 GitHub calls per sync.
