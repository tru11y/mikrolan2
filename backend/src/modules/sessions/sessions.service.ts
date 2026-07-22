import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ManagementMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import { listActive, removeActive } from '../../common/routeros/hotspot.ops';
import type { ApiRow } from '../../common/routeros/routeros-api.client';

export interface LiveSession {
  id: string; // RouterOS .id
  user: string;
  ipAddress: string | null;
  macAddress: string | null;
  bytesIn: string;
  bytesOut: string;
  uptime: string | null;
}

function mapActive(row: ApiRow): LiveSession {
  return {
    id: row['.id'] ?? '',
    user: row.user ?? '',
    ipAddress: row.address ?? null,
    macAddress: row['mac-address'] ?? null,
    bytesIn: row['bytes-in'] ?? '0',
    bytesOut: row['bytes-out'] ?? '0',
    uptime: row.uptime ?? null,
  };
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly remote: RemoteRouterService,
  ) {}

  /**
   * Live list of everyone connected to the hotspot (not just mikrolan codes).
   * REMOTE routers are read over the tunnel; LOCAL (free) routers are read by
   * the mobile app directly over the LAN.
   */
  async live(routerId: string): Promise<LiveSession[]> {
    const router = await this.getRouter(routerId);
    if (router.mode !== ManagementMode.REMOTE) {
      throw new BadRequestException(
        'Routeur local : les sessions se lisent via le LAN',
      );
    }
    const active = await this.remote.run(routerId, (c) => listActive(c));
    return active.map(mapActive);
  }

  async terminate(routerId: string, mikrotikId: string) {
    const router = await this.getRouter(routerId);
    if (router.mode !== ManagementMode.REMOTE) {
      throw new BadRequestException(
        'Routeur local : déconnexion via le LAN',
      );
    }
    await this.remote.run(routerId, (c) => removeActive(c, mikrotikId));
    return { terminated: true };
  }

  private async getRouter(routerId: string) {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true, mode: true },
    });
    if (!router) throw new NotFoundException('Router not found');
    return router;
  }
}
