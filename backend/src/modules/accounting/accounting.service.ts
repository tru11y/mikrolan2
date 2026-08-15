import { Injectable } from '@nestjs/common';
import { VoucherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../common/context/tenant-context';

export interface RevenueByPeriodItem {
  month: string;
  year: number;
  monthNum: number;
  totalXof: number;
  transactionCount: number;
}

export interface RevenueByRouterItem {
  routerId: string;
  routerName: string;
  totalXof: number;
  transactionCount: number;
}

export interface InvoiceItem {
  id: string;
  number: string;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE';
  subtotalXof: number;
  taxXof: number;
  totalXof: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  createdAt: string;
}

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

@Injectable()
export class AccountingService {
  constructor(private readonly prisma: PrismaService) {}

  async revenueByPeriod(months: number): Promise<RevenueByPeriodItem[]> {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        status: { in: [VoucherStatus.USED, VoucherStatus.ACTIVE] },
        usedAt: { gte: since },
      },
      select: {
        usedAt: true,
        plan: { select: { priceXof: true } },
      },
    });

    const buckets = new Map<string, RevenueByPeriodItem>();

    for (const v of vouchers) {
      const d = v.usedAt!;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const entry = buckets.get(key) ?? {
        month: MONTH_NAMES[d.getMonth()],
        year: d.getFullYear(),
        monthNum: d.getMonth() + 1,
        totalXof: 0,
        transactionCount: 0,
      };
      entry.totalXof += v.plan.priceXof;
      entry.transactionCount += 1;
      buckets.set(key, entry);
    }

    return [...buckets.values()].sort(
      (a, b) => a.year - b.year || a.monthNum - b.monthNum,
    );
  }

  async revenueByRouter(from?: string, to?: string): Promise<RevenueByRouterItem[]> {
    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to);

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        status: { in: [VoucherStatus.USED, VoucherStatus.ACTIVE] },
        ...(Object.keys(dateFilter).length ? { usedAt: dateFilter } : {}),
      },
      select: {
        routerId: true,
        router: { select: { identity: true, alias: true } },
        plan: { select: { priceXof: true } },
      },
    });

    const buckets = new Map<string, RevenueByRouterItem>();

    for (const v of vouchers) {
      const entry = buckets.get(v.routerId) ?? {
        routerId: v.routerId,
        routerName: v.router.alias || v.router.identity,
        totalXof: 0,
        transactionCount: 0,
      };
      entry.totalXof += v.plan.priceXof;
      entry.transactionCount += 1;
      buckets.set(v.routerId, entry);
    }

    return [...buckets.values()].sort((a, b) => b.totalXof - a.totalXof);
  }

  async invoices(page: number, limit: number) {
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          amount: true,
          status: true,
          paidAt: true,
          createdAt: true,
          billingPeriod: true,
          periodDays: true,
          idempotencyKey: true,
        },
      }),
      this.prisma.invoice.count(),
    ]);

    return {
      items: items.map((inv, idx) => this.toInvoiceItem(inv, total - (page - 1) * limit - idx)),
      total,
      page,
      limit,
    };
  }

  async generateInvoice(periodStart: string, periodEnd: string): Promise<InvoiceItem> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        status: { in: [VoucherStatus.USED, VoucherStatus.ACTIVE] },
        usedAt: { gte: start, lte: end },
      },
      select: { plan: { select: { priceXof: true } } },
    });

    const subtotal = vouchers.reduce((s, v) => s + v.plan.priceXof, 0);

    const invoice = await this.prisma.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        amount: subtotal,
        status: 'PENDING',
        periodDays: Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
        idempotencyKey: `inv-${ctx.tenantId}-${periodStart}-${periodEnd}`,
      },
      select: {
        id: true,
        amount: true,
        status: true,
        paidAt: true,
        createdAt: true,
        billingPeriod: true,
        periodDays: true,
        idempotencyKey: true,
      },
    });

    return {
      id: invoice.id,
      number: `INV-${invoice.createdAt.getFullYear()}-${String(1).padStart(4, '0')}`,
      status: 'DRAFT',
      subtotalXof: subtotal,
      taxXof: 0,
      totalXof: subtotal,
      periodStart,
      periodEnd,
      dueDate: null,
      createdAt: invoice.createdAt.toISOString(),
    };
  }

  private toInvoiceItem(
    inv: {
      id: string;
      amount: number;
      status: string;
      paidAt: Date | null;
      createdAt: Date;
      billingPeriod: string;
      periodDays: number;
      idempotencyKey: string;
    },
    seqNum: number,
  ): InvoiceItem {
    const start = new Date(inv.createdAt);
    start.setDate(start.getDate() - inv.periodDays);

    const statusMap: Record<string, InvoiceItem['status']> = {
      PENDING: 'DRAFT',
      PAID: 'PAID',
      FAILED: 'OVERDUE',
      REFUNDED: 'PAID',
    };

    return {
      id: inv.id,
      number: `INV-${inv.createdAt.getFullYear()}-${String(seqNum).padStart(4, '0')}`,
      status: statusMap[inv.status] ?? 'DRAFT',
      subtotalXof: inv.amount,
      taxXof: 0,
      totalXof: inv.amount,
      periodStart: start.toISOString(),
      periodEnd: inv.createdAt.toISOString(),
      dueDate: null,
      createdAt: inv.createdAt.toISOString(),
    };
  }
}
