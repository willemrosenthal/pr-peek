-- Plan 19: an admin role, and usage counts for the admin page.
CREATE TYPE "Role" AS ENUM ('user', 'admin');

ALTER TABLE "User" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'user';

CREATE TABLE "UsageStat" (
    "bucket" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "low" BIGINT,
    "high" BIGINT,

    CONSTRAINT "UsageStat_pkey" PRIMARY KEY ("bucket","source","metric","key")
);
