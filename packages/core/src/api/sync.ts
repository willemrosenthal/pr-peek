export interface RequestSyncResponse {
  // False when a sync for the user was already queued or running.
  queued: boolean;
}

export interface SyncStatusResponse {
  lastSyncedAt: string | null;
  // "reauth" means sign in again. "failed" means it will retry on its own.
  syncError: string | null;
  running: boolean;
}
