-- Plan fidelity (MikroTicket parity): simultaneous logins + validity mode.
CREATE TYPE "PlanExpiration" AS ENUM ('ELAPSED', 'RADIO_PAUSE');

ALTER TABLE "Plan" ADD COLUMN "sharedUsers" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Plan" ADD COLUMN "expirationMode" "PlanExpiration" NOT NULL DEFAULT 'RADIO_PAUSE';
