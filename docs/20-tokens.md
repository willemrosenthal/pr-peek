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
- **Replace** shows only on a token that expires within 7 days or has stopped. A working token has just Remove. Replacing swaps the token in one step, so its repos never fall back to the sign in, and it works at the cap.
- **Same orgs:** adding a token that reaches the same orgs as one you have asks "Replace that one?". This covers a leaked token or the wrong permissions, without a Replace button on every card.
- **Classic tokens** are still allowed. They reach everything the account can, so most people need only one.

## PRs

1. **The table** (20.1): `feat(server): store personal access tokens in their own table`. Has a migration. No change on screen yet. Merged (#163).
2. **Syncs use them** (20.2), split in two since it's big:
   - 2a: `feat(server): find which orgs each token reaches`. Finding owners, picking a token per owner, the repo picker, preview, and add by link, and a rejected token stopping alone.
   - 2b: `feat(server): sync each owner with the token that reaches it`. Searches per token, details per owner, and the tests with several tokens.
3. **The settings page** (20.3, 20.4): `feat(web): add several personal access tokens`.
4. **Reminders and key checks** (20.5, 20.6): `feat(server): remind before a token expires, and check the key on start`.

## Steps

### 20.1 The table

- [x] A `GitHubToken` table: `id`, `userId`, `name`, `tokenEnc`, `tokenHash`, `kind` (classic or fine-grained, from the `ghp_` or `github_pat_` prefix), `scopes`, `expiresAt`, `owners` (string list), `ownersCheckedAt`, `status` (working or stopped), `stoppedAt`, `expiryRemindedAt`, `lastUsedAt`, `createdAt`. Unique on `userId` and `tokenHash`.
- [x] Copy each user's `patEnc`, `patExpiresAt`, and `patScopes` into a row. The encrypted text copies as is.
  - Learned while building: SQL can't decrypt the token, so the migration can't hash it or read its prefix. `tokenHash` and `kind` are null until then. The first time a sync reads the token, it fills in both. The settings page (20.3) shows no kind while it's null.
  - Names start as "Personal access token". Names from the org come with 20.2, once we know what a token reaches.
  - When GitHub rejects the token, it's marked `stopped` too, ready for 20.5.
- [x] The current `/github-token` routes and the sync read and write the table, as a list of one. So nothing changes for users yet, and nothing is lost after the deploy.
- [x] Keep the old columns for one release, so the running version still works during the deploy (10.6). Drop them in a later PR.
  - The new version still writes them when a token is saved or removed, with the same encrypted text as the table. A token saved or removed on the old version during the few minutes of the deploy only changes the old columns.
- [ ] When dropping the old columns, first make the table match them: delete tokens of users whose `patEnc` is null, and replace a token whose `tokenEnc` doesn't match `patEnc`. The same encrypted text means a plain comparison works. This catches a token saved or removed on the old version during this PR's deploy.
- [x] `tokens:reencrypt` also covers the new table. Update [security.md](security.md).

### 20.2 Syncs use them

- [x] When a token is added, and once a day, list the repos it can reach (`GET /user/repos`, at most 10 pages) and save their owners.
  - As built (2a): each sync first checks fine-grained tokens whose owners are a day old or never checked. A new token is checked by the next sync, a minute or two later. Checking it before saving comes with the settings page (20.3).
- [x] First, check with a real fine-grained token what `/user/repos` returns. If it also lists public repos outside the token's org, count only owners whose private repos it lists, or find another way. Update this plan with what you learn.
  - Checked on 7 November 2026, with a fine-grained token for `willemrosenthal` on all repos. Its private repos were all `willemrosenthal`'s. Its public repos came from other owners too, since any token reads public repos.
  - So: ask for private repos only (`GET /user/repos?visibility=private`), and save their owners. Public repos need no particular token: any works, including the sign in.
  - A classic token reaches everything the account can, so it counts as reaching every owner.
- [x] Pick a token per owner: a working token that reaches it, newest first, else the sign in. `pickToken` in `tokens.ts`. Clients take a `TokenChoice`: an owner, or a token id (null for the sign in).
- [x] Run the searches once per token in use, then merge by PR id. Fetch each PR's details with its owner's token.
  - As built (2b): `tokenClients` in `sync.ts` makes one client per token, when first needed, and runs work grouped by the token picked for each owner. PRs a search missed are checked the same way. The user's teams use the newest working token, else the sign in.
  - A token GitHub rejects fails that sync. It's marked stopped, so the next sync, a couple of minutes later, picks another token or the sign in for its owners.
  - When the sign in stops working but a token works, the sign in's owners are skipped for that sync. Their PRs aren't ended or changed, and the rest still sync. Telling the user comes with the banners (20.5).
- [x] The repo picker, the PR preview, and add by link use the owner's token too.
  - The picker's list of owners (`/github/owners`) still asks with the default token. The settings page (20.3) can add the owners each token reaches.
- [x] When GitHub rejects a token, mark only that token stopped. Its owners fall back to the sign in. `syncError: "token"` is only for when nothing works.
  - `markRejected` replaces `markNeedsReauth`. A rejected sign in also stops syncs only when no personal access token works.
- [x] Tests: two fine-grained tokens for two orgs, one stopped token, an owner nothing reaches, and the GitHub call count per sync. In `sync.test.ts`, "several tokens": each token makes 2 searches and fetches only its owner's PRs.

### 20.3 The settings page

- [ ] Settings, General, "GitHub tokens": each token's name, kind, owners, expiry, and status, with Remove. Replace shows too when the token expires within 7 days or has stopped. See the mockup.
- [ ] Add a token: paste, check, then see what it reaches before saving. Name it, starting as its org.
- [ ] If the new token reaches the same orgs as one you have, ask: "Replace that one?" Replace swaps it with no gap. Keep both saves it as a new token.
- [ ] Messages for: not accepted, another account's token, already added, reaches no watched repo (can still save), and the cap.
- [ ] "Which token syncs each owner": the owners of watched repos and what syncs each. An owner nothing reaches links to adding a token.

#### On phones

Most people make a token on GitHub and paste it on the same phone, so this has to be easy there.

- [ ] Buttons that open GitHub's new token pages. The classic one ticks `repo` and `read:org` already (`/settings/tokens/new?scopes=repo,read:org`).
- [ ] A Paste button next to the token field. Inputs use 16px text, so iPhones don't zoom in.
- [ ] Token cards stack, with full-width buttons. Every target is at least 44px.
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
- [ ] Removing or revoking one token affects only its org. Those repos fall back to the GitHub sign in, and a banner says so. The other tokens keep syncing.
- [ ] A push arrives 7 days before a token expires.
- [ ] Each extra token adds no more than 2 or 3 GitHub calls per sync.
