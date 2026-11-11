import * as Sentry from '@sentry/react-native';
import { scrubBreadcrumb, scrubEvent } from './sentryScrub';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
    environment: __DEV__ ? 'development' : 'production',
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30_000,
    attachStacktrace: true,
    maxBreadcrumbs: 50,
    // Aucune donnée personnelle par défaut : explicite, pas laissé au défaut du SDK.
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event as never),
    beforeBreadcrumb: (b) => scrubBreadcrumb(b),
  });
}

export { Sentry };
