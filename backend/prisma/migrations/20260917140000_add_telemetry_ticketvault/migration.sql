-- RouterTelemetry (historique diagnostics routeurs, rétention 7-30j)
CREATE TABLE "RouterTelemetry" (
    "id" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "cpuPercent" INTEGER,
    "ramUsedMb" INTEGER,
    "ramTotalMb" INTEGER,
    "uptime" TEXT,
    "rosVersion" TEXT,
    "boardName" TEXT,
    "hotspotActive" INTEGER,
    "lastErrors" JSONB,
    "health" "RouterHealth" NOT NULL DEFAULT 'UNKNOWN',
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouterTelemetry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RouterTelemetry_routerId_collectedAt_idx" ON "RouterTelemetry"("routerId", "collectedAt");
CREATE INDEX "RouterTelemetry_collectedAt_idx" ON "RouterTelemetry"("collectedAt");

ALTER TABLE "RouterTelemetry" ADD CONSTRAINT "RouterTelemetry_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TicketVault (PDF archivés côté serveur)
CREATE TABLE "TicketVault" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeByte" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketVault_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketVault_tenantId_idx" ON "TicketVault"("tenantId");
CREATE INDEX "TicketVault_batchId_idx" ON "TicketVault"("batchId");

ALTER TABLE "TicketVault" ADD CONSTRAINT "TicketVault_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TicketVault" ADD CONSTRAINT "TicketVault_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "VoucherBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- VoucherBatch: ajout pdfUrl
ALTER TABLE "VoucherBatch" ADD COLUMN "pdfUrl" TEXT;
