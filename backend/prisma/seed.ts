import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Phase 1 will seed the platform SUPER_ADMIN + system tenant here.
  // Placeholder to keep `prisma:seed` runnable.
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
