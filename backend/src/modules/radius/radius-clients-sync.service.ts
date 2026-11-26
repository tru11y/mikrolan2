import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { execFile } from "node:child_process";
import { ManagementMode, RouterLinkAuthMode } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CryptoService } from "../../common/crypto/crypto.service";
import type { AppConfig } from "../../config/configuration";

/** Wrapper root installé sur le VPS (sudoers fixe, lecture STDIN, voir backend/deploy/radius/). */
const SYNC_WRAPPER = "/usr/local/sbin/mikrolan-radius-sync";

/**
 * Génère le fichier `clients.conf` de FreeRADIUS (un bloc `client {}` par NAS
 * provisionné) et le pousse sur le VPS via le wrapper root `mikrolan-radius-sync`
 * (sudo -n, contenu sur STDIN — jamais en argv : le secret RADIUS n'apparaît dans
 * aucune ligne de commande ni journal). Le wrapper valide, écrit atomiquement
 * `clients.d/mikrolan-clients.conf` puis recharge FreeRADIUS (HUP).
 *
 * C'est le chaînon API→FreeRADIUS : sans lui, FreeRADIUS ne connaît aucun NAS et
 * rejette tout Access-Request AVANT même d'appeler l'API. Inerte si
 * RADIUS_ENABLED=false (aucun FreeRADIUS à alimenter).
 */
@Injectable()
export class RadiusClientsSyncService {
  private readonly logger = new Logger(RadiusClientsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Régénère et pousse la liste complète des clients RADIUS. Idempotent :
   * reconstruit toujours l'intégralité du fichier depuis la base (pas de delta).
   * No-op si RADIUS désactivé. Retourne le nombre de NAS écrits.
   */
  async sync(): Promise<number> {
    if (!this.config.get("RADIUS_ENABLED", { infer: true })) {
      return 0;
    }
    const conf = await this.buildClientsConf();
    await this.push(conf.content);
    this.logger.log({ event: "radius.clients_synced", nas: conf.count });
    return conf.count;
  }

  /**
   * Construit le contenu de clients.conf depuis la base : chaque routeur REMOTE,
   * membre d'un lien RADIUS, disposant d'un secret chiffré ET d'une IP WireGuard
   * (RemotePeer.wgIp = IP source du NAS vers 10.20.0.1 via wg-mgmt, stable même si
   * le routeur a plusieurs liens fibre : RADIUS passe par le tunnel, pas le WAN).
   * Dédupliqué par routeur (un NAS = un bloc, sinon FreeRADIUS refuse le doublon d'ipaddr).
   */
  private async buildClientsConf(): Promise<{
    content: string;
    count: number;
  }> {
    const members = await this.prisma.routerLinkMember.findMany({
      where: {
        // Seuls les membres effectivement provisionnés (use-radius confirmé côté
        // routeur) sont enrôlés : deactivate remet radiusReadyAt=null → le NAS
        // sort de clients.conf au prochain sync.
        radiusReadyAt: { not: null },
        link: { authMode: RouterLinkAuthMode.RADIUS },
        router: {
          mode: ManagementMode.REMOTE,
          radiusSecretEncrypted: { not: null },
          remotePeer: { isNot: null },
        },
      },
      select: {
        router: {
          select: {
            id: true,
            radiusSecretEncrypted: true,
            remotePeer: { select: { wgIp: true } },
          },
        },
      },
    });

    const seen = new Set<string>();
    const blocks: string[] = [];
    for (const { router } of members) {
      if (seen.has(router.id)) continue;
      const wgIp = router.remotePeer?.wgIp;
      if (!wgIp || !router.radiusSecretEncrypted) continue;
      seen.add(router.id);
      const secret = this.crypto.decrypt(router.radiusSecretEncrypted);
      const name = `nas_${router.id.replace(/[^a-zA-Z0-9]/g, "_")}`;
      blocks.push(
        [
          `client ${name} {`,
          `    ipaddr = ${wgIp}`,
          `    secret = ${secret}`,
          `    nas_type = other`,
          `    shortname = ${name}`,
          `    require_message_authenticator = no`,
          `}`,
        ].join("\n"),
      );
    }

    const header = "# Généré par l'API MikroLan — NE PAS éditer à la main.\n";
    const content = blocks.length
      ? `${header}${blocks.join("\n\n")}\n`
      : header;
    return { content, count: seen.size };
  }

  /** Pousse le contenu via `sudo -n mikrolan-radius-sync` (STDIN, jamais argv). */
  private push(content: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = execFile(
        "sudo",
        ["-n", SYNC_WRAPPER],
        { timeout: 15_000 },
        (err, _stdout, stderr) => {
          if (err) {
            // stderr du wrapper peut contenir le motif de refus (jamais le secret).
            reject(
              new Error(
                `mikrolan-radius-sync a échoué: ${stderr?.trim() || err.message}`,
              ),
            );
            return;
          }
          resolve();
        },
      );
      child.stdin?.end(content);
    });
  }
}
