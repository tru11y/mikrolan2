const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

/**
 * Réglages du SDK natif Sentry (Android) portés par le manifeste : aucune donnée personnelle par défaut,
 * ni capture d'écran, ni hiérarchie de vues, ni breadcrumbs d'interaction/système/réseau/composants.
 * Idempotent : une clé existante est remplacée, jamais dupliquée. Survit à `expo prebuild`.
 */
const SETTINGS = {
  'io.sentry.send-default-pii': 'false',
  'io.sentry.attach-screenshot': 'false',
  'io.sentry.attach-view-hierarchy': 'false',
  'io.sentry.breadcrumbs.user-interaction': 'false',
  'io.sentry.breadcrumbs.system-events': 'false',
  'io.sentry.breadcrumbs.network-events': 'false',
  'io.sentry.breadcrumbs.app-components': 'false',
};

module.exports = function withSentryNativeHardening(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    for (const [name, value] of Object.entries(SETTINGS)) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, value);
    }
    return cfg;
  });
};

module.exports.SETTINGS = SETTINGS;
