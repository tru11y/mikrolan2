-- Fenêtre de grâce sur la rotation des refresh tokens (anti-déconnexion involontaire).
-- Colonnes nullables : les jetons existants (rotatedAt/graceExpiresAt NULL) sont
-- traités comme hors grâce → comportement strict d'origine conservé.
ALTER TABLE "RefreshToken" ADD COLUMN "rotatedAt" TIMESTAMP(3);
ALTER TABLE "RefreshToken" ADD COLUMN "graceExpiresAt" TIMESTAMP(3);
