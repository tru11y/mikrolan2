import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { EXPO_TIMEOUT_MS, NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    router: { findFirst: jest.Mock };
    user: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
      create: jest.Mock;
    };
  };
  let pushQueue: { add: jest.Mock };

  const mockTenantId = 'tenant-123';

  beforeEach(async () => {
    prisma = {
      router: { findFirst: jest.fn() },
      user: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'notif-new' }),
      },
    };
    pushQueue = { add: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: getQueueToken('notifications'), useValue: pushQueue },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  describe('sendPushToTenant', () => {
    const originalFetch = global.fetch;
    const tok = (n: string) => `ExponentPushToken[${n}]`;
    const okFetch = (tickets: unknown[]) =>
      jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: tickets }) });
    const user = (id: string, pushToken: string | null, notificationsEnabled = true) => ({ id, pushToken, notificationsEnabled });

    beforeEach(() => {
      prisma.router.findFirst.mockResolvedValue(null);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
    });

    afterEach(() => {
      global.fetch = originalFetch;
      jest.useRealTimers();
    });

    it('routeur avec notifications push désactivées : DISABLED, aucune requête utilisateur ni Expo', async () => {
      prisma.router.findFirst.mockResolvedValue({ pushNotifications: false });
      global.fetch = jest.fn();

      const res = await service.sendPushToTenant(mockTenantId, 'Titre', 'Corps', 'router-1');

      expect(res.status).toBe('DISABLED');
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('aucun token : NO_TOKEN (jamais SENT), pas d appel Expo, requête limitée au tenant actif', async () => {
      prisma.router.findFirst.mockResolvedValue({ pushNotifications: true });
      prisma.user.findMany.mockResolvedValue([]);
      global.fetch = jest.fn();

      const res = await service.sendPushToTenant(mockTenantId, 'Titre', 'Corps', 'router-1');

      expect(res).toEqual({ status: 'NO_TOKEN', tokensFound: 0, accepted: 0, invalid: 0 });
      expect(global.fetch).not.toHaveBeenCalled();
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId, pushToken: { not: null }, status: 'ACTIVE' },
        select: { id: true, pushToken: true, notificationsEnabled: true },
      });
    });

    it('notificationsEnabled=false sur tous les porteurs de token : DISABLED, pas d envoi', async () => {
      prisma.user.findMany.mockResolvedValue([user('u1', tok('a'), false)]);
      global.fetch = jest.fn();

      const res = await service.sendPushToTenant(mockTenantId, 'T', 'C');

      expect(res.status).toBe('DISABLED');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('roles : la requête filtre OWNER/ADMIN du tenant ACTIF (TICKET_VERIFIER, suspendus, autre tenant exclus)', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.sendPushToTenant(mockTenantId, 'T', 'C', null, undefined, ['OWNER', 'ADMIN']);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId, pushToken: { not: null }, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
        select: { id: true, pushToken: true, notificationsEnabled: true },
      });
    });

    it('envoie le payload Expo (channelId default, priority high) et retourne SENT', async () => {
      prisma.router.findFirst.mockResolvedValue({ pushNotifications: true });
      prisma.user.findMany.mockResolvedValue([user('user-1', tok('user1_token'))]);
      global.fetch = okFetch([{ status: 'ok', id: 'ticket-1' }]);

      const res = await service.sendPushToTenant(mockTenantId, 'Alerte', 'Message test', 'router-1');

      expect(res).toEqual({ status: 'SENT', tokensFound: 1, accepted: 1, invalid: 0 });
      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://exp.host/--/api/v2/push/send');
      expect(options.method).toBe('POST');
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(options.body)).toEqual([
        {
          to: tok('user1_token'),
          title: 'Alerte',
          body: 'Message test',
          sound: 'default',
          channelId: 'default',
          priority: 'high',
          data: { routerId: 'router-1' },
        },
      ]);
    });

    it('plusieurs utilisateurs, un seul token mort : invalidation ciblée (id + tenant + token), résultat SENT', async () => {
      prisma.user.findMany.mockResolvedValue([user('u1', tok('alive')), user('u2', tok('dead')), user('u3', tok('alive2'))]);
      global.fetch = okFetch([
        { status: 'ok', id: 't1' },
        { status: 'error', details: { error: 'DeviceNotRegistered' } },
        { status: 'ok', id: 't3' },
      ]);

      const res = await service.sendPushToTenant(mockTenantId, 'T', 'C');

      expect(res).toEqual({ status: 'SENT', tokensFound: 3, accepted: 2, invalid: 1 });
      expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u2', tenantId: mockTenantId, pushToken: tok('dead') },
        data: { pushToken: null },
      });
    });

    it('tous les tokens morts : INVALID_TOKEN (jamais SENT)', async () => {
      prisma.user.findMany.mockResolvedValue([user('u1', tok('dead'))]);
      global.fetch = okFetch([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]);

      const res = await service.sendPushToTenant(mockTenantId, 'T', 'C');

      expect(res).toMatchObject({ status: 'INVALID_TOKEN', accepted: 0, invalid: 1 });
    });

    it('token mal formé : INVALID_TOKEN sans appel réseau ni purge', async () => {
      prisma.user.findMany.mockResolvedValue([user('u1', 'pas-un-token-expo')]);
      global.fetch = jest.fn();

      const res = await service.sendPushToTenant(mockTenantId, 'T', 'C');

      expect(res).toMatchObject({ status: 'INVALID_TOKEN', failureCode: 'INVALID_EXPO_TOKEN' });
      expect(global.fetch).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('erreur réseau : FAILED NETWORK_ERROR sans propager', async () => {
      prisma.user.findMany.mockResolvedValue([user('u1', tok('t1'))]);
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      await expect(service.sendPushToTenant(mockTenantId, 'T', 'C')).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'NETWORK_ERROR',
      });
    });

    it('HTTP 500 Expo : FAILED HTTP_500', async () => {
      prisma.user.findMany.mockResolvedValue([user('u1', tok('t1'))]);
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

      await expect(service.sendPushToTenant(mockTenantId, 'T', 'C')).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'HTTP_500',
      });
    });

    it('réponse Expo non JSON / sans tableau : FAILED MALFORMED_RESPONSE', async () => {
      prisma.user.findMany.mockResolvedValue([user('u1', tok('t1'))]);
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

      await expect(service.sendPushToTenant(mockTenantId, 'T', 'C')).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'MALFORMED_RESPONSE',
      });
    });

    it('timeout Expo (10 s) : FAILED TIMEOUT', async () => {
      jest.useFakeTimers();
      prisma.user.findMany.mockResolvedValue([user('u1', tok('t1'))]);
      global.fetch = jest.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
      );

      const pending = service.sendPushToTenant(mockTenantId, 'T', 'C');
      await jest.advanceTimersByTimeAsync(EXPO_TIMEOUT_MS + 1);

      await expect(pending).resolves.toMatchObject({ status: 'FAILED', failureCode: 'TIMEOUT' });
    });

    it('erreur de lecture des utilisateurs : FAILED TOKEN_LOOKUP_FAILED', async () => {
      prisma.user.findMany.mockRejectedValue(new Error('db down'));

      await expect(service.sendPushToTenant(mockTenantId, 'T', 'C')).resolves.toMatchObject({
        status: 'FAILED',
        failureCode: 'TOKEN_LOOKUP_FAILED',
      });
    });

    it('le résumé retourné ne contient jamais de token', async () => {
      prisma.user.findMany.mockResolvedValue([user('u1', tok('secret_value'))]);
      global.fetch = okFetch([{ status: 'ok', id: 't1' }]);

      const res = await service.sendPushToTenant(mockTenantId, 'T', 'C');

      expect(JSON.stringify(res)).not.toContain('secret_value');
    });
  });

  describe('list', () => {
    it('retourne les notifications formatées', async () => {
      const now = new Date();
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'notif-1',
          type: 'INFO',
          title: 'Bienvenue',
          body: 'Bienvenue sur MikroLan',
          voucherId: null,
          routerId: null,
          readAt: null,
          createdAt: now,
        },
      ]);

      const result = await service.list({ limit: 10, unreadOnly: 'false' });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'notif-1',
        type: 'INFO',
        title: 'Bienvenue',
        body: 'Bienvenue sur MikroLan',
        voucherId: null,
        routerId: null,
        read: false,
        createdAt: now.toISOString(),
      });
    });
  });

  describe('unreadCount', () => {
    it('compte le nombre de notifications non lues', async () => {
      prisma.notification.count.mockResolvedValue(4);

      const count = await service.unreadCount();

      expect(count).toBe(4);
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { readAt: null },
      });
    });
  });

  describe('markRead', () => {
    it('marque une notification lue', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.markRead('notif-1');

      expect(res).toEqual({ read: true });
    });

    it('lève NotFoundException si notification introuvable', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.markRead('notif-none')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('markAllRead', () => {
    it('marque toutes les notifications lues', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const res = await service.markAllRead();

      expect(res).toEqual({ updated: 5 });
    });
  });
});
