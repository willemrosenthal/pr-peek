-- The old per-device level goes: nothing has read or written it since 1.34.1 (#191).
ALTER TABLE "PushSubscription" DROP COLUMN "minSeverity";
