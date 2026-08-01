import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BillingPeriod, Prisma, SubscriptionTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  tierFeatureSchema,
  type CreateTierDto,
  type TierFeatureDto,
  type UpdateTierDto,
} from './dto/tier.schemas';

/** Jours facturés selon la périodicité. */
export const PERIOD_DAYS: Record<BillingPeriod, number> = {
  MONTHLY: 30,
  ANNUAL: 365,
};

export interface TierView {
  id: string;
  key: string;
  name: string;
  monthlyXof: number;
  /** Mensualité effective si le client règle l'année. */
  annualMonthlyXof: number;
  annualDiscount: number;
  routerLimit: number | null;
  remoteAccess: boolean;
  a4Printing: boolean;
  cloudBackup: boolean;
  prioritySupport: boolean;
  badge: string | null;
  tagline: string | null;
  features: TierFeatureDto[];
  displayOrder: number;
  active: boolean;
}

/** Mensualité effective : la remise annuelle s'applique au mois, pas au total. */
export function monthlyPrice(tier: SubscriptionTier, period: BillingPeriod): number {
  if (period === 'MONTHLY') return tier.monthlyXof;
  return Math.round(tier.monthlyXof * (1 - tier.annualDiscount / 100));
}

/** Montant réellement facturé pour la période. */
export function periodAmount(tier: SubscriptionTier, period: BillingPeriod): number {
  return period === 'ANNUAL' ? monthlyPrice(tier, 'ANNUAL') * 12 : tier.monthlyXof;
}

function readFeatures(value: Prisma.JsonValue): TierFeatureDto[] {
  if (!Array.isArray(value)) return [];
  const parsed = value
    .map((entry) => tierFeatureSchema.safeParse(entry))
    .filter((r): r is { success: true; data: TierFeatureDto } => r.success)
    .map((r) => r.data);
  return parsed;
}

export function toTierView(tier: SubscriptionTier): TierView {
  return {
    id: tier.id,
    key: tier.key,
    name: tier.name,
    monthlyXof: tier.monthlyXof,
    annualMonthlyXof: monthlyPrice(tier, 'ANNUAL'),
    annualDiscount: tier.annualDiscount,
    routerLimit: tier.routerLimit,
    remoteAccess: tier.remoteAccess,
    a4Printing: tier.a4Printing,
    cloudBackup: tier.cloudBackup,
    prioritySupport: tier.prioritySupport,
    badge: tier.badge,
    tagline: tier.tagline,
    features: readFeatures(tier.features),
    displayOrder: tier.displayOrder,
    active: tier.active,
  };
}

/**
 * Grille tarifaire de la plateforme.
 *
 * `SubscriptionTier` est hors tenant : le middleware Prisma d'isolation ne le
 * connaît pas (il n'a pas de colonne `tenantId`), la lecture est donc ouverte à
 * tous les comptes et l'écriture verrouillée par `@Roles(SUPER_ADMIN)` sur le
 * contrôleur d'administration.
 */
@Injectable()
export class TiersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grille publique : formules actives, dans l'ordre d'affichage. */
  async listActive(): Promise<TierView[]> {
    const rows = await this.prisma.subscriptionTier.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: 'asc' }, { monthlyXof: 'asc' }],
    });
    return rows.map(toTierView);
  }

  /** Vue d'administration : les archivées comprises. */
  async listAll(): Promise<TierView[]> {
    const rows = await this.prisma.subscriptionTier.findMany({
      orderBy: [{ displayOrder: 'asc' }, { monthlyXof: 'asc' }],
    });
    return rows.map(toTierView);
  }

  async getByKeyOrThrow(key: string): Promise<SubscriptionTier> {
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { key } });
    if (!tier) throw new NotFoundException(`Formule inconnue : ${key}`);
    if (!tier.active) throw new BadRequestException(`Formule archivée : ${key}`);
    return tier;
  }

  /**
   * Formule retenue quand le client n'en précise aucune : la moins chère qui
   * débloque la gestion à distance, puisque c'est la seule raison de payer.
   * Sans grille en base, on refuse plutôt que d'inventer un prix.
   */
  async defaultUpgradeTier(): Promise<SubscriptionTier> {
    const tier = await this.prisma.subscriptionTier.findFirst({
      where: { active: true, remoteAccess: true },
      orderBy: { monthlyXof: 'asc' },
    });
    if (!tier) {
      throw new BadRequestException(
        'Aucune formule payante n’est publiée. Contactez l’administrateur.',
      );
    }
    return tier;
  }

  async create(dto: CreateTierDto): Promise<TierView> {
    const existing = await this.prisma.subscriptionTier.findUnique({
      where: { key: dto.key },
    });
    if (existing) throw new ConflictException(`La formule ${dto.key} existe déjà.`);

    const tier = await this.prisma.subscriptionTier.create({
      data: { ...dto, features: dto.features },
    });
    return toTierView(tier);
  }

  async update(id: string, dto: UpdateTierDto): Promise<TierView> {
    await this.getByIdOrThrow(id);
    const tier = await this.prisma.subscriptionTier.update({
      where: { id },
      data: { ...dto, ...(dto.features ? { features: dto.features } : {}) },
    });
    return toTierView(tier);
  }

  /**
   * Archivage, jamais suppression : des abonnements et des factures pointent
   * sur la formule, et l'historique de facturation doit rester lisible.
   */
  async archive(id: string): Promise<TierView> {
    await this.getByIdOrThrow(id);
    const tier = await this.prisma.subscriptionTier.update({
      where: { id },
      data: { active: false },
    });
    return toTierView(tier);
  }

  private async getByIdOrThrow(id: string): Promise<SubscriptionTier> {
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { id } });
    if (!tier) throw new NotFoundException('Formule introuvable');
    return tier;
  }
}
