-- ALTER TYPE ... ADD VALUE must run OUTSIDE a transaction in PostgreSQL.
-- Prisma wraps each migration file in its own transaction, so this enum
-- extension lives alone in its own migration — the rest of the SasPay
-- schema is applied by the next migration.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'SASPAY';
