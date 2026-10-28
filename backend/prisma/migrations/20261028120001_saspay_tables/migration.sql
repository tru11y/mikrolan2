-- SasPay integration: payment intents + webhook event dedup.
-- The PaymentProvider enum was extended with 'SASPAY' in the preceding
-- migration (20261028120000_saspay_provider_enum) because ALTER TYPE
-- cannot share a transaction with other statements.
-- Non-destructive. Existing MANUAL invoices and PaymentProof unchanged.

-- 1. New enum PaymentIntentStatus
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED');

-- 2. PaymentIntent — one external payment attempt per row
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'SASPAY',
    "idempotencyKey" TEXT NOT NULL,
    "providerSessionId" TEXT,
    "providerReference" TEXT,
    "checkoutUrl" TEXT,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
    "amountRequested" INTEGER NOT NULL,
    "amountCharged" INTEGER,
    "amountNet" INTEGER,
    "fee" INTEGER,
    "feeChargeMode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "countryCode" TEXT,
    "network" TEXT,
    "activatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rawLastEvent" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentIntent_idempotencyKey_key" ON "PaymentIntent"("idempotencyKey");
CREATE UNIQUE INDEX "PaymentIntent_providerSessionId_key" ON "PaymentIntent"("providerSessionId");
CREATE UNIQUE INDEX "PaymentIntent_providerReference_key" ON "PaymentIntent"("providerReference");
CREATE INDEX "PaymentIntent_tenantId_idx" ON "PaymentIntent"("tenantId");
CREATE INDEX "PaymentIntent_invoiceId_idx" ON "PaymentIntent"("invoiceId");
CREATE INDEX "PaymentIntent_status_createdAt_idx" ON "PaymentIntent"("status", "createdAt");

ALTER TABLE "PaymentIntent"
    ADD CONSTRAINT "PaymentIntent_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. WebhookEventLog — dedup for provider webhook deliveries
CREATE TABLE "WebhookEventLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "providerRef" TEXT,
    "tenantId" TEXT,
    "intentId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookEventLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookEventLog_eventHash_key" ON "WebhookEventLog"("eventHash");
CREATE INDEX "WebhookEventLog_provider_eventType_idx" ON "WebhookEventLog"("provider", "eventType");
CREATE INDEX "WebhookEventLog_receivedAt_idx" ON "WebhookEventLog"("receivedAt");
