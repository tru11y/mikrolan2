-- CreateTable
CREATE TABLE "AppRelease" (
    "id" TEXT NOT NULL,
    "versionName" TEXT NOT NULL,
    "versionCode" INTEGER NOT NULL,
    "minVersionCode" INTEGER NOT NULL,
    "releaseNotes" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppRelease_versionCode_key" ON "AppRelease"("versionCode");

-- CreateIndex
CREATE UNIQUE INDEX "AppRelease_storageKey_key" ON "AppRelease"("storageKey");

-- CreateIndex
CREATE INDEX "AppRelease_isActive_idx" ON "AppRelease"("isActive");

-- CreateIndex
CREATE INDEX "AppRelease_createdAt_idx" ON "AppRelease"("createdAt");

-- AddForeignKey
ALTER TABLE "AppRelease" ADD CONSTRAINT "AppRelease_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

