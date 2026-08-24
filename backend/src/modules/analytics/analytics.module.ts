import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ForecastService } from './forecast/forecast.service';
import { RevenueModule } from '../revenue/revenue.module';

@Module({
  imports: [RevenueModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ForecastService],
})
export class AnalyticsModule {}
