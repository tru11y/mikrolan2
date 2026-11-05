import { Module } from '@nestjs/common';
import { OpsHealthAlertCron } from './ops-health.alert.cron';
import { OpsHealthController } from './ops-health.controller';
import { OpsHealthService } from './ops-health.service';

@Module({
  controllers: [OpsHealthController],
  providers: [OpsHealthService, OpsHealthAlertCron],
})
export class OpsHealthModule {}
