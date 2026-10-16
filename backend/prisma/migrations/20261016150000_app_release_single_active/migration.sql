-- Garantie base de données : au plus une release active (index unique partiel).
-- Prisma ne sait pas exprimer ce prédicat : il vit uniquement dans cette migration.
CREATE UNIQUE INDEX "AppRelease_single_active_idx" ON "AppRelease" ("isActive") WHERE "isActive" = true;
