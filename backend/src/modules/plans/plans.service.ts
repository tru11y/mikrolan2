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
  userProfile: true,
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

  async create(dto: CreatePlanDto) {
    const slug = await this.uniqueSlug(slugify(dto.name));
    const created = await this.prisma.plan.create({
      // tenantId injected by the Prisma tenant middleware.
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        durationMinutes: dto.durationMinutes,
        priceXof: dto.priceXof,
        downloadKbps: dto.downloadKbps ?? null,
        uploadKbps: dto.uploadKbps ?? null,
        dataLimitMb: dto.dataLimitMb ?? null,
        userProfile: slug,
        displayOrder: dto.displayOrder ?? 0,
      } as Prisma.PlanCreateInput,
      select: PLAN_PUBLIC,
    });
    await this.audit(AuditAction.CREATE, created.id, { slug });
    return created;
  }

  findAll() {
    return this.prisma.plan.findMany({
      where: { deletedAt: null },
      select: PLAN_PUBLIC,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const plan = await this.prisma.plan.findFirst({
      where: { id, deletedAt: null },
      select: PLAN_PUBLIC,
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto) {
    await this.findOne(id); // ownership + existence (404 cross-tenant)

    const data: Prisma.PlanUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.durationMinutes !== undefined)
      data.durationMinutes = dto.durationMinutes;
    if (dto.priceXof !== undefined) data.priceXof = dto.priceXof;
    if (dto.downloadKbps !== undefined) data.downloadKbps = dto.downloadKbps;
    if (dto.uploadKbps !== undefined) data.uploadKbps = dto.uploadKbps;
    if (dto.dataLimitMb !== undefined) data.dataLimitMb = dto.dataLimitMb;
    if (dto.displayOrder !== undefined) data.displayOrder = dto.displayOrder;
    if (dto.status !== undefined) data.status = dto.status;

    // Middleware rewrites update→updateMany (tenant-scoped); no select here.
    await this.prisma.plan.update({ where: { id }, data });
    await this.audit(AuditAction.UPDATE, id, {});
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.plan.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit(AuditAction.DELETE, id, {});
    return { deleted: true };
  }

  // Unique per tenant, counting soft-deleted rows (they keep the slug via the
  // (tenantId, slug) unique index).
  private async uniqueSlug(base: string): Promise<string> {
    const rows = await this.prisma.plan.findMany({
      where: { slug: { startsWith: base } },
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
