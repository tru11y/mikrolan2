import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { PrismaPoolStats, isPoolTimeout } from './prisma-pool-stats';
import { getTenantContext, isAdminBypass, type TenantContext } from '../common/context/tenant-context';

// Models carrying a tenantId column — subject to row-level isolation.
// TicketMessage is intentionally excluded: it has no tenantId column (only a
// ticketId relation to SupportTicket), so it cannot be scoped by this
// middleware without a schema migration. Its isolation relies on the
// service layer verifying ticket ownership before writing (support.service.ts).
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
  'Notification',
  'SupportTicket',
  'ReleaseDownload',
  'TicketVerifierAssignment',
]);

/**
 * Pure, side-effect-free tenant scoping logic — extracted from the Prisma
 * middleware so it can be unit-tested directly against real
 * Prisma.MiddlewareParams shapes, without spinning up a database connection.
 */
export function applyTenantScope(
  params: Prisma.MiddlewareParams,
  ctx: TenantContext,
): Prisma.MiddlewareParams {
  const tenantId = ctx.tenantId;

  switch (params.action) {
    case 'create':
      params.args.data = { ...params.args.data, tenantId };
      break;
    case 'createMany':
    case 'createManyAndReturn': {
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
    case 'groupBy':
    case 'updateMany':
    case 'deleteMany':
      params.args = params.args ?? {};
      params.args.where = { ...params.args.where, tenantId };
      break;
    case 'update':
    case 'delete':
      // update/delete require a unique where → scope via updateMany/deleteMany.
      params.action = params.action === 'update' ? 'updateMany' : 'deleteMany';
      params.args.where = { ...params.args.where, tenantId };
      break;
    case 'upsert':
      params.args.where = { ...params.args.where, tenantId };
      params.args.create = { ...params.args.create, tenantId };
      break;
    default:
      break;
  }

  return params;
}

/**
 * Décision pure d'isolation pour une opération donnée. Reproduit exactement le
 * gating de l'ancien `tenantMiddleware` (modèle hors périmètre → passthrough ;
 * pas de contexte tenant → passthrough ; SUPER_ADMIN en bypass → passthrough)
 * puis délègue l'injection de `tenantId` à `applyTenantScope`.
 *
 * On ne conserve QUE les `args` scopés (where/data), PAS la réécriture d'action
 * d'`applyTenantScope` : un Client Extension ne peut pas changer l'opération
 * réellement exécutée sans la redispatcher hors du pipeline (ce qui casserait
 * l'atomicité des `$transaction`). Inutile depuis Prisma 5 : `extendedWhereUnique`
 * (stable) autorise un filtre scalaire additionnel dans le `where` d'un
 * findUnique/update/delete. Ainsi findUnique conserve `tenantId` dans son where
 * → `null` cross-tenant (comme findFirst), findUniqueOrThrow/update/delete →
 * P2025 cross-tenant : aucune ligne d'un autre tenant n'est lue ni mutée.
 *
 * @returns `null` pour passthrough, sinon les `args` scopés à exécuter tels quels.
 */
export function resolveTenantScope(
  model: string,
  operation: Prisma.PrismaAction,
  args: unknown,
  ctx: TenantContext | undefined,
  bypass: boolean,
): Prisma.MiddlewareParams['args'] | null {
  if (!TENANT_MODELS.has(model as Prisma.ModelName)) return null;
  if (!ctx) return null;
  if (ctx.role === UserRole.SUPER_ADMIN && bypass) return null;

  const params = applyTenantScope(
    {
      model: model as Prisma.ModelName,
      action: operation,
      args: args as Prisma.MiddlewareParams['args'],
      dataPath: [],
      runInTransaction: false,
    },
    ctx,
  );
  return params.args;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  /** Durée des requêtes (attente de connexion comprise) et erreurs P2024, pour /admin/system-health. */
  readonly poolStats = new PrismaPoolStats();

  constructor() {
    super();
    // Enregistré en premier = middleware le plus externe : la durée mesurée inclut l'attente d'une connexion du pool.
    this.$use(this.statsMiddleware.bind(this));

    // Isolation tenant via Client Extension (remplace le middleware $use déprécié
    // en Prisma 5). `applyTenantScope` (logique pure, inchangée) injecte `tenantId`
    // dans where/data ; on exécute l'opération d'origine avec ces args scopés via
    // `query` — donc toujours DANS le pipeline/transaction courant. Aucune
    // redispatch hors pipeline : l'atomicité des `$transaction` est préservée.
    const scoped = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const scopedArgs = resolveTenantScope(
              model,
              operation as Prisma.PrismaAction,
              args,
              getTenantContext(),
              isAdminBypass(),
            );
            return query(scopedArgs ?? args);
          },
        },
      },
    });

    // `$extends` retourne un NOUVEAU client ; il faut donc router l'accès de
    // l'instance injectée vers lui. Tout passe par l'étendu (delegates de modèles
    // scopés, `$transaction`, `$connect`, `$queryRaw`, transactions interactives
    // comprises) SAUF les membres propres au service, qui restent sur la base.
    const baseOnly = new Set<string>(['poolStats', 'onModuleInit', 'onModuleDestroy', 'logger']);
    // Clés PROPRES présentes dès la construction : les delegates de modèles
    // (`user`, `router`, …) sont des own-properties de l'instance PrismaClient —
    // ils DOIVENT être routés vers le client étendu (scopé), pas vers la base.
    // Seules les clés ajoutées APRÈS (ex. un `jest.spyOn` qui pose
    // `prisma.$transaction`) priment sur le routage.
    const nativeOwnKeys = new Set<string | symbol>(Reflect.ownKeys(this));
    return new Proxy(this, {
      get(target, prop, receiver) {
        // Override posé après construction (spy de test) → priorité.
        if (!nativeOwnKeys.has(prop) && Object.prototype.hasOwnProperty.call(target, prop)) {
          return Reflect.get(target, prop, receiver);
        }
        if (typeof prop === 'string' && !baseOnly.has(prop)) {
          const value = (scoped as Record<string, unknown>)[prop];
          if (value !== undefined) {
            return typeof value === 'function' ? value.bind(scoped) : value;
          }
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as PrismaService;
  }

  private async statsMiddleware(
    params: Prisma.MiddlewareParams,
    next: (p: Prisma.MiddlewareParams) => Promise<unknown>,
  ): Promise<unknown> {
    const startedAt = Date.now();
    try {
      return await next(params);
    } catch (err) {
      if (isPoolTimeout(err)) this.poolStats.recordPoolTimeout();
      throw err;
    } finally {
      this.poolStats.recordQuery(Date.now() - startedAt);
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
