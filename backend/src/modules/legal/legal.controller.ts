import { Controller, Get, Header } from '@nestjs/common';
import { NoEnvelope } from '../../common/decorators/no-envelope.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { TERMS_HTML, PRIVACY_HTML, REMOTE_ACCESS_HTML } from './legal.content';
import { LEGAL_VERSIONS } from './legal.versions';

// Ces pages renvoient du HTML brut : l'enveloppe JSON globale les transformerait en objet,
// que Fastify refuse d'envoyer avec un Content-Type text/html (500).
@Controller('legal')
export class LegalController {
  @Public()
  @NoEnvelope()
  @Get('terms')
  @Header('Content-Type', 'text/html; charset=utf-8')
  terms() {
    return TERMS_HTML;
  }

  @Public()
  @NoEnvelope()
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacy() {
    return PRIVACY_HTML;
  }

  @Public()
  @Get('remote-access')
  @Header('Content-Type', 'text/html; charset=utf-8')
  remoteAccess() {
    return REMOTE_ACCESS_HTML;
  }

  @Public()
  @Get('versions')
  versions() {
    return LEGAL_VERSIONS;
  }
}
