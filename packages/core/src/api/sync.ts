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
