-- Plans become per-router. Add nullable routerId, backfill existing plans to
-- the tenant's oldest router, then move slug uniqueness to (tenantId, routerId).

ALTER TABLE "Plan" ADD COLUMN "routerId" TEXT;

UPDATE "Plan" p
SET "routerId" = (
  SELECT r.id FROM "Router" r
  WHERE r."tenantId" = p."tenantId" AND r."deletedAt" IS NULL
  ORDER BY r."createdAt" ASC
  LIMIT 1
)
WHERE p."routerId" IS NULL;

DROP INDEX "Plan_tenantId_slug_key";

CREATE UNIQUE INDEX "Plan_tenantId_routerId_slug_key" ON "Plan"("tenantId", "routerId", "slug");

CREATE INDEX "Plan_routerId_idx" ON "Plan"("routerId");

ALTER TABLE "Plan" ADD CONSTRAINT "Plan_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE SET NULL ON UPDATE CASCADE;
