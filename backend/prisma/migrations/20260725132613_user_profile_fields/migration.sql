-- Editable profile fields for "Mon Compte" (Nom Complet, Pays/Région).
ALTER TABLE "User" ADD COLUMN "name" TEXT;
ALTER TABLE "User" ADD COLUMN "country" TEXT;
