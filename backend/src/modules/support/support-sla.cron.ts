import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

const SLA_HOURS: Record<string, number> = {
  HIGH: 4,
  MEDIUM: 12,
  LOW: 48,
};

@Injectable()
export class SupportSlaCron {
  private readonly logger = new Logger(SupportSlaCron.name);

  @Cron(CronExpression.EVERY_5_MINUTES)
  async escalateOverdueTickets(): Promise<void> {
    const now = new Date();
    const overdue = await this.prisma.supportTicket.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        slaDeadlineAt: { not: null, lt: now },
        priority: { not: 'HIGH' },
      },
      select: { id: true, priority: true },
    });

    for (const ticket of overdue) {
      const newPriority = ticket.priority === 'LOW' ? 'MEDIUM' : 'HIGH';
      await this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { priority: newPriority as 'LOW' | 'MEDIUM' | 'HIGH' },
      });
      this.logger.warn(`Ticket ${ticket.id} escalated to ${newPriority}`);
    }
  }

  constructor(private readonly prisma: PrismaService) {}

  static computeDeadline(priority: string, createdAt: Date): Date {
    const hours = SLA_HOURS[priority] ?? 12;
    return new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
  }
}
