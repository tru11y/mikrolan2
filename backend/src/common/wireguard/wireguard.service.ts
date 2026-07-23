import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../../config/configuration';

const exec = promisify(execFile);

@Injectable()
export class WireGuardService {
  private readonly logger = new Logger(WireGuardService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

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
}
