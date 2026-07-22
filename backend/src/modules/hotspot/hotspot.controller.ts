import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { HotspotService } from './hotspot.service';
import {
  configureHotspotSchema,
  type ConfigureHotspotDto,
} from './dto/hotspot.schemas';

@Controller('routers/:id/hotspot')
export class HotspotController {
  constructor(private readonly hotspot: HotspotService) {}

  @Post('configure')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  configure(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(configureHotspotSchema)) dto: ConfigureHotspotDto,
  ) {
    return this.hotspot.configure(id, dto);
  }
}
