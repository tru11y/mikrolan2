-- AlterEnum
BEGIN;
CREATE TYPE "PaymentProvider_new" AS ENUM ('MANUAL');
ALTER TABLE "Invoice" ALTER COLUMN "provider" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "provider" TYPE "PaymentProvider_new" USING ("provider"::text::"PaymentProvider_new");
ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
ALTER TYPE "PaymentProvider_new" RENAME TO "PaymentProvider";
DROP TYPE "PaymentProvider_old";
ALTER TABLE "Invoice" ALTER COLUMN "provider" SET DEFAULT 'MANUAL';
COMMIT;

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "provider" SET DEFAULT 'MANUAL';

