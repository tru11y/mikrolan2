import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getTenantContext } from '../../common/context/tenant-context';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.schemas';

const PLAN_PUBLIC = {
  id: true,
  name: true,
  slug: true,
  description: true,
  durationMinutes: true,
  priceXof: true,
  downloadKbps: true,
  uploadKbps: true,
  dataLimitMb: true,
  sharedUsers: true,
  expirationMode: true,
  userProfile: true,
  codePrefix: true,
  codeLength: true,
  codeFormat: true,
  status: true,
  displayOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PlanSelect;

// RouterOS profile name: lowercase alphanumerics + dashes, no spaces/accents.
function slugify(name: string): string {
  return name
    .normalize('NFD')
    // strip combining diacritics (accents)
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'plan';
}

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(routerId: string, dto: CreatePlanDto) {
    await this.assertRouter(routerId);
    const slug = await this.uniqueSlug(routerId, slugify(dto.name));
    const created = await this.prisma.plan.create({
      // tenantId injected by the Prisma tenant middleware.
      data: {
        routerId,
        name: dto.name,
        slug,
        description: dto.description,
        durationMinutes: dto.durationMinutes,
        priceXof: dto.priceXof,
        downloadKbps: dto.downloadKbps ?? null,
        uploadKbps: dto.uploadKbps ?? null,
        dataLimitMb: dto.dataLimitMb ?? null,
        sharedUsers: dto.sharedUsers ?? 1,
        expirationMode: dto.expirationMode ?? 'RADIO_PAUSE',
        userProfile: slug,
        codePrefix: dto.codePrefix || null,
        codeLength: dto.codeLength ?? 8,
        codeFormat: dto.codeFormat ?? 'ALPHANUMERIC',
        displayOrder: dto.displayOrder ?? 0,
      } as unknown as Prisma.PlanUncheckedCreateInput,
      select: PLAN_PUBLIC,
    });
    await this.audit(AuditAction.CREATE, created.id, { slug, routerId });
    return created;
  }

  findAll(routerId: string) {
    return this.prisma.plan.findMany({
      where: { routerId, deletedAt: null },
      select: PLAN_PUBLIC,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(routerId: string, id: string) {
    const plan = await this.prisma.plan.findFirst({
      where: { id, routerId, deletedAt: null },
      select: PLAN_PUBLIC,
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async update(routerId: string, id: string, dto: UpdatePlanDto) {
    await this.findOne(routerId, id); // ownership + existence (404 cross-tenant/router)

    const data: Prisma.PlanUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.durationMinutes !== undefined)
      data.durationMinutes = dto.durationMinutes;
    if (dto.priceXof !== undefined) data.priceXof = dto.priceXof;
    if (dto.downloadKbps !== undefined) data.downloadKbps = dto.downloadKbps;
    if (dto.uploadKbps !== undefined) data.uploadKbps = dto.uploadKbps;
    if (dto.dataLimitMb !== undefined) data.dataLimitMb = dto.dataLimitMb;
    if (dto.sharedUsers !== undefined) data.sharedUsers = dto.sharedUsers;
    if (dto.expirationMode !== undefined)
      data.expirationMode = dto.expirationMode;
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.codePrefix !== undefined) data.codePrefix = dto.codePrefix || null;
    if (dto.codeLength !== undefined) data.codeLength = dto.codeLength;
    if (dto.codeFormat !== undefined) data.codeFormat = dto.codeFormat;

    // Middleware rewrites update→updateMany (tenant-scoped); no select here.
    await this.prisma.plan.update({ where: { id }, data });
    await this.audit(AuditAction.UPDATE, id, {});
    return this.findOne(routerId, id);
  }

  async remove(routerId: string, id: string) {
    await this.findOne(routerId, id);
    await this.prisma.plan.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit(AuditAction.DELETE, id, {});
    return { deleted: true };
  }

  // Ensures the router exists within the caller's tenant (404 otherwise).
  private async assertRouter(routerId: string): Promise<void> {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true },
    });
    if (!router) throw new NotFoundException('Router not found');
  }

  // Unique per router, counting soft-deleted rows (they keep the slug via the
  // (tenantId, routerId, slug) unique index).
  private async uniqueSlug(routerId: string, base: string): Promise<string> {
    const rows = await this.prisma.plan.findMany({
      where: { routerId, slug: { startsWith: base } },
      select: { slug: true },
    });
    const taken = new Set(rows.map((r) => r.slug));
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base}-${i}`)) i += 1;
    return `${base}-${i}`;
  }

  private async audit(
    action: AuditAction,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    const ctx = getTenantContext();
    if (!ctx) return;
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          action,
          entityType: 'Plan',
          entityId,
          metadata,
        },
      });
    } catch {
      // append-only, best-effort
    }
  }
}
