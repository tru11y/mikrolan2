-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "timezone" TEXT DEFAULT 'Africa/Abidjan';

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "priceSnapshotSource" TEXT,
ADD COLUMN     "priceXofAtActivation" INTEGER;
