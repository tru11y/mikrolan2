import { Controller, Get, Param, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';
import {
  overviewQuerySchema,
  routersQuerySchema,
  routerDetailQuerySchema,
  plansQuerySchema,
  trafficQuerySchema,
  type OverviewQueryDto,
  type RoutersQueryDto,
  type RouterDetailQueryDto,
  type PlansQueryDto,
  type TrafficQueryDto,
} from './dto/analytics.schemas';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

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

  @Get('traffic')
  traffic(@Query(new ZodValidationPipe(trafficQuerySchema)) query: TrafficQueryDto) {
    return this.analytics.traffic(query);
  }
}
