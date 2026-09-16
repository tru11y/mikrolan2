-- AlterTable
ALTER TABLE "SubscriptionTier" ADD COLUMN "userLimit" INTEGER;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "routerLimitOverride" INTEGER;
ALTER TABLE "Subscription" ADD COLUMN "userLimitOverride" INTEGER;
