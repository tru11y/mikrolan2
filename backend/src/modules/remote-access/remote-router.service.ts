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

const ROUTEROS_REST_PORT = 80;
const REQUEST_TIMEOUT_MS = 8000;

export type RestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Proxies RouterOS REST calls from the backend to a router over the WireGuard
 * tunnel (PRO). Uses the router credentials stored encrypted at rest.
 */
@Injectable()
export class RemoteRouterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async request(
    routerId: string,
    method: RestMethod,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
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

    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `http://${peer.wgIp}:${ROUTEROS_REST_PORT}/rest${cleanPath}`;
    const auth = Buffer.from(
      `${creds.username}:${creds.password}`,
    ).toString('base64');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) {
        throw new ServiceUnavailableException(
          `RouterOS a répondu ${res.status}`,
        );
      }
      return data;
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException('Routeur injoignable via le tunnel');
    } finally {
      clearTimeout(timer);
    }
  }

  systemResource(routerId: string): Promise<unknown> {
    return this.request(routerId, 'GET', '/system/resource');
  }
}
