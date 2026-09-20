import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelemetryService } from './telemetry.service';

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
      await this.telemetry.collectAll();
    } finally {
      this.running = false;
    }
  }

  @Cron('0 3 * * *')
  async purge(): Promise<void> {
    await this.telemetry.cleanup();
  }
}
