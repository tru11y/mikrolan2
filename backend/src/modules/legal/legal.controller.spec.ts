import { Controller, Get } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { LegalController } from './legal.controller';
import { PRIVACY_HTML, REMOTE_ACCESS_HTML, TERMS_HTML } from './legal.content';
import { LEGAL_VERSIONS } from './legal.versions';

@Controller('probe')
class ProbeController {
  @Get()
  json() {
    return { ok: true };
  }
}

// Régression : l'intercepteur global emballait la chaîne HTML dans un objet et Fastify
// répondait 500 (« Attempted to send payload of invalid type 'object' »).
describe('LegalController (HTTP, intercepteur global actif)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LegalController, ProbeController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: ResponseInterceptor }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['/legal/terms', TERMS_HTML],
    ['/legal/privacy', PRIVACY_HTML],
    ['/legal/remote-access', REMOTE_ACCESS_HTML],
  ])('%s répond 200 en HTML brut, sans enveloppe', async (url, html) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe(html);
  });

  it('/legal/versions conserve l\'enveloppe JSON (lue par le mobile avec unwrap)', async () => {
    const res = await app.inject({ method: 'GET', url: '/legal/versions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: LEGAL_VERSIONS, message: null, error: null });
  });

  it("l'enveloppe JSON reste appliquée aux autres routes", async () => {
    const res = await app.inject({ method: 'GET', url: '/probe' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { ok: true }, message: null, error: null });
  });
});
