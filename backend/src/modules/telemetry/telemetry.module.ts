import { Module } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';
import { TelemetryCron } from './telemetry.cron';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { RouterGatewayModule } from '../router-gateway/router-gateway.module';

@Module({
  imports: [CryptoModule, RouterGatewayModule],
  providers: [TelemetryService, TelemetryCron],
  exports: [TelemetryService],
})
export class TelemetryModule {}
