-- CreateEnum
CREATE TYPE "RouterLinkStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RouterLinkAuthMode" AS ENUM ('RADIUS', 'DIRECT');

-- AlterTable
ALTER TABLE "Router" ADD COLUMN     "radiusSecretEncrypted" TEXT;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "linkId" TEXT;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "acctSessionId" TEXT,
ADD COLUMN     "nasIdentifier" TEXT;

-- CreateTable
CREATE TABLE "RouterLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "RouterLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "authMode" "RouterLinkAuthMode" NOT NULL DEFAULT 'DIRECT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouterLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouterLinkMember" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouterLinkMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouterLink_tenantId_idx" ON "RouterLink"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RouterLink_tenantId_slug_key" ON "RouterLink"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "RouterLinkMember_tenantId_idx" ON "RouterLinkMember"("tenantId");

-- CreateIndex
CREATE INDEX "RouterLinkMember_routerId_idx" ON "RouterLinkMember"("routerId");

-- CreateIndex
CREATE UNIQUE INDEX "RouterLinkMember_linkId_routerId_key" ON "RouterLinkMember"("linkId", "routerId");

-- AddForeignKey
ALTER TABLE "RouterLink" ADD CONSTRAINT "RouterLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterLinkMember" ADD CONSTRAINT "RouterLinkMember_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "RouterLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterLinkMember" ADD CONSTRAINT "RouterLinkMember_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouterLinkMember" ADD CONSTRAINT "RouterLinkMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "RouterLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── BACKFILL (idempotent) ─────────────────────────────────────────────────
-- Pour chaque Router portant au moins un voucher, on crée un lien mono-routeur
-- (authMode DIRECT = comportement historique). L'id du RouterLink et du
-- RouterLinkMember réutilise l'id du Router : rejouable sans doublon (ON CONFLICT),
-- et Voucher.linkId = Voucher.routerId satisfait d'emblée la FK.
INSERT INTO "RouterLink" ("id", "tenantId", "name", "slug", "status", "authMode", "createdAt", "updatedAt")
SELECT r."id",
       r."tenantId",
       r."identity",
       lower(regexp_replace(r."identity", '[^a-zA-Z0-9]+', '-', 'g')) || '-' || left(r."id", 8),
       'ACTIVE',
       'DIRECT',
       now(),
       now()
FROM "Router" r
WHERE EXISTS (SELECT 1 FROM "Voucher" v WHERE v."routerId" = r."id")
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "RouterLinkMember" ("id", "linkId", "routerId", "tenantId", "createdAt")
SELECT r."id", r."id", r."id", r."tenantId", now()
FROM "Router" r
WHERE EXISTS (SELECT 1 FROM "Voucher" v WHERE v."routerId" = r."id")
ON CONFLICT ("linkId", "routerId") DO NOTHING;

UPDATE "Voucher" v
SET "linkId" = v."routerId"
WHERE v."linkId" IS NULL
  AND EXISTS (SELECT 1 FROM "RouterLink" l WHERE l."id" = v."routerId");

-- ─── SESSION : 1-1 (voucherId unique) → 1-N par routeur ────────────────────
-- Garde-fou : sous l'ancienne contrainte voucherId unique aucun doublon
-- (voucherId, routerId) ne peut exister, mais on le vérifie avant de poser la
-- nouvelle contrainte composite.
DO $$
DECLARE dup bigint;
BEGIN
  SELECT count(*) INTO dup FROM (
    SELECT "voucherId", "routerId"
    FROM "Session"
    GROUP BY "voucherId", "routerId"
    HAVING count(*) > 1
  ) d;
  IF dup > 0 THEN
    RAISE EXCEPTION 'Doublons (voucherId, routerId) dans Session: % — contrainte composite impossible', dup;
  END IF;
END $$;

-- DropIndex
DROP INDEX "Session_voucherId_key";

-- CreateIndex
CREATE INDEX "Session_voucherId_idx" ON "Session"("voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_voucherId_routerId_key" ON "Session"("voucherId", "routerId");
