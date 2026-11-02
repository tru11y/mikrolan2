-- CreateTable
CREATE TABLE "TicketVerifierAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "routerId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketVerifierAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketVerifierAssignment_userId_key" ON "TicketVerifierAssignment"("userId");

-- CreateIndex
CREATE INDEX "TicketVerifierAssignment_tenantId_idx" ON "TicketVerifierAssignment"("tenantId");

-- CreateIndex
CREATE INDEX "TicketVerifierAssignment_routerId_idx" ON "TicketVerifierAssignment"("routerId");

-- CreateIndex
CREATE INDEX "TicketVerifierAssignment_tenantId_routerId_idx" ON "TicketVerifierAssignment"("tenantId", "routerId");

-- AddForeignKey
ALTER TABLE "TicketVerifierAssignment" ADD CONSTRAINT "TicketVerifierAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketVerifierAssignment" ADD CONSTRAINT "TicketVerifierAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketVerifierAssignment" ADD CONSTRAINT "TicketVerifierAssignment_routerId_fkey" FOREIGN KEY ("routerId") REFERENCES "Router"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketVerifierAssignment" ADD CONSTRAINT "TicketVerifierAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
