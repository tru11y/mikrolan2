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
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserRole } from '@prisma/client';
import { RoutersService } from './routers.service';
import {
  clientEventSchema,
  createRouterSchema,
  updateRouterSchema,
  type ClientEventDto,
  type CreateRouterDto,
  type UpdateRouterDto,
} from './dto/router.schemas';
import {
  ticketTemplateSchema,
  type TicketTemplateDto,
} from './dto/ticket-template.schemas';

@Controller('routers')
export class RoutersController {
  constructor(private readonly routers: RoutersService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body(new ZodValidationPipe(createRouterSchema)) dto: CreateRouterDto) {
    return this.routers.create(dto);
  }

  @Get()
  findAll() {
    return this.routers.findAll();
  }

  @Post(':id/events')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  recordClientEvent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(clientEventSchema)) dto: ClientEventDto,
  ) {
    return this.routers.recordClientEvent(id, dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.routers.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRouterSchema)) dto: UpdateRouterDto,
  ) {
    return this.routers.update(id, dto);
  }

  @Patch(':id/ticket-template')
  @Roles(UserRole.ADMIN)
  updateTicketTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ticketTemplateSchema)) dto: TicketTemplateDto,
  ) {
    return this.routers.updateTicketTemplate(id, dto);
  }

  // Restauration LAN d'un ADMIN : secret en clair, donc ADMIN+ uniquement, tenant explicite, lecture auditée.
  @Get(':id/credentials')
  @Roles(UserRole.ADMIN)
  getCredentials(@Param('id', ParseUUIDPipe) id: string) {
    return this.routers.getCredentials(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.routers.remove(id);
  }
}
