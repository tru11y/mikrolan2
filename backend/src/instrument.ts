import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 0.2,
    profilesSampleRate: 0.2,
    environment: process.env.NODE_ENV ?? 'development',
    // Les corps de requête peuvent contenir des identifiants RouterOS
    // (PATCH/POST /routers) : jamais envoyés à Sentry.
    beforeSend(event) {
      if (event.request) delete event.request.data;
      return event;
    },
  });
}
