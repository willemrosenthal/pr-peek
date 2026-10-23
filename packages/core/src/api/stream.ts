// The SSE event sent on GET /api/stream when the user's items change.
// Its data is a SummaryResponse.
export const ITEMS_CHANGED_EVENT = "items-changed";

// Sent instead of a push to browsers on the Mac while the Mac menu bar app runs. Its data
// is a PushPayload, for a native Mac notification.
export const NOTIFY_EVENT = "notify";

// The Mac menu bar app counts as running this long after its last heartbeat. It sends
// one every minute.
export const DESKTOP_ONLINE_MS = 3 * 60_000;
