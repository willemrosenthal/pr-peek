-- CreateIndex
CREATE INDEX "Item_pullRequestId_idx" ON "Item"("pullRequestId");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_idx" ON "NotificationLog"("userId");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
