import { HttpStatus, NotFoundException } from '@nestjs/common';
import { AuditAction, EventOutcome } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  EventLogService,
  categoryOf,
  describeFailure,
  entityTypesOf,
} from './event-log.service';

jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({ tenantId: 'tenant-1', userId: '11111111-1111-4111-8111-111111111111', ip: '1.2.3.4' })),
}));

function build() {
  const prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
  return { service: new EventLogService(prisma as any), create: prisma.auditLog.create };
}

const written = (create: jest.Mock, i = 0) => create.mock.calls[i][0].data;

describe('EventLogService', () => {
  it.each([
    ['success', EventOutcome.SUCCESS],
    ['warning', EventOutcome.WARNING],
    ['partialSuccess', EventOutcome.PARTIAL_SUCCESS],
  ] as const)('%s writes outcome %s with tenant, user and ip from context', async (method, outcome) => {
    const { service, create } = build();
    await service[method](AuditAction.CREATE, 'VoucherBatch', 'b1', { totalCount: 10 });
    expect(written(create)).toMatchObject({
      tenantId: 'tenant-1',
      userId: '11111111-1111-4111-8111-111111111111',
      ip: '1.2.3.4',
      action: AuditAction.CREATE,
      entityType: 'VoucherBatch',
      entityId: 'b1',
      outcome,
      metadata: { totalCount: 10 },
    });
  });

  it('actor overrides context tenant and user', async () => {
    const { service, create } = build();
    await service.success(AuditAction.MESSAGE, 'SupportTicket', 't1', undefined, {
      tenantId: 'tenant-9',
      userId: '22222222-2222-4222-8222-222222222222',
    });
    expect(written(create)).toMatchObject({ tenantId: 'tenant-9', userId: '22222222-2222-4222-8222-222222222222' });
  });

  it('a non-user actor (SYSTEM cron) is stored without a user id and named in metadata', async () => {
    const { service, create } = build();
    await service.success(AuditAction.SUBSCRIBE, 'Subscription', 't1', { kind: 'deactivate-pro' }, {
      tenantId: 'tenant-1',
      userId: 'SYSTEM',
    });
    expect(written(create)).toMatchObject({ userId: null, metadata: { kind: 'deactivate-pro', actor: 'SYSTEM' } });
  });

  it('failure records FAILED with the business errorCode and message', async () => {
    const { service, create } = build();
    const err = new BusinessException(HttpStatus.FORBIDDEN, 'VOUCHER_LIMIT_REACHED', 'Limite atteinte');
    await service.failure(AuditAction.CREATE, 'VoucherBatch', 'r1', err, { quantity: 50 });
    expect(written(create)).toMatchObject({
      outcome: EventOutcome.FAILED,
      metadata: { errorCode: 'VOUCHER_LIMIT_REACHED', error: 'Limite atteinte', quantity: 50 },
    });
  });

  it('explicit errorCode in metadata wins over the exception one', async () => {
    const { service, create } = build();
    await service.failure(AuditAction.REBOOT, 'Diagnostic', 'r1', new Error('boom'), {
      errorCode: 'ROUTER_REBOOT_FAILED',
    });
    expect(written(create).metadata).toMatchObject({ errorCode: 'ROUTER_REBOOT_FAILED', error: 'boom' });
  });

  it('never throws when the database write fails', async () => {
    const { service, create } = build();
    create.mockRejectedValue(new Error('db down'));
    await expect(service.success(AuditAction.CREATE, 'Router', 'r1')).resolves.toBeUndefined();
  });

  it('skips (and does not throw) when there is no tenant', async () => {
    const { getTenantContext } = jest.requireMock('../../common/context/tenant-context');
    getTenantContext.mockReturnValueOnce(undefined);
    const { service, create } = build();
    await service.success(AuditAction.CREATE, 'Router', 'r1');
    expect(create).not.toHaveBeenCalled();
  });

  describe('track', () => {
    it('emits SUCCESS with the entity id described from the result', async () => {
      const { service, create } = build();
      const result = await service.track(
        { action: AuditAction.CREATE, entityType: 'Plan', metadata: { routerId: 'r1' } },
        async () => ({ id: 'p1' }),
        (plan) => ({ entityId: plan.id }),
      );
      expect(result).toEqual({ id: 'p1' });
      expect(written(create)).toMatchObject({ entityId: 'p1', outcome: EventOutcome.SUCCESS, metadata: { routerId: 'r1' } });
    });

    it('can downgrade the outcome from the result', async () => {
      const { service, create } = build();
      await service.track(
        { action: AuditAction.CREATE, entityType: 'VoucherBatch' },
        async () => ({ pushed: 3, total: 5 }),
        (r) => ({ outcome: r.pushed < r.total ? EventOutcome.PARTIAL_SUCCESS : EventOutcome.SUCCESS }),
      );
      expect(written(create).outcome).toBe(EventOutcome.PARTIAL_SUCCESS);
    });

    it('emits FAILED and rethrows the original error', async () => {
      const { service, create } = build();
      const err = new NotFoundException('Introuvable');
      await expect(
        service.track({ action: AuditAction.DELETE, entityType: 'Router', entityId: 'r1' }, async () => {
          throw err;
        }),
      ).rejects.toBe(err);
      expect(written(create)).toMatchObject({
        outcome: EventOutcome.FAILED,
        entityId: 'r1',
        metadata: { errorCode: 'HTTP_404' },
      });
    });
  });

  describe('guard', () => {
    it('does not emit on success', async () => {
      const { service, create } = build();
      await service.guard({ action: AuditAction.REVOKE, entityType: 'Router' }, async () => 1);
      expect(create).not.toHaveBeenCalled();
    });

    it('traces a failure once, even when the error was already traced inside', async () => {
      const { service, create } = build();
      const err = new BusinessException(HttpStatus.SERVICE_UNAVAILABLE, 'ROUTER_PROVISION_FAILED', 'nope');
      await expect(
        service.guard({ action: AuditAction.PROVISION, entityType: 'Router', entityId: 'r1' }, async () => {
          await service.failure(AuditAction.PROVISION, 'Router', 'r1', err, { cause: 'wg down' });
          throw err;
        }),
      ).rejects.toBe(err);
      expect(create).toHaveBeenCalledTimes(1);
      expect(written(create).metadata).toMatchObject({ cause: 'wg down', errorCode: 'ROUTER_PROVISION_FAILED' });
    });
  });

  describe('describeFailure', () => {
    it('uses HTTP_<status> for exceptions without a business code', () => {
      expect(describeFailure(new NotFoundException('x')).errorCode).toBe('HTTP_404');
    });
    it('falls back to UNEXPECTED_ERROR for plain errors and non-errors', () => {
      expect(describeFailure(new Error('x')).errorCode).toBe('UNEXPECTED_ERROR');
      expect(describeFailure('oops')).toEqual({ errorCode: 'UNEXPECTED_ERROR', error: 'oops' });
    });
  });

  describe('categories', () => {
    it('maps every audited domain', () => {
      expect(categoryOf('VoucherBatch')).toBe('TICKETS');
      expect(categoryOf('TicketVault')).toBe('VAULT');
      expect(categoryOf('Router')).toBe('ROUTERS');
      expect(categoryOf('Diagnostic')).toBe('DIAGNOSTICS');
      expect(categoryOf('PaymentProof')).toBe('PAYMENTS');
      expect(categoryOf('SupportTicket')).toBe('SUPPORT');
      expect(categoryOf('Unknown')).toBeNull();
    });
    it('lists entity types per category', () => {
      expect(entityTypesOf('TICKETS')).toEqual(expect.arrayContaining(['Voucher', 'VoucherBatch', 'Plan']));
    });
  });
});
