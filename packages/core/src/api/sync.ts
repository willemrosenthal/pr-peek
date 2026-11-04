// Sent by the web app on requests made while someone can see it. Only those count as
// using the app, which speeds up the account's syncs. Background refetches, like after a
// live update, don't send it.
export const LOOKING_HEADER = "X-Pr-Peek-Looking";

export interface RequestSyncResponse {
  // False when a sync for the user was already queued or running.
  queued: boolean;
}

export interface SyncStatusResponse {
  lastSyncedAt: string | null;
  // "reauth": sign in with GitHub again. "token": add a new personal access token.
  // "failed": it will retry on its own.
  syncError: "reauth" | "token" | "failed" | null;
  running: boolean;
}
