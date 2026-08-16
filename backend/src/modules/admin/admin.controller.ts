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
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TiersService } from '../subscriptions/tiers.service';
import {
  createTierSchema,
  updateTierSchema,
  type CreateTierDto,
  type UpdateTierDto,
} from '../subscriptions/dto/tier.schemas';
import { AdminBypassInterceptor } from '../../common/interceptors/admin-bypass.interceptor';
import { AdminService } from './admin.service';
import {
  adminTicketMessageSchema,
  listAuditQuerySchema,
  listInvoicesQuerySchema,
  listTenantsQuerySchema,
  listTenantRoutersQuerySchema,
  listTicketsQuerySchema,
  listUsersQuerySchema,
  rejectInvoiceSchema,
  setTenantStatusSchema,
  setTicketStatusSchema,
  setUserStatusSchema,
  updateConfigSchema,
  validateInvoiceSchema,
  type AdminTicketMessageDto,
  type ListAuditQueryDto,
  type ListInvoicesQueryDto,
  type ListTenantsQueryDto,
  type ListTenantRoutersQueryDto,
  type ListTicketsQueryDto,
  type ListUsersQueryDto,
  type RejectInvoiceDto,
  type SetTenantStatusDto,
  type SetTicketStatusDto,
  type SetUserStatusDto,
  type UpdateConfigDto,
  type ValidateInvoiceDto,
} from './dto/admin.schemas';

/**
 * Back-office plateforme.
 *
 * `@Roles(SUPER_ADMIN)` est posé sur la classe : toute route ajoutée ici est
 * fermée par défaut, on ne peut pas oublier de la protéger. `@AlwaysAllowed`
 * neutralise le paywall — le tenant technique de la plateforme n'a pas
 * d'abonnement à jour et n'a pas à en avoir un.
 */
@Controller('admin')
@Roles(UserRole.SUPER_ADMIN)
@AlwaysAllowed()
@UseInterceptors(AdminBypassInterceptor)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly tiers: TiersService,
  ) {}

  // ── Comptes clients ────────────────────────────────────

  @Get('tenants')
  listTenants(
    @Query(new ZodValidationPipe(listTenantsQuerySchema)) query: ListTenantsQueryDto,
  ) {
    return this.admin.listTenants(query);
  }

  @Get('tenants/:id')
  getTenant(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getTenant(id);
  }

  @Patch('tenants/:id/status')
  @HttpCode(200)
  setTenantStatus(
    @CurrentUser() actor: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setTenantStatusSchema)) dto: SetTenantStatusDto,
  ) {
    return this.admin.setTenantStatus(id, actor, dto);
  }

  // ── Utilisateurs ───────────────────────────────────────

  @Get('users')
  listUsers(
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQueryDto,
  ) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id/status')
  @HttpCode(200)
  setUserStatus(
    @CurrentUser() actor: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setUserStatusSchema)) dto: SetUserStatusDto,
  ) {
    return this.admin.setUserStatus(id, actor, dto);
  }

  // ── Demandes d'activation ──────────────────────────────

  @Get('invoices')
  listInvoices(
    @Query(new ZodValidationPipe(listInvoicesQuerySchema)) query: ListInvoicesQueryDto,
  ) {
    return this.admin.listInvoices(query);
  }

  // ── Chiffres ───────────────────────────────────────────

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  // ── Journal d'audit ────────────────────────────────────

  @Get('audit')
  listAudit(
    @Query(new ZodValidationPipe(listAuditQuerySchema)) query: ListAuditQueryDto,
  ) {
    return this.admin.listAudit(query);
  }

  // ── Grille tarifaire ───────────────────────────────────

  @Get('tiers')
  listTiers() {
    return this.tiers.listAll();
  }

  @Post('tiers')
  @HttpCode(201)
  createTier(@Body(new ZodValidationPipe(createTierSchema)) dto: CreateTierDto) {
    return this.tiers.create(dto);
  }

  @Patch('tiers/:id')
  @HttpCode(200)
  updateTier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTierSchema)) dto: UpdateTierDto,
  ) {
    return this.tiers.update(id, dto);
  }

  /** Archivage : des factures émises pointent dessus, on ne les orpheline pas. */
  @Delete('tiers/:id')
  @HttpCode(200)
  archiveTier(@Param('id', ParseUUIDPipe) id: string) {
    return this.tiers.archive(id);
  }

  // ── Routeurs d'un tenant ──────────────────────────────

  @Get('tenants/:id/routers')
  listTenantRouters(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(listTenantRoutersQuerySchema)) query: ListTenantRoutersQueryDto,
  ) {
    return this.admin.listTenantRouters(id, query);
  }

  // ── Validation / rejet de facture ─────────────────────

  @Get('invoices/:id/proofs')
  getInvoiceProofs(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getInvoiceProofs(id);
  }

  @Post('invoices/:id/validate')
  @HttpCode(200)
  validateInvoice(
    @CurrentUser() actor: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(validateInvoiceSchema)) dto: ValidateInvoiceDto,
  ) {
    return this.admin.validateInvoice(id, actor, dto);
  }

  @Post('invoices/:id/reject')
  @HttpCode(200)
  rejectInvoice(
    @CurrentUser() actor: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectInvoiceSchema)) dto: RejectInvoiceDto,
  ) {
    return this.admin.rejectInvoice(id, actor, dto);
  }

  // ── Tickets SAV ───────────────────────────────────────

  @Get('tickets')
  listTickets(
    @Query(new ZodValidationPipe(listTicketsQuerySchema)) query: ListTicketsQueryDto,
  ) {
    return this.admin.listTickets(query);
  }

  @Get('tickets/:id')
  getTicket(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getTicket(id);
  }

  @Post('tickets/:id/messages')
  @HttpCode(201)
  replyToTicket(
    @CurrentUser() actor: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adminTicketMessageSchema)) dto: AdminTicketMessageDto,
  ) {
    return this.admin.replyToTicket(id, actor.userId, dto.body);
  }

  @Patch('tickets/:id/status')
  @HttpCode(200)
  setTicketStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setTicketStatusSchema)) dto: SetTicketStatusDto,
  ) {
    return this.admin.setTicketStatus(id, dto);
  }

  // ── Config plateforme ─────────────────────────────────

  @Get('config')
  getConfig() {
    return this.admin.getConfig();
  }

  @Patch('config')
  @HttpCode(200)
  updateConfig(
    @Body(new ZodValidationPipe(updateConfigSchema)) dto: UpdateConfigDto,
  ) {
    return this.admin.updateConfig(dto);
  }
}
