import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContext } from '../../common/context/tenant-context';
import { AppReleasesController } from './app-releases.controller';
import {
  createReleaseSchema,
  requireReleaseSchema,
  uploadUrlSchema,
} from './dto/app-release.schemas';

function contextFor(method: string, role: UserRole): ExecutionContext {
  const user: TenantContext = { tenantId: 't1', userId: 'u1', role };
  const handler = (AppReleasesController.prototype as unknown as Record<string, unknown>)[method];
  return {
    getHandler: () => handler,
    getClass: () => AppReleasesController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('AppReleasesController — fermeture par rôle', () => {
  const guard = new RolesGuard(new Reflector());
  const routes = Object.getOwnPropertyNames(AppReleasesController.prototype).filter(
    (n) => n !== 'constructor',
  );

  it('expose les 7 routes attendues', () => {
    expect(routes.sort()).toEqual(
      ['activate', 'archive', 'create', 'latest', 'list', 'require', 'uploadUrl'].sort(),
    );
  });

  it.each([UserRole.ADMIN, UserRole.MEMBER])('refuse %s sur toutes les routes', (role) => {
    for (const route of routes) {
      expect(() => guard.canActivate(contextFor(route, role))).toThrow(ForbiddenException);
    }
  });

  it('autorise SUPER_ADMIN sur toutes les routes', () => {
    for (const route of routes) {
      expect(guard.canActivate(contextFor(route, UserRole.SUPER_ADMIN))).toBe(true);
    }
  });
});

describe('createReleaseSchema', () => {
  const valid = {
    versionName: '1.2.0',
    versionCode: 40,
    minVersionCode: 30,
    releaseNotes: 'Correctifs',
    fileSize: 86_541_675,
    storageKey: 'releases/android/mikrolan-1.2.0.apk',
  };

  it('accepte une release valide et met minVersionCode à 1 par défaut', () => {
    expect(createReleaseSchema.safeParse(valid).success).toBe(true);
    const { minVersionCode: _omit, ...rest } = valid;
    const parsed = createReleaseSchema.parse(rest);
    expect(parsed.minVersionCode).toBe(1);
  });

  it('refuse minVersionCode > versionCode', () => {
    expect(createReleaseSchema.safeParse({ ...valid, minVersionCode: 41 }).success).toBe(false);
  });

  it.each([
    'releases/android/../../etc/passwd.apk',
    '../releases/android/a.apk',
    'releases/android/sub/a.apk',
    'other/a.apk',
    'releases/android/a.exe',
    '/releases/android/a.apk',
    'releases/android/.apk',
  ])('refuse la clé de stockage %s', (storageKey) => {
    expect(createReleaseSchema.safeParse({ ...valid, storageKey }).success).toBe(false);
  });

  it.each([
    { versionName: 'v1' },
    { versionCode: 0 },
    { versionCode: 1.5 },
    { fileSize: 0 },
    { fileSize: 201 * 1024 * 1024 },
    { releaseNotes: '   ' },
  ])('refuse %j', (over) => {
    expect(createReleaseSchema.safeParse({ ...valid, ...over }).success).toBe(false);
  });

  it('refuse un champ inconnu (ex. isActive injecté)', () => {
    expect(createReleaseSchema.safeParse({ ...valid, isActive: true }).success).toBe(false);
  });
});

describe('uploadUrlSchema', () => {
  it('accepte une demande valide', () => {
    expect(uploadUrlSchema.safeParse({ versionCode: 5, fileSize: 1000 }).success).toBe(true);
  });
  it.each([
    { versionCode: 0, fileSize: 1 },
    { versionCode: 5, fileSize: 0 },
    { versionCode: 5, fileSize: 201 * 1024 * 1024 },
    { versionCode: 5, fileSize: 1, storageKey: 'releases/android/x.apk' },
  ])('refuse %j', (b) => {
    expect(uploadUrlSchema.safeParse(b).success).toBe(false);
  });
});

describe('requireReleaseSchema', () => {
  it('corps vide = required true', () => {
    expect(requireReleaseSchema.parse(undefined)).toEqual({ required: true });
  });
  it('accepte required:false', () => {
    expect(requireReleaseSchema.parse({ required: false })).toEqual({ required: false });
  });
});
