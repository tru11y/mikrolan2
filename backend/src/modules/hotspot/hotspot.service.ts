import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ManagementMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import {
  addIpBinding,
  configureHotspot,
  listHotspotServers,
  listIpBindings,
  removeIpBinding,
  type HotspotServer,
  type IpBinding,
} from '../../common/routeros/hotspot.ops';
import type {
  ConfigureHotspotDto,
  CreateIpBindingDto,
} from './dto/hotspot.schemas';

@Injectable()
export class HotspotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
  ) {}

  async configure(routerId: string, dto: ConfigureHotspotDto) {
    await this.assertRouter(routerId);

    const network = dto.network ?? '10.5.50.0/24';
    const [base, prefixStr] = network.split('/');
    const octets = base.split('.').map((n) => Number.parseInt(n, 10));
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) {
      throw new BadRequestException('Réseau invalide');
    }
    const [a, b, c] = octets;
    const gateway = `${a}.${b}.${c}.1`;
    const poolRange = `${a}.${b}.${c}.10-${a}.${b}.${c}.254`;

    await this.remote.run(routerId, (client) =>
      configureHotspot(client, {
        iface: dto.interface,
        gateway,
        prefix: Number.parseInt(prefixStr, 10),
        poolRange,
        network,
        dns: dto.dns ?? '8.8.8.8',
      }),
    );

    return { configured: true, gateway, network };
  }

  /** Lists hotspot servers for the ticket « Serveur Hotspot » dropdown (REMOTE only; LOCAL routers are queried by the app over the LAN). */
  async listServers(routerId: string): Promise<HotspotServer[]> {
    await this.assertRemote(routerId);
    return this.remote.run(routerId, (client) => listHotspotServers(client));
  }

  /** IP bindings (bypass/block MAC devices) — REMOTE only; LOCAL is LAN-side. */
  async listIpBindings(routerId: string): Promise<IpBinding[]> {
    await this.assertRemote(routerId);
    return this.remote.run(routerId, (client) => listIpBindings(client));
  }

  async addIpBinding(routerId: string, dto: CreateIpBindingDto) {
    await this.assertRemote(routerId);
    const mikrotikId = await this.remote.run(routerId, (client) =>
      addIpBinding(client, dto),
    );
    return { id: mikrotikId, ...dto };
  }

  async removeIpBinding(routerId: string, bindingId: string) {
    await this.assertRemote(routerId);
    await this.remote.run(routerId, (client) =>
      removeIpBinding(client, bindingId),
    );
    return { removed: true };
  }

  private async assertRemote(routerId: string): Promise<void> {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true, mode: true },
    });
    if (!router) throw new NotFoundException('Router not found');
    if (router.mode !== ManagementMode.REMOTE) {
      throw new BadRequestException(
        'Routeur local : les IP bindings se gèrent via le LAN',
      );
    }
  }

  private async assertRouter(routerId: string): Promise<void> {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true },
    });
    if (!router) throw new NotFoundException('Router not found');
  }
}
