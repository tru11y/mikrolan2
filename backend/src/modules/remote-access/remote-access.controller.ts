import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Optional,
  Param,
  ParseUUIDPipe,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuditAction, UserRole } from '@prisma/client';
import { z } from 'zod';
import { BusinessException } from '../../common/exceptions/business.exception';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../../common/error-codes';
import { EventLogService } from '../events/event-log.service';
import { RemoteAccessService } from './remote-access.service';
import { RemoteRouterService } from './remote-router.service';

// Operators sometimes move RouterOS management services off their default
// ports (most commonly `www` from 80 → 87 for hardening). The mobile app
// probes the router's `/ip service` right before provisioning and hands the
// observed ports to the backend so the VPS DNAT targets a listening port.
const provisionSchema = z
  .object({
    webfigPort: z.coerce.number().int().min(1).max(65535).optional(),
    sshPort: z.coerce.number().int().min(1).max(65535).optional(),
    winboxPort: z.coerce.number().int().min(1).max(65535).optional(),
  })
  .default({});
type ProvisionDto = z.infer<typeof provisionSchema>;

const openAccessSchema = z
  .object({
    durationMinutes: z.coerce.number().int().min(5).max(60).default(15),
  })
  .default({});
type OpenAccessDto = z.infer<typeof openAccessSchema>;

/** `::ffff:1.2.3.4` → `1.2.3.4` ; null si l'adresse n'est pas de l'IPv4 valide. */
export function clientIpv4(ip: string): string | null {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const octets = v4.split('.');
  const valid =
    octets.length === 4 &&
    octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
  return valid ? v4 : null;
}

@Controller('routers/:id/remote')
export class RemoteAccessController {
  private readonly logger = new Logger(RemoteAccessController.name);

  constructor(
    private readonly remote: RemoteAccessService,
    private readonly remoteRouter: RemoteRouterService,
    private readonly prisma: PrismaService,
    private readonly eventLog: EventLogService,
  ) {}

  @Get()
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.remote.status(id);
  }

  @Get('system-resource')
  systemResource(@Param('id', ParseUUIDPipe) id: string) {
    return this.remoteRouter.systemResource(id);
  }

  @Post('provision')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  provision(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Optional()
    @Body(new ZodValidationPipe(provisionSchema))
    dto: ProvisionDto = {},
  ) {
    return this.remote.provision(id, user.userId, dto);
  }

  @Post('open-access')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  openAccess(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: FastifyRequest,
    @Optional()
    @Body(new ZodValidationPipe(openAccessSchema))
    dto: OpenAccessDto = { durationMinutes: 15 },
  ) {
    const sourceIp = clientIpv4(req.ip);
    if (!sourceIp) {
      throw new BusinessException(HttpStatus.BAD_REQUEST, ErrorCode.REMOTE_ACCESS_IPV4_REQUIRED, "L'accès direct nécessite une connexion IPv4.");
    }
    return this.remote.openAccess(id, user.userId, sourceIp, dto.durationMinutes);
  }

  @Post('close-access')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  closeAccess(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.remote.closeAccess(id, user.userId);
  }

  @Post('revoke')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  revoke(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.remote.revoke(id, user.userId);
  }

  @Post('reboot')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  async reboot(
    @CurrentUser() user: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    try {
      await this.remoteRouter.reboot(id);
    } catch (err) {
      this.logger.warn(`Router ${id} reboot failed: ${err instanceof Error ? err.message : err}`);
      await this.eventLog.failure(
        AuditAction.REBOOT, 'Diagnostic', id, err,
        { source: 'diagnostic', errorCode: ErrorCode.ROUTER_REBOOT_FAILED },
        { tenantId: user.tenantId, userId: user.userId },
      );
      throw err;
    }
    await this.eventLog.success(
      AuditAction.REBOOT, 'Diagnostic', id, { source: 'diagnostic' },
      { tenantId: user.tenantId, userId: user.userId },
    );
    return { rebooted: true };
  }
}
