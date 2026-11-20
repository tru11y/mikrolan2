-- CreateIndex
-- Idempotent : en prod, créer l'index à la main HORS migration avec
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Voucher_tenantId_status_updatedAt_idx"
--     ON "Voucher"("tenantId", "status", "updatedAt" DESC);
-- (CONCURRENTLY = pas de verrou écriture ; interdit dans la transaction de migrate deploy).
-- `migrate deploy` rejouera alors ce CREATE INDEX comme un no-op (index déjà présent).
CREATE INDEX IF NOT EXISTS "Voucher_tenantId_status_updatedAt_idx" ON "Voucher"("tenantId", "status", "updatedAt" DESC);
