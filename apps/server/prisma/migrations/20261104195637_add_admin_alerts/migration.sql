-- When each alert to the admin last went out, so each goes at most once a day.
CREATE TABLE "AdminAlert" (
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("kind")
);
