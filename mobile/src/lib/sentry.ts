import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { applySentry } from './sentryConfig';
import { scrubBreadcrumb, scrubEvent, shouldDropBreadcrumb } from './sentryScrub';

// DSN injecté au build (EXPO_PUBLIC_SENTRY_DSN), jamais versionné. Absent : Sentry reste inactif.
applySentry(
  (options) =>
    Sentry.init({
      ...options,
      // Fil d'Ariane réseau seulement (réduit par beforeBreadcrumb) : ni console, ni DOM, ni navigation.
      integrations: (defaults) => [
        ...defaults.filter((d) => d.name !== 'Breadcrumbs'),
        Sentry.breadcrumbsIntegration({ console: false, dom: false, history: false, fetch: true, xhr: true, sentry: true }),
      ],
      beforeSend: (event) => scrubEvent(event as never),
      beforeBreadcrumb: (b) => (shouldDropBreadcrumb(b) ? null : scrubBreadcrumb(b)),
    }),
  {
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    env: process.env.EXPO_PUBLIC_SENTRY_ENV,
    isDev: __DEV__,
    packageName: Constants.expoConfig?.android?.package,
    version: Constants.expoConfig?.version,
    versionCode: Constants.expoConfig?.android?.versionCode,
  },
);

export { Sentry };
