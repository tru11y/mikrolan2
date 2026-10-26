import { Controller, Get, HttpStatus, Logger, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PRIVACY_HTML, REMOTE_ACCESS_HTML, TERMS_HTML } from '../legal/legal.content';
import { AppReleasesService } from './app-releases.service';
import { landingPage, unavailablePage } from './public-download.page';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Site public de téléchargement de l'APK (version active) : une page, un lien et les textes légaux,
 * sans compte. Aucune donnée sensible : version, taille et une URL signée de courte durée, générée à
 * chaque clic. Le portail d'administration (`/admin-portal/releases`) reste réservé au SUPER_ADMIN.
 *
 * Tous les liens de la page sont RELATIFS (`download/apk`, `download/conditions`, …) : elle fonctionne
 * sous `/api/download` comme à la racine d'un domaine dédié (voir backend/deploy/Caddyfile.download).
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
      reply.status(HttpStatus.SERVICE_UNAVAILABLE).send(unavailablePage());
      return;
    }
    reply.status(HttpStatus.OK).send(landingPage(release));
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

  @Get('conditions')
  conditions(@Res() reply: FastifyReply): void {
    this.legal(reply, TERMS_HTML);
  }

  @Get('confidentialite')
  privacy(@Res() reply: FastifyReply): void {
    this.legal(reply, PRIVACY_HTML);
  }

  @Get('acces-distant')
  remoteAccess(@Res() reply: FastifyReply): void {
    this.legal(reply, REMOTE_ACCESS_HTML);
  }

  /**
   * Mêmes textes que `/api/legal/*`, servis sous le nom du site. Leurs liens internes pointent vers
   * `/api/legal/...` (introuvable sous ce nom) : on les ramène aux pages sœurs, en relatif.
   */
  private legal(reply: FastifyReply, html: string): void {
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Cache-Control', 'no-store');
    reply.status(HttpStatus.OK).send(
      html
        .replace(/href="\/api\/legal\/privacy"/g, 'href="confidentialite"')
        .replace(/href="\/api\/legal\/remote-access"/g, 'href="acces-distant"')
        .replace(/href="\/api\/legal\/terms"/g, 'href="conditions"'),
    );
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
