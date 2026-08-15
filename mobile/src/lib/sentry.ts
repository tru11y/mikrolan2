import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
    environment: __DEV__ ? 'development' : 'production',
  });
}

export { Sentry };
