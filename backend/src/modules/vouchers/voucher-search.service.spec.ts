import { UserRole, VoucherStatus } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { makeEventLogStub } from '../../common/testing/event-log.stub';
import { VoucherSearchService, decodeCursor, encodeCursor } from './voucher-search.service';
import { voucherSearchQuerySchema } from './dto/voucher-search.schemas';

let role: UserRole = UserRole.ADMIN;
jest.mock('../../common/context/tenant-context', () => ({
  getTenantContext: jest.fn(() => ({ tenantId: 't1', userId: 'u1', role })),
}));

const ID = '11111111-1111-4111-8111-111111111111';
const ROUTER = '22222222-2222-4222-8222-222222222222';

function setup(rows: unknown[] = [], one: unknown = null) {
  const prisma = { voucher: { findMany: jest.fn().mockResolvedValue(rows), findFirst: jest.fn().mockResolvedValue(one) } };
  const eventLog = makeEventLogStub();
  const service = new VoucherSearchService(prisma as never, eventLog as never);
  return { service, prisma, eventLog };
}

const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  code: `3d${n}`,
  status: VoucherStatus.GENERATED,
  createdAt: new Date(1_800_000_000_000 - n * 1000),
});

describe('voucherSearchQuerySchema', () => {
  it('borne limit à 200 et impose 2 caractères minimum pour q', () => {
    expect(voucherSearchQuerySchema.safeParse({ limit: '201' }).success).toBe(false);
    expect(voucherSearchQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(voucherSearchQuerySchema.parse({}).limit).toBe(50);
  });
  it('refuse les champs inconnus', () => {
    expect(voucherSearchQuerySchema.safeParse({ tenantId: 'x' }).success).toBe(false);
  });
});

describe('curseur', () => {
  it('aller-retour', () => {
    const d = new Date(1_800_000_000_000);
    expect(decodeCursor(encodeCursor(d, ID))).toEqual({ createdAt: d, id: ID });
  });
  it('un curseur falsifié est refusé (400)', () => {
    expect(() => decodeCursor('bm9wZQ')).toThrow(BusinessException);
    expect(() => decodeCursor(Buffer.from('abc|not-a-uuid').toString('base64url'))).toThrow(BusinessException);
  });
});

describe('VoucherSearchService.search', () => {
  it('renvoie nextCursor quand il reste des résultats et n’expose jamais le mot de passe', async () => {
    const { service, prisma } = setup([row(1), row(2), row(3)]);
    const out = await service.search(ROUTER, { limit: 2 });
    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).not.toBeNull();
    const args = prisma.voucher.findMany.mock.calls[0][0];
    expect(args.take).toBe(3);
    expect(args.select.password).toBeUndefined();
    expect(args.where.routerId).toBe(ROUTER);
  });
  it('dernier page : nextCursor null', async () => {
    const { service } = setup([row(1)]);
    expect((await service.search(ROUTER, { limit: 2 })).nextCursor).toBeNull();
  });
  it('recherche par préfixe insensible à la casse, filtre sur le routeur', async () => {
    const { service, prisma } = setup([]);
    await service.search(ROUTER, { limit: 50, q: '3d' });
    expect(prisma.voucher.findMany.mock.calls[0][0].where.code).toEqual({ startsWith: '3d', mode: 'insensitive' });
  });
});

describe('VoucherSearchService.reprint', () => {
  const ticket = (status: VoucherStatus) => ({ id: ID, code: 'abc', password: 'pw', status, plan: { name: '1 day', priceXof: 300, durationMinutes: 1440 } });
  beforeEach(() => { role = UserRole.ADMIN; });

  it('ticket jamais utilisé : ADMIN peut réimprimer, audit sans code', async () => {
    const { service, eventLog } = setup([], ticket(VoucherStatus.GENERATED));
    const out = await service.reprint(ROUTER, ID);
    expect(out.password).toBe('pw');
    expect(JSON.stringify(eventLog.track.mock.calls[0][0])).not.toContain('abc');
  });
  it('ticket utilisé : ADMIN refusé (409), OWNER accepté', async () => {
    const a = setup([], ticket(VoucherStatus.USED));
    await expect(a.service.reprint(ROUTER, ID)).rejects.toMatchObject({ status: 409 });
    role = UserRole.OWNER;
    const b = setup([], ticket(VoucherStatus.USED));
    await expect(b.service.reprint(ROUTER, ID)).resolves.toMatchObject({ code: 'abc' });
  });
  it('ticket révoqué : 409 même pour OWNER', async () => {
    role = UserRole.OWNER;
    const { service } = setup([], ticket(VoucherStatus.REVOKED));
    await expect(service.reprint(ROUTER, ID)).rejects.toMatchObject({ status: 409 });
  });
  it('ticket d’un autre routeur / inconnu : 404', async () => {
    const { service, prisma } = setup([], null);
    await expect(service.reprint(ROUTER, ID)).rejects.toMatchObject({ status: 404 });
    expect(prisma.voucher.findFirst.mock.calls[0][0].where).toMatchObject({ id: ID, routerId: ROUTER });
  });
});
