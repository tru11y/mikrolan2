-- CreateTable
CREATE TABLE "ReleaseDownload" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReleaseDownload_releaseId_idx" ON "ReleaseDownload"("releaseId");

-- CreateIndex
CREATE INDEX "ReleaseDownload_tenantId_idx" ON "ReleaseDownload"("tenantId");

-- CreateIndex
CREATE INDEX "ReleaseDownload_userId_idx" ON "ReleaseDownload"("userId");

-- CreateIndex
CREATE INDEX "ReleaseDownload_downloadedAt_idx" ON "ReleaseDownload"("downloadedAt");

-- AddForeignKey
ALTER TABLE "ReleaseDownload" ADD CONSTRAINT "ReleaseDownload_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "AppRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseDownload" ADD CONSTRAINT "ReleaseDownload_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseDownload" ADD CONSTRAINT "ReleaseDownload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

