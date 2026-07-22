import { Controller, Get, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MetricsService } from './metrics.service';
import { metricsQuerySchema, type MetricsQueryDto } from './dto/metrics.schemas';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('summary')
  summary(
    @Query(new ZodValidationPipe(metricsQuerySchema)) query: MetricsQueryDto,
  ) {
    return this.metrics.summary(query);
  }
}
