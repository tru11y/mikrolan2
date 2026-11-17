-- Idempotence B-01 : quatre colonnes nullables sur VoucherBatch pour dédupliquer
-- POST /routers/:id/vouchers/generate.
--   • clientRequestId       : UUID v4 fourni par le client (header Idempotency-Key).
--   • requestFingerprint    : SHA-256 de la canonicalisation JSON.stringify
--                             ([tenantId, routerId, planId, quantity]) — format
--                             figé (fait partie du contrat persistant).
--   • pushedByServer        : vrai si l'opération initiale a poussé les vouchers
--                             via WireGuard (REMOTE + peer actif) au moment de
--                             la génération, faux pour le chemin LAN. NULL pour
--                             les lots legacy antérieurs à cette migration.
--   • pushParamsSnapshot    : JSONB immuable du payload RouterOS pour le chemin
--                             LAN (le mobile doit pouvoir rejouer le push après
--                             perte de la 1re réponse). Strictement :
--                             userProfile, rateLimit, sharedUsers, limitUptime,
--                             limitBytesTotal, comment. AUCUN secret ni code de
--                             ticket. NULL pour REMOTE (le serveur a poussé) et
--                             pour les lots legacy.
-- Aucune réécriture des lots historiques, aucun backfill.
-- En PostgreSQL, NULL != NULL dans un index unique standard → plusieurs
-- VoucherBatch legacy à clientRequestId NULL coexistent sans conflit.
-- Retour arrière : les colonnes et l'index peuvent être retirés. Aucun lot
-- ni ticket n'est supprimé par ce rollback. En revanche, l'historique des clés
-- d'idempotence, des empreintes, du mode de push et du snapshot LAN est perdu :
-- des requêtes replay encore en vol côté client ne seraient plus reconnues et
-- créeraient un nouveau batch.
--   DROP INDEX "VoucherBatch_tenantId_clientRequestId_key";
--   ALTER TABLE "VoucherBatch"
--     DROP COLUMN "pushParamsSnapshot",
--     DROP COLUMN "pushedByServer",
--     DROP COLUMN "requestFingerprint",
--     DROP COLUMN "clientRequestId";
ALTER TABLE "VoucherBatch"
  ADD COLUMN "clientRequestId" TEXT,
  ADD COLUMN "requestFingerprint" TEXT,
  ADD COLUMN "pushedByServer" BOOLEAN,
  ADD COLUMN "pushParamsSnapshot" JSONB;

CREATE UNIQUE INDEX "VoucherBatch_tenantId_clientRequestId_key"
  ON "VoucherBatch"("tenantId", "clientRequestId");
