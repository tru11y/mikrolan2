import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { AdminBypassInterceptor } from '../../common/interceptors/admin-bypass.interceptor';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SubscriptionsService } from './subscriptions.service';
import { TiersService } from './tiers.service';
import { activateSchema, type ActivateDto } from './dto/subscription.schemas';
import {
  requestUpgradeSchema,
  type RequestUpgradeDto,
} from './dto/tier.schemas';

@Controller('subscriptions')
@AlwaysAllowed() // un client verrouillé doit pouvoir payer
export class SubscriptionsController {
  constructor(
    private readonly subs: SubscriptionsService,
    private readonly tiers: TiersService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: TenantContext) {
    return this.subs.getForTenant(user.tenantId);
  }

  /**
   * Grille tarifaire lue par l'application. Ouverte à tout compte authentifié :
   * c'est ce qui remplace les prix écrits en dur dans l'écran d'abonnement.
   */
  @Get('tiers')
  tiersList() {
    return this.tiers.listActive();
  }

  @Post('request-upgrade')
  @Roles(UserRole.OWNER)
  @HttpCode(200)
  requestUpgrade(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(requestUpgradeSchema)) dto: RequestUpgradeDto,
  ) {
    return this.subs.requestUpgrade(
      user.tenantId,
      user.userId,
      dto.note,
      dto.tierKey,
      dto.billingPeriod,
    );
  }

  @Get('payment-info')
  paymentInfo() {
    return this.subs.getPaymentInfo();
  }

  @Get('invoices')
  invoiceHistory(@CurrentUser() user: TenantContext) {
    return this.subs.getInvoiceHistory(user.tenantId);
  }

  @Post('upload-proof')
  @Roles(UserRole.OWNER)
  @HttpCode(200)
  uploadProof(): never {
    throw new BusinessException(
      HttpStatus.GONE,
      ErrorCode.MANUAL_PAYMENT_PROOF_DISABLED,
      "L'envoi de preuve de paiement manuel est désactivé. Mettez l'application à jour pour payer en ligne via SasPay.",
    );
  }

  /**
   * FIND-004 fix: the only way to retrieve a payment proof's file content.
   * Replaces the formerly-public static route (`/uploads/proofs/...`,
   * removed from main.ts). Authorization is enforced inside
   * SubscriptionsService.getProofFile — SUPER_ADMIN or the owning tenant
   * only; every other case (anonymous, wrong tenant, unknown id) is a 404,
   * never a distinguishing 401/403 that would confirm a proof's existence.
   * Standard JwtAuthGuard (global) already rejects unauthenticated callers
   * before this handler runs.
   */
  @Get('proofs/:proofId')
  @Roles(UserRole.OWNER, UserRole.SUPER_ADMIN)
  @NoEnvelope() // StreamableFile must reach Nest's Fastify reply undecorated
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  getProof(
    @CurrentUser() user: TenantContext,
    @Param('proofId', ParseUUIDPipe) proofId: string,
  ) {
    return this.subs.getProofFile(user, proofId);
  }

  // ── Platform admin (manual validation) ──────────────────
  @Post(':tenantId/activate')
  @Roles(UserRole.SUPER_ADMIN)
  @UseInterceptors(AdminBypassInterceptor)
  @HttpCode(200)
  activate(
    @CurrentUser() actor: TenantContext,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body(new ZodValidationPipe(activateSchema)) dto: ActivateDto,
  ) {
    return this.subs.activateManually(
      tenantId,
      actor.userId,
      dto.periodDays,
      dto.invoiceId,
    );
  }

  @Post(':tenantId/deactivate')
  @Roles(UserRole.SUPER_ADMIN)
  @UseInterceptors(AdminBypassInterceptor)
  @HttpCode(200)
  deactivate(
    @CurrentUser() actor: TenantContext,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.subs.deactivate(tenantId, actor.userId);
  }
}
