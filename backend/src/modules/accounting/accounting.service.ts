import { Injectable } from '@nestjs/common';
import { VoucherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../common/context/tenant-context';
import { RevenueService, type ActivationLine, type RevenueDataQuality } from '../revenue/revenue.service';

export interface RevenueByPeriodItem {
  month: string;
  year: number;
  monthNum: number;
  totalXof: number;
  transactionCount: number;
  // Qualité du revenu — ajoutés audit/55, corrige audit/54 §7.
  exactXof: number;
  estimatedXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
}

export interface RevenueByRouterItem {
  routerId: string;
  routerName: string;
  totalXof: number;
  transactionCount: number;
  exactXof: number;
  estimatedXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: RevenueService,
  ) {}

  /**
   * Revenu hotspot par mois glissant. Passe désormais par
   * RevenueService.listActivations (audit/51, audit/52, audit/55) — même
   * règle EXACT/ESTIMATED/UNKNOWN/INVALID_SOURCE que le dashboard global,
   * jamais un recalcul indépendant du montant. Chaque bucket mensuel expose
   * sa propre qualité (audit/54 §7 : ces indicateurs étaient calculés puis
   * perdus, désormais exposés par groupe).
   */
  async revenueByPeriod(months: number): Promise<RevenueByPeriodItem[]> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');

    const since = new Date();
    since.setMonth(since.getMonth() - months);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const activations = await this.revenue.listActivations({
      tenantId: ctx.tenantId,
      from: since,
      to: new Date(),
    });

    const byMonth = new Map<string, ActivationLine[]>();
    const meta = new Map<string, { year: number; monthNum: number }>();
    for (const a of activations) {
      const d = a.usedAt;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const lines = byMonth.get(key) ?? [];
      lines.push(a);
      byMonth.set(key, lines);
      meta.set(key, { year: d.getFullYear(), monthNum: d.getMonth() + 1 });
    }

    const items: RevenueByPeriodItem[] = [];
    for (const [key, lines] of byMonth) {
      const q = this.revenue.summarizeQuality(lines);
      const { year, monthNum } = meta.get(key)!;
      items.push({
        month: MONTH_NAMES[monthNum - 1],
        year,
        monthNum,
        totalXof: q.exactRevenueXof + q.estimatedRevenueXof,
        transactionCount: lines.filter((l) => l.xof !== null).length,
        exactXof: q.exactRevenueXof,
        estimatedXof: q.estimatedRevenueXof,
        unknownSalesCount: q.unknownSalesCount,
        invalidSourceCount: q.invalidSourceCount,
        dataQuality: q.dataQuality,
      });
    }

    return items.sort((a, b) => a.year - b.year || a.monthNum - b.monthNum);
  }

  async revenueByRouter(from?: string, to?: string): Promise<RevenueByRouterItem[]> {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('Contexte tenant manquant');

    const activations = await this.revenue.listActivations({
      tenantId: ctx.tenantId,
      from: from ? new Date(from) : new Date(0),
      to: to ? new Date(to) : new Date(),
    });

    const routerIds = [...new Set(activations.map((a) => a.routerId))];
    const routers = await this.prisma.router.findMany({
      where: { id: { in: routerIds } },
      select: { id: true, identity: true, alias: true },
    });
    const routerName = new Map(routers.map((r) => [r.id, r.alias || r.identity]));

    const byRouter = new Map<string, ActivationLine[]>();
    for (const a of activations) {
      const lines = byRouter.get(a.routerId) ?? [];
      lines.push(a);
      byRouter.set(a.routerId, lines);
    }

    const items: RevenueByRouterItem[] = [];
    for (const [routerId, lines] of byRouter) {
      const q = this.revenue.summarizeQuality(lines);
      items.push({
        routerId,
        routerName: routerName.get(routerId) ?? routerId,
        totalXof: q.exactRevenueXof + q.estimatedRevenueXof,
        transactionCount: lines.filter((l) => l.xof !== null).length,
        exactXof: q.exactRevenueXof,
        estimatedXof: q.estimatedRevenueXof,
        unknownSalesCount: q.unknownSalesCount,
        invalidSourceCount: q.invalidSourceCount,
        dataQuality: q.dataQuality,
      });
    }

    return items.sort((a, b) => b.totalXof - a.totalXof);
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
