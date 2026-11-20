-- PR4 : bascule du provisioning hotspot direct → délégation RADIUS (opt-in par lien).
-- Ajouts minimaux, défauts non-nuls : aucune donnée existante cassée.

-- RouterLinkMember : horodatage de confirmation que ce NAS délègue au RADIUS
-- (use-radius=yes vérifié sur le profil hotspot). NULL = pas encore prêt.
ALTER TABLE "RouterLinkMember" ADD COLUMN "radiusReadyAt" TIMESTAMP(3);

-- Voucher : flag de distribuabilité dénormalisé en mode RADIUS, piloté par
-- l'état du lien. Défaut false → les vouchers existants (mode DIRECT) gardent
-- leur distribuabilité décidée par mikrotikId, ce flag étant ignoré.
ALTER TABLE "Voucher" ADD COLUMN "radiusDistributable" BOOLEAN NOT NULL DEFAULT false;
