import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../../config/configuration';

const exec = promisify(execFile);

const SSH_PORT_OFFSET = 1000;
const WINBOX_PORT_OFFSET = 2000;

function assertIp(ip: string): void {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    throw new Error(`Invalid IP: ${ip}`);
  }
}
function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
}

export { SSH_PORT_OFFSET, WINBOX_PORT_OFFSET };

// Ports the router-side services listen on. The DNAT target defaults to the
// RouterOS out-of-the-box values, but each RemotePeer can override them (an
// operator moving `www` off port 80 is common). Callers pass the per-peer
// ports explicitly so the router-side change never silently drifts.
export type ServicePorts = {
  webfigPort: number;
  sshPort: number;
  winboxPort: number;
};

const DEFAULT_SERVICE_PORTS: ServicePorts = {
  webfigPort: 80,
  sshPort: 22,
  winboxPort: 8291,
};

@Injectable()
export class WireGuardService implements OnModuleInit {
  private readonly logger = new Logger(WireGuardService.name);
  private dnatReady = false;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async onModuleInit(): Promise<void> {
    if (this.enabled) {
      await this.ensureDnatInfrastructure();
    }
  }

  get enabled(): boolean {
    return this.config.get('WG_ENABLED', { infer: true });
  }

  get serverPublicKey(): string {
    return this.config.get('WG_SERVER_PUBLIC_KEY', { infer: true });
  }

  get endpoint(): string {
    return this.config.get('WG_ENDPOINT', { infer: true });
  }

  private get iface(): string {
    return this.config.get('WG_INTERFACE', { infer: true });
  }

