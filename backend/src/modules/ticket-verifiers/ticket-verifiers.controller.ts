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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { TenantContext } from '../../common/context/tenant-context';
import { TicketVerifiersService } from './ticket-verifiers.service';
import {
  createVerifierSchema,
  listVerifiersQuerySchema,
  resetPasswordSchema,
  updateStatusSchema,
  updateVerifierSchema,
  upsertAssignmentSchema,
  type CreateVerifierDto,
  type ListVerifiersQuery,
  type ResetPasswordDto,
  type UpdateStatusDto,
  type UpdateVerifierDto,
  type UpsertAssignmentDto,
} from './dto/verifier.schemas';

// ADMIN+ gated — RolesGuard's hierarchy lets ADMIN/OWNER/SUPER_ADMIN through
// and refuses MEMBER (rank 1 < 2) and TICKET_VERIFIER (disjoint role).
@Controller('ticket-verifiers')
@Roles(UserRole.ADMIN)
export class TicketVerifiersController {
  constructor(private readonly svc: TicketVerifiersService) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() ctx: TenantContext,
    @Body(new ZodValidationPipe(createVerifierSchema)) dto: CreateVerifierDto,
  ) {
    return this.svc.create(ctx, dto);
  }

  @Get()
  list(
    @CurrentUser() ctx: TenantContext,
    @Query(new ZodValidationPipe(listVerifiersQuerySchema))
    query: ListVerifiersQuery,
  ) {
    return this.svc.list(ctx, query);
  }

  @Get(':id')
  get(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.get(ctx, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateVerifierSchema)) dto: UpdateVerifierDto,
  ) {
    return this.svc.update(ctx, id, dto);
  }

  @Patch(':id/assignment')
  upsertAssignment(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(upsertAssignmentSchema)) dto: UpsertAssignmentDto,
  ) {
    return this.svc.upsertAssignment(ctx, id, dto);
  }

  @Delete(':id/assignment')
  removeAssignment(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.removeAssignment(ctx, id);
  }

  @Patch(':id/status')
  setStatus(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateStatusSchema)) dto: UpdateStatusDto,
  ) {
    return this.svc.setStatus(ctx, id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
  ) {
    return this.svc.resetPassword(ctx, id, dto);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(200)
  revokeSessions(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.revokeSessions(ctx, id);
  }

  @Delete(':id')
  softDelete(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.softDelete(ctx, id);
  }
}
