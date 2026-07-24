import {
  Body,
  Controller,
  Delete,
  Get,
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
  createIpBindingSchema,
  setInternetSharingSchema,
  type ConfigureHotspotDto,
  type CreateIpBindingDto,
  type SetInternetSharingDto,
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

  @Get('servers')
  listServers(@Param('id', ParseUUIDPipe) id: string) {
    return this.hotspot.listServers(id);
  }

  @Get('ip-bindings')
  listIpBindings(@Param('id', ParseUUIDPipe) id: string) {
    return this.hotspot.listIpBindings(id);
  }

  @Post('ip-bindings')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  addIpBinding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createIpBindingSchema)) dto: CreateIpBindingDto,
  ) {
    return this.hotspot.addIpBinding(id, dto);
  }

  @Delete('ip-bindings/:bindingId')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  removeIpBinding(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bindingId') bindingId: string,
  ) {
    return this.hotspot.removeIpBinding(id, bindingId);
  }

  @Get('internet-sharing')
  getInternetSharing(@Param('id', ParseUUIDPipe) id: string) {
    return this.hotspot.getInternetSharing(id);
  }

  @Post('internet-sharing')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  setInternetSharing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setInternetSharingSchema))
    dto: SetInternetSharingDto,
  ) {
    return this.hotspot.setInternetSharing(id, dto.blocked);
  }
}
