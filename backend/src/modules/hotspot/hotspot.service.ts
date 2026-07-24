import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ManagementMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import {
  configureHotspot,
  listHotspotServers,
  type HotspotServer,
} from '../../common/routeros/hotspot.ops';
import type { ConfigureHotspotDto } from './dto/hotspot.schemas';

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
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true, mode: true },
    });
    if (!router) throw new NotFoundException('Router not found');
    if (router.mode !== ManagementMode.REMOTE) {
      throw new BadRequestException(
        'Routeur local : les serveurs se lisent via le LAN',
      );
    }
    return this.remote.run(routerId, (client) => listHotspotServers(client));
  }

  private async assertRouter(routerId: string): Promise<void> {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true },
    });
    if (!router) throw new NotFoundException('Router not found');
  }
}
