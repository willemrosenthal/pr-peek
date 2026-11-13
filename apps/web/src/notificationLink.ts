import type { PushPayload } from "@pr-peek/core";

// The list opens the preview of the PR in `?pr=`, like from a notification.
export const PREVIEW_PARAM = "pr";

// Where a tap on a notification goes: the preview of its PR in the app, or its link when
// it's about no PR, like the morning summary.
export const notificationLink = ({
  url,
  prId,
}: Pick<PushPayload, "url" | "prId">) =>
  prId ? `/?${PREVIEW_PARAM}=${encodeURIComponent(prId)}` : url;
