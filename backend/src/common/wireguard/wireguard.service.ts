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
}
