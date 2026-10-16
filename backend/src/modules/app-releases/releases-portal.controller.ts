import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ReleaseStorageService } from './release-storage.service';
import { PORTAL_CSS } from './portal/releases-portal.css';
import { PORTAL_HTML } from './portal/releases-portal.html';
import { PORTAL_JS } from './portal/releases-portal.js';

/**
 * Portail web « Versions APK ». La coquille (HTML/JS/CSS) est publique et sans
 * donnée : toutes les opérations passent par `/admin/releases`, fermé au
 * SUPER_ADMIN. La CSP de cette route remplace celle de Helmet pour autoriser
 * l'envoi direct vers l'origine S3 configurée, et rien d'autre.
 */
@Controller('admin-portal')
@Public()
@NoEnvelope()
export class ReleasesPortalController {
  constructor(private readonly storage: ReleaseStorageService) {}

  @Get('releases')
  page(@Res({ passthrough: true }) reply: FastifyReply): string {
    const connect = ["'self'", this.storage.uploadOrigin].filter(Boolean).join(' ');
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        `connect-src ${connect}`,
        "img-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    return PORTAL_HTML;
  }

  @Get('releases.js')
  script(@Res({ passthrough: true }) reply: FastifyReply): string {
    reply.header('Content-Type', 'application/javascript; charset=utf-8');
    reply.header('Cache-Control', 'no-cache');
    return PORTAL_JS;
  }

  @Get('releases.css')
  style(@Res({ passthrough: true }) reply: FastifyReply): string {
    reply.header('Content-Type', 'text/css; charset=utf-8');
    reply.header('Cache-Control', 'no-cache');
    return PORTAL_CSS;
  }
}
