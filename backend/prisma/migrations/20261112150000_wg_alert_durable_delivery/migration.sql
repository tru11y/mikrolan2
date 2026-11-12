-- CreateEnum
CREATE TYPE "WgAlertType" AS ENUM ('STALE_24H', 'NEVER_CONNECTED');

-- CreateEnum
CREATE TYPE "WgAlertEpisodeStatus" AS ENUM ('OPEN', 'PROVIDER_ACCEPTED', 'EXHAUSTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "WgAlertChannel" AS ENUM ('EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "WgAlertEmailStatus" AS ENUM ('SENT', 'NO_RECIPIENT', 'NOT_CONFIGURED', 'FAILED');

-- CreateEnum
CREATE TYPE "WgAlertPushStatus" AS ENUM ('SENT', 'NO_TOKEN', 'DISABLED', 'FAILED', 'INVALID_TOKEN');

-- CreateEnum
CREATE TYPE "WgAlertAttemptKind" AS ENUM ('INITIAL', 'RETRY', 'REMINDER');

-- CreateEnum
CREATE TYPE "WgAlertAttemptStatus" AS ENUM ('PROVIDER_ACCEPTED', 'NO_RECIPIENT', 'NOT_CONFIGURED', 'NO_TOKEN', 'DISABLED', 'INVALID_TOKEN', 'PROVIDER_FAILED', 'TIMEOUT');

-- CreateTable
CREATE TABLE "WgAlertEpisode" (
    "id" TEXT NOT NULL,
    "remotePeerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "alertType" "WgAlertType" NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "status" "WgAlertEpisodeStatus" NOT NULL DEFAULT 'OPEN',
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "emailStatus" "WgAlertEmailStatus",
    "pushStatus" "WgAlertPushStatus",
    "providerAcceptedAt" TIMESTAMP(3),
    "nextReminderAt" TIMESTAMP(3),
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "claimExpiresAt" TIMESTAMP(3),
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WgAlertEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WgAlertDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "channel" "WgAlertChannel" NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "kind" "WgAlertAttemptKind" NOT NULL DEFAULT 'INITIAL',
    "reminderNumber" INTEGER,
    "status" "WgAlertAttemptStatus" NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL,
    "providerAcceptedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WgAlertDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WgAlertEpisode_remotePeerId_status_idx" ON "WgAlertEpisode"("remotePeerId", "status");

-- CreateIndex
CREATE INDEX "WgAlertEpisode_nextAttemptAt_status_idx" ON "WgAlertEpisode"("nextAttemptAt", "status");

-- CreateIndex
CREATE INDEX "WgAlertEpisode_nextReminderAt_status_idx" ON "WgAlertEpisode"("nextReminderAt", "status");

-- CreateIndex
CREATE INDEX "WgAlertEpisode_tenantId_idx" ON "WgAlertEpisode"("tenantId");

-- CreateIndex
CREATE INDEX "WgAlertDeliveryAttempt_attemptedAt_channel_status_idx" ON "WgAlertDeliveryAttempt"("attemptedAt", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WgAlertDeliveryAttempt_episodeId_channel_attemptNumber_key" ON "WgAlertDeliveryAttempt"("episodeId", "channel", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WgAlertDeliveryAttempt_episodeId_channel_reminderNumber_key" ON "WgAlertDeliveryAttempt"("episodeId", "channel", "reminderNumber");

-- AddForeignKey
ALTER TABLE "WgAlertEpisode" ADD CONSTRAINT "WgAlertEpisode_remotePeerId_fkey" FOREIGN KEY ("remotePeerId") REFERENCES "RemotePeer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WgAlertDeliveryAttempt" ADD CONSTRAINT "WgAlertDeliveryAttempt_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "WgAlertEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Un seul épisode non résolu par (peer, type) : imposé par PostgreSQL contre les courses concurrentes.
-- Index partiel : Prisma ne sait pas l'exprimer dans schema.prisma, ne pas le supprimer.
CREATE UNIQUE INDEX "WgAlertEpisode_one_active_per_peer_type_key"
  ON "WgAlertEpisode" ("remotePeerId", "alertType")
  WHERE "status" <> 'RESOLVED';
