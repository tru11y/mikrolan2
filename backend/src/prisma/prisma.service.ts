import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { getTenantContext } from '../common/context/tenant-context';

// Models carrying a tenantId column — subject to row-level isolation.
const TENANT_MODELS = new Set<Prisma.ModelName>([
  'User',
  'Router',
  'RemotePeer',
  'Subscription',
  'Invoice',
  'AuditLog',
  'Plan',
  'VoucherBatch',
  'Voucher',
  'Session',
]);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    this.$use(this.tenantMiddleware.bind(this));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Injects `tenantId` on every tenant-scoped query. Defense in depth: even a
   * service that forgets to filter cannot read or mutate another tenant's rows.
   * Skipped when there is no tenant context (unauthenticated/system paths such
   * as signup and login) or when the actor is a platform SUPER_ADMIN.
   */
  private async tenantMiddleware(
    params: Prisma.MiddlewareParams,
    next: (p: Prisma.MiddlewareParams) => Promise<unknown>,
  ): Promise<unknown> {
    const model = params.model;
    if (!model || !TENANT_MODELS.has(model)) return next(params);

    const ctx = getTenantContext();
    if (!ctx || ctx.role === UserRole.SUPER_ADMIN) return next(params);

    const tenantId = ctx.tenantId;

    switch (params.action) {
      case 'create':
        params.args.data = { ...params.args.data, tenantId };
        break;
      case 'createMany': {
        const data = params.args.data;
        params.args.data = Array.isArray(data)
          ? data.map((d: Record<string, unknown>) => ({ ...d, tenantId }))
          : { ...data, tenantId };
        break;
      }
      case 'findUnique':
      case 'findUniqueOrThrow':
        // Unique-by-id lookups can't carry extra filters → widen to findFirst.
        params.action =
          params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
        params.args.where = { ...params.args.where, tenantId };
        break;
      case 'findFirst':
      case 'findFirstOrThrow':
      case 'findMany':
      case 'count':
      case 'aggregate':
      case 'updateMany':
      case 'deleteMany':
        params.args = params.args ?? {};
        params.args.where = { ...params.args.where, tenantId };
        break;
      case 'update':
      case 'delete':
        // update/delete require a unique where → scope via updateMany/deleteMany.
        params.action =
          params.action === 'update' ? 'updateMany' : 'deleteMany';
        params.args.where = { ...params.args.where, tenantId };
        break;
      case 'upsert':
        params.args.where = { ...params.args.where, tenantId };
        params.args.create = { ...params.args.create, tenantId };
        break;
      default:
        break;
    }

    return next(params);
  }
}
