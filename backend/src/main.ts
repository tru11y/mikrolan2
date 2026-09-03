import './instrument';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { join } from 'node:path';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(
    AppModule,
    new FastifyAdapter(),
  ) as NestFastifyApplication;

  const config = app.get(ConfigService<AppConfig, true>);

  await app.register(helmet);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  // Payment proofs are intentionally NOT served here (FIND-004): they are
  // private financial documents, served exclusively through the
  // authenticated/authorized endpoint in SubscriptionsController, which is
  // the only code path with tenant-isolation logic for them.
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'public', 'legal'),
    prefix: '/legal/',
    decorateReply: false,
  });

  app.setGlobalPrefix('api');

  const origins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({
    origin: origins.length ? origins : false,
    credentials: true,
  });

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`MikroLan API on :${port}`);
}

void bootstrap();
