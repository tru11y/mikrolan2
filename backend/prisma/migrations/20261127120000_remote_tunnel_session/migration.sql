-- Accès distant via tunnel WSS 443 : mode de transport + sessions de tunnel.
-- Migration additive (enum + colonne à défaut + table) : rollback trivial.

-- CreateEnum
CREATE TYPE "AccessMode" AS ENUM ('DIRECT', 'TUNNEL');

-- CreateEnum
CREATE TYPE "RemoteTunnelCloseReason" AS ENUM ('EXPIRED', 'CLOSED_BY_USER', 'REVOKED', 'REPLACED', 'IP_MISMATCH', 'ERROR');

-- AlterTable
ALTER TABLE "RemotePeer" ADD COLUMN "accessMode" "AccessMode" NOT NULL DEFAULT 'DIRECT';

-- CreateTable
CREATE TABLE "RemoteTunnelSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticketHash" TEXT NOT NULL,
    "sourceIp" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" "RemoteTunnelCloseReason",
    "bytesUp" BIGINT NOT NULL DEFAULT 0,
    "bytesDown" BIGINT NOT NULL DEFAULT 0,
    "streamsOpened" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RemoteTunnelSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RemoteTunnelSession_ticketHash_key" ON "RemoteTunnelSession"("ticketHash");

-- CreateIndex
CREATE INDEX "RemoteTunnelSession_tenantId_idx" ON "RemoteTunnelSession"("tenantId");

-- CreateIndex
CREATE INDEX "RemoteTunnelSession_peerId_closedAt_idx" ON "RemoteTunnelSession"("peerId", "closedAt");

-- CreateIndex
CREATE INDEX "RemoteTunnelSession_expiresAt_idx" ON "RemoteTunnelSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "RemoteTunnelSession" ADD CONSTRAINT "RemoteTunnelSession_peerId_fkey" FOREIGN KEY ("peerId") REFERENCES "RemotePeer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
