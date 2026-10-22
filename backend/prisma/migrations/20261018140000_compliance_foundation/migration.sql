-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "remoteAccessAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "remoteAccessAcceptedById" TEXT,
ADD COLUMN     "remoteAccessVersion" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "privacyAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "privacyVersion" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT;

-- CreateIndex
CREATE INDEX "User_status_deletedAt_idx" ON "User"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "RemotePeer_status_revokedAt_idx" ON "RemotePeer"("status", "revokedAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PaymentProof_createdAt_idx" ON "PaymentProof"("createdAt");

