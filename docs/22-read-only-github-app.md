# 22. Read-only GitHub App

**Goal:** sign in through a **GitHub App** that can only read, and only the repos the user picks on GitHub. No more `repo` scope, which can also write. From issue [#219](https://github.com/willemrosenthal/pr-peek/issues/219).

**Needs:** nothing. Webhooks (plan 11) can build on this later, but aren't part of it.

## Why

- Our OAuth App needs `repo` to read private repos. GitHub has no read-only version, so the token can also write. If our server were broken into, that write access is what leaks.
- A GitHub App's token has only the App's permissions, and only reaches the repos where it's installed. We can make every permission read-only.
- Orgs approve a read-only App more easily than an OAuth App that can write.

Already done before this plan (PR for #219): "Public repos only" asks for just `read:org`, the unused `notifications` scope is gone, and the sign in and privacy pages say plainly that tokens are kept on our server.

## Key decisions

- **Same sign in flow.** A GitHub App signs users in with the same OAuth web flow, with its own client id and secret and no `scope`. Tokens expire and refresh like today, so `github/tokens.ts` mostly stays.
- **Permissions, all Read-only:** Repository: Metadata, Pull requests, Checks, Commit statuses, Contents (check in 22.0 whether we need it). Organization: Members. Nothing else, and no write permission of any kind.
- **Installing picks the repos.** The user installs the App on their account or org and picks repos there. An org owner has to approve it for org repos, like today. Our repo picker shows what the App can reach, with a link to add more on GitHub.
- **Existing users keep working.** Keep the OAuth App as a fallback while people move. Offer "Switch to read-only access" in Settings: revoke the OAuth grant (`revokeGrant`), then sign in through the App. Decide in 22.5 when to retire the OAuth App.
- **Personal access tokens stay.** Fine-grained is the recommended kind (already the default tab).

## Steps

### 22.0 Check first

With a test App on your own account, check what a user token from it can do. Update this plan with what you learn.

- [ ] GraphQL search for `review-requested:@me`, `author:@me`, and `assignee:@me` returns PRs from installed repos.
- [ ] It can read public repos where the App isn't installed. If not, decide how "watch any public repo" keeps working.
- [ ] Teams load with Organization Members read (`github/teams.ts`).
- [ ] Check runs load with Checks read (fine-grained tokens can't read them today).
- [ ] How to list the repos it reaches: `GET /user/installations` and `GET /user/installations/{id}/repositories`, in place of `GET /user/repos`.
- [ ] Whether Contents read is needed for anything we call.

### 22.1 Create the Apps (You)

- [ ] **(You)** In GitHub, Settings, Developer settings, GitHub Apps, create **git-buddy-app (dev)** and **git-buddy-app** (prod):
  - Callback URL: same as the OAuth Apps (`/api/auth/github/callback`).
  - Turn on "Expire user authorization tokens" and "Request user authorization (OAuth) during installation".
  - Webhook: off for now.
  - Permissions: the list in Key decisions. All Read-only.
  - "Any account" can install it.
- [ ] **(You)** Put `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, and `GITHUB_APP_SLUG` in `.env` and in Render's `git-buddy-env` group.

### 22.2 Server

- [ ] Config for the App's id, secret, and slug. Add them to `.env.example`.
- [ ] `createGitHubOAuth` takes which app to use. The App's authorize link sends no `scope`.
- [ ] A column on `User` for which app a token came from (`oauth_app` or `github_app`), so refresh and revoke use the right client id. Safe to deploy: new column with a default.
- [ ] Repo listing reads the App's installations for App users.
- [ ] Tests for each.

### 22.3 Web

- [ ] Sign in: "Sign in with GitHub" uses the App. The hint says it can only read.
- [ ] Repo picker: a link to `https://github.com/apps/<slug>/installations/new` to add repos or orgs. Say an org owner may need to approve it.
- [ ] Settings: "Switch to read-only access" for OAuth App users.

### 22.4 Words

- [ ] Privacy page and `docs/security.md`: what the App can read, and how to uninstall it on GitHub.
- [ ] README: how to install the App.

### 22.5 Retire the OAuth App

- [ ] Once most users have switched, decide with the user: keep the OAuth App for people who can't install the App, or remove it.

## Done when

- [ ] A new user signs in through the App and sees their PRs, teams, and checks.
- [ ] The App asks GitHub for no write permission. GitHub's install page shows only "Read access".
- [ ] An OAuth App user can switch, and Authorized OAuth Apps on GitHub no longer lists Git Buddy afterwards.
- [ ] **(You)** Try it on the live site with a work org.
