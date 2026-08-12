import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { HotspotService } from './hotspot.service';
import {
  configureHotspotSchema,
  createIpBindingSchema,
  hotspotSettingsQuerySchema,
  setInternetSharingSchema,
  updateHotspotSettingsSchema,
  updateUserProfileSchema,
  type ConfigureHotspotDto,
  type CreateIpBindingDto,
  type HotspotSettingsQueryDto,
  type SetInternetSharingDto,
  type UpdateHotspotSettingsDto,
  type UpdateUserProfileDto,
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

  @Get('user-profiles')
  listUserProfiles(@Param('id', ParseUUIDPipe) id: string) {
    return this.hotspot.listUserProfiles(id);
  }

  @Patch('user-profiles/:profileId')
  @Roles(UserRole.ADMIN)
  updateUserProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(updateUserProfileSchema))
    dto: UpdateUserProfileDto,
  ) {
    return this.hotspot.updateUserProfile(id, profileId, dto);
  }

  @Delete('user-profiles/:profileId')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  removeUserProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('profileId') profileId: string,
  ) {
    return this.hotspot.removeUserProfile(id, profileId);
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

  @Patch('ip-bindings/:bindingId')
  @Roles(UserRole.ADMIN)
  updateIpBinding(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('bindingId') bindingId: string,
    @Body(new ZodValidationPipe(createIpBindingSchema.partial())) dto: Partial<CreateIpBindingDto>,
  ) {
    return this.hotspot.updateIpBinding(id, bindingId, dto);
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

  @Get('settings')
  getSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(hotspotSettingsQuerySchema))
    query: HotspotSettingsQueryDto,
  ) {
    return this.hotspot.getSettings(id, query.server);
  }

  @Patch('settings')
  @Roles(UserRole.ADMIN)
  updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateHotspotSettingsSchema))
    dto: UpdateHotspotSettingsDto,
  ) {
    return this.hotspot.updateSettings(id, dto);
  }
}
