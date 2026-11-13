// Set by vite.config.ts when the app is built.
declare const __BUILD__: Build;

export interface Build {
  // Like "1.2.0". Empty when the commit has no release tag of its own.
  version: string;
  // Without a version, the last release before the commit, like "1.2.0". Empty when
  // there's none, or the build couldn't see the tags.
  after: string;
  commit: string;
}

export const BUILD = __BUILD__;

export const REPO_URL = "https://github.com/willemrosenthal/pr-peek";

// Bugs and ideas go here. The repo is public, so anyone with GitHub can file one.
export const ISSUES_URL = `${REPO_URL}/issues/new`;

// Where GitHub lists the OAuth Apps a user allowed, Git Buddy among them, to revoke.
export const GITHUB_AUTHORIZED_APPS =
  "https://github.com/settings/applications";

// For privacy questions and account problems. Forwards to the person running Git Buddy.
export const PRIVACY_EMAIL = "privacy@git-buddy.com";
