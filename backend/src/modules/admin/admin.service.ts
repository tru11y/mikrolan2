import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
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
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/redis/cache.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { monthlyPrice } from '../subscriptions/tiers.service';
import type {
  ListAuditQueryDto,
  ListFleetQueryDto,
  ListInvoicesQueryDto,
  ListTenantsQueryDto,
  ListTenantRoutersQueryDto,
  ListTicketsQueryDto,
  ListUsersQueryDto,
  RejectInvoiceDto,
  PatchSubscriptionDto,
  SetTenantStatusDto,
  SetTicketStatusDto,
  SetUserStatusDto,
  UpdateConfigDto,
  ValidateInvoiceDto,
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
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly cache: CacheService,
    private readonly remoteRouter: RemoteRouterService,
  ) {}

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
            routerLimitOverride: true,
            userLimitOverride: true,
            voucherLimitOverride: true,
            tier: { select: { key: true, name: true, monthlyXof: true, routerLimit: true, userLimit: true, voucherMonthlyLimit: true } },
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
    if (!tenant) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.TENANT_NOT_FOUND, 'Compte introuvable');
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
    if (!tenant) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.TENANT_NOT_FOUND, 'Compte introuvable');
    if (id === actor.tenantId) {
      throw new BusinessException(HttpStatus.FORBIDDEN, ErrorCode.ADMIN_SELF_SUSPEND, 'Impossible de suspendre son propre compte.');
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
    if (!user) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.USER_NOT_FOUND, 'Utilisateur introuvable');
    if (user.id === actor.userId) {
      throw new BusinessException(HttpStatus.FORBIDDEN, ErrorCode.ADMIN_SELF_MODIFY, 'Impossible de modifier son propre compte.');
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new BusinessException(HttpStatus.FORBIDDEN, ErrorCode.ADMIN_SELF_MODIFY, 'Le statut d\'un administrateur plateforme ne se modifie pas ici.');
    }
    if (user.status === UserStatus.DELETED) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.USER_DELETED, 'Ce compte a été supprimé par son titulaire.');
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

    const [
      routersOffline,
      routersDegraded,
      openTickets,
      overdueTickets,
      activeSessions,
    ] = await Promise.all([
      this.prisma.router.count({
        where: { deletedAt: null, health: RouterHealth.OFFLINE },
      }),
      this.prisma.router.count({
        where: { deletedAt: null, health: 'DEGRADED' as RouterHealth },
      }),
      this.prisma.supportTicket.count({
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      this.prisma.supportTicket.count({
        where: {
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          slaDeadlineAt: { lt: now },
        },
      }),
      this.prisma.session.count({ where: { status: 'ACTIVE' } }),
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
      routers: {
        total: routersTotal,
        online: routersOnline,
        offline: routersOffline,
        degraded: routersDegraded,
      },
      vouchers30d: { generated: vouchersGenerated, activated: vouchersActivated },
      sessions: { active: activeSessions },
      support: { open: openTickets, overdue: overdueTickets },
      generatedAt: now.toISOString(),
    };
  }

  // ── Journal d'audit (lecture seule) ────────────────────

  async listAudit(query: ListAuditQueryDto): Promise<Page<unknown>> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.errorCode
          ? { metadata: { path: ['errorCode'], equals: query.errorCode } }
          : {}),
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
        user: { select: { name: true, email: true } },
      },
    });

    return this.paginate(rows, query.limit, (a) => ({
      id: a.id,
      tenantId: a.tenantId,
      tenantName: a.tenant.name,
      userId: a.userId,
      userName: a.user?.name ?? a.user?.email ?? null,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      metadata: a.metadata,
      ip: a.ip,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  // ── Routeurs d'un tenant ────────────────────────────────

  async listTenantRouters(tenantId: string, query: ListTenantRoutersQueryDto): Promise<Page<unknown>> {
    const rows = await this.prisma.router.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        identity: true,
        alias: true,
        model: true,
        localAddress: true,
        mode: true,
        health: true,
        lastHeartbeat: true,
        createdAt: true,
      },
    });
    return this.paginate(rows, query.limit, (r) => r);
  }

  // ── Validation / rejet de facture ─────────────────────

  async validateInvoice(
    invoiceId: string,
    actor: { userId: string; tenantId: string },
    dto: ValidateInvoiceDto,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.INVOICE_NOT_FOUND, 'Facture introuvable');
    if (invoice.status !== 'PENDING') {
      throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.INVOICE_NOT_PENDING, 'Cette facture n\'est pas en attente.');
    }

    const periodDays = dto.months
      ? dto.months * 30
      : dto.periodDays ?? invoice.periodDays;

    await this.subscriptions.activate(
      invoice.tenantId,
      actor.userId,
      periodDays,
      invoiceId,
    );

    return { validated: true };
  }

  async rejectInvoice(
    invoiceId: string,
    actor: { userId: string; tenantId: string },
    dto: RejectInvoiceDto,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.INVOICE_NOT_FOUND, 'Facture introuvable');
    if (invoice.status !== 'PENDING') {
      throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.INVOICE_NOT_PENDING, 'Cette facture n\'est pas en attente.');
    }

    const notification = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.invoice.updateMany({
        where: { id: invoiceId, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      if (claimed.count === 0) {
        throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.INVOICE_CONCURRENT, 'Cette facture a déjà été traitée (validation concurrente).');
      }
      return tx.notification.create({
        data: {
          tenantId: invoice.tenantId,
          type: 'PAYMENT_REJECTED',
          title: 'Paiement refusé',
          body: dto.reason,
        },
      });
    });
    this.notifications.sendPushToTenant(
      invoice.tenantId,
      'Paiement refusé',
      dto.reason,
      null,
      { notificationId: notification.id, type: 'PAYMENT_REJECTED' },
    );

    await this.audit(
      invoice.tenantId,
      actor.userId,
      AuditAction.REJECT,
      'Invoice',
      invoiceId,
      { reason: dto.reason },
    );

    return { rejected: true };
  }

  // ── Subscription override (P0-04 / P0-08) ─────────────

  async patchSubscription(
    tenantId: string,
    actor: { userId: string },
    dto: PatchSubscriptionDto,
  ) {
    const sub = await this.prisma.subscription.findUnique({
      where: { tenantId },
    });
    if (!sub) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.SUBSCRIPTION_NOT_FOUND, 'Abonnement introuvable');

    if (dto.tierId) {
      const tier = await this.prisma.subscriptionTier.findUnique({
        where: { id: dto.tierId },
      });
      if (!tier) throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.TIER_NOT_FOUND, 'Formule introuvable');
    }

    const updated = await this.prisma.subscription.update({
      where: { tenantId },
      data: {
        ...(dto.plan !== undefined && { plan: dto.plan }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.tierId !== undefined && { tierId: dto.tierId }),
        ...(dto.billingPeriod !== undefined && { billingPeriod: dto.billingPeriod }),
        ...(dto.currentPeriodEnd !== undefined && { currentPeriodEnd: dto.currentPeriodEnd }),
        ...(dto.routerLimitOverride !== undefined && { routerLimitOverride: dto.routerLimitOverride }),
        ...(dto.userLimitOverride !== undefined && { userLimitOverride: dto.userLimitOverride }),
        ...(dto.voucherLimitOverride !== undefined && { voucherLimitOverride: dto.voucherLimitOverride }),
      },
    });

    await this.audit(
      tenantId,
      actor.userId,
      AuditAction.UPDATE,
      'Subscription',
      sub.id,
      dto as unknown as Prisma.InputJsonValue,
    );

    return updated;
  }

  async getInvoiceProofs(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        amount: true,
        status: true,
        tenantId: true,
        tenant: { select: { name: true } },
        proofs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!invoice) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.INVOICE_NOT_FOUND, 'Facture introuvable');
    return invoice;
  }

  // ── Tickets SAV (vue admin) ───────────────────────────

  async listTickets(query: ListTicketsQueryDto): Promise<Page<unknown>> {
    const rows = await this.prisma.supportTicket.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      },
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
        tenant: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, name: true } },
        _count: { select: { messages: true } },
      },
    });
    return this.paginate(rows, query.limit, (t) => t);
  }

  async getTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      select: {
        id: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        tenant: { select: { id: true, name: true } },
        user: { select: { id: true, email: true, name: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            body: true,
            imageUrl: true,
            isAdmin: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!ticket) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.SUPPORT_TICKET_NOT_FOUND, 'Ticket introuvable');
    return ticket;
  }

  async replyToTicket(ticketId: string, userId: string, body: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.SUPPORT_TICKET_NOT_FOUND, 'Ticket introuvable');

    const notifBody = body.length > 100 ? `${body.slice(0, 99)}…` : body;
    const [message, , notification] = await this.prisma.$transaction([
      this.prisma.ticketMessage.create({
        data: { ticketId, userId, body, isAdmin: true },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'IN_PROGRESS' },
      }),
      this.prisma.notification.create({
        data: {
          tenantId: ticket.tenantId,
          type: 'TICKET_REPLY',
          title: 'Réponse du support',
          body: notifBody,
        },
      }),
    ]);
    this.notifications.sendPushToTenant(
      ticket.tenantId,
      'Réponse du support',
      notifBody,
      null,
      { notificationId: notification.id, type: 'TICKET_REPLY', ticketId },
    );
    return message;
  }

  async setTicketStatus(id: string, dto: SetTicketStatusDto) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.SUPPORT_TICKET_NOT_FOUND, 'Ticket introuvable');
    return this.prisma.supportTicket.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.status === 'CLOSED' || dto.status === 'RESOLVED'
          ? { closedAt: new Date() }
          : {}),
      },
    });
  }

  // ── Audit sécurité ────────────────────────────────────

  async securityAudit() {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      superAdminCount,
      recentLogins,
      suspendedUsers,
      routersWithoutCreds,
      sensitiveActions,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } }),
      this.prisma.auditLog.count({
        where: { action: 'LOGIN', createdAt: { gte: last24h } },
      }),
      this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.router.count({
        where: { deletedAt: null, mode: 'REMOTE', credEncrypted: null },
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: { in: ['DELETE', 'SUSPEND', 'REVOKE'] },
          createdAt: { gte: last24h },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          action: true,
          entityType: true,
          entityId: true,
          userId: true,
          ip: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      superAdmins: superAdminCount,
      loginsLast24h: recentLogins,
      suspendedUsers,
      routersRemoteWithoutCreds: routersWithoutCreds,
      sensitiveActionsLast24h: sensitiveActions,
      generatedAt: now.toISOString(),
    };
  }

  // ── Config plateforme ─────────────────────────────────

  async getConfig(): Promise<Record<string, string>> {
    const rows = await this.prisma.platformConfig.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async updateConfig(dto: UpdateConfigDto): Promise<Record<string, string>> {
    const ops = Object.entries(dto).map(([key, value]) =>
      this.prisma.platformConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }),
    );
    await this.prisma.$transaction(ops);
    return this.getConfig();
  }

  // ── Fleet (vue cross-tenant des routeurs payants) ──────

  async listFleet(query: ListFleetQueryDto): Promise<Page<unknown>> {
    const where: Prisma.RouterWhereInput = {
      deletedAt: null,
      tenant: {
        subscription: { plan: SubscriptionPlan.PRO, status: SubscriptionStatus.ACTIVE },
      },
      ...(query.health ? { health: query.health } : {}),
      ...(query.q
        ? {
            OR: [
              { identity: { contains: query.q, mode: 'insensitive' as const } },
              { alias: { contains: query.q, mode: 'insensitive' as const } },
              { tenant: { name: { contains: query.q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.router.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
      select: {
        id: true,
        identity: true,
        alias: true,
        model: true,
        mode: true,
        health: true,
        lastSyncAt: true,
        lastSyncError: true,
        syncFailCount: true,
        createdAt: true,
        tenant: { select: { id: true, name: true, slug: true } },
        remotePeer: { select: { status: true, wgIp: true } },
        telemetry: {
          orderBy: { collectedAt: 'desc' as const },
          take: 1,
          select: {
            cpuPercent: true,
            ramUsedMb: true,
            ramTotalMb: true,
            uptime: true,
            rosVersion: true,
            boardName: true,
            hotspotActive: true,
            lastErrors: true,
            health: true,
            collectedAt: true,
          },
        },
      },
    });

    return this.paginate(rows, query.limit, (r) => ({
      ...r,
      telemetry: r.telemetry[0] ?? null,
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

  // ── Revenue history (P0-05) ─────────────────────────────

  async revenueHistory(months: number) {
    const since = new Date();
    since.setMonth(since.getMonth() - Math.min(months, 120));

    const invoices = await this.prisma.invoice.findMany({
      where: { status: 'PAID', paidAt: { gte: since } },
      select: { amount: true, paidAt: true, currency: true },
      orderBy: { paidAt: 'asc' },
    });

    const byMonth: Record<string, { total: number; count: number }> = {};
    for (const inv of invoices) {
      if (!inv.paidAt) continue;
      const key = `${inv.paidAt.getFullYear()}-${String(inv.paidAt.getMonth() + 1).padStart(2, '0')}`;
      const entry = byMonth[key] ??= { total: 0, count: 0 };
      entry.total += inv.amount;
      entry.count += 1;
    }

    return Object.entries(byMonth).map(([month, data]) => ({
      month,
      ...data,
    }));
  }

  // ── Billing Audit (P0-07) ─────────────────────────────

  async billingAudit() {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);

    const [expiredButActive, paidWithoutPro, stalePending] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: { lt: now },
        },
        select: { id: true, tenantId: true, currentPeriodEnd: true, tenant: { select: { name: true } } },
      }),
      this.prisma.$queryRaw<Array<{ id: string; tenantId: string; amount: number; paidAt: Date }>>`
        SELECT i.id, i."tenantId", i.amount, i."paidAt"
        FROM "Invoice" i
        JOIN "Subscription" s ON s."tenantId" = i."tenantId"
        WHERE i.status = 'PAID'
          AND i."paidAt" > ${ninetyDaysAgo}
          AND s.plan != 'PRO'
      `,
      this.prisma.invoice.findMany({
        where: { status: 'PENDING', createdAt: { lt: ninetyDaysAgo } },
        select: { id: true, tenantId: true, amount: true, createdAt: true, tenant: { select: { name: true } } },
      }),
    ]);

    return { expiredButActive, paidWithoutPro, stalePending };
  }

  // ── Diagnostic Mode & Safe Reboot ─────────────────────

  private diagnosticKey(userId: string, routerId: string): string {
    return `diag:${userId}:${routerId}`;
  }

  private static readonly DIAGNOSTIC_TTL_SECONDS = 300; // 5 min

  async enterDiagnosticMode(
    tenantId: string,
    routerId: string,
    actor: { userId: string },
  ): Promise<{ confirmToken: string; expiresInSeconds: number }> {
    await this.prisma.router.findFirstOrThrow({
      where: { id: routerId, tenantId, deletedAt: null },
      select: { id: true },
    }).catch(() => { throw new BusinessException(HttpStatus.NOT_FOUND, ErrorCode.ROUTER_NOT_FOUND, 'Routeur introuvable'); });

    const confirmToken = randomUUID();
    await this.cache.set(
      this.diagnosticKey(actor.userId, routerId),
      { confirmToken, tenantId },
      AdminService.DIAGNOSTIC_TTL_SECONDS,
    );

    await this.audit(
      tenantId, actor.userId, AuditAction.DIAGNOSTIC_ENTER,
      'Router', routerId, { ttlSeconds: AdminService.DIAGNOSTIC_TTL_SECONDS },
    );

    return {
      confirmToken,
      expiresInSeconds: AdminService.DIAGNOSTIC_TTL_SECONDS,
    };
  }

  async confirmedReboot(
    tenantId: string,
    routerId: string,
    confirmToken: string,
    actor: { userId: string },
  ): Promise<{ rebooted: true }> {
    const key = this.diagnosticKey(actor.userId, routerId);
    const session = await this.cache.get<{ confirmToken: string; tenantId: string }>(key);

    if (!session || session.confirmToken !== confirmToken || session.tenantId !== tenantId) {
      throw new BusinessException(HttpStatus.FORBIDDEN, ErrorCode.SUBSCRIPTION_INACTIVE, 'Mode diagnostic inactif ou token invalide. Entrez en mode diagnostic d\'abord.');
    }

    await this.cache.del(key);

    await this.remoteRouter.adminReboot(tenantId, routerId);

    await this.audit(
      tenantId, actor.userId, AuditAction.REBOOT,
      'Router', routerId, { confirmedAt: new Date().toISOString() },
    );

    return { rebooted: true };
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
    } catch (err) {
      this.logger.warn(`Audit log write failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
