import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { TERMS_HTML, PRIVACY_HTML, REMOTE_ACCESS_HTML } from './legal.content';
import { LEGAL_VERSIONS } from './legal.versions';

@Controller('legal')
export class LegalController {
  @Public()
  @Get('terms')
  @Header('Content-Type', 'text/html; charset=utf-8')
  terms() {
    return TERMS_HTML;
  }

  @Public()
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
