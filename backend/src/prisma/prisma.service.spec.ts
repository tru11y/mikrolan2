import { UserRole } from '@prisma/client';
import { applyTenantScope, PrismaService } from './prisma.service';
import * as tenantContext from '../common/context/tenant-context';
import type { TenantContext } from '../common/context/tenant-context';

const ctxA: TenantContext = { tenantId: 'tenant-A', userId: 'user-1', role: UserRole.ADMIN };

describe('applyTenantScope (real tenant middleware logic, FIND-003)', () => {
  it('injects tenantId on create', () => {
    const params: any = { model: 'SupportTicket', action: 'create', args: { data: { subject: 'help' } } };
    const out = applyTenantScope(params, ctxA);
    expect(out.args.data.tenantId).toBe('tenant-A');
  });

  it('overwrites a client-supplied tenantId on create (cannot be spoofed)', () => {
    const params: any = {
      model: 'SupportTicket',
      action: 'create',
      args: { data: { subject: 'help', tenantId: 'attacker-tenant' } },
    };
    const out = applyTenantScope(params, ctxA);
    expect(out.args.data.tenantId).toBe('tenant-A');
  });

  it('injects tenantId into where on findMany (list)', () => {
    const params: any = { model: 'SupportTicket', action: 'findMany', args: { where: { status: 'OPEN' } } };
    const out = applyTenantScope(params, ctxA);
    expect(out.args.where).toEqual({ status: 'OPEN', tenantId: 'tenant-A' });
  });

  it('rewrites findUnique to findFirst and scopes by tenantId (direct ID lookup cannot bypass isolation)', () => {
    const params: any = { model: 'SupportTicket', action: 'findUnique', args: { where: { id: 'ticket-of-tenant-B' } } };
    const out = applyTenantScope(params, ctxA);
    expect(out.action).toBe('findFirst');
    expect(out.args.where).toEqual({ id: 'ticket-of-tenant-B', tenantId: 'tenant-A' });
  });

  it('rewrites update to updateMany and scopes by tenantId', () => {
    const params: any = {
      model: 'SupportTicket',
      action: 'update',
      args: { where: { id: 'ticket-1' }, data: { status: 'CLOSED' } },
    };
    const out = applyTenantScope(params, ctxA);
    expect(out.action).toBe('updateMany');
    expect(out.args.where).toEqual({ id: 'ticket-1', tenantId: 'tenant-A' });
  });

  it('rewrites delete to deleteMany and scopes by tenantId', () => {
    const params: any = { model: 'SupportTicket', action: 'delete', args: { where: { id: 'ticket-1' } } };
    const out = applyTenantScope(params, ctxA);
    expect(out.action).toBe('deleteMany');
    expect(out.args.where).toEqual({ id: 'ticket-1', tenantId: 'tenant-A' });
  });

  it('injects tenantId on count', () => {
    const params: any = { model: 'SupportTicket', action: 'count', args: { where: {} } };
    const out = applyTenantScope(params, ctxA);
    expect(out.args.where).toEqual({ tenantId: 'tenant-A' });
  });

  it('leaves unrelated params structurally intact for unknown actions', () => {
    const params: any = { model: 'SupportTicket', action: 'aggregate', args: { where: { status: 'OPEN' }, _count: true } };
    const out = applyTenantScope(params, ctxA);
    expect(out.args.where).toEqual({ status: 'OPEN', tenantId: 'tenant-A' });
    expect(out.args._count).toBe(true);
  });
});

describe('PrismaService tenantMiddleware gating (real private method, FIND-003)', () => {
  let service: PrismaService;

  beforeEach(() => {
    // Real instance — real constructor, real $use registration. No $connect() is called,
    // so no database connection is required to exercise the middleware gating logic.
    service = new PrismaService();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await service.$disconnect();
  });

  function callMiddleware(params: any) {
    const next = jest.fn(async (p) => p);
    return (service as any)
      .tenantMiddleware(params, next)
      .then((result: unknown) => ({ result, forwardedParams: next.mock.calls[0]?.[0] }));
  }

  it('scopes a SupportTicket findMany when a tenant context is active (fix verified end-to-end through the real private method)', async () => {
    jest.spyOn(tenantContext, 'getTenantContext').mockReturnValue(ctxA);
    jest.spyOn(tenantContext, 'isAdminBypass').mockReturnValue(false);

    const { forwardedParams } = await callMiddleware({
      model: 'SupportTicket',
      action: 'findMany',
      args: { where: {} },
    });

    expect(forwardedParams.args.where).toEqual({ tenantId: 'tenant-A' });
  });

  it('does NOT scope TicketMessage (not in TENANT_MODELS — no tenantId column exists on that model)', async () => {
    jest.spyOn(tenantContext, 'getTenantContext').mockReturnValue(ctxA);
    jest.spyOn(tenantContext, 'isAdminBypass').mockReturnValue(false);

    const { forwardedParams } = await callMiddleware({
      model: 'TicketMessage',
      action: 'findMany',
      args: { where: {} },
    });

    expect(forwardedParams.args.where).toEqual({});
  });

  it('SUPER_ADMIN with active bypass sees all tenants (admin support workflow preserved)', async () => {
    const adminCtx: TenantContext = { tenantId: 'irrelevant', userId: 'admin-1', role: UserRole.SUPER_ADMIN };
    jest.spyOn(tenantContext, 'getTenantContext').mockReturnValue(adminCtx);
    jest.spyOn(tenantContext, 'isAdminBypass').mockReturnValue(true);

    const { forwardedParams } = await callMiddleware({
      model: 'SupportTicket',
      action: 'findUnique',
      args: { where: { id: 'any-tenant-ticket' } },
    });

    expect(forwardedParams.action).toBe('findUnique');
    expect(forwardedParams.args.where).toEqual({ id: 'any-tenant-ticket' });
  });

  it('a request with no tenant context passes through unscoped (documented existing behavior, not a FIND-003 regression)', async () => {
    jest.spyOn(tenantContext, 'getTenantContext').mockReturnValue(undefined);

    const { forwardedParams } = await callMiddleware({
      model: 'SupportTicket',
      action: 'findMany',
      args: { where: {} },
    });

    expect(forwardedParams.args.where).toEqual({});
  });
});
