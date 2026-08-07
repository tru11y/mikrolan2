-- CreateEnum
CREATE TYPE "PlanCodeFormat" AS ENUM ('ALPHANUMERIC', 'NUMERIC');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('VOUCHER_ACTIVATED');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "codeFormat" "PlanCodeFormat" NOT NULL DEFAULT 'ALPHANUMERIC',
ADD COLUMN     "codeLength" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "codePrefix" TEXT;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "voucherId" TEXT,
    "routerId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_readAt_idx" ON "Notification"("tenantId", "readAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
