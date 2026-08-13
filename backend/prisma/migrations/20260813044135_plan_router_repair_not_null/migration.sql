-- Repairs Plan rows left with a NULL routerId (the backfill in
-- 20260724035912_plan_per_router only reached tenants that already had a
-- router at that time — tenants with zero routers then kept NULL). An
-- orphaned plan is invisible and unmodifiable in the app: `PlansService`
-- always filters/matches on `routerId`.
--
-- 1) Backfill remaining NULLs to the tenant's oldest active router.
UPDATE "Plan" p
SET "routerId" = (
  SELECT r.id FROM "Router" r
  WHERE r."tenantId" = p."tenantId" AND r."deletedAt" IS NULL
  ORDER BY r."createdAt" ASC
  LIMIT 1
)
WHERE p."routerId" IS NULL;

-- 2) Any plan that still has no router (tenant has none at all) cannot be
-- attached to anything — soft-delete it rather than block the NOT NULL
-- constraint below.
UPDATE "Plan"
SET "deletedAt" = NOW()
WHERE "routerId" IS NULL AND "deletedAt" IS NULL;

DELETE FROM "Plan" WHERE "routerId" IS NULL;

-- 3) routerId becomes mandatory: PlansService.create always sets it, and an
-- optional FK is what allowed the orphaning in the first place.
ALTER TABLE "Plan" ALTER COLUMN "routerId" SET NOT NULL;

-- 4) A router's plans are meaningless without it — cascade instead of
-- silently orphaning future rows the same way. RoutersService.hardCleanup
-- already hard-deletes a router's plans explicitly; this is defense in depth
-- for any deletion path that bypasses it.
ALTER TABLE "Plan" DROP CONSTRAINT "Plan_routerId_fkey";
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE CASCADE ON UPDATE CASCADE;
