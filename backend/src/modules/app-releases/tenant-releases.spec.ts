import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ALWAYS_ALLOWED_KEY } from '../../common/decorators/always-allowed.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ErrorCode } from '../../common/error-codes';
import { AppReleasesService } from './app-releases.service';
import { ReleaseStorageUnavailableError } from './release-storage.service';
import { TenantReleasesController } from './tenant-releases.controller';

const actor = { userId: 'u1', tenantId: 't1', role: 'MEMBER' } as any;

const mockPrisma: Record<string, any> = {
  appRelease: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  releaseDownload: { create: jest.fn() },
};
const mockStorage = { presignDownload: jest.fn(), headSize: jest.fn() };
const build = () => new AppReleasesService(mockPrisma as any, mockStorage as any, {} as any);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'rel-1',
  versionName: '1.2.0',
  versionCode: 40,
  minVersionCode: 30,
  releaseNotes: 'notes',
  fileSize: 1000,
  storageKey: 'releases/android/mikrolan-1.2.0.apk',
  isActive: true,
  isRequired: false,
  archivedAt: null,
  createdAt: new Date('2026-10-16T00:00:00Z'),
  createdById: 'admin-1',
  ...over,
});

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => e.getResponse().errorCode,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.headSize.mockResolvedValue(1000);
});

describe('TenantReleasesController — accès', () => {
  const routes = Object.getOwnPropertyNames(TenantReleasesController.prototype).filter(
    (n) => n !== 'constructor',
  );
  const reflector = new Reflector();

  it('expose exactement latest / history / downloadLog', () => {
    expect(routes.sort()).toEqual(['downloadLog', 'history', 'latest']);
  });

  it('aucun rôle requis : MEMBER autorisé ; reste accessible si paywall', () => {
    expect(reflector.get(ROLES_KEY, TenantReleasesController)).toBeUndefined();
    expect(reflector.get(ALWAYS_ALLOWED_KEY, TenantReleasesController)).toBe(true);
    const ctx = {
      getHandler: () => TenantReleasesController.prototype.latest,
      getClass: () => TenantReleasesController,
      switchToHttp: () => ({ getRequest: () => ({ user: { ...actor, role: UserRole.MEMBER } }) }),
    } as unknown as ExecutionContext;
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });
});

describe('AppReleasesService — portail tenant', () => {
  it('latestForTenant : n’expose ni storageKey ni createdById, plancher effectif, URL signée', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(row({ isRequired: true }));
    mockStorage.presignDownload.mockResolvedValue('https://s3.test/x?sig=1');
    const out = await build().latestForTenant();
    expect(out).toMatchObject({
      versionCode: 40,
      minVersionCode: 40,
      isRequired: true,
      fileSize: 1000,
      downloadUrl: 'https://s3.test/x?sig=1',
    });
    expect(out).not.toHaveProperty('storageKey');
    expect(out).not.toHaveProperty('createdById');
  });

  it('latestForTenant : tri déterministe (versionCode puis id décroissants)', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(row());
    mockStorage.presignDownload.mockResolvedValue('https://s3.test/x');
    await build().latestForTenant();
    expect(mockPrisma.appRelease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ versionCode: 'desc' }, { id: 'desc' }] }),
    );
  });

  it('latestForTenant : 404 sans release active', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(null);
    expect(await codeOf(build().latestForTenant())).toBe(ErrorCode.RELEASE_NOT_FOUND);
  });

  it('latestForTenant : stockage indisponible → downloadUrl null', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(row());
    mockStorage.headSize.mockRejectedValue(new ReleaseStorageUnavailableError('x'));
    expect((await build().latestForTenant()).downloadUrl).toBeNull();
  });

  it('latestForTenant : fichier absent du stockage → 404 RELEASE_FILE_MISSING', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(row());
    mockStorage.headSize.mockResolvedValue(null);
    expect(await codeOf(build().latestForTenant())).toBe(ErrorCode.RELEASE_FILE_MISSING);
    expect(mockStorage.presignDownload).not.toHaveBeenCalled();
  });

  it('history : 5 dernières non archivées, plus récente d’abord', async () => {
    mockPrisma.appRelease.findMany.mockResolvedValue([row()]);
    const out = await build().history();
    expect(mockPrisma.appRelease.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null }, take: 5 }),
    );
    expect(out[0]).not.toHaveProperty('storageKey');
  });

  it('logDownload : enregistre release/tenant/user', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row());
    mockPrisma.releaseDownload.create.mockResolvedValue({ id: 'dl-1' });
    expect(await build().logDownload('rel-1', actor)).toEqual({ id: 'dl-1' });
    expect(mockPrisma.releaseDownload.create).toHaveBeenCalledWith({
      data: { releaseId: 'rel-1', tenantId: 't1', userId: 'u1' },
      select: { id: true },
    });
  });

  it('logDownload : release inactive → 409 RELEASE_INACTIVE, rien d’écrit', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row({ isActive: false }));
    expect(await codeOf(build().logDownload('rel-1', actor))).toBe(ErrorCode.RELEASE_INACTIVE);
    expect(mockPrisma.releaseDownload.create).not.toHaveBeenCalled();
  });

  it.each([null, row({ archivedAt: new Date() })])('logDownload : absente/archivée → 404', async (r) => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(r);
    expect(await codeOf(build().logDownload('rel-1', actor))).toBe(ErrorCode.RELEASE_NOT_FOUND);
    expect(mockPrisma.releaseDownload.create).not.toHaveBeenCalled();
  });
});
