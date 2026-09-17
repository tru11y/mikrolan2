-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "country" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "countryUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "lastCountryReminderAt" TIMESTAMP(3);

-- Backfill: copy country from OWNER user to tenant (best-effort)
UPDATE "Tenant" t
SET "country" = u."country",
    "countryUpdatedAt" = NOW()
FROM "User" u
WHERE u."tenantId" = t.id
  AND u."role" = 'OWNER'
  AND u."country" IS NOT NULL
  AND t."country" IS NULL;

-- Feature 3: VoucherLimit par tier
ALTER TABLE "SubscriptionTier" ADD COLUMN "voucherMonthlyLimit" INTEGER;
ALTER TABLE "Subscription" ADD COLUMN "voucherLimitOverride" INTEGER;