  /** Adds a peer to the VPS interface. No-op (logged) when WG is disabled. */
  async addPeer(publicKey: string, wgIp: string): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        `[WG disabled] would add peer ${publicKey} -> ${wgIp}/32 on ${this.iface}`,
      );
      return;
    }
    await exec('wg', [
      'set',
      this.iface,
      'peer',
      publicKey,
      'allowed-ips',
      `${wgIp}/32`,
    ]);
  }

  async removePeer(publicKey: string): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(`[WG disabled] would remove peer ${publicKey}`);
      return;
    }
    await exec('wg', ['set', this.iface, 'peer', publicKey, 'remove']);
  }

  /**
   * Reconciles the live interface to exactly the given set of peers: adds or
   * updates each wanted peer and removes any extra one. The DB is the source of
   * truth, so this restores peers lost to a wg/VPS restart (runtime `wg set`
   * peers are not persisted) and prunes revoked leftovers. Idempotent.
   */
  async syncPeers(peers: { wgPublicKey: string; wgIp: string }[]): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(`[WG disabled] would sync ${peers.length} peer(s)`);
      return;
    }
    for (const p of peers) {
      await exec('wg', [
        'set',
        this.iface,
        'peer',
        p.wgPublicKey,
        'allowed-ips',
        `${p.wgIp}/32`,
      ]);
    }
    const { stdout } = await exec('wg', ['show', this.iface, 'peers']);
    const live = stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const wanted = new Set(peers.map((p) => p.wgPublicKey));
    for (const pk of live) {
      if (!wanted.has(pk)) {
        await exec('wg', ['set', this.iface, 'peer', pk, 'remove']);
      }
    }
  }

  /** Map of peer public key → last handshake (unix seconds; 0 = never). */
  async latestHandshakes(): Promise<Record<string, number>> {
    if (!this.enabled) return {};
    const { stdout } = await exec('wg', [
      'show',
      this.iface,
      'latest-handshakes',
    ]);
    const out: Record<string, number> = {};
    for (const line of stdout.split('\n')) {
      const [pk, ts] = line.trim().split(/\s+/);
      if (pk && ts) out[pk] = Number(ts);
    }
    return out;
  }

  // ── DNAT port forwarding (WebFig / SSH / Winbox) ────────────────────────

  get vpsPublicIp(): string {
    return this.config.get('VPS_PUBLIC_IP', { infer: true });
  }

  private async ipt(args: string[]): Promise<void> {
    await exec('iptables', ['-w', '5', ...args]);
  }

  private async iptSafe(args: string[]): Promise<boolean> {
    try {
      await this.ipt(args);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDnatInfrastructure(): Promise<void> {
    if (this.dnatReady) return;

    await this.iptSafe(['-t', 'nat', '-N', 'MIKROLAN_DNAT']);
    await this.iptSafe(['-N', 'MIKROLAN_FWD']);

    const hasJumpNat = await this.iptSafe([
      '-t', 'nat', '-C', 'PREROUTING', '-j', 'MIKROLAN_DNAT',
    ]);
    if (!hasJumpNat) {
      await this.ipt(['-t', 'nat', '-A', 'PREROUTING', '-j', 'MIKROLAN_DNAT']);
    }

    const hasJumpFwd = await this.iptSafe(['-C', 'FORWARD', '-j', 'MIKROLAN_FWD']);
    if (!hasJumpFwd) {
      await this.ipt(['-A', 'FORWARD', '-j', 'MIKROLAN_FWD']);
    }

    const subnet = this.config.get('WG_SUBNET_BASE', { infer: true });
    const hasMasq = await this.iptSafe([
      '-t', 'nat', '-C', 'POSTROUTING', '-d', subnet, '-o', this.iface, '-j', 'MASQUERADE',
    ]);
    if (!hasMasq) {
      await this.ipt([
        '-t', 'nat', '-A', 'POSTROUTING', '-d', subnet, '-o', this.iface, '-j', 'MASQUERADE',
      ]);
    }

    this.dnatReady = true;
    this.logger.log('DNAT infrastructure ready (chains + MASQUERADE)');
  }

  async addDnat(
    wgIp: string,
    allocatedPort: number,
    ports: ServicePorts = DEFAULT_SERVICE_PORTS,
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(`[WG disabled] would add DNAT for ${wgIp}`);
      return;
    }
    assertIp(wgIp);
    assertPort(allocatedPort);
    assertPort(ports.webfigPort);
    assertPort(ports.sshPort);
    assertPort(ports.winboxPort);

    await this.ensureDnatInfrastructure();

    await this.ipt(['-t', 'nat', '-A', 'MIKROLAN_DNAT', '-p', 'tcp', '--dport', String(allocatedPort), '-j', 'DNAT', '--to-destination', `${wgIp}:${ports.webfigPort}`]);
    await this.ipt(['-t', 'nat', '-A', 'MIKROLAN_DNAT', '-p', 'tcp', '--dport', String(allocatedPort + SSH_PORT_OFFSET), '-j', 'DNAT', '--to-destination', `${wgIp}:${ports.sshPort}`]);
    await this.ipt(['-t', 'nat', '-A', 'MIKROLAN_DNAT', '-p', 'tcp', '--dport', String(allocatedPort + WINBOX_PORT_OFFSET), '-j', 'DNAT', '--to-destination', `${wgIp}:${ports.winboxPort}`]);
    await this.ipt(['-A', 'MIKROLAN_FWD', '-d', wgIp, '-p', 'tcp', '-m', 'multiport', '--dports', `${ports.webfigPort},${ports.sshPort},${ports.winboxPort}`, '-j', 'ACCEPT']);

    this.logger.log(
      `DNAT added: ${wgIp} (webfig:${allocatedPort}→${ports.webfigPort} ssh:${allocatedPort + SSH_PORT_OFFSET}→${ports.sshPort} winbox:${allocatedPort + WINBOX_PORT_OFFSET}→${ports.winboxPort})`,
    );
  }

  async removeDnat(
    wgIp: string,
    allocatedPort: number,
    ports: ServicePorts = DEFAULT_SERVICE_PORTS,
  ): Promise<void> {
    if (!this.enabled) return;
    assertIp(wgIp);
    assertPort(allocatedPort);
    assertPort(ports.webfigPort);
    assertPort(ports.sshPort);
    assertPort(ports.winboxPort);

    await this.iptSafe(['-t', 'nat', '-D', 'MIKROLAN_DNAT', '-p', 'tcp', '--dport', String(allocatedPort), '-j', 'DNAT', '--to-destination', `${wgIp}:${ports.webfigPort}`]);
    await this.iptSafe(['-t', 'nat', '-D', 'MIKROLAN_DNAT', '-p', 'tcp', '--dport', String(allocatedPort + SSH_PORT_OFFSET), '-j', 'DNAT', '--to-destination', `${wgIp}:${ports.sshPort}`]);
    await this.iptSafe(['-t', 'nat', '-D', 'MIKROLAN_DNAT', '-p', 'tcp', '--dport', String(allocatedPort + WINBOX_PORT_OFFSET), '-j', 'DNAT', '--to-destination', `${wgIp}:${ports.winboxPort}`]);
    await this.iptSafe(['-D', 'MIKROLAN_FWD', '-d', wgIp, '-p', 'tcp', '-m', 'multiport', '--dports', `${ports.webfigPort},${ports.sshPort},${ports.winboxPort}`, '-j', 'ACCEPT']);

    this.logger.log(`DNAT removed: ${wgIp}`);
  }

  async syncDnat(
    peers: {
      wgIp: string;
      allocatedPort: number;
      webfigPort?: number;
      sshPort?: number;
      winboxPort?: number;
    }[],
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(`[WG disabled] would sync DNAT for ${peers.length} peer(s)`);
      return;
    }

    await this.ensureDnatInfrastructure();

    await this.iptSafe(['-t', 'nat', '-F', 'MIKROLAN_DNAT']);
    await this.iptSafe(['-F', 'MIKROLAN_FWD']);

    for (const p of peers) {
      assertIp(p.wgIp);
      assertPort(p.allocatedPort);
      const webfigPort = p.webfigPort ?? DEFAULT_SERVICE_PORTS.webfigPort;
      const sshPort = p.sshPort ?? DEFAULT_SERVICE_PORTS.sshPort;
      const winboxPort = p.winboxPort ?? DEFAULT_SERVICE_PORTS.winboxPort;
      assertPort(webfigPort);
      assertPort(sshPort);
      assertPort(winboxPort);
      await this.ipt(['-t', 'nat', '-A', 'MIKROLAN_DNAT', '-p', 'tcp', '--dport', String(p.allocatedPort), '-j', 'DNAT', '--to-destination', `${p.wgIp}:${webfigPort}`]);
      await this.ipt(['-t', 'nat', '-A', 'MIKROLAN_DNAT', '-p', 'tcp', '--dport', String(p.allocatedPort + SSH_PORT_OFFSET), '-j', 'DNAT', '--to-destination', `${p.wgIp}:${sshPort}`]);
      await this.ipt(['-t', 'nat', '-A', 'MIKROLAN_DNAT', '-p', 'tcp', '--dport', String(p.allocatedPort + WINBOX_PORT_OFFSET), '-j', 'DNAT', '--to-destination', `${p.wgIp}:${winboxPort}`]);
      await this.ipt(['-A', 'MIKROLAN_FWD', '-d', p.wgIp, '-p', 'tcp', '-m', 'multiport', '--dports', `${webfigPort},${sshPort},${winboxPort}`, '-j', 'ACCEPT']);
    }

    this.logger.log(`DNAT synced: ${peers.length} peer(s)`);
  }
}
