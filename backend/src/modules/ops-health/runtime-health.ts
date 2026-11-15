import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { PrismaService } from '../../prisma/prisma.service';
import type { PrismaPoolSnapshot } from '../../prisma/prisma-pool-stats';
import type { HealthLevel } from './ops-health.service';

const MB = 1024 * 1024;
const KB = 1024;

export interface MemInfo {
  memTotalBytes: number;
  memAvailableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

/** Valeurs de `/proc/meminfo` (en kB) converties en octets ; null si le format est inattendu. */
export function parseMeminfo(text: string): MemInfo | null {
  const kb = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm').exec(text);
    return m ? Number(m[1]) : null;
  };
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  const swapTotal = kb('SwapTotal');
  const swapFree = kb('SwapFree');
  if (total === null || available === null || swapTotal === null || swapFree === null) return null;
  return {
    memTotalBytes: total * KB,
    memAvailableBytes: available * KB,
    swapTotalBytes: swapTotal * KB,
    swapUsedBytes: Math.max(0, swapTotal - swapFree) * KB,
  };
}

/** `VmSwap` (kB) de `/proc/self/status`, en octets ; null si absent. */
export function parseProcessSwap(text: string): number | null {
  const m = /^VmSwap:\s+(\d+)\s+kB/m.exec(text);
  return m ? Number(m[1]) * KB : null;
}

export interface RuntimeHealth {
  level: HealthLevel;
  reasons: string[];
  node: { rssMb: number; heapUsedMb: number; heapTotalMb: number; externalMb: number; uptimeSeconds: number };
  system: {
    memTotalMb: number;
    memAvailableMb: number;
    swapTotalMb: number;
    swapUsedMb: number;
    swapUsedPercent: number;
    processSwapMb: number | null;
  } | null;
  prisma: PrismaPoolSnapshot;
}

/**
 * Seuils : swap système > 50 % → ORANGE, > 80 % → RED ; au moins 1 erreur P2024 sur 1 h → ORANGE, 10 ou plus → RED.
 * Ce sont des repères d'alerte, pas une cause : la décision reste humaine.
 */
export function evaluateRuntimeLevel(swapUsedPercent: number | null, p2024Last1h: number): { level: HealthLevel; reasons: string[] } {
  const reasons: string[] = [];
  let red = false;
  let orange = false;
  if (swapUsedPercent !== null && swapUsedPercent > 80) {
    red = true;
    reasons.push('swap système utilisé à plus de 80 %');
  } else if (swapUsedPercent !== null && swapUsedPercent > 50) {
    orange = true;
    reasons.push('swap système utilisé à plus de 50 %');
  }
  if (p2024Last1h >= 10) {
    red = true;
    reasons.push('10 erreurs P2024 ou plus sur la dernière heure');
  } else if (p2024Last1h >= 1) {
    orange = true;
    reasons.push('erreur(s) P2024 sur la dernière heure');
  }
  return { level: red ? 'RED' : orange ? 'ORANGE' : 'GREEN', reasons };
}

@Injectable()
export class RuntimeHealthService {
  constructor(private readonly prisma: PrismaService) {}

  snapshot(): RuntimeHealth {
    const mem = process.memoryUsage();
    const pool = this.prisma.poolStats.snapshot();
    const info = this.read('/proc/meminfo', parseMeminfo);
    const processSwap = this.read('/proc/self/status', parseProcessSwap);
    const swapPct = info === null ? null : info.swapTotalBytes > 0 ? Math.round((info.swapUsedBytes / info.swapTotalBytes) * 100) : 0;
    const { level, reasons } = evaluateRuntimeLevel(swapPct, pool.p2024Last1h);
    return {
      level,
      reasons,
      node: {
        rssMb: Math.round(mem.rss / MB),
        heapUsedMb: Math.round(mem.heapUsed / MB),
        heapTotalMb: Math.round(mem.heapTotal / MB),
        externalMb: Math.round(mem.external / MB),
        uptimeSeconds: Math.round(process.uptime()),
      },
      system: info
        ? {
            memTotalMb: Math.round(info.memTotalBytes / MB),
            memAvailableMb: Math.round(info.memAvailableBytes / MB),
            swapTotalMb: Math.round(info.swapTotalBytes / MB),
            swapUsedMb: Math.round(info.swapUsedBytes / MB),
            swapUsedPercent: swapPct ?? 0,
            processSwapMb: processSwap === null ? null : Math.round(processSwap / MB),
          }
        : null,
      prisma: pool,
    };
  }

  private read<T>(path: string, parse: (text: string) => T | null): T | null {
    try {
      return parse(readFileSync(path, 'utf8'));
    } catch {
      return null; // hors Linux ou /proc illisible : pas de mesure système, jamais une erreur de santé
    }
  }
}
