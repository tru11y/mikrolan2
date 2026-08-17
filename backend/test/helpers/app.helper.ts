import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import multipart from '@fastify/multipart';
import { AppModule } from '../../src/app.module';
import { MailService } from '../../src/modules/mail/mail.service';

export async function createTestApp(): Promise<NestFastifyApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-chars-long',
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL: '2592000',
    ROUTER_CRED_KEY: 'a'.repeat(64).replace(/a/g, '0'),
    CORS_ORIGINS: '',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6380',
    WG_ENABLED: 'false',
    SENTRY_DSN: '',
    SMTP_HOST: '',
  });

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
