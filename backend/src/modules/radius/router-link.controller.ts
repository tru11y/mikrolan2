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
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RouterLinkService } from './router-link.service';
import {
  addMembersSchema,
  createRouterLinkSchema,
  setAuthModeSchema,
  type AddMembersDto,
  type CreateRouterLinkDto,
  type SetAuthModeDto,
} from './dto/router-link.schemas';

/**
 * Gestion des liens de routeurs (RouterLink) : réservé à l'ADMIN (même rôle que
 * la gestion des routeurs). Isolation tenant portée par le service (RouterLink
 * est hors du middleware tenant Prisma). Aucun secret n'est exposé.
 */
@Controller('router-links')
@Roles(UserRole.ADMIN)
export class RouterLinkController {
  constructor(private readonly links: RouterLinkService) {}

  @Post()
  create(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(createRouterLinkSchema)) dto: CreateRouterLinkDto,
  ) {
    return this.links.createLink(user.tenantId, user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: TenantContext) {
    return this.links.listLinks(user.tenantId);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.links.getLink(user.tenantId, id);
  }

  @Post(':id/members')
  @HttpCode(200)
  addMembers(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addMembersSchema)) dto: AddMembersDto,
  ) {
    return this.links.addMembers(user.tenantId, user.userId, id, dto.routerIds);
  }

  @Delete(':id/members/:routerId')
  removeMember(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('routerId', ParseUUIDPipe) routerId: string,
  ) {
    return this.links.removeMember(user.tenantId, user.userId, id, routerId);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.links.activate(user.tenantId, user.userId, id);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.links.deactivate(user.tenantId, user.userId, id);
  }

  @Patch(':id/auth-mode')
  setAuthMode(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setAuthModeSchema)) dto: SetAuthModeDto,
  ) {
    return this.links.setAuthMode(user.tenantId, user.userId, id, dto.authMode);
  }
}
