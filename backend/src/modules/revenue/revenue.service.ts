import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { UserRole, VoucherStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../common/context/tenant-context';
import { resolveTenantTimezone } from './timezone.util';

/**
 * Définition canonique unique du chiffre d'affaires hotspot MikroLan.
 * Voir audit/51-revenue-business-rule-and-data-foundation.md (règle métier),
 * audit/52-historical-revenue-data-assessment.md (validation sur données
 * réelles) et audit/54-revenue-foundation-independent-review.md (défauts
 * corrigés ici — audit/55). Ne JAMAIS dupliquer cette logique ailleurs —
 * metrics/accounting doivent appeler ce service, pas reconstruire leur
 * propre calcul.
 *
 * Règles non négociables :
 * - statut ACTIVE ou USED, usedAt non nul, usedAt dans la période demandée ;
 * - jamais createdAt pour attribuer le revenu à une période ;
 * - jamais Invoice (système SaaS tenant→plateforme, un métier différent) ;
 * - montant = Voucher.priceXofAtActivation quand disponible (snapshot figé),
 *   jamais Plan.priceXof courant pour un voucher qui a déjà un snapshot ;
 * - un voucher activé avant la migration n'a pas de snapshot : son montant
 *   est reconstruit au prix courant du plan et classé ESTIMATED, jamais
 *   présenté comme EXACT ;
 * - `query.tenantId` est TOUJOURS injecté explicitement dans le `where` de
 *   chaque requête Voucher — jamais une confiance exclusive dans le
 *   middleware Prisma/AsyncLocalStorage (audit/54 §6.1). Le service ne fait
 *   pas non plus confiance à l'appelant : il revérifie lui-même la
 *   cohérence entre `query.tenantId` et le contexte ambiant (§ci-dessous).
 *
 * Contrat de cohérence contexte/paramètre (audit/54 §6.1, corrigé audit/55) :
 * - Aucun contexte tenant ouvert → échec sûr (`ForbiddenException`). Il
 *   n'existe aujourd'hui aucun appelant interne légitime sans contexte
 *   (metrics/accounting exigent déjà un contexte avant d'appeler ce
 *   service) — un appel sans contexte est donc toujours une erreur.
 * - Contexte tenant normal (OWNER/ADMIN/MEMBER) → `query.tenantId` DOIT
 *   être strictement égal à `ctx.tenantId`. Un écart est traité comme une
 *   tentative (accidentelle ou non) de cibler un autre tenant → échec sûr.
 * - SUPER_ADMIN (bypass actif ou non) → `query.tenantId` reste obligatoire
 *   et n'a pas besoin d'égaler un tenant "courant" (un SUPER_ADMIN n'a pas
 *   de tenant propre) ; il est injecté explicitement dans le `where` posé
 *   par CE service.
 *
 *   ATTENTION (audit/56 §2, démontré par test réel audit/57 étape 7) : si le
 *   bypass admin (`AdminBypassInterceptor`/`isAdminBypass()`) n'est PAS actif
 *   sur la requête, le middleware Prisma (`prisma.service.ts`) réapplique
 *   ENSUITE son propre `tenantId: ctx.tenantId` par-dessus le `where`, ce qui
 *   écrase silencieusement le `tenantId` explicite posé ici — le résultat
 *   final serait alors scopé sur le tenant de l'admin, PAS sur celui demandé.
 *   Aucune route HTTP actuelle (Metrics/Accounting sourcent toujours
 *   `tenantId` depuis `ctx.tenantId`, jamais d'un paramètre client) n'exerce
 *   ce chemin aujourd'hui — mais toute future route admin exposant un
 *   ciblage tenant explicite DOIT câbler `AdminBypassInterceptor`, sous
 *   peine que cette garantie ne soit pas réelle. Non corrigé dans cette
 *   phase (hors périmètre) — voir audit/57 pour le suivi requis.
 */

export type RevenueDataSource =
  | 'EXACT'
  | 'ESTIMATED_FROM_CURRENT_PLAN_PRICE'
  | 'UNKNOWN'
  | 'INVALID_SOURCE';

export interface RevenueQuery {
  tenantId: string;
  from: Date;
  to: Date;
  routerId?: string;
  planId?: string;
}

/** Liste fermée — audit/54 §7, corrigé audit/55 étape 6. */
export type RevenueDataQuality = 'EXACT' | 'ESTIMATED' | 'MIXED' | 'INCOMPLETE' | 'NO_DATA';

export interface RevenueResult {
  revenueXof: number;
  salesCount: number;
  valuedSalesCount: number;
  averageSaleXof: number;
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
  period: { from: string; to: string };
  timezone: string;
  lastCalculatedAt: string;
}

export interface PlanRevenueItem {
  planId: string;
  planName: string;
  sold: number;
  revenueXof: number;
  exactRevenueXof: number;
  estimatedRevenueXof: number;
  unknownSalesCount: number;
  invalidSourceCount: number;
  dataQuality: RevenueDataQuality;
}

interface ValuedLine {
  xof: number | null;
  source: RevenueDataSource;
}

/** Une ligne classifiée par {@link RevenueService.listActivations}. */
export interface ActivationLine {
  usedAt: Date;
  routerId: string;
  planId: string;
  xof: number | null;
  source: RevenueDataSource;
}

const logger = new Logger('RevenueService');

@Injectable()
export class RevenueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Vérifie que l'appelant a le droit de lire les vouchers de
   * `query.tenantId` avant toute requête — jamais une confiance exclusive
   * dans le middleware Prisma (audit/54 §6.1). Lève `ForbiddenException`
   * (échec sûr) plutôt que de laisser passer une requête ambiguë.
   */
  private assertTenantAccess(tenantId: string): void {
    if (!tenantId) {
      throw new ForbiddenException('RevenueService: tenantId requis.');
    }
    const ctx = getTenantContext();
    if (!ctx) {
      throw new ForbiddenException('RevenueService: aucun contexte tenant ouvert.');
    }
    if (ctx.role === UserRole.SUPER_ADMIN) {
      // SUPER_ADMIN n'a pas de tenant propre — le tenantId explicite EST la
      // cible légitime, avec ou sans bypass actif sur ce contexte : le
      // filtre explicite ci-dessous (§ toutes les requêtes voucher) scope
      // quand même le résultat, que le middleware filtre ou non en plus.
      return;
    }
    if (ctx.tenantId !== tenantId) {
      logger.warn(
        'RevenueService: tenantId demandé différent du contexte actif — requête refusée.',
      );
      throw new ForbiddenException('RevenueService: tenantId incohérent avec le contexte.');
    }
  }

  async computeRevenue(query: RevenueQuery): Promise<RevenueResult> {
    this.assertTenantAccess(query.tenantId);
    const { tenantId, from, to, routerId, planId } = query;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timezone = resolveTenantTimezone(tenant?.timezone);

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        tenantId,
        status: { in: [VoucherStatus.ACTIVE, VoucherStatus.USED] },
        usedAt: { gte: from, lt: to, not: null },
        ...(routerId ? { routerId } : {}),
        ...(planId ? { planId } : {}),
      },
      select: {
        priceXofAtActivation: true,
        priceSnapshotSource: true,
        plan: { select: { priceXof: true } },
      },
    });

    let exactRevenueXof = 0;
    let estimatedRevenueXof = 0;
    let unknownSalesCount = 0;
    let invalidSourceCount = 0;
    let exactCount = 0;
    let estimatedCount = 0;

    for (const v of vouchers) {
      const line = this.valueLine(v.priceXofAtActivation, v.priceSnapshotSource, v.plan?.priceXof);
      if (line.source === 'EXACT' && line.xof !== null) {
        exactRevenueXof += line.xof;
        exactCount += 1;
      } else if (line.source === 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' && line.xof !== null) {
        estimatedRevenueXof += line.xof;
        estimatedCount += 1;
      } else if (line.source === 'INVALID_SOURCE') {
        invalidSourceCount += 1;
      } else {
        unknownSalesCount += 1;
      }
    }

    const valuedSalesCount = exactCount + estimatedCount;
    const revenueXof = exactRevenueXof + estimatedRevenueXof;

    return {
      revenueXof,
      salesCount: vouchers.length,
      valuedSalesCount,
      averageSaleXof: valuedSalesCount > 0 ? Math.round(revenueXof / valuedSalesCount) : 0,
      exactRevenueXof,
      estimatedRevenueXof,
      unknownSalesCount,
      invalidSourceCount,
      dataQuality: this.dataQuality(exactCount, estimatedCount, unknownSalesCount, invalidSourceCount),
      period: { from: from.toISOString(), to: to.toISOString() },
      timezone,
      lastCalculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Toutes les activations classifiées (valorisées ou non) sur la période,
   * une ligne par voucher — pour que les appelants (accounting) puissent
   * grouper eux-mêmes (par mois, par routeur) tout en exposant la qualité
   * par groupe, sans dupliquer la classification définie une seule fois ici
   * (audit/55, corrige audit/54 §7 : la qualité était calculée puis perdue).
   */
  async listActivations(query: RevenueQuery): Promise<ActivationLine[]> {
    this.assertTenantAccess(query.tenantId);
    const { tenantId, from, to, routerId, planId } = query;

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        tenantId,
        status: { in: [VoucherStatus.ACTIVE, VoucherStatus.USED] },
        usedAt: { gte: from, lt: to, not: null },
        ...(routerId ? { routerId } : {}),
        ...(planId ? { planId } : {}),
      },
      select: {
        usedAt: true,
        routerId: true,
        planId: true,
        priceXofAtActivation: true,
        priceSnapshotSource: true,
        plan: { select: { priceXof: true } },
      },
    });

    return vouchers.map((v) => {
      const line = this.valueLine(v.priceXofAtActivation, v.priceSnapshotSource, v.plan?.priceXof);
      return {
        usedAt: v.usedAt as Date,
        routerId: v.routerId,
        planId: v.planId,
        xof: line.xof,
        source: line.source,
      };
    });
  }

  /**
   * Agrège la qualité d'un groupe de lignes déjà classifiées — helper public
   * pour que les appelants (accounting) réutilisent la même liste fermée de
   * statuts sans la redéfinir.
   */
  summarizeQuality(lines: ActivationLine[]): {
    exactRevenueXof: number;
    estimatedRevenueXof: number;
    unknownSalesCount: number;
    invalidSourceCount: number;
    dataQuality: RevenueDataQuality;
  } {
    let exactRevenueXof = 0;
    let estimatedRevenueXof = 0;
    let unknownSalesCount = 0;
    let invalidSourceCount = 0;
    let exactCount = 0;
    let estimatedCount = 0;

    for (const line of lines) {
      if (line.source === 'EXACT' && line.xof !== null) {
        exactRevenueXof += line.xof;
        exactCount += 1;
      } else if (line.source === 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' && line.xof !== null) {
        estimatedRevenueXof += line.xof;
        estimatedCount += 1;
      } else if (line.source === 'INVALID_SOURCE') {
        invalidSourceCount += 1;
      } else {
        unknownSalesCount += 1;
      }
    }

    return {
      exactRevenueXof,
      estimatedRevenueXof,
      unknownSalesCount,
      invalidSourceCount,
      dataQuality: this.dataQuality(exactCount, estimatedCount, unknownSalesCount, invalidSourceCount),
    };
  }

  /** Même règle métier que computeRevenue, ventilée par forfait pour le dashboard. */
  async revenueByPlan(query: RevenueQuery): Promise<PlanRevenueItem[]> {
    this.assertTenantAccess(query.tenantId);
    const { tenantId, from, to, routerId, planId } = query;

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        tenantId,
        status: { in: [VoucherStatus.ACTIVE, VoucherStatus.USED] },
        usedAt: { gte: from, lt: to, not: null },
        ...(routerId ? { routerId } : {}),
        ...(planId ? { planId } : {}),
      },
      select: {
        priceXofAtActivation: true,
        priceSnapshotSource: true,
        plan: { select: { id: true, name: true, priceXof: true } },
      },
    });

    interface Acc {
      planName: string;
      sold: number;
      revenueXof: number;
      exactRevenueXof: number;
      estimatedRevenueXof: number;
      unknownSalesCount: number;
      invalidSourceCount: number;
      exactCount: number;
      estimatedCount: number;
    }
    const byPlan = new Map<string, Acc>();

    for (const v of vouchers) {
      if (!v.plan) continue;
      const line = this.valueLine(v.priceXofAtActivation, v.priceSnapshotSource, v.plan.priceXof);
      const entry: Acc = byPlan.get(v.plan.id) ?? {
        planName: v.plan.name,
        sold: 0,
        revenueXof: 0,
        exactRevenueXof: 0,
        estimatedRevenueXof: 0,
        unknownSalesCount: 0,
        invalidSourceCount: 0,
        exactCount: 0,
        estimatedCount: 0,
      };

      if (line.source === 'EXACT' && line.xof !== null) {
        entry.exactRevenueXof += line.xof;
        entry.revenueXof += line.xof;
        entry.exactCount += 1;
        entry.sold += 1;
      } else if (line.source === 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' && line.xof !== null) {
        entry.estimatedRevenueXof += line.xof;
        entry.revenueXof += line.xof;
        entry.estimatedCount += 1;
        entry.sold += 1;
      } else if (line.source === 'INVALID_SOURCE') {
        entry.invalidSourceCount += 1;
      } else {
        entry.unknownSalesCount += 1;
      }
      byPlan.set(v.plan.id, entry);
    }

    return [...byPlan.entries()]
      .map(([planId2, e]) => ({
        planId: planId2,
        planName: e.planName,
        sold: e.sold,
        revenueXof: e.revenueXof,
        exactRevenueXof: e.exactRevenueXof,
        estimatedRevenueXof: e.estimatedRevenueXof,
        unknownSalesCount: e.unknownSalesCount,
        invalidSourceCount: e.invalidSourceCount,
        dataQuality: this.dataQuality(e.exactCount, e.estimatedCount, e.unknownSalesCount, e.invalidSourceCount),
      }))
      .sort((a, b) => b.revenueXof - a.revenueXof);
  }

  /**
   * Classifie une ligne voucher et calcule son montant valorisable, une
   * seule fois pour les trois méthodes ci-dessus.
   *
   * - `EXACT` : snapshot figé à l'activation, valide (prix > 0).
   * - `ESTIMATED_FROM_CURRENT_PLAN_PRICE` : pas de snapshot exploitable
   *   (jamais écrit — vieux voucher pas encore backfillé — ou explicitement
   *   `ESTIMATED_FROM_CURRENT_PLAN_PRICE`), reconstruit au prix courant du
   *   plan si celui-ci est valide.
   * - `UNKNOWN` : provenance explicitement `UNKNOWN`, ou plan/prix courant
   *   introuvable pour un fallback ESTIMATED — jamais un faux montant.
   * - `INVALID_SOURCE` (audit/54 §3 point 2, corrigé audit/55 étape 5) :
   *   `priceSnapshotSource` contient une valeur hors de la liste fermée
   *   {EXACT, ESTIMATED_FROM_CURRENT_PLAN_PRICE, UNKNOWN}, OU la provenance
   *   annonce `EXACT` mais le prix stocké est nul/non positif (snapshot
   *   corrompu) — jamais silencieusement requalifié en ESTIMATED.
   */
  private valueLine(
    price: number | null,
    source: string | null,
    currentPlanPrice: number | undefined,
  ): ValuedLine {
    const KNOWN_SOURCES = new Set(['EXACT', 'ESTIMATED_FROM_CURRENT_PLAN_PRICE', 'UNKNOWN']);

    if (source !== null && !KNOWN_SOURCES.has(source)) {
      logger.warn('RevenueService: priceSnapshotSource hors liste fermée — classé INVALID_SOURCE.');
      return { xof: null, source: 'INVALID_SOURCE' };
    }

    if (source === 'EXACT') {
      // Snapshot annoncé exact mais valeur non exploitable : corrompu,
      // jamais requalifié silencieusement en ESTIMATED (audit/54 §3.2).
      if (price === null || !Number.isFinite(price) || price <= 0) {
        logger.warn('RevenueService: priceSnapshotSource=EXACT avec prix non positif — classé INVALID_SOURCE.');
        return { xof: null, source: 'INVALID_SOURCE' };
      }
      return { xof: price, source: 'EXACT' };
    }

    if (source === 'UNKNOWN') {
      return { xof: null, source: 'UNKNOWN' };
    }

    // source === 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' ou null (pas encore
    // backfillé) : reconstruit au prix courant du plan si valide.
    if (typeof currentPlanPrice === 'number' && currentPlanPrice > 0) {
      return { xof: currentPlanPrice, source: 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' };
    }
    return { xof: null, source: 'UNKNOWN' };
  }

  private dataQuality(
    exactCount: number,
    estimatedCount: number,
    unknownCount: number,
    invalidSourceCount: number,
  ): RevenueDataQuality {
    const total = exactCount + estimatedCount + unknownCount + invalidSourceCount;
    if (total === 0) return 'NO_DATA';
    if (unknownCount > 0 || invalidSourceCount > 0) return 'INCOMPLETE';
    if (estimatedCount === 0) return 'EXACT';
    if (exactCount === 0) return 'ESTIMATED';
    return 'MIXED';
  }
}
