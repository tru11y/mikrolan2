import { AuditAction, EventOutcome, VoucherStatus } from '@prisma/client';
import {
  NOT_FOUND_RESPONSE,
  TicketVerificationService,
  UNAVAILABLE_RESPONSE,
} from './ticket-verification.service';
import type { TicketVerifierScope } from '../../common/guards/ticket-verifier-scope.guard';

const SCOPE: TicketVerifierScope = {
  userId: 'U-VER',
  tenantId: 'T-A',
  routerId: 'R-A1',
};

type VoucherRow = {
  id: string;
  tenantId: string;
  routerId: string;
  code: string;
  status: VoucherStatus;
  mikrotikId: string | null;
  expiresAt: Date | null;
  usedAt: Date | null;
  plan: { name: string; durationMinutes: number };
};

function makeDb(rows: VoucherRow[]) {
  return {
    voucher: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const code = (where as { code: { equals: string } }).code.equals.toLowerCase();
        const tenantId = where['tenantId'] as string;
        const routerId = where['routerId'] as string;
        const found = rows.find(
          (r) =>
            r.tenantId === tenantId &&
            r.routerId === routerId &&
            r.code.toLowerCase() === code,
        );
        return found
          ? {
              id: found.id,
              status: found.status,
              mikrotikId: found.mikrotikId,
              expiresAt: found.expiresAt,
              usedAt: found.usedAt,
              plan: found.plan,
            }
          : null;
      }),
    },
  };
}

function makeEvents() {
  return {
    emit: jest.fn(async () => undefined),
    failure: jest.fn(async () => undefined),
  };
}

function voucher(partial: Partial<VoucherRow>): VoucherRow {
  return {
    id: 'V1',
    tenantId: 'T-A',
    routerId: 'R-A1',
    code: 'ABC123',
    status: VoucherStatus.GENERATED,
    mikrotikId: 'mk-1',
    expiresAt: null,
    usedAt: null,
    plan: { name: '1H', durationMinutes: 60 },
    ...partial,
  };
}

