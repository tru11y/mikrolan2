import { UserRole } from '@prisma/client';
import { applyTenantScope, resolveTenantScope } from './prisma.service';
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

describe('resolveTenantScope (gating de l’extension client, remplace tenantMiddleware)', () => {
  it('scope une opération findMany SupportTicket quand un contexte tenant est actif', () => {
    const args = resolveTenantScope('SupportTicket', 'findMany', { where: {} }, ctxA, false);
    expect(args).not.toBeNull();
    expect(args!.where).toEqual({ tenantId: 'tenant-A' });
  });

  it('findUnique : tenantId injecté dans le where (extendedWhereUnique → null cross-tenant, opération inchangée)', () => {
    const args = resolveTenantScope('SupportTicket', 'findUnique', { where: { id: 't-B' } }, ctxA, false);
    expect(args!.where).toEqual({ id: 't-B', tenantId: 'tenant-A' });
  });

  it('update et delete : tenantId injecté dans le where (P2025 cross-tenant, aucune mutation croisée)', () => {
    const upd = resolveTenantScope('SupportTicket', 'update', { where: { id: 't1' }, data: { status: 'CLOSED' } }, ctxA, false);
    expect(upd!.where).toEqual({ id: 't1', tenantId: 'tenant-A' });
    const del = resolveTenantScope('SupportTicket', 'delete', { where: { id: 't1' } }, ctxA, false);
    expect(del!.where).toEqual({ id: 't1', tenantId: 'tenant-A' });
  });

  it('create : tenantId forcé dans data (anti-spoof)', () => {
    const args = resolveTenantScope('SupportTicket', 'create', { data: { subject: 'x', tenantId: 'attacker' } }, ctxA, false);
    expect(args!.data.tenantId).toBe('tenant-A');
  });

  it('ne scope PAS TicketMessage (hors TENANT_MODELS — pas de colonne tenantId)', () => {
    expect(resolveTenantScope('TicketMessage', 'findMany', { where: {} }, ctxA, false)).toBeNull();
  });

  it('SUPER_ADMIN avec bypass actif voit tous les tenants (passthrough)', () => {
    const adminCtx: TenantContext = { tenantId: 'irrelevant', userId: 'admin-1', role: UserRole.SUPER_ADMIN };
    expect(resolveTenantScope('SupportTicket', 'findUnique', { where: { id: 'x' } }, adminCtx, true)).toBeNull();
  });

  it('SUPER_ADMIN SANS bypass reste scopé (le bypass doit être explicitement armé)', () => {
    const adminCtx: TenantContext = { tenantId: 'tenant-A', userId: 'admin-1', role: UserRole.SUPER_ADMIN };
    const args = resolveTenantScope('SupportTicket', 'findMany', { where: {} }, adminCtx, false);
    expect(args!.where).toEqual({ tenantId: 'tenant-A' });
  });

  it('une requête sans contexte tenant passe inchangée (signup/login, chemins système)', () => {
    expect(resolveTenantScope('SupportTicket', 'findMany', { where: {} }, undefined, false)).toBeNull();
  });
});
