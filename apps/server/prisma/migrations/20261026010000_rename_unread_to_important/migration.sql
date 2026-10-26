-- The mark is now "important", a flag, not a second unread dot.
ALTER TABLE "PullRequest" RENAME COLUMN "unreadAt" TO "importantAt";
