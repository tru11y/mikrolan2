import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';
import { ForecastService } from './forecast/forecast.service';
import {
  overviewQuerySchema,
  routersQuerySchema,
  routerDetailQuerySchema,
  plansQuerySchema,
  trafficQuerySchema,
  sessionStatsQuerySchema,
  type OverviewQueryDto,
  type RoutersQueryDto,
  type RouterDetailQueryDto,
  type PlansQueryDto,
  type TrafficQueryDto,
  type SessionStatsQueryDto,
} from './dto/analytics.schemas';
import {
  forecastQuerySchema,
  forecastTrafficQuerySchema,
  type ForecastQueryDto,
  type ForecastTrafficQueryDto,
} from './forecast/forecast.schemas';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly forecastService: ForecastService,
  ) {}

  @Get('overview')
  overview(@Query(new ZodValidationPipe(overviewQuerySchema)) query: OverviewQueryDto) {
    return this.analytics.overview(query);
  }

  @Get('routers')
  routers(@Query(new ZodValidationPipe(routersQuerySchema)) query: RoutersQueryDto) {
    return this.analytics.routers(query);
  }

  @Get('routers/:routerId')
  routerDetail(
    @Param('routerId') routerId: string,
    @Query(new ZodValidationPipe(routerDetailQuerySchema)) query: RouterDetailQueryDto,
  ) {
    return this.analytics.routerDetail(routerId, query);
  }

  @Get('plans')
  plans(@Query(new ZodValidationPipe(plansQuerySchema)) query: PlansQueryDto) {
    return this.analytics.plans(query);
  }

  @Get('sessions')
  sessionStats(@Query(new ZodValidationPipe(sessionStatsQuerySchema)) query: SessionStatsQueryDto) {
    return this.analytics.sessionStats(query);
  }

  @Get('traffic')
  traffic(@Query(new ZodValidationPipe(trafficQuerySchema)) query: TrafficQueryDto) {
    return this.analytics.traffic(query);
  }

  @Get('forecast')
  forecast(@Query(new ZodValidationPipe(forecastQuerySchema)) query: ForecastQueryDto) {
    return this.forecastService.forecast(query);
  }

  @Get('forecast/traffic')
  forecastTraffic(@Query(new ZodValidationPipe(forecastTrafficQuerySchema)) query: ForecastTrafficQueryDto) {
    return this.forecastService.forecastTraffic(query.routerId);
  }

  @Get('forecast/routers')
  forecastRouters() {
    return this.forecastService.forecastRouters();
  }

  @Get('forecast/plans')
  forecastPlans() {
    return this.forecastService.forecastPlans();
  }

  @Get('insights')
  insights() {
    return this.forecastService.insights();
  }
}
