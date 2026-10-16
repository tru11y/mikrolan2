import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TenantContext } from '../../common/context/tenant-context';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminBypassInterceptor } from '../../common/interceptors/admin-bypass.interceptor';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AppReleasesService } from './app-releases.service';
import {
  createReleaseSchema,
  listReleasesQuerySchema,
  requireReleaseSchema,
  uploadUrlSchema,
  type CreateReleaseDto,
  type ListReleasesQueryDto,
  type RequireReleaseDto,
  type UploadUrlDto,
} from './dto/app-release.schemas';

/** Distribution APK — SUPER_ADMIN uniquement (fermé par défaut au niveau classe). */
@Controller('admin/releases')
@Roles(UserRole.SUPER_ADMIN)
@AlwaysAllowed()
@UseInterceptors(AdminBypassInterceptor)
export class AppReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  @Post('upload-url')
  @HttpCode(200)
  uploadUrl(
    @Body(new ZodValidationPipe(uploadUrlSchema)) dto: UploadUrlDto,
    @CurrentUser() actor: TenantContext,
  ) {
    return this.releases.createUploadTarget(dto, actor);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createReleaseSchema)) dto: CreateReleaseDto,
    @CurrentUser() actor: TenantContext,
  ) {
    return this.releases.create(dto, actor);
  }

  @Get()
  list(@Query(new ZodValidationPipe(listReleasesQuerySchema)) query: ListReleasesQueryDto) {
    return this.releases.list(query);
  }

  @Get('latest')
  latest() {
    return this.releases.latest();
  }

  @Patch(':id/activate')
  @HttpCode(200)
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: TenantContext) {
    return this.releases.activate(id, actor);
  }

  @Patch(':id/require')
  @HttpCode(200)
  require(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(requireReleaseSchema)) dto: RequireReleaseDto,
    @CurrentUser() actor: TenantContext,
  ) {
    return this.releases.setRequired(id, dto.required, actor);
  }

  @Patch(':id/archive')
  @HttpCode(200)
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: TenantContext) {
    return this.releases.archive(id, actor);
  }
}
