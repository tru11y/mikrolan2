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
import { AdminService } from './admin.service';
import {
  listAuditQuerySchema,
  listInvoicesQuerySchema,
  listTenantsQuerySchema,
  listUsersQuerySchema,
  setTenantStatusSchema,
  setUserStatusSchema,
  type ListAuditQueryDto,
  type ListInvoicesQueryDto,
  type ListTenantsQueryDto,
  type ListUsersQueryDto,
  type SetTenantStatusDto,
  type SetUserStatusDto,
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
}
