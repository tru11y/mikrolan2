-- AlterTable: add push token and googleId to User
ALTER TABLE "User" ADD COLUMN "pushToken" TEXT;
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- AlterTable: add push notifications toggle to Router
ALTER TABLE "Router" ADD COLUMN "pushNotifications" BOOLEAN NOT NULL DEFAULT true;
