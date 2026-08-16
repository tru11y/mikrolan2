import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateTicketDto, ListMyTicketsDto } from './dto/support.schemas';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, userId: string, dto: CreateTicketDto) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        tenantId,
        userId,
        subject: dto.subject,
        messages: {
          create: { userId, body: dto.body },
        },
      },
      include: { messages: true },
    });
    return ticket;
  }

  async listMine(tenantId: string, query: ListMyTicketsDto): Promise<Page<unknown>> {
    const rows = await this.prisma.supportTicket.findMany({
      where: { tenantId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async getOne(tenantId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, tenantId },
      select: {
        id: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            body: true,
            imageUrl: true,
            isAdmin: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket introuvable');
    return ticket;
  }

  async addMessage(tenantId: string, ticketId: string, userId: string, body: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException('Ticket introuvable');

    return this.prisma.ticketMessage.create({
      data: { ticketId, userId, body, isAdmin: false },
    });
  }
}
