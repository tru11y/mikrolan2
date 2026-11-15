import { RuntimeHealthService, evaluateRuntimeLevel, parseMeminfo, parseProcessSwap } from './runtime-health';
import { PrismaPoolStats } from '../../prisma/prisma-pool-stats';

// Valeurs relevées sur le VPS pendant l'incident du 15/11/2026 (kB).
const MEMINFO = `MemTotal:         935980 kB
MemFree:           78024 kB
MemAvailable:     145480 kB
Buffers:            1300 kB
SwapCached:        50000 kB
SwapTotal:       2097148 kB
SwapFree:        1134340 kB
`;

describe('parseMeminfo / parseProcessSwap', () => {
  it('convertit kB en octets et calcule le swap utilisé', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      memTotalBytes: 935980 * 1024,
      memAvailableBytes: 145480 * 1024,
      swapTotalBytes: 2097148 * 1024,
      swapUsedBytes: (2097148 - 1134340) * 1024,
    });
  });

  it('format inattendu : null, jamais d exception', () => {
    expect(parseMeminfo('n importe quoi')).toBeNull();
    expect(parseMeminfo('MemTotal: 10 kB')).toBeNull();
    expect(parseProcessSwap('Name: node\nVmRSS: 100 kB')).toBeNull();
  });

  it('VmSwap du processus en octets', () => {
    expect(parseProcessSwap('Name:\tnode\nVmRSS:\t344896 kB\nVmSwap:\t670840 kB\n')).toBe(670840 * 1024);
  });
});

describe('evaluateRuntimeLevel', () => {
  it.each([
    [null, 0, 'GREEN'],
    [0, 0, 'GREEN'],
    [50, 0, 'GREEN'],
    [51, 0, 'ORANGE'],
    [80, 0, 'ORANGE'],
    [81, 0, 'RED'],
    [10, 1, 'ORANGE'],
    [10, 9, 'ORANGE'],
    [10, 10, 'RED'],
    [90, 0, 'RED'],
    [null, 27, 'RED'],
  ] as const)('swap %s %% + %s P2024/h => %s', (swap, p2024, expected) => {
    expect(evaluateRuntimeLevel(swap, p2024).level).toBe(expected);
  });

  it('les raisons expliquent le niveau', () => {
    expect(evaluateRuntimeLevel(85, 12).reasons).toHaveLength(2);
    expect(evaluateRuntimeLevel(0, 0).reasons).toEqual([]);
  });
});

describe('RuntimeHealthService.snapshot', () => {
  it('expose RSS, heapUsed, heapTotal, swap et P2024/h, sans donnée sensible', () => {
    const stats = new PrismaPoolStats();
    stats.recordPoolTimeout();
    const svc = new RuntimeHealthService({ poolStats: stats } as never);
    const snap = svc.snapshot();
    expect(snap.node.rssMb).toBeGreaterThan(0);
    expect(snap.node.heapUsedMb).toBeGreaterThan(0);
    expect(snap.node.heapTotalMb).toBeGreaterThanOrEqual(snap.node.heapUsedMb);
    expect(snap.prisma.p2024Last1h).toBe(1);
    expect(['GREEN', 'ORANGE', 'RED']).toContain(snap.level);
    expect(snap.level).not.toBe('GREEN'); // 1 P2024 sur la dernière heure => au moins ORANGE
    if (snap.system) {
      expect(snap.system.swapUsedPercent).toBeGreaterThanOrEqual(0);
      expect(snap.system.memTotalMb).toBeGreaterThan(0);
    } else {
      expect(snap.system).toBeNull(); // hors Linux : pas de mesure système
    }
    expect(JSON.stringify(snap)).not.toMatch(/@|token|password|secret/i);
  });
});
