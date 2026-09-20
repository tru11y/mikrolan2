import { Test } from '@nestjs/testing';
import { TelemetryService } from './telemetry.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RouterHealth } from '@prisma/client';

jest.mock('../../common/routeros/routeros-api.client', () => ({
  withRouterOsApi: jest.fn(),
  RouterOsAuthError: class extends Error {},
  RouterOsApiError: class extends Error {},
}));

import { withRouterOsApi } from '../../common/routeros/routeros-api.client';

const mockWithRouterOsApi = withRouterOsApi as jest.MockedFunction<typeof withRouterOsApi>;

function makePrisma() {
  return {
    remotePeer: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    routerTelemetry: {
      create: jest.fn().mockResolvedValue({ id: 'tel-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}

function makeCrypto() {
  return {
    decrypt: jest.fn().mockReturnValue(
      JSON.stringify({ username: 'admin', password: 'pass' }),
    ),
  } as unknown as CryptoService;
}

describe('TelemetryService', () => {
  let service: TelemetryService;
  let prisma: ReturnType<typeof makePrisma>;
  let crypto: ReturnType<typeof makeCrypto>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = makePrisma();
    crypto = makeCrypto();
    const module = await Test.createTestingModule({
      providers: [
        TelemetryService,
        { provide: PrismaService, useValue: prisma },
        { provide: CryptoService, useValue: crypto },
      ],
    }).compile();
    service = module.get(TelemetryService);
  });

  it('collects telemetry for active peers', async () => {
    (prisma.remotePeer.findMany as jest.Mock).mockResolvedValue([
      {
        routerId: 'r1',
        wgIp: '10.0.0.2',
        router: { id: 'r1', credEncrypted: 'enc', deletedAt: null },
      },
    ]);

    mockWithRouterOsApi.mockImplementation(async (_params, fn) => {
      const client = {
        command: jest.fn()
          .mockResolvedValueOnce([{
            'cpu-load': '15',
            'total-memory': '134217728',
            'free-memory': '67108864',
            'uptime': '1d2h',
            'version': '7.15.3',
            'board-name': 'hAP ac3',
          }])
          .mockResolvedValueOnce([{}, {}])
          .mockResolvedValueOnce([{ time: '12:00', message: 'test error' }]),
      };
      return fn(client as any);
    });

    await service.collectAll();

    expect(prisma.routerTelemetry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routerId: 'r1',
          cpuPercent: 15,
          ramTotalMb: 128,
          ramUsedMb: 64,
          rosVersion: '7.15.3',
          hotspotActive: 2,
          health: RouterHealth.ONLINE,
        }),
      }),
    );
  });

  it('skips deleted routers', async () => {
    (prisma.remotePeer.findMany as jest.Mock).mockResolvedValue([
      {
        routerId: 'r2',
        wgIp: '10.0.0.3',
        router: { id: 'r2', credEncrypted: 'enc', deletedAt: new Date() },
      },
    ]);

    await service.collectAll();
    expect(mockWithRouterOsApi).not.toHaveBeenCalled();
  });

  it('handles RouterOS connection failure gracefully', async () => {
    (prisma.remotePeer.findMany as jest.Mock).mockResolvedValue([
      {
        routerId: 'r3',
        wgIp: '10.0.0.4',
        router: { id: 'r3', credEncrypted: 'enc', deletedAt: null },
      },
    ]);

    mockWithRouterOsApi.mockRejectedValue(new Error('Connection refused'));

    await expect(service.collectAll()).resolves.not.toThrow();
    expect(prisma.routerTelemetry.create).not.toHaveBeenCalled();
  });

  it('cleanup deletes old records', async () => {
    (prisma.routerTelemetry.deleteMany as jest.Mock).mockResolvedValue({ count: 42 });
    const count = await service.cleanup();
    expect(count).toBe(42);
    expect(prisma.routerTelemetry.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { collectedAt: { lt: expect.any(Date) } },
      }),
    );
  });
});
