-- AlterEnum
-- ALTER TYPE ... ADD VALUE doit s'exécuter dans sa propre transaction (cf. 20261028120000_saspay_provider_enum).
ALTER TYPE "UserRole" ADD VALUE 'TICKET_VERIFIER';
