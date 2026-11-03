-- AlterTable
ALTER TABLE "PasswordResetCode" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
