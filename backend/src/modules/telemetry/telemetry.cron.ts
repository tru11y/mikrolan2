import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelemetryService } from './telemetry.service';
import { withDeadline } from '../../common/utils/with-deadline';

// Moins que l'intervalle du cron (15 min).
export const MAX_RUN_MS = 10 * 60_000;

@Injectable()
export class TelemetryCron {
  private readonly logger = new Logger(TelemetryCron.name);
  private running = false;

  constructor(private readonly telemetry: TelemetryService) {}

  @Cron('*/15 * * * *')
  async collect(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous telemetry collection still running, skipping');
      return;
    }
    this.running = true;
    try {
      // Filet de sécurité : même si une collecte reste bloquée, le garde est
      // libéré avant le tick suivant (15 min) au lieu de rester vrai à jamais.
      await withDeadline(this.telemetry.collectAll(), MAX_RUN_MS, 'Collecte télémétrie');
    } catch (err) {
      this.logger.error(`Telemetry collection aborted: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  @Cron('0 3 * * *')
  async purge(): Promise<void> {
    await this.telemetry.cleanup();
  }
}
