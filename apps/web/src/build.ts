// Set by vite.config.ts when the app is built.
declare const __BUILD__: Build;

export interface Build {
  // Like "1.2.0". Empty when the build couldn't find a release tag.
  version: string;
  commit: string;
}

export const BUILD = __BUILD__;

export const REPO_URL = "https://github.com/willemrosenthal/pr-peek";
