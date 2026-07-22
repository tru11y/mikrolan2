import { Injectable, NestMiddleware } from '@nestjs/common';
import { tenantStore } from './tenant-context';

/**
 * Establishes an AsyncLocalStorage scope per request. The auth guard later
 * fills the tenant context into this scope; the Prisma tenant middleware reads
 * it to enforce row-level isolation.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(_req: unknown, _res: unknown, next: () => void): void {
    tenantStore.run({}, () => next());
  }
}
