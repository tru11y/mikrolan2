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

  console.log(`Seeded SUPER_ADMIN: ${SUPER_ADMIN_EMAIL}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
