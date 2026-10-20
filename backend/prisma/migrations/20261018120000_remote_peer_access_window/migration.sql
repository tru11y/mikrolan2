-- AlterTable
ALTER TABLE "RemotePeer" ADD COLUMN "accessOpenUntil" TIMESTAMP(3),
ADD COLUMN "accessSourceIp" TEXT;
