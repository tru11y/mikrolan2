-- Plan.sharedUsers (appareils simultanés) : obligatoire, aucune valeur par défaut silencieuse.
-- Toutes les lignes existantes ont déjà une valeur (colonne NOT NULL). Métadonnées seules, sans réécriture.
-- Compatible avec l'ancien code (il fournit toujours sharedUsers explicitement).
ALTER TABLE "Plan" ALTER COLUMN "sharedUsers" DROP DEFAULT;
