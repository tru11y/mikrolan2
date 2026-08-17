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
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  const config = app.get(ConfigService<AppConfig, true>);

  await app.register(helmet);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    decorateReply: false,
  });
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
