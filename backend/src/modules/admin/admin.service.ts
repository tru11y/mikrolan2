import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  BillingPeriod,
  Prisma,
  RouterHealth,
  SubscriptionPlan,
  SubscriptionStatus,
  TenantStatus,
  UserRole,
  UserStatus,
  VoucherStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { monthlyPrice } from '../subscriptions/tiers.service';
import type {
  ListAuditQueryDto,
  ListInvoicesQueryDto,
  ListTenantsQueryDto,
  ListUsersQueryDto,
  SetTenantStatusDto,
  SetUserStatusDto,
} from './dto/admin.schemas';

/**
 * Enveloppe de pagination. `nextCursor` vaut `null` quand la fin est atteinte,
 * ce qui évite au client d'avoir à comparer la taille du lot à la limite.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const DAY_MS = 86_400_000;

/**
 * Back-office de la plateforme.
 *
 * Toutes les lectures d'ici traversent volontairement l'isolation par tenant :
 * le middleware Prisma laisse passer un `SUPER_ADMIN` sans filtre
 * (`prisma.service.ts`). C'est le contrôleur, et lui seul, qui garantit que
 * personne d'autre n'atteint ces méthodes.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Comptes clients ────────────────────────────────────

  async listTenants(query: ListTenantsQueryDto): Promise<Page<unknown>> {
    const where: Prisma.TenantWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { slug: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.tenant.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        subscription: {
          select: {
            plan: true,
            status: true,
            currentPeriodEnd: true,
            tier: { select: { key: true, name: true } },
          },
        },
        _count: { select: { users: true, routers: true } },
      },
    });

    return this.paginate(rows, query.limit, (t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      plan: t.subscription?.plan ?? SubscriptionPlan.FREE,
      subscriptionStatus: t.subscription?.status ?? null,
      tierKey: t.subscription?.tier?.key ?? null,
      tierName: t.subscription?.tier?.name ?? null,
      currentPeriodEnd: t.subscription?.currentPeriodEnd?.toISOString() ?? null,
      userCount: t._count.users,
      routerCount: t._count.routers,
    }));
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        subscription: {
          select: {
            plan: true,
            status: true,
            billingPeriod: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            tier: { select: { key: true, name: true, monthlyXof: true } },
          },
        },
        users: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        // Count only — jamais la liste nominative des routeurs d'un tenant.
        // SUPER_ADMIN voit "combien", pas "lesquels" (isolation produit).
        _count: { select: { routers: true } },
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            billingPeriod: true,
            note: true,
            createdAt: true,
            paidAt: true,
            tier: { select: { key: true, name: true } },
          },
        },
      },
    });
    if (!tenant) throw new NotFoundException('Compte introuvable');
    return tenant;
  }

  async setTenantStatus(
    id: string,
    actor: { userId: string; tenantId: string },
    dto: SetTenantStatusDto,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, status: true, slug: true },
    });
    if (!tenant) throw new NotFoundException('Compte introuvable');
    // Suspendre le tenant de la plateforme reviendrait à se couper l'accès au
    // back-office depuis le back-office.
    if (id === actor.tenantId) {
      throw new ForbiddenException('Impossible de suspendre son propre compte.');
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { status: dto.status },
      select: { id: true, name: true, status: true },
    });

    // Suspension : on coupe les sessions ouvertes. Les jetons d'accès déjà
    // émis restent valides jusqu'à leur expiration (quelques minutes), mais
    // plus aucun ne peut être renouvelé.
    if (dto.status === TenantStatus.SUSPENDED) {
      await this.prisma.refreshToken.updateMany({
        where: { user: { tenantId: id }, revoked: false },
        data: { revoked: true },
      });
    }

    await this.audit(
      id,
      actor.userId,
      dto.status === TenantStatus.SUSPENDED
        ? AuditAction.SUSPEND
        : AuditAction.RESTORE,
      'Tenant',
      id,
      { reason: dto.reason ?? null },
    );

    return updated;
  }

  // ── Utilisateurs ───────────────────────────────────────

  async listUsers(query: ListUsersQueryDto): Promise<Page<unknown>> {
    const where: Prisma.UserWhereInput = {
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });

    return this.paginate(rows, query.limit, (u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      tenantId: u.tenant.id,
      tenantName: u.tenant.name,
    }));
  }

  async setUserStatus(
    id: string,
    actor: { userId: string },
    dto: SetUserStatusDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, tenantId: true, role: true, status: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.id === actor.userId) {
      throw new ForbiddenException('Impossible de modifier son propre compte.');
    }
    // Un administrateur de plateforme ne se désactive pas depuis l'API : la
    // seule sortie serait alors un accès direct à la base.
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Le statut d’un administrateur plateforme ne se modifie pas ici.',
      );
    }
    if (user.status === UserStatus.DELETED) {
      throw new BadRequestException('Ce compte a été supprimé par son titulaire.');
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: dto.status },
      select: { id: true, email: true, status: true },
    });

    if (dto.status === UserStatus.SUSPENDED) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revoked: false },
        data: { revoked: true },
      });
    }

    await this.audit(
      user.tenantId,
      actor.userId,
      dto.status === UserStatus.SUSPENDED
        ? AuditAction.SUSPEND
        : AuditAction.RESTORE,
      'User',
      id,
      { reason: dto.reason ?? null },
    );

    return updated;
  }

  // ── File des demandes d'activation ─────────────────────

  async listInvoices(query: ListInvoicesQueryDto): Promise<Page<unknown>> {
    const rows = await this.prisma.invoice.findMany({
      where: { status: query.status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        tenantId: true,
        amount: true,
        currency: true,
        status: true,
        billingPeriod: true,
        periodDays: true,
        note: true,
        createdAt: true,
        paidAt: true,
        tenant: { select: { name: true, slug: true } },
        tier: { select: { key: true, name: true } },
      },
    });

    return this.paginate(rows, query.limit, (i) => ({
      id: i.id,
      tenantId: i.tenantId,
      tenantName: i.tenant.name,
      amount: i.amount,
      currency: i.currency,
      status: i.status,
      billingPeriod: i.billingPeriod,
      periodDays: i.periodDays,
      // C'est le résumé laissé par le conseiller d'abonnement : il dit à
      // l'administrateur *pourquoi* le client demande cette formule.
      note: i.note,
      tierKey: i.tier?.key ?? null,
      tierName: i.tier?.name ?? null,
      createdAt: i.createdAt.toISOString(),
      paidAt: i.paidAt?.toISOString() ?? null,
    }));
  }

  // ── Chiffres de la plateforme ──────────────────────────

  /**
   * Le revenu récurrent se calcule sur les abonnements actifs ramenés au mois,
   * jamais sur les factures : une facture annuelle encaisserait douze mois d'un
   * coup et ferait bondir la courbe sans que rien n'ait changé.
   */
  async metrics() {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * DAY_MS);
    const last30 = new Date(now.getTime() - 30 * DAY_MS);

    const [
      tenantsTotal,
      tenantsSuspended,
      activeSubs,
      trialing,
      trialsExpiring,
      pendingInvoices,
      routersTotal,
      routersOnline,
      vouchersGenerated,
      vouchersActivated,
    ] = await Promise.all([
      this.prisma.tenant.count({ where: { deletedAt: null } }),
      this.prisma.tenant.count({
        where: { deletedAt: null, status: TenantStatus.SUSPENDED },
      }),
      this.prisma.subscription.findMany({
        where: {
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: { gt: now },
        },
        select: {
          billingPeriod: true,
          tier: true,
        },
      }),
      this.prisma.subscription.count({
        where: {
          status: SubscriptionStatus.TRIALING,
          currentPeriodEnd: { gt: now },
        },
      }),
      this.prisma.subscription.count({
        where: {
          status: SubscriptionStatus.TRIALING,
          currentPeriodEnd: { gt: now, lte: in7Days },
        },
      }),
      this.prisma.invoice.count({ where: { status: 'PENDING' } }),
      this.prisma.router.count({ where: { deletedAt: null } }),
      this.prisma.router.count({
        where: { deletedAt: null, health: RouterHealth.ONLINE },
      }),
      this.prisma.voucher.count({ where: { createdAt: { gte: last30 } } }),
      this.prisma.voucher.count({
        where: { usedAt: { gte: last30 }, status: { not: VoucherStatus.REVOKED } },
      }),
    ]);

    const mrrXof = activeSubs.reduce((sum, sub) => {
      if (!sub.tier) return sum;
      return sum + monthlyPrice(sub.tier, sub.billingPeriod ?? BillingPeriod.MONTHLY);
    }, 0);

    // Un abonnement actif sans formule vient d'une activation faite avant la
    // mise en place de la grille : le signaler plutôt que de fausser le MRR.
    const untieredActive = activeSubs.filter((s) => !s.tier).length;

    return {
      tenants: {
        total: tenantsTotal,
        pro: activeSubs.length,
        trialing,
        suspended: tenantsSuspended,
        locked: Math.max(0, tenantsTotal - activeSubs.length - trialing),
      },
      revenue: { mrrXof, currency: 'XOF', untieredActive },
      trialsExpiringIn7Days: trialsExpiring,
      pendingInvoices,
      routers: { total: routersTotal, online: routersOnline },
      vouchers30d: { generated: vouchersGenerated, activated: vouchersActivated },
      generatedAt: now.toISOString(),
    };
  }

  // ── Journal d'audit (lecture seule) ────────────────────

  async listAudit(query: ListAuditQueryDto): Promise<Page<unknown>> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        ...(query.action ? { action: query.action } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        tenantId: true,
        userId: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        ip: true,
        createdAt: true,
        tenant: { select: { name: true } },
      },
    });

    return this.paginate(rows, query.limit, (a) => ({
      id: a.id,
      tenantId: a.tenantId,
      tenantName: a.tenant.name,
      userId: a.userId,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      metadata: a.metadata,
      ip: a.ip,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  // ── Interne ────────────────────────────────────────────

  /** On demande `limit + 1` lignes : la surnuméraire dit qu'il reste une page. */
  private paginate<Row extends { id: string }, Out>(
    rows: Row[],
    limit: number,
    project: (row: Row) => Out,
  ): Page<Out> {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: page.map(project),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  private async audit(
    tenantId: string,
    userId: string,
    action: AuditAction,
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: { tenantId, userId, action, entityType, entityId, metadata },
      });
    } catch {
      // Append-only et jamais bloquant : un échec d'audit ne doit pas annuler
      // la décision d'administration qui vient d'être prise.
    }
  }
}
