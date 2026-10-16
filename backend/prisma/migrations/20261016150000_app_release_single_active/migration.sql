-- Invariant « une seule release active » garanti par la base (index unique partiel,
-- non exprimable dans schema.prisma : à conserver à la main).
-- Une release archivée ne peut pas rester active.
UPDATE "AppRelease" SET "isActive" = false WHERE "isActive" = true AND "archivedAt" IS NOT NULL;

-- Réparation préalable : si plusieurs actives existent, on garde la plus récente (versionCode).
UPDATE "AppRelease" SET "isActive" = false
WHERE "isActive" = true
  AND "id" <> (
    SELECT "id" FROM "AppRelease" WHERE "isActive" = true
    ORDER BY "versionCode" DESC, "id" DESC LIMIT 1
  );

CREATE UNIQUE INDEX "AppRelease_single_active" ON "AppRelease" ("isActive") WHERE "isActive" = true;

ALTER TABLE "AppRelease"
  ADD CONSTRAINT "AppRelease_active_not_archived" CHECK (NOT ("isActive" AND "archivedAt" IS NOT NULL));
