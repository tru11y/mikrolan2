import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { RevenueModule } from '../revenue/revenue.module';

@Module({
  imports: [RevenueModule],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
