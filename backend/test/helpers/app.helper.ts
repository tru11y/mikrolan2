import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { getQueueToken } from '@nestjs/bullmq';
import multipart from '@fastify/multipart';
import { AppModule } from '../../src/app.module';
import { MailService } from '../../src/modules/mail/mail.service';
import { REDIS_CLIENT } from '../../src/common/redis/redis.module';
import { CacheService } from '../../src/common/redis/cache.service';
import { NotificationProcessor } from '../../src/modules/notifications/notification.processor';

const noopRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue([]),
  ping: jest.fn().mockResolvedValue('PONG'),
  disconnect: jest.fn(),
  quit: jest.fn(),
};

export async function createTestApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MailService)
    .useValue({
      sendWelcome: jest.fn().mockResolvedValue(undefined),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    })
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: jest.fn().mockResolvedValue({
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    })
    .overrideProvider(REDIS_CLIENT)
    .useValue(noopRedis)
    .overrideProvider(CacheService)
    .useValue({
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      invalidatePrefix: jest.fn().mockResolvedValue(undefined),
    })
    .overrideProvider(getQueueToken('notifications'))
    .useValue({ add: jest.fn().mockResolvedValue({}) })
    .overrideProvider(NotificationProcessor)
    .useValue({ process: jest.fn().mockResolvedValue(undefined) })
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.setGlobalPrefix('api');
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}
