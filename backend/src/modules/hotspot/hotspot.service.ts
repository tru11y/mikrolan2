import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ManagementMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RemoteRouterService } from '../remote-access/remote-router.service';
import {
  addIpBinding,
  updateIpBinding,
  configureHotspot,
  getHotspotSettings,
  isInternetSharingBlocked,
  listHotspotServers,
  listIpBindings,
  listUserProfiles,
  removeIpBinding,
  setHotspotSettings,
  setInternetSharingBlocked,
  type HotspotServer,
  type HotspotSettings,
  type IpBinding,
  type UserProfile,
} from '../../common/routeros/hotspot.ops';
import type {
  ConfigureHotspotDto,
  CreateIpBindingDto,
  UpdateHotspotSettingsDto,
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

  async listUserProfiles(routerId: string): Promise<UserProfile[]> {
    await this.assertRemote(routerId);
    return this.remote.run(routerId, (client) => listUserProfiles(client));
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

  async updateIpBinding(routerId: string, bindingId: string, dto: Partial<CreateIpBindingDto>) {
    await this.assertRemote(routerId);
    await this.remote.run(routerId, (client) =>
      updateIpBinding(client, bindingId, dto),
    );
    return { id: bindingId, ...dto };
  }

  async removeIpBinding(routerId: string, bindingId: string) {
    await this.assertRemote(routerId);
    await this.remote.run(routerId, (client) =>
      removeIpBinding(client, bindingId),
    );
    return { removed: true };
  }

  /**
   * Anti-tethering toggle (TTL mangle rule). ⚠️ Applies a live firewall change
   * to the router the operator manages — never triggered automatically; the
   * app calls this only on explicit user action.
   */
  async getInternetSharing(routerId: string): Promise<{ blocked: boolean }> {
    await this.assertRemote(routerId);
    const blocked = await this.remote.run(routerId, (client) =>
      isInternetSharingBlocked(client),
    );
    return { blocked };
  }

  async setInternetSharing(
    routerId: string,
    blocked: boolean,
  ): Promise<{ blocked: boolean }> {
    await this.assertRemote(routerId);
    await this.remote.run(routerId, (client) =>
      setInternetSharingBlocked(client, blocked),
    );
    return { blocked };
  }

  /** Idle-timeout + DNS name of the hotspot server profile. Low-risk (no live traffic impact until a client actually idles/logs in). */
  async getSettings(
    routerId: string,
    server: string,
  ): Promise<HotspotSettings> {
    await this.assertRemote(routerId);
    return this.remote.run(routerId, (client) =>
      getHotspotSettings(client, server),
    );
  }

  async updateSettings(
    routerId: string,
    dto: UpdateHotspotSettingsDto,
  ): Promise<HotspotSettings> {
    await this.assertRemote(routerId);
    const { server, ...settings } = dto;
    await this.remote.run(routerId, (client) =>
      setHotspotSettings(client, server, settings),
    );
    return this.getSettings(routerId, server);
  }

  private async assertRemote(routerId: string): Promise<void> {
    const router = await this.prisma.router.findFirst({
      where: { id: routerId, deletedAt: null },
      select: { id: true, mode: true },
    });
    if (!router) throw new NotFoundException('Routeur introuvable — il a peut-être été supprimé.');
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
    if (!router) throw new NotFoundException('Routeur introuvable — il a peut-être été supprimé.');
  }
}
