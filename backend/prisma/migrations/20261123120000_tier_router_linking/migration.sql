-- Option payante « liaison de routeurs » (quota partagé RADIUS) : entitlement par tier.
ALTER TABLE "SubscriptionTier" ADD COLUMN "routerLinking" BOOLEAN NOT NULL DEFAULT false;

-- Activée d'office sur la formule Entreprise (cf. prisma/seed.ts).
UPDATE "SubscriptionTier" SET "routerLinking" = true WHERE "key" = 'entreprise';
