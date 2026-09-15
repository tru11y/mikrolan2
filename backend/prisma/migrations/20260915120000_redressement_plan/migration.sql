-- AlterEnum: add DEGRADED to RouterHealth
ALTER TYPE "RouterHealth" ADD VALUE 'DEGRADED';

-- Router health monitoring fields
ALTER TABLE "Router" ADD COLUMN "lastSyncAt" TIMESTAMP(3);
ALTER TABLE "Router" ADD COLUMN "lastSyncError" TEXT;
ALTER TABLE "Router" ADD COLUMN "syncFailCount" INTEGER NOT NULL DEFAULT 0;

-- Notification delivery tracking
ALTER TABLE "Notification" ADD COLUMN "pushSentAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN "pushError" TEXT;
ALTER TABLE "Notification" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;

-- Support SLA
ALTER TABLE "SupportTicket" ADD COLUMN "slaDeadlineAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "firstReplyAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN "satisfactionScore" INTEGER;
CREATE INDEX "SupportTicket_slaDeadlineAt_idx" ON "SupportTicket"("slaDeadlineAt");

-- Invoice auto-expiration
ALTER TABLE "Invoice" ADD COLUMN "expiresAt" TIMESTAMP(3);
