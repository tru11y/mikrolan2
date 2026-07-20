import { AsyncLocalStorage } from 'node:async_hooks';
import { UserRole } from '@prisma/client';

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: UserRole;
}

// Mutable holder so the auth guard can populate the context after the
// middleware has established the async scope for the request.
interface Store {
  ctx?: TenantContext;
}

export const tenantStore = new AsyncLocalStorage<Store>();

export function getTenantContext(): TenantContext | undefined {
  return tenantStore.getStore()?.ctx;
}

export function setTenantContext(ctx: TenantContext): void {
  const store = tenantStore.getStore();
  if (store) store.ctx = ctx;
}
