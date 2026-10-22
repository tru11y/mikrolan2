-- CreateTable
CREATE TABLE "AuditLogArchive" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "outcome" "EventOutcome" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLogArchive_tenantId_createdAt_idx" ON "AuditLogArchive"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLogArchive_createdAt_idx" ON "AuditLogArchive"("createdAt");
