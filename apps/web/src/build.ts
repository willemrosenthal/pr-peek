// Set by vite.config.ts when the app is built.
declare const __BUILD__: Build;

export interface Build {
  // Like "1.2.0". Empty when the build couldn't find a release tag.
  version: string;
  commit: string;
}

export const BUILD = __BUILD__;

export const REPO_URL = "https://github.com/willemrosenthal/pr-peek";

// Bugs and ideas go here. The repo is public, so anyone with GitHub can file one.
export const ISSUES_URL = `${REPO_URL}/issues/new`;

// For privacy questions and account problems. Forwards to the person running Git Buddy.
export const PRIVACY_EMAIL = "privacy@git-buddy.com";
