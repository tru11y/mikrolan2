import { Module } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { TelemetryCron } from './telemetry.cron';
import { CryptoModule } from '../../common/crypto/crypto.module';

@Module({
  imports: [CryptoModule],
  providers: [TelemetryService, TelemetryCron],
  exports: [TelemetryService],
})
export class TelemetryModule {}
