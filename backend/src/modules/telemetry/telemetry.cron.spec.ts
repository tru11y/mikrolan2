import { Logger } from '@nestjs/common';
import { MAX_RUN_MS, TelemetryCron } from './telemetry.cron';
import type { TelemetryService } from './telemetry.service';

const collectAll = jest.fn();
const build = () => new TelemetryCron({ collectAll } as unknown as TelemetryService);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('TelemetryCron — garde running', () => {
  it('tick simultané : ignoré tant que la collecte précédente tourne', async () => {
    const cron = build();
    let release!: () => void;
    collectAll.mockReturnValueOnce(new Promise<void>((r) => (release = r)));

    const first = cron.collect();
    await cron.collect(); // ignoré
    expect(collectAll).toHaveBeenCalledTimes(1);

    release();
    await first;
    collectAll.mockResolvedValueOnce(undefined);
    await cron.collect();
    expect(collectAll).toHaveBeenCalledTimes(2);
  });

  it('erreur : running est libéré et le tick suivant fonctionne normalement', async () => {
    const cron = build();
    collectAll.mockRejectedValueOnce(new Error('boom'));
    await expect(cron.collect()).resolves.toBeUndefined();

    collectAll.mockResolvedValueOnce(undefined);
    await cron.collect();
    expect(collectAll).toHaveBeenCalledTimes(2);
  });

  it('collecte bloquée : running est libéré au délai maximal (plus de « still running » éternel)', async () => {
    jest.useFakeTimers();
    const cron = build();
    collectAll.mockReturnValueOnce(new Promise(() => undefined)); // ne se termine jamais

    const stuck = cron.collect();
    await jest.advanceTimersByTimeAsync(MAX_RUN_MS);
    await stuck;

    collectAll.mockResolvedValueOnce(undefined);
    await cron.collect();
    expect(collectAll).toHaveBeenCalledTimes(2);
  });
});
