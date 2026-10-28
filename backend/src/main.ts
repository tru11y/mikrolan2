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
import { Readable } from 'node:stream';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(
    AppModule,
    // Seul Caddy (loopback) est cru sur X-Forwarded-For : `req.ip` sert à
    // restreindre l'accès routeur à l'IP de l'opérateur, il ne doit pas être
    // falsifiable par un appel direct au port de l'API.
    new FastifyAdapter({ trustProxy: '127.0.0.1' }),
  ) as NestFastifyApplication;

  const config = app.get(ConfigService<AppConfig, true>);

  await app.register(helmet);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

  // Raw body capture pour la vérification HMAC du webhook SasPay.
  // Scopé à l'URL exacte pour ne jamais perturber les autres routes JSON :
  // on remplace le parser JSON par défaut sur ces requêtes uniquement, afin
  // de conserver le corps brut (indispensable car la signature couvre les
  // octets exacts envoyés par SasPay, pas une re-sérialisation).
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('preParsing', (req, _reply, payload, done) => {
    if (req.url === '/api/payments/saspay/webhook') {
      const chunks: Buffer[] = [];
      payload.on('data', (chunk: Buffer) => chunks.push(chunk));
      payload.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        (req as unknown as { rawBody?: string }).rawBody = raw;
        try {
          (req as unknown as { body?: unknown }).body = raw.length ? JSON.parse(raw) : {};
        } catch {
          // Laisse body indéfini : le contrôleur rejettera via Zod.
          (req as unknown as { body?: unknown }).body = {};
        }
        done(null, Readable.from([raw]));
      });
      payload.on('error', (err: Error) => done(err));
      return;
    }
    done(null, payload);
  });
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
