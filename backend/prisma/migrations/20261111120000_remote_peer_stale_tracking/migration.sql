-- Suivi d'inactivité du tunnel WireGuard (alerte « injoignable depuis 24 h »). Colonnes nullables, sans défaut :
-- aucun verrou long, aucune donnée existante modifiée.
-- Retour arrière (réversible, aucune perte fonctionnelle) :
--   ALTER TABLE "RemotePeer" DROP COLUMN "lastHandshakeAt", DROP COLUMN "staleAlertedAt";
ALTER TABLE "RemotePeer" ADD COLUMN "lastHandshakeAt" TIMESTAMP(3),
ADD COLUMN "staleAlertedAt" TIMESTAMP(3);
