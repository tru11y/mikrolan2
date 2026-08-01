import {
  PrismaClient,
  SubscriptionPlan,
  SubscriptionStatus,
  TenantStatus,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const SUPER_ADMIN_EMAIL =
  process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@mikrolan.local';
const SUPER_ADMIN_PASSWORD =
  process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe-SuperAdmin-2026';
const PLATFORM_SLUG = 'platform';

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: PLATFORM_SLUG },
    update: {},
    create: {
      name: 'MikroLan Platform',
      slug: PLATFORM_SLUG,
      status: TenantStatus.ACTIVE,
      subscription: {
        create: {
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
        },
      },
    },
  });

  const passwordHash = await argon2.hash(SUPER_ADMIN_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: { role: UserRole.SUPER_ADMIN },
    create: {
      tenantId: tenant.id,
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  await seedTiers();

  console.log(`Seeded SUPER_ADMIN: ${SUPER_ADMIN_EMAIL}`);
}

/**
 * Grille tarifaire initiale.
 *
 * Les montants reprennent **exactement** ceux que l'application affichait en
 * dur (`mobile/src/config/tiers.ts`) : au premier déploiement, aucun client ne
 * doit voir son prix changer. `update: {}` sur l'upsert est délibéré — une
 * fois la grille publiée, c'est le super admin qui la pilote, pas le seed.
 */
async function seedTiers(): Promise<void> {
  const tiers = [
    {
      key: 'essentiel',
      name: 'Essentiel',
      monthlyXof: 5000,
      tagline: 'Jusqu’à 3 routeurs',
      routerLimit: 3,
      remoteAccess: false,
      a4Printing: false,
      cloudBackup: false,
      prioritySupport: false,
      badge: null,
      displayOrder: 0,
      features: [
        { label: 'Jusqu’à 3 routeurs MikroTik', included: true },
        { label: 'Génération de tickets illimitée', included: true },
        { label: 'Impression thermique Bluetooth', included: true },
        { label: 'Templates de tickets basiques', included: true },
        { label: 'Sauvegarde Cloud automatique', included: false },
        { label: 'Accès distant multi-sites', included: false },
      ],
    },
    {
      key: 'avance',
      name: 'Avancé',
      monthlyXof: 15000,
      tagline: 'Jusqu’à 10 routeurs',
      routerLimit: 10,
      remoteAccess: true,
      a4Printing: true,
      cloudBackup: true,
      prioritySupport: false,
      badge: 'LE PLUS CHOISI',
      displayOrder: 1,
      features: [
        { label: 'Jusqu’à 10 routeurs MikroTik', included: true },
        { label: 'Génération de tickets illimitée', included: true },
        { label: 'Impression thermique + PDF A4/A3', included: true },
        { label: 'Tous les templates Premium', included: true },
        { label: 'Sauvegarde Cloud automatique 24/7', included: true },
        { label: 'Accès distant multi-sites', included: true },
      ],
    },
    {
      key: 'entreprise',
      name: 'Entreprise',
      monthlyXof: 35000,
      tagline: 'Routeurs illimités',
      routerLimit: null,
      remoteAccess: true,
      a4Printing: true,
      cloudBackup: true,
      prioritySupport: true,
      badge: null,
      displayOrder: 2,
      features: [
        { label: 'Routeurs MikroTik illimités', included: true },
        { label: 'Tickets & baux DHCP illimités', included: true },
        { label: 'Support technique dédié 24/7', included: true },
        { label: 'Personnalisation white-label', included: true },
        { label: 'Sauvegarde Cloud & API', included: true },
        { label: 'Accès distant multi-sites', included: true },
      ],
    },
  ];

  for (const tier of tiers) {
    await prisma.subscriptionTier.upsert({
      where: { key: tier.key },
      update: {},
      create: { ...tier, annualDiscount: 20, active: true },
    });
  }

  console.log(`Seeded ${tiers.length} subscription tiers`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
