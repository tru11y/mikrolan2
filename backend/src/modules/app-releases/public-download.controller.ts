import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AppReleasesService } from './app-releases.service';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;

const page = (body: string): string => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Télécharger MikroLan</title>
<style>body{margin:0;background:#0b0b12;color:#ecedf5;font:16px/1.5 system-ui,sans-serif}
main{max-width:520px;margin:0 auto;padding:32px 20px}h1{font-size:26px;margin:0 0 4px}
.v{color:#9aa0b8;margin:0 0 24px}a.btn{display:block;text-align:center;background:#6c5ce7;color:#fff;
text-decoration:none;font-weight:700;padding:16px;border-radius:12px;margin:20px 0}
ol{padding-left:20px;color:#c9cce0}li{margin:8px 0}.n{color:#9aa0b8;font-size:14px}</style></head>
<body><main>${body}</main></body></html>`;

/**
 * Téléchargement public de l'APK de la version active : une page et un lien, sans compte.
 * Aucune donnée sensible : version, taille et une URL signée de courte durée, générée à chaque clic.
 * Le portail d'administration (`/admin-portal/releases`) reste réservé au SUPER_ADMIN.
 */
@Controller('download')
@Public()
@NoEnvelope()
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class PublicDownloadController {
  private readonly logger = new Logger(PublicDownloadController.name);

  constructor(private readonly releases: AppReleasesService) {}

  @Get()
  async landing(@Res() reply: FastifyReply): Promise<void> {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Content-Security-Policy', CSP);
    reply.header('Cache-Control', 'no-store');
    const release = await this.activeRelease();
    if (!release) {
      reply.status(HttpStatus.SERVICE_UNAVAILABLE).send(
        page('<h1>MikroLan</h1><p>Le téléchargement est momentanément indisponible. Réessayez dans quelques minutes.</p>'),
      );
      return;
    }
    reply.status(HttpStatus.OK).send(
      page(`<h1>MikroLan</h1>
<p class="v">Version ${esc(release.versionName)} · Android · ${mb(release.fileSize)}</p>
<a class="btn" href="/api/download/apk">Télécharger l'application</a>
<h2>Installation</h2>
<ol><li>Ouvrez le fichier téléchargé (<em>mikrolan.apk</em>).</li>
<li>Si Android le demande, autorisez l'installation depuis cette source (une seule fois).</li>
<li>Ouvrez MikroLan, créez votre compte et acceptez les conditions.</li></ol>
<p class="n">Besoin d'aide ? Contactez le support MikroLan.</p>`),
    );
  }

  @Get('apk')
  async apk(@Res() reply: FastifyReply): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    const release = await this.activeRelease();
    if (!release?.downloadUrl) {
      reply.status(HttpStatus.SERVICE_UNAVAILABLE).header('Content-Type', 'text/plain; charset=utf-8').send('Téléchargement indisponible.');
      return;
    }
    reply.status(HttpStatus.FOUND).header('Location', release.downloadUrl).send();
  }

  /** Release active, ou null si aucune ou si le fichier / le stockage est indisponible. */
  private async activeRelease() {
    try {
      return await this.releases.latestForTenant();
    } catch (err) {
      this.logger.warn(`Téléchargement public indisponible : ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
