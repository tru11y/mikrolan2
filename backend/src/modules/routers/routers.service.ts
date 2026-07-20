import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ManagementMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { getTenantContext } from '../../common/context/tenant-context';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateRouterDto, UpdateRouterDto } from './dto/router.schemas';

// Never expose credEncrypted to the API.
const ROUTER_PUBLIC = {
  id: true,
  identity: true,
  alias: true,
  model: true,
  localAddress: true,
  mode: true,
  health: true,
  lastHeartbeat: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RouterSelect;

@Injectable()
export class RoutersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // Remote (cloud + WireGuard) management is a PRO-only feature.
  private async assertRemoteAllowed(mode?: ManagementMode): Promise<void> {
    if (mode !== ManagementMode.REMOTE) return;
    const tenantId = getTenantContext()?.tenantId;
    if (!tenantId || !(await this.subscriptions.isRemoteAllowed(tenantId))) {
      throw new ForbiddenException(
        'La gestion à distance nécessite un abonnement PRO actif',
      );
    }
  }

  async create(dto: CreateRouterDto) {
    await this.assertRemoteAllowed(dto.mode);
    try {
      // tenantId injected by the Prisma tenant middleware.
      return await this.prisma.router.create({
        data: {
          identity: dto.identity,
          alias: dto.alias,
          model: dto.model,
          localAddress: dto.localAddress,
          mode: dto.mode,
          credEncrypted: dto.credentials
            ? this.crypto.encrypt(JSON.stringify(dto.credentials))
            : undefined,
        } as Prisma.RouterCreateInput,
        select: ROUTER_PUBLIC,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Router identity already exists');
      }
      throw e;
    }
  }

  findAll() {
    return this.prisma.router.findMany({
      where: { deletedAt: null },
      select: ROUTER_PUBLIC,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const router = await this.prisma.router.findFirst({
      where: { id, deletedAt: null },
      select: ROUTER_PUBLIC,
    });
    if (!router) throw new NotFoundException('Router not found');
    return router;
  }

  async update(id: string, dto: UpdateRouterDto) {
    await this.findOne(id); // ownership + existence (404 if cross-tenant)
    await this.assertRemoteAllowed(dto.mode);

    const data: Prisma.RouterUpdateInput = {};
    if (dto.alias !== undefined) data.alias = dto.alias;
    if (dto.model !== undefined) data.model = dto.model;
    if (dto.localAddress !== undefined) data.localAddress = dto.localAddress;
    if (dto.mode !== undefined) data.mode = dto.mode;
    if (dto.credentials !== undefined) {
      data.credEncrypted = dto.credentials
        ? this.crypto.encrypt(JSON.stringify(dto.credentials))
        : null;
    }

    // Middleware rewrites update→updateMany (tenant-scoped); no select here.
    await this.prisma.router.update({ where: { id }, data });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.router.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }
}
