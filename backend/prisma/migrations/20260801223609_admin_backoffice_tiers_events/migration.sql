-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SUSPEND';
ALTER TYPE "AuditAction" ADD VALUE 'RESTORE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SESSION_ENDED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'UPGRADE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'ROUTER_OFFLINE';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "note" TEXT,
ADD COLUMN     "periodDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "tierId" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "billingPeriod" "BillingPeriod",
ADD COLUMN     "tierId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SubscriptionTier" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyXof" INTEGER NOT NULL,
    "annualDiscount" INTEGER NOT NULL DEFAULT 20,
    "routerLimit" INTEGER,
    "remoteAccess" BOOLEAN NOT NULL DEFAULT false,
    "a4Printing" BOOLEAN NOT NULL DEFAULT false,
    "cloudBackup" BOOLEAN NOT NULL DEFAULT false,
    "prioritySupport" BOOLEAN NOT NULL DEFAULT false,
    "badge" TEXT,
    "tagline" TEXT,
    "features" JSONB NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionTier_key_key" ON "SubscriptionTier"("key");

-- CreateIndex
CREATE INDEX "SubscriptionTier_active_displayOrder_idx" ON "SubscriptionTier"("active", "displayOrder");

-- CreateIndex
CREATE INDEX "Invoice_status_createdAt_idx" ON "Invoice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_tierId_idx" ON "Subscription"("tierId");

-- CreateIndex
CREATE INDEX "Tenant_createdAt_idx" ON "Tenant"("createdAt");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE INDEX "User_tenantId_createdAt_idx" ON "User"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "SubscriptionTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "SubscriptionTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
