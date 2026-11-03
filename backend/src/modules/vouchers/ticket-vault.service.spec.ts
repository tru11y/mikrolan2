import { TicketVaultService } from './ticket-vault.service';

describe('TicketVaultService.store — cloudBackup gate', () => {
  const build = (cloudBackup: boolean) => {
    const prisma = { ticketVault: { create: jest.fn() }, voucherBatch: { update: jest.fn() } };
    const subs = { getEntitlement: jest.fn().mockResolvedValue({ cloudBackup }) };
    const service = new TicketVaultService(prisma as never, { success: jest.fn(), failure: jest.fn() } as never, subs as never);
    return { service, prisma };
  };

  it('refuse (403) quand la formule n’inclut pas la sauvegarde cloud', async () => {
    const { service, prisma } = build(false);
    await expect(service.store('t1', 'b1', Buffer.from('%PDF-1.4'), 'x.pdf')).rejects.toMatchObject({ status: 403 });
    expect(prisma.ticketVault.create).not.toHaveBeenCalled();
  });
});
