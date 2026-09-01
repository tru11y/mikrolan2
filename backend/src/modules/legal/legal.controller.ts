import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { TERMS_HTML, PRIVACY_HTML } from './legal.content';

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
}
