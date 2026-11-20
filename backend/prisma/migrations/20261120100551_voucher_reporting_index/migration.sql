-- CreateIndex
CREATE INDEX "Voucher_tenantId_status_updatedAt_idx" ON "Voucher"("tenantId", "status", "updatedAt" DESC);
