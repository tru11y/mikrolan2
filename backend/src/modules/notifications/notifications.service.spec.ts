import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    router: { findFirst: jest.Mock };
    user: { findMany: jest.Mock; update: jest.Mock };
    notification: {
      findMany: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  const mockTenantId = 'tenant-123';

  beforeEach(async () => {
    prisma = {
      router: { findFirst: jest.fn() },
      user: { findMany: jest.fn(), update: jest.fn() },
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    jest.clearAllMocks();
  });

  describe('sendPushToTenant', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('ignore si le routeur a désactivé les notifications push', async () => {
      prisma.router.findFirst.mockResolvedValue({ pushNotifications: false });

      await service.sendPushToTenant(mockTenantId, 'Titre', 'Corps', 'router-1');

      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('ignore si aucun utilisateur actif du tenant ne possède de pushToken', async () => {
      prisma.router.findFirst.mockResolvedValue({ pushNotifications: true });
      prisma.user.findMany.mockResolvedValue([]);

      await service.sendPushToTenant(mockTenantId, 'Titre', 'Corps', 'router-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: mockTenantId,
          notificationsEnabled: true,
          pushToken: { not: null },
          status: 'ACTIVE',
        },
        select: { id: true, pushToken: true },
      });
    });

    it('envoie le payload Expo avec channelId: default et priority: high', async () => {
      prisma.router.findFirst.mockResolvedValue({ pushNotifications: true });
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', pushToken: 'ExponentPushToken[user1_token]' },
      ]);

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ status: 'ok', id: 'ticket-1' }],
        }),
      });
      global.fetch = mockFetch;

      await service.sendPushToTenant(mockTenantId, 'Alerte', 'Message test', 'router-1');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://exp.host/--/api/v2/push/send');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body).toEqual([
        {
          to: 'ExponentPushToken[user1_token]',
          title: 'Alerte',
          body: 'Message test',
          sound: 'default',
          channelId: 'default',
          priority: 'high',
          data: { routerId: 'router-1' },
        },
      ]);
    });

    it('nettoie le token utilisateur en base si Expo renvoie DeviceNotRegistered', async () => {
      prisma.router.findFirst.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-unregistered', pushToken: 'ExponentPushToken[dead_token]' },
      ]);
      prisma.user.update.mockResolvedValue({});

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              status: 'error',
              message: '"ExponentPushToken[dead_token]" is not a registered push device',
              details: { error: 'DeviceNotRegistered' },
            },
          ],
        }),
      });
      global.fetch = mockFetch;

      await service.sendPushToTenant(mockTenantId, 'Titre', 'Corps');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-unregistered' },
        data: { pushToken: null },
      });
    });

    it('gère une erreur HTTP ou réseau sans propager d exception', async () => {
      prisma.router.findFirst.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', pushToken: 'ExponentPushToken[token1]' },
      ]);

      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      await expect(
        service.sendPushToTenant(mockTenantId, 'Titre', 'Corps'),
      ).resolves.toBeUndefined();
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

      await expect(service.markRead('notif-none')).rejects.toThrow(
        NotFoundException,
      );
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
