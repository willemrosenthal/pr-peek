-- The iPhone app's devices, for Apple push (plan 12). A new table only, so the live code
-- keeps working while this deploys.
-- CreateTable
CREATE TABLE "AppleDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "lastSuccessAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppleDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppleDevice_token_key" ON "AppleDevice"("token");

-- CreateIndex
CREATE INDEX "AppleDevice_userId_idx" ON "AppleDevice"("userId");

-- AddForeignKey
ALTER TABLE "AppleDevice" ADD CONSTRAINT "AppleDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

