# 22. Read-only access

**Goal:** signing in to Git Buddy never asks for anything that can change your code on GitHub. It reads only public data. Private repos come through personal access tokens the user adds: fine-grained by default, which can be read-only, or classic if they want. From issue [#219](https://github.com/willemrosenthal/pr-peek/issues/219).

**Needs:** [#230](https://github.com/willemrosenthal/pr-peek/pull/230) merged. It already made "Public repos only" ask for just `read:org`.

## Why

- Our OAuth App needs the `repo` scope to read private repos. GitHub has no read-only version, so that token can also write to every repo the user can reach. If our server were broken into, every user's write access would leak with it. Encrypting tokens doesn't stop that: the server holds the key, since it has to read them to sync.
- Classic tokens have the same problem: they need `repo` too. But a token is the user's own choice, made and deleted on GitHub, so classic ones stay allowed.
- A fine-grained token can be read-only, limited to the repos the user picks, and short-lived. The user makes it and can delete it on GitHub at any time.

## Key decisions

- **Sign in is read-only.** It always asks for `read:org` and nothing else. `read:org` is read-only, and finds the user's teams. The "Public repos only" checkbox goes away.
- **The sign-in token reads public repos.** Any token can (checked in plan 20). Owners with no token already fall back to it, so public repos keep working with no new code.
- **Private repos need a personal access token.** Fine-grained is the default and recommended kind. Classic tokens still work.
- **Old grants that can write are dropped by hand.** With two users, each revokes Git Buddy in GitHub's Authorized OAuth Apps and signs in again. No code for it.
- **Changed in 22.2.** 22.1 also refused classic tokens, and the plan had an in-app cutover that deleted them. That went further than wanted: the goal was only a read-only sign in. 22.2 brings classic tokens back and drops the cutover.
- **Failed check names.** Fine-grained tokens can't read check runs, so failed checks from GitHub Actions show without a name in private repos. A GitHub App could fix this later (plan 11). Repos read with the sign-in token still name them.

## PRs

- **22.1** `plan-22-1-read-only` (#231): steps 22.1 to 22.3. A read-only sign in.
- **22.2** `plan-22-2-classic-tokens`: step 22.4. Classic tokens allowed again.

## Steps

### 22.1 Sign in

- [x] `oauth.ts`: one scope, `read:org`. Remove `ScopeChoice` and the `?scope=` query on `/api/auth/github`.
- [x] Sign in page: remove the checkbox. The hint says Git Buddy can only read public data, and private repos need a token.
- [x] Tests.

### 22.2 Fine-grained tokens only (undone in 22.4)

- [x] Adding, replacing, and checking a token refuse anything that isn't fine-grained (`github_pat_`), with a message that says why. Refused before it's sent to GitHub. The sheet's link to make a fine-grained one sits right above the error.
- [x] Keep the classic special cases for now (`reachesOwner` in `github/tokens.ts`, the owner list in `routes/repos.ts`, and `sync.ts`). Classic tokens already stored keep working until 22.5 deletes them.
- [x] Token sheet: no Classic tab. Fine-grained steps only, with read-only permissions, the repos you watch, and a short expiry.
- [x] Onboarding: the orgs step is now "Private repos". Public repos work right away, private ones (the user's own too) need a token, one per account or org. Settings says the same.
- [x] Tests. The e2e seed user has no tokens, so it needed no change. The fake `me` now has the read-only scope.

### 22.3 Words

- [x] Privacy page: sign in reads public data only. Private repos only through fine-grained tokens you make. A line for people who signed in or added a classic token before, saying how to drop write access themselves.
- [x] `docs/security.md`, `docs/overview.md`, and the README (a new "Private repos" section).

### 22.4 Classic tokens again

- [x] The token routes take classic tokens again, with the `repo` or `public_repo` check from before.
- [x] The token sheet has its Fine-grained and Classic tabs back. Fine-grained is the default, marked Recommended. Its steps keep 22.1's fixes: own private repos need a token too, and Git Buddy can't check that a token is read-only.
- [x] Sign in, onboarding, Settings, the privacy page, the README, `docs/security.md`, and `docs/overview.md` say private repos need a personal access token, fine-grained or classic.
- [x] Tests.
- [ ] **(You)** Revoke Git Buddy in GitHub's Authorized OAuth Apps and sign in again, and ask the other user to do the same.

## Done when

- [ ] **(You)** Signing in shows only read access on GitHub's page. (The sign-in link asks only for `read:org`, checked by `oauth.test.ts`.)
- [x] Adding a classic token works again, and fine-grained is the default (`github-token.test.ts`, `GitHubTokens.test.tsx`).
- [ ] **(You)** After revoking and signing in again, Authorized OAuth Apps on GitHub shows Git Buddy with only read access.
- [ ] **(You)** On the live site: sign in fresh, add a fine-grained token for a work org, and see its PRs.