describe('TicketVerificationService', () => {
  it('VALID: provisioned, GENERATED, in scope', async () => {
    const db = makeDb([voucher({})]);
    const events = makeEvents();
    const svc = new TicketVerificationService(db as never, events as never);
    const res = await svc.verify(SCOPE, 'ABC123');
    expect(res.status).toBe('VALID');
    expect(res.recommendedAction).toBe('ALLOW_CUSTOMER');
    expect(res.ticket).toEqual(
      expect.objectContaining({ planName: '1H', durationMinutes: 60 }),
    );
  });

  it('ALREADY_USED: USED status', async () => {
    const db = makeDb([voucher({ status: VoucherStatus.USED })]);
    const svc = new TicketVerificationService(db as never, makeEvents() as never);
    const res = await svc.verify(SCOPE, 'ABC123');
    expect(res.status).toBe('ALREADY_USED');
    expect(res.recommendedAction).toBe('DO_NOT_REPLACE');
  });

  it('ALREADY_USED: ACTIVE + duration not yet elapsed → IN_USE mapped as ALREADY_USED', async () => {
    const past = new Date(Date.now() - 10 * 60 * 1000);
    const db = makeDb([
      voucher({ status: VoucherStatus.ACTIVE, usedAt: past }),
    ]);
    const svc = new TicketVerificationService(db as never, makeEvents() as never);
    const res = await svc.verify(SCOPE, 'ABC123');
    expect(res.status).toBe('ALREADY_USED');
  });

  it('EXPIRED: stored status', async () => {
    const db = makeDb([voucher({ status: VoucherStatus.EXPIRED })]);
    const svc = new TicketVerificationService(db as never, makeEvents() as never);
    const res = await svc.verify(SCOPE, 'ABC123');
    expect(res.status).toBe('EXPIRED');
    expect(res.recommendedAction).toBe('DO_NOT_REPLACE');
  });

  it('EXPIRED: ACTIVE but duration elapsed', async () => {
    const long = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10h ago
    const db = makeDb([
      voucher({ status: VoucherStatus.ACTIVE, usedAt: long }),
    ]);
    const svc = new TicketVerificationService(db as never, makeEvents() as never);
    const res = await svc.verify(SCOPE, 'ABC123');
    expect(res.status).toBe('EXPIRED');
  });

  it('BLOCKED: REVOKED', async () => {
    const db = makeDb([voucher({ status: VoucherStatus.REVOKED })]);
    const svc = new TicketVerificationService(db as never, makeEvents() as never);
    const res = await svc.verify(SCOPE, 'ABC123');
    expect(res.status).toBe('BLOCKED');
    expect(res.recommendedAction).toBe('CONTACT_MANAGER');
  });

  it('TEMPORARILY_UNAVAILABLE: not provisioned (mikrotikId empty)', async () => {
    const db = makeDb([voucher({ mikrotikId: null })]);
    const svc = new TicketVerificationService(db as never, makeEvents() as never);
    const res = await svc.verify(SCOPE, 'ABC123');
    expect(res).toEqual(UNAVAILABLE_RESPONSE);
  });

  describe('NOT_FOUND — identical response, no global fallback', () => {
    it('nowhere in DB', async () => {
      const db = makeDb([]);
      const svc = new TicketVerificationService(db as never, makeEvents() as never);
      await expect(svc.verify(SCOPE, 'XYZ999')).resolves.toEqual(
        NOT_FOUND_RESPONSE,
      );
    });

    it('exists on ANOTHER router of the SAME tenant', async () => {
      const db = makeDb([
        voucher({ id: 'V-OTHER', routerId: 'R-A2' }),
      ]);
      const svc = new TicketVerificationService(db as never, makeEvents() as never);
      const res = await svc.verify(SCOPE, 'ABC123');
      expect(res).toEqual(NOT_FOUND_RESPONSE);
      // Exactly ONE DB query — no secondary global lookup.
      expect(db.voucher.findFirst).toHaveBeenCalledTimes(1);
      // And that lookup was tenant+router scoped.
      const whereArg = ((db.voucher.findFirst as jest.Mock).mock.calls[0]![0] as {
        where: Record<string, unknown>;
      }).where;
      expect(whereArg['tenantId']).toBe('T-A');
      expect(whereArg['routerId']).toBe('R-A1');
    });

    it('exists at ANOTHER tenant', async () => {
      const db = makeDb([
        voucher({ id: 'V-FOREIGN', tenantId: 'T-B', routerId: 'R-B1' }),
      ]);
      const svc = new TicketVerificationService(db as never, makeEvents() as never);
      await expect(svc.verify(SCOPE, 'ABC123')).resolves.toEqual(
        NOT_FOUND_RESPONSE,
      );
      expect(db.voucher.findFirst).toHaveBeenCalledTimes(1);
    });

    it('three NOT_FOUND cases return byte-identical response', async () => {
      const dbEmpty = makeDb([]);
      const dbForeignRouter = makeDb([voucher({ routerId: 'R-A2' })]);
      const dbForeignTenant = makeDb([voucher({ tenantId: 'T-B' })]);
      const svcs = [
        new TicketVerificationService(dbEmpty as never, makeEvents() as never),
        new TicketVerificationService(
          dbForeignRouter as never,
          makeEvents() as never,
        ),
        new TicketVerificationService(
          dbForeignTenant as never,
          makeEvents() as never,
        ),
      ];
      const results = await Promise.all(
        svcs.map((s) => s.verify(SCOPE, 'ABC123')),
      );
      // Deep equality + stable key ordering.
      const serialized = results.map((r) => JSON.stringify(r));
      expect(serialized[0]).toBe(serialized[1]);
      expect(serialized[1]).toBe(serialized[2]);
    });
  });

  describe('audit', () => {
    it('writes exactly one audit event per attempt with AuditAction.VERIFY', async () => {
      const db = makeDb([voucher({})]);
      const events = makeEvents();
      const svc = new TicketVerificationService(db as never, events as never);
      await svc.verify(SCOPE, 'ABC123');
      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.failure).not.toHaveBeenCalled();
      const call = (events.emit as jest.Mock).mock.calls[0]![0];
      expect(call.action).toBe(AuditAction.VERIFY);
      expect(call.entityType).toBe('Voucher');
      expect(call.outcome).toBe(EventOutcome.SUCCESS);
    });

    it('audit metadata contains a code fingerprint, NOT the raw code', async () => {
      const db = makeDb([voucher({})]);
      const events = makeEvents();
      const svc = new TicketVerificationService(db as never, events as never);
      await svc.verify(SCOPE, 'ABC123');
      const meta = ((events.emit as jest.Mock).mock.calls[0]![0] as { metadata: Record<string, unknown> }).metadata;
      expect(meta['result']).toBe('VALID');
      expect(meta['source']).toBe('MANUAL');
      expect(meta['routerId']).toBe('R-A1');
      expect(typeof meta['codeFingerprint']).toBe('string');
      expect((meta['codeFingerprint'] as string).length).toBe(16);
      // No raw code anywhere
      expect(JSON.stringify(meta)).not.toContain('ABC123');
    });

    it('NOT_FOUND audit records NO entityId (never leaks foreign voucherId)', async () => {
      const db = makeDb([voucher({ id: 'V-FOREIGN', tenantId: 'T-B' })]);
      const events = makeEvents();
      const svc = new TicketVerificationService(db as never, events as never);
      await svc.verify(SCOPE, 'ABC123');
      const call = (events.emit as jest.Mock).mock.calls[0]![0];
      expect(call.entityId).toBeUndefined();
      expect((call.metadata as Record<string, unknown>)['result']).toBe('NOT_FOUND');
    });

    it('audit carries tenantId/userId from the server-side scope', async () => {
      const db = makeDb([voucher({})]);
      const events = makeEvents();
      const svc = new TicketVerificationService(db as never, events as never);
      await svc.verify(SCOPE, 'ABC123');
      const call = (events.emit as jest.Mock).mock.calls[0]![0];
      expect(call.tenantId).toBe('T-A');
      expect(call.userId).toBe('U-VER');
    });
  });

  describe('errors', () => {
    it('DB failure → TEMPORARILY_UNAVAILABLE (never NOT_FOUND), traced via failure()', async () => {
      const db = {
        voucher: {
          findFirst: jest.fn(async () => {
            throw new Error('P2010 relation does not exist');
          }),
        },
      };
      const events = makeEvents();
      const svc = new TicketVerificationService(db as never, events as never);
      const res = await svc.verify(SCOPE, 'ABC123');
      expect(res).toEqual(UNAVAILABLE_RESPONSE);
      expect(events.failure).toHaveBeenCalledTimes(1);
      expect(events.emit).not.toHaveBeenCalled();
    });

    it('error details are not leaked to the public response', async () => {
      const db = {
        voucher: {
          findFirst: jest.fn(async () => {
            throw new Error('syntax error at or near "SELECT secret"');
          }),
        },
      };
      const svc = new TicketVerificationService(db as never, makeEvents() as never);
      const res = await svc.verify(SCOPE, 'ABC123');
      expect(JSON.stringify(res)).not.toContain('syntax');
      expect(JSON.stringify(res)).not.toContain('secret');
    });
  });

  describe('response shape — no sensitive data', () => {
    it('response never exposes tenantId / routerId / voucherId / mikrotikId / password', async () => {
      const db = makeDb([voucher({})]);
      const svc = new TicketVerificationService(db as never, makeEvents() as never);
      const res = await svc.verify(SCOPE, 'ABC123');
      const flat = JSON.stringify(res);
      expect(flat).not.toContain('T-A');
      expect(flat).not.toContain('R-A1');
      expect(flat).not.toContain('V1');
      expect(flat).not.toContain('mk-1');
      expect(flat).not.toMatch(/password/i);
    });
  });

  describe('case / trim normalization aligned with existing verifier', () => {
    it('case-insensitive match for mixed-case historical codes', async () => {
      const db = makeDb([voucher({ code: 'AbC123' })]);
      const svc = new TicketVerificationService(db as never, makeEvents() as never);
      const res = await svc.verify(SCOPE, 'abc123');
      expect(res.status).toBe('VALID');
    });
  });
});
