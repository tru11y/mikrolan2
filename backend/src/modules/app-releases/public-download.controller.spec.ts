import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { NO_ENVELOPE_KEY } from '../../common/decorators/no-envelope.decorator';
import { AppReleasesService } from './app-releases.service';
import { PublicDownloadController } from './public-download.controller';

const release = {
  versionName: '1.1.6',
  versionCode: 41,
  fileSize: 86_635_875,
  publishedAt: new Date('2026-10-26T12:20:33Z'),
  downloadUrl: 'https://bucket.s3.eu-west-3.amazonaws.com/releases/android/mikrolan-41.apk?X-Amz-Signature=abc',
};

describe('PublicDownloadController', () => {
  let app: NestFastifyApplication;
  const latestForTenant = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicDownloadController],
      providers: [{ provide: AppReleasesService, useValue: { latestForTenant } }],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => latestForTenant.mockReset());

  it('est public et sans enveloppe JSON', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicDownloadController)).toBe(true);
    expect(Reflect.getMetadata(NO_ENVELOPE_KEY, PublicDownloadController)).toBe(true);
  });

  it('GET /download : page complète (accroche, bouton, version, taille, date, étapes, pied légal)', async () => {
    latestForTenant.mockResolvedValue(release);
    const res = await app.inject({ method: 'GET', url: '/download' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('Gérez votre hotspot MikroTik depuis votre téléphone');
    expect(res.body).toContain('href="download/apk"');
    expect(res.body).toContain('Télécharger pour Android');
    expect(res.body).toContain('Version 1.1.6');
    expect(res.body).toContain('82,6 Mo');
    expect(res.body).toContain('publiée le 26 octobre 2026');
    expect(res.body).toContain('Installer en 5 étapes');
    expect(res.body).toContain('Télécharger quand même');
    expect(res.body).toContain('Analyser l’appli');
    expect(res.body).not.toContain('mikrolan.apk');
    expect(res.body).toContain('href="download/conditions"');
    expect(res.body).toContain('href="download/confidentialite"');
    expect(res.body).toContain('href="download/acces-distant"');
    expect(res.body).toContain('<meta name="viewport"');
  });

  it('GET /download : aucun script, aucune ressource externe, aucun secret, CSP stricte', async () => {
    latestForTenant.mockResolvedValue(release);
    const res = await app.inject({ method: 'GET', url: '/download' });
    expect(res.body).not.toContain('<script');
    expect(res.body).not.toMatch(/(src|href)="https?:/);
    expect(res.body).not.toContain('X-Amz-Signature');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).not.toContain('script-src');
  });

  it('GET /download : le nom de version est échappé', async () => {
    latestForTenant.mockResolvedValue({ ...release, versionName: '<img src=x onerror=alert(1)>' });
    const res = await app.inject({ method: 'GET', url: '/download' });
    expect(res.body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(res.body).not.toContain('<img src=x');
  });

  it("GET /download/apk : redirige (302) vers l'URL signée, sans mise en cache", async () => {
    latestForTenant.mockResolvedValue(release);
    const res = await app.inject({ method: 'GET', url: '/download/apk' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(release.downloadUrl);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('aucune release active : 503 sur la page comme sur le fichier', async () => {
    latestForTenant.mockRejectedValue(new Error('aucune release'));
    const page = await app.inject({ method: 'GET', url: '/download' });
    const apk = await app.inject({ method: 'GET', url: '/download/apk' });
    expect(page.statusCode).toBe(503);
    expect(page.body).toContain('momentanément indisponible');
    expect(apk.statusCode).toBe(503);
    expect(apk.headers.location).toBeUndefined();
  });

  it('stockage indisponible (URL absente) : 503, pas de redirection', async () => {
    latestForTenant.mockResolvedValue({ ...release, downloadUrl: null });
    const res = await app.inject({ method: 'GET', url: '/download/apk' });
    expect(res.statusCode).toBe(503);
    expect(res.headers.location).toBeUndefined();
  });

  it.each([
    ['/download/conditions', 'Conditions Générales'],
    ['/download/confidentialite', 'confidentialité'],
    ['/download/acces-distant', 'accès'],
  ])('%s : texte légal servi en HTML, sans dépendre d’une release', async (url, needle) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body.toLowerCase()).toContain(needle.toLowerCase());
    expect(latestForTenant).not.toHaveBeenCalled();
  });

  it('les liens internes des textes légaux restent sur le site (plus de /api/legal)', async () => {
    const pages = await Promise.all(
      ['/download/conditions', '/download/confidentialite', '/download/acces-distant'].map((url) =>
        app.inject({ method: 'GET', url }),
      ),
    );
    for (const p of pages) expect(p.body).not.toContain('/api/legal/');
    expect(pages[0].body).toContain('href="confidentialite"');
  });
});
