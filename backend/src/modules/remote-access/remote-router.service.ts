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
  withRouterOsApi,
} from '../../common/routeros/routeros-api.client';

// RouterOS binary API — enabled by default (no `www`/REST service needed).
const ROUTEROS_API_PORT = 8728;
const REQUEST_TIMEOUT_MS = 8000;

type RestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Maps the REST-style proxy verb onto a RouterOS API action verb.
const METHOD_ACTION: Record<RestMethod, string> = {
  GET: 'print',
  POST: 'add',
  PUT: 'set',
  PATCH: 'set',
  DELETE: 'remove',
};

/**
 * Drives a router from the backend over the WireGuard tunnel using the RouterOS
 * binary API (8728), the same protocol the mobile app speaks on the LAN. Uses
 * the router credentials stored encrypted at rest (pushed on PRO activation).
 */
@Injectable()
export class RemoteRouterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // Private on purpose: no arbitrary command passthrough is exposed over HTTP.
  // Each remotely-driven operation gets its own typed, allowlisted method below.
  private async request(
    routerId: string,
    method: RestMethod,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<ApiRow[]> {
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

    const words = this.buildSentence(method, path, body);

    try {
      return await withRouterOsApi(
        {
          host: peer.wgIp,
          port: ROUTEROS_API_PORT,
          username: creds.username,
          password: creds.password,
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
        (c) => c.command(words),
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

  /** REST-style verb + menu path → RouterOS API command word list. */
  private buildSentence(
    method: RestMethod,
    path: string,
    body?: Record<string, unknown>,
  ): string[] {
    const menu = path.startsWith('/') ? path : `/${path}`;
    const action = METHOD_ACTION[method];
    const words = [`${menu}/${action}`];

    if (action === 'set' || action === 'remove') {
      const id = body?.['.id'];
      if (typeof id !== 'string' || !id) {
        throw new BadRequestException('`.id` requis pour cette opération');
      }
      words.push(`=.id=${id}`);
    }

    if (body) {
      // GET: attributes are query filters (`?k=v`); writes: attributes (`=k=v`).
      const prefix = action === 'print' ? '?' : '=';
      for (const [k, v] of Object.entries(body)) {
        if (k === '.id') continue;
        words.push(`${prefix}${k}=${String(v)}`);
      }
    }
    return words;
  }

  async systemResource(routerId: string): Promise<ApiRow> {
    const rows = await this.request(routerId, 'GET', '/system/resource');
    return rows[0] ?? {};
  }
}
