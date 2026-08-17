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
  // Env vars are set by test/setup/env-setup.ts (a Jest setupFiles entry),
  // which runs before this module — and its AppModule import that validates
  // env at load time — is even required.
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
