import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { scrubBreadcrumb, scrubEvent } from './common/sentry-scrub';

const dsn = process.env.SENTRY_DSN;

// Les corps de requête peuvent contenir des identifiants RouterOS
// (PATCH/POST /routers) : jamais envoyés à Sentry.
export function scrubSentryEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) delete event.request.data;
  scrubEvent(event as never);
  return event;
}

if (dsn) {
  Sentry.init({
    dsn,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 0.2,
    profilesSampleRate: 0.2,
    environment: process.env.NODE_ENV ?? 'development',
    // Aucune donnée personnelle par défaut (IP, cookies, en-têtes) : explicite, pas laissé au défaut du SDK.
    sendDefaultPii: false,
    beforeSend: scrubSentryEvent,
    beforeBreadcrumb: (b) => scrubBreadcrumb(b),
  });
}
