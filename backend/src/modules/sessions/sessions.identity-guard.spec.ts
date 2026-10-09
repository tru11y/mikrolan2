import { Logger } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { VoucherService } from '../vouchers/voucher.service';
import { isGenericIdentity } from '../../common/routeros/router-identity.guard';

/**
 * P0 : deux MikroTik peuvent partager la même adresse LAN (10.10.10.1). Un rapport LAN issu du routeur A
 * ne doit JAMAIS muter les données du routeur B (clôture de Session, activation de Voucher, CA).
 */
const prisma = {
  router: { findFirst: jest.fn() },
  session: { findMany: jest.fn(), updateMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  voucher: { findMany: jest.fn(), updateMany: jest.fn() },
  voucherBatch: { findFirst: jest.fn(), update: jest.fn() },
  notification: { create: jest.fn() },
};
const eventLog = { warning: jest.fn(), success: jest.fn(), failure: jest.fn() };

const ROUTER_B = { id: 'B', mode: 'LOCAL', tenantId: 't1', identity: 'ROUTER_B' };
const active = [{ id: '*1', user: 'CODEA1', ipAddress: '10.10.10.5', macAddress: 'AA', bytesIn: '1', bytesOut: '2', uptime: '1m' }];

const sessions = () =>
  new SessionsService(prisma as never, {} as never, { publish: jest.fn() } as never, { sendPushToTenant: jest.fn() } as never, undefined, eventLog as never);

const noMutation = () => {
  expect(prisma.session.updateMany).not.toHaveBeenCalled();
  expect(prisma.session.create).not.toHaveBeenCalled();
  expect(prisma.session.update).not.toHaveBeenCalled();
  expect(prisma.voucher.updateMany).not.toHaveBeenCalled();
  expect(prisma.notification.create).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env['LAN_IDENTITY_POLICY'];
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  prisma.router.findFirst.mockResolvedValue(ROUTER_B);
  prisma.session.findMany.mockResolvedValue([{ id: 's-open', voucher: { code: 'CODEB9' } }]);
  prisma.voucher.findMany.mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

describe('syncFromLan — garde d\'identité backend', () => {
  it('A. identité observée = ROUTER_A, attendue ROUTER_B : 409 ROUTER_IDENTITY_MISMATCH, 0 mutation (aucune Session close, aucun Voucher activé)', async () => {
    await expect(sessions().syncFromLan('B', active, 'ROUTER_A')).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ errorCode: 'ROUTER_IDENTITY_MISMATCH' }),
    });
    expect(prisma.session.findMany).not.toHaveBeenCalled(); // reconcileActive n'est même pas entré
    noMutation();
  });

  it('E. le refus est tracé (audit non sensible : routeur, raison, opération — ni identités ni sessions)', async () => {
    await sessions().syncFromLan('B', active, 'ROUTER_A').catch(() => undefined);
    expect(eventLog.warning).toHaveBeenCalledWith('REJECT', 'Router', 'B', { reason: 'IDENTITY_MISMATCH', operation: 'LAN_SESSION_SYNC' }, { tenantId: 't1' });
  });

  it('B. identité correcte : la logique historique continue (reconcile exécuté)', async () => {
    await expect(sessions().syncFromLan('B', active, 'ROUTER_B')).resolves.toEqual({ synced: 1 });
    expect(prisma.session.findMany).toHaveBeenCalled();
    expect(prisma.session.updateMany).toHaveBeenCalled(); // CODEB9 n'est plus dans la liste → fermée comme avant
  });

  it('C. routeur d\'un autre tenant / inconnu : 404 conservé, aucune comparaison ni mutation', async () => {
    prisma.router.findFirst.mockResolvedValue(null);
    await expect(sessions().syncFromLan('B', active, 'ROUTER_B')).rejects.toMatchObject({ status: 404 });
    noMutation();
  });

  it('D1. ancien APK sans identité, politique warn (étape 1) : comportement historique conservé', async () => {
    await expect(sessions().syncFromLan('B', active)).resolves.toEqual({ synced: 1 });
    expect(prisma.session.findMany).toHaveBeenCalled();
  });

  it('D2. ancien APK sans identité, politique enforce (étape 2) : 409 ROUTER_IDENTITY_REQUIRED, 0 mutation', async () => {
    process.env['LAN_IDENTITY_POLICY'] = 'enforce';
    await expect(sessions().syncFromLan('B', active)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ errorCode: 'ROUTER_IDENTITY_REQUIRED' }),
    });
    noMutation();
  });

  it('D3. charge falsifiée : identité vide / espaces seuls ne passe jamais pour une preuve', async () => {
    await expect(sessions().syncFromLan('B', active, '   ')).rejects.toMatchObject({ status: 409 });
    noMutation();
  });

  it('une erreur d\'audit n\'empêche pas le refus', async () => {
    eventLog.warning.mockRejectedValueOnce(new Error('db down'));
    await expect(sessions().syncFromLan('B', active, 'ROUTER_A')).rejects.toMatchObject({ status: 409 });
  });

  it('routeur REMOTE : refus historique inchangé (avant le garde)', async () => {
    prisma.router.findFirst.mockResolvedValue({ ...ROUTER_B, mode: 'REMOTE' });
    await expect(sessions().syncFromLan('B', active, 'ROUTER_A')).rejects.toMatchObject({ status: 400 });
  });
});

describe('confirmPush — garde d\'identité backend', () => {
  const dto = { batchId: '00000000-0000-4000-8000-000000000001', items: [{ id: '00000000-0000-4000-8000-000000000002', mikrotikId: '*A1' }] };
  const vouchers = () => new VoucherService(prisma as never, {} as never, {} as never, eventLog as never);

  it('mikrotikId issus du routeur A confirmés pour B : 409, aucune écriture', async () => {
    await expect(vouchers().confirmPush('B', { ...dto, observedRouterIdentity: 'ROUTER_A' })).rejects.toMatchObject({ status: 409 });
    expect(prisma.voucher.updateMany).not.toHaveBeenCalled();
    expect(prisma.voucherBatch.update).not.toHaveBeenCalled();
  });

  it('identité correcte : confirmation historique', async () => {
    prisma.voucher.updateMany.mockResolvedValue({ count: 1 });
    prisma.voucherBatch.findFirst.mockResolvedValue({ quantity: 5 });
    prisma.voucherBatch.update.mockResolvedValue({});
    await vouchers().confirmPush('B', { ...dto, observedRouterIdentity: 'ROUTER_B' }).catch(() => undefined);
    expect(prisma.voucher.updateMany).toHaveBeenCalled();
  });
});

describe('identités génériques', () => {
  it.each(['MikroTik', 'mikrotik', 'RouterOS', 'MikroTik-2', 'router', '', '  '])('%p est générique', (v) => {
    expect(isGenericIdentity(v)).toBe(true);
  });
  it.each(['ROUTER_A', 'rb951_BZ_akdo sinacassi_dec_2025', 'FREEDOM HOME'])('%p est une preuve forte', (v) => {
    expect(isGenericIdentity(v)).toBe(false);
  });
});
