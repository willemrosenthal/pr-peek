# 22. Read-only access

**Goal:** Git Buddy never holds anything that can change your code on GitHub. Signing in reads only public data. Private repos come only through fine-grained tokens, made read-only. From issue [#219](https://github.com/willemrosenthal/pr-peek/issues/219).

**Needs:** [#230](https://github.com/willemrosenthal/pr-peek/pull/230) merged. It already made "Public repos only" ask for just `read:org`.

## Why

- Our OAuth App needs the `repo` scope to read private repos. GitHub has no read-only version, so that token can also write to every repo the user can reach. If our server were broken into, every user's write access would leak with it. Encrypting tokens doesn't stop that: the server holds the key, since it has to read them to sync.
- Classic tokens have the same problem: they need `repo` too.
- A fine-grained token can be read-only, limited to the repos the user picks, and short-lived. The user makes it and can delete it on GitHub at any time.

## Key decisions

- **Sign in is read-only.** It always asks for `read:org` and nothing else. `read:org` is read-only, and finds the user's teams. The "Public repos only" checkbox goes away.
- **The sign-in token reads public repos.** Any token can (checked in plan 20). Owners with no fine-grained token already fall back to it, so public repos keep working with no new code.
- **Private repos need a fine-grained token.** Classic tokens are no longer accepted, since they can write.
- **Old grants that can write are revoked.** On release, any user whose sign-in token has `repo` or `public_repo` has it revoked on GitHub and deleted here. They sign in again and get the read-only scope. Grants that are already read-only stay.
- **Stored classic tokens are deleted.** On release, with a note asking the user to add a fine-grained token instead. We can't revoke a personal token on GitHub, so the note also says to delete it there.
- **Failed check names.** Fine-grained tokens can't read check runs, so failed checks from GitHub Actions show without a name in private repos. A GitHub App could fix this later (plan 11). Repos read with the sign-in token still name them.

## PRs

Two PRs, so the cutover lands on its own:

- **22.1** `plan-22-1-read-only`: steps 22.1 to 22.3. New sign-ins and new tokens are read-only.
- **22.2** `plan-22-2-cutover`: steps 22.4 and 22.5. Revoke old grants and delete classic tokens. Merging it releases the cutover.

## Steps

### 22.1 Sign in

- [ ] `oauth.ts`: one scope, `read:org`. Remove `ScopeChoice` and the `?scope=` query on `/api/auth/github`.
- [ ] Sign in page: remove the checkbox. The hint says Git Buddy can only read public data, and private repos need a token.
- [ ] Tests.

### 22.2 Fine-grained tokens only

- [ ] `PUT /api/github-token` and the check route refuse classic tokens (`ghp_`), with a message that says why and links to make a fine-grained one.
- [ ] Remove the classic special cases: `reachesOwner` in `github/tokens.ts`, the owner list in `routes/repos.ts`, and `sync.ts`.
- [ ] Token sheet: no Classic tab. Fine-grained steps only, with read-only permissions, the repos you watch, and a short expiry.
- [ ] Onboarding: the orgs step says private repos need a token, one per org.
- [ ] Tests, including the e2e seed user (it has a classic token in `fake-api.ts` today).

### 22.3 Words

- [ ] Privacy page: sign in reads public data only. Private repos only through fine-grained tokens you make. No more `repo`.
- [ ] `docs/security.md`, `docs/overview.md`, and the README.

### 22.4 Revoke old grants

- [ ] Once per user, after release: if the sign-in token's scopes include `repo` or `public_repo`, revoke the grant (`revokeGrant`), and clear the stored sign-in tokens. The user lands on sign in, with a line saying why.
- [ ] Runs lazily: on the user's next request, and in the sync. So nobody keeps write access just by staying away. Safe to run twice.
- [ ] A token that's gone already (404 or 422) counts as done.
- [ ] Tests.

### 22.5 Delete classic tokens

- [ ] In the same step, delete the user's stored classic tokens. Show a one-time note: "Classic tokens can change your code, so Git Buddy doesn't keep them any more. Add a fine-grained token, and delete the old one on GitHub."
- [ ] Owners only a classic token reached show "Needs a token" in the repo list until a fine-grained one is added.
- [ ] Tests.

## Done when

- [ ] Signing in shows only read access on GitHub's page.
- [ ] A classic token is refused, with a clear message.
- [ ] A user with an old `repo` grant is signed out on their next visit, and Authorized OAuth Apps on GitHub shows the read-only scope after they sign in again.
- [ ] No user row has a `repo` or `public_repo` scope, and no classic token is stored. A query in the plan's PR shows both counts are 0.
- [ ] **(You)** On the live site: sign in fresh, add a fine-grained token for a work org, and see its PRs.
