import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SupportService } from './support.service';
import {
  createTicketSchema,
  listMyTicketsSchema,
  ticketMessageSchema,
  type CreateTicketDto,
  type ListMyTicketsDto,
  type TicketMessageDto,
} from './dto/support.schemas';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('tickets')
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(createTicketSchema)) dto: CreateTicketDto,
  ) {
    return this.support.create(user.tenantId, user.userId, dto);
  }

  @Get('tickets')
  list(
    @CurrentUser() user: TenantContext,
    @Query(new ZodValidationPipe(listMyTicketsSchema)) query: ListMyTicketsDto,
  ) {
    return this.support.listMine(user.tenantId, query);
  }

  @Get('tickets/:id')
  getOne(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.support.getOne(user.tenantId, id);
  }

  @Post('tickets/:id/messages')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  addMessage(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ticketMessageSchema)) dto: TicketMessageDto,
  ) {
    return this.support.addMessage(user.tenantId, id, user.userId, dto.body);
  }
}
