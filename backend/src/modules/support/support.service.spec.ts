import { NotFoundException } from '@nestjs/common';
import { SupportService } from './support.service';

function makePrisma() {
  return {
    supportTicket: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    ticketMessage: {
      create: jest.fn(),
    },
  } as unknown as { supportTicket: any; ticketMessage: any };
}

function makeService() {
  const prisma = makePrisma();
  return { service: new SupportService(prisma as any), prisma };
}

describe('SupportService (real service layer, FIND-003)', () => {
  it('create() always writes the caller tenantId — never a client-controlled value', async () => {
    const { service, prisma } = makeService();
    prisma.supportTicket.create.mockResolvedValue({ id: 't1' });

    await service.create('tenant-A', 'user-1', { subject: 'help', body: 'hi' } as any);

    expect(prisma.supportTicket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-A' }) }),
    );
  });

  it('listMine() scopes findMany by the caller tenantId (tenant A cannot see tenant B tickets)', async () => {
    const { service, prisma } = makeService();
    prisma.supportTicket.findMany.mockResolvedValue([]);

    await service.listMine('tenant-A', { limit: 20 } as any);

    expect(prisma.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-A' }) }),
    );
  });

  it('getOne() scopes findFirst by id AND tenantId — a direct ID lookup cannot cross tenants', async () => {
    const { service, prisma } = makeService();
    prisma.supportTicket.findFirst.mockResolvedValue({ id: 'ticket-1', tenantId: 'tenant-A' });

    await service.getOne('tenant-A', 'ticket-1');

    expect(prisma.supportTicket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ticket-1', tenantId: 'tenant-A' } }),
    );
  });

  it('getOne() throws NotFoundException when the ticket belongs to another tenant (findFirst returns null)', async () => {
    const { service, prisma } = makeService();
    prisma.supportTicket.findFirst.mockResolvedValue(null);

    await expect(service.getOne('tenant-A', 'ticket-of-tenant-B')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('addMessage() refuses to post on a ticket belonging to another tenant', async () => {
    const { service, prisma } = makeService();
    prisma.supportTicket.findFirst.mockResolvedValue(null);

    await expect(
      service.addMessage('tenant-A', 'ticket-of-tenant-B', 'user-1', 'hello'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ticketMessage.create).not.toHaveBeenCalled();
  });

  it('addMessage() verifies ticket ownership (id + tenantId) before writing the message', async () => {
    const { service, prisma } = makeService();
    prisma.supportTicket.findFirst.mockResolvedValue({ id: 'ticket-1', tenantId: 'tenant-A' });
    prisma.ticketMessage.create.mockResolvedValue({ id: 'msg-1' });

    await service.addMessage('tenant-A', 'ticket-1', 'user-1', 'hello');

    expect(prisma.supportTicket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ticket-1', tenantId: 'tenant-A' } }),
    );
    expect(prisma.ticketMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ticketId: 'ticket-1', userId: 'user-1' }) }),
    );
  });
});
