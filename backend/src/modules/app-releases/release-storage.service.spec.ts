import { ConfigService } from '@nestjs/config';
import { ReleaseStorageService, safeFilename } from './release-storage.service';

const config = {
  get: (k: string) =>
    ({ RELEASES_S3_BUCKET: 'bucket-test', RELEASES_S3_REGION: 'eu-west-3', RELEASES_URL_TTL: 300 })[k],
} as unknown as ConfigService<never, true>;

const KEY = 'releases/android/mikrolan-41-8ff38170bf9f.apk';

describe('ReleaseStorageService.presignDownload', () => {
  const env = { ...process.env };

  beforeAll(() => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIATESTTESTTESTTEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-de-test-secret-de-test-secret-1';
  });

  afterAll(() => {
    process.env = env;
  });

  const disposition = (url: string) => new URL(url).searchParams.get('response-content-disposition');

  it('propose le nom demandé, pas la clé de stockage', async () => {
    const url = await new ReleaseStorageService(config).presignDownload(KEY, 'mikrolan-1.1.6.apk');
    expect(disposition(url)).toBe('attachment; filename="mikrolan-1.1.6.apk"');
    expect(url).toContain('/releases/android/mikrolan-41-8ff38170bf9f.apk');
  });

  it('sans nom : reprend la fin de la clé (comportement précédent)', async () => {
    const url = await new ReleaseStorageService(config).presignDownload(KEY);
    expect(disposition(url)).toBe('attachment; filename="mikrolan-41-8ff38170bf9f.apk"');
  });

  it("un nom hostile ne peut pas sortir de l'en-tête (guillemets, retours à la ligne, chemins)", async () => {
    const url = await new ReleaseStorageService(config).presignDownload(KEY, '../x"\r\nSet-Cookie: a=b.apk');
    const d = disposition(url) as string;
    expect(d).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"$/);
    expect(d).not.toMatch(/[\r\n]/);
  });
});

describe('safeFilename', () => {
  it.each([
    ['mikrolan-1.1.6.apk', 'mikrolan-1.1.6.apk'],
    ['mikrolan 1.1.6+rc1.apk', 'mikrolan_1.1.6_rc1.apk'],
    ['../../etc/passwd', '_.._etc_passwd'],
  ])('%s -> %s', (input, expected) => {
    expect(safeFilename(input)).toBe(expected);
  });

  it('vide ou absent : null', () => {
    expect(safeFilename(undefined)).toBeNull();
    expect(safeFilename('')).toBeNull();
    expect(safeFilename('...')).toBeNull();
  });

  it('borne la longueur à 80 caractères', () => {
    expect((safeFilename('a'.repeat(200)) as string).length).toBe(80);
  });
});
