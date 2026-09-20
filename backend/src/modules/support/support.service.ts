import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { getTenantContext } from '../../common/context/tenant-context';
import { SupportSlaCron } from './support-sla.cron';
import type { CreateTicketDto, ListMyTicketsDto } from './dto/support.schemas';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, userId: string, dto: CreateTicketDto) {
    const now = new Date();
    const priority = dto.priority ?? 'MEDIUM';
    const ticket = await this.prisma.supportTicket.create({
      data: {
        tenantId,
        userId,
        subject: dto.subject,
        priority,
        slaDeadlineAt: SupportSlaCron.computeDeadline(priority, now),
        messages: {
          create: { userId, body: dto.body },
        },
      },
      include: { messages: true },
    });
    await this.audit(tenantId, userId, AuditAction.CREATE, 'SupportTicket', ticket.id, {
      subject: dto.subject,
      priority,
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
    if (!ticket) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.SUPPORT_TICKET_NOT_FOUND, 'Ticket introuvable');
    return ticket;
  }

  async addMessage(tenantId: string, ticketId: string, userId: string, body: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.SUPPORT_TICKET_NOT_FOUND, 'Ticket introuvable');

    const msg = await this.prisma.ticketMessage.create({
      data: { ticketId, userId, body, isAdmin: false },
    });
    await this.audit(tenantId, userId, AuditAction.MESSAGE, 'SupportTicket', ticketId, {});
    return msg;
  }

  private async audit(
    tenantId: string,
    userId: string,
    action: AuditAction,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          action,
          entityType,
          entityId,
          metadata: metadata as any,
          ip: getTenantContext()?.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Audit log write failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
