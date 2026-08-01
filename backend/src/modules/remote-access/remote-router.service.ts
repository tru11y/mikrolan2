import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RemotePeerStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { getTenantContext } from '../../common/context/tenant-context';
import {
  RouterOsApiError,
  RouterOsAuthError,
  type ApiRow,
  type RouterOsApiClient,
  withRouterOsApi,
} from '../../common/routeros/routeros-api.client';

// RouterOS binary API — enabled by default (no `www`/REST service needed).
const ROUTEROS_API_PORT = 8728;
const REQUEST_TIMEOUT_MS = 8000;

/**
 * Drives a router from the backend over the WireGuard tunnel using the RouterOS
 * binary API (8728), the same protocol the mobile app speaks on the LAN. Uses
 * the router credentials stored encrypted at rest (pushed on PRO activation).
 *
 * `run()` is the shared entry point every remote router operation composes on
 * (hotspot config, voucher push, session polling): it enforces the PRO gate,
 * decrypts the credentials, opens an authenticated 8728 session over the tunnel,
 * and always closes it. No arbitrary command passthrough is exposed over HTTP.
 */
@Injectable()
export class RemoteRouterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async run<T>(
    routerId: string,
    fn: (client: RouterOsApiClient) => Promise<T>,
  ): Promise<T> {
    const tenantId = getTenantContext()?.tenantId;
    if (!tenantId || !(await this.subscriptions.isRemoteAllowed(tenantId))) {
      throw new ForbiddenException('Abonnement PRO actif requis');
    }

    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true, credEncrypted: true },
    });
    if (!router) throw new NotFoundException('Router not found');
    if (!router.credEncrypted) {
      throw new BadRequestException(
        'Identifiants RouterOS non configurés pour ce routeur',
      );
    }

    const peer = await this.prisma.remotePeer.findFirst({
      where: { routerId, status: RemotePeerStatus.ACTIVE },
      select: { wgIp: true },
    });
    if (!peer) throw new BadRequestException('Tunnel non provisionné');

    const creds = JSON.parse(this.crypto.decrypt(router.credEncrypted)) as {
      username: string;
      password: string;
    };

    try {
      return await withRouterOsApi(
        {
          host: peer.wgIp,
          port: ROUTEROS_API_PORT,
          username: creds.username,
          password: creds.password,
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
        fn,
      );
    } catch (e) {
      if (e instanceof RouterOsAuthError) {
        throw new BadRequestException('Identifiants RouterOS incorrects');
      }
      if (e instanceof RouterOsApiError) {
        throw new ServiceUnavailableException(`RouterOS: ${e.message}`);
      }
      throw new ServiceUnavailableException('Routeur injoignable via le tunnel');
    }
  }

  async systemResource(routerId: string): Promise<ApiRow> {
    const rows = await this.run(routerId, (c) =>
      c.command(['/system/resource/print']),
    );
    return rows[0] ?? {};
  }

  async reboot(routerId: string): Promise<void> {
    await this.run(routerId, (c) => c.command(['/system/reboot']));
  }
}
