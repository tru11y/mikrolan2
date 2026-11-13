/** Options Sentry dérivées de la configuration réellement construite (package, versionName, versionCode). Pur, testable. */
export type SentryEnv = 'production' | 'staging' | 'devtest' | 'development';

const ENVS: readonly string[] = ['production', 'staging', 'devtest', 'development'];
/** Échantillonnage de traces hors production : volontairement explicite. */
export const NON_PROD_TRACES_RATE = 0.2;
export const PROD_TRACES_RATE = 0.05;

export interface SentryConfigInput {
  dsn: string | undefined;
  env: string | undefined;
  isDev: boolean;
  packageName: string | undefined;
  version: string | undefined;
  versionCode: number | string | undefined;
}

export function resolveEnv(env: string | undefined, isDev: boolean): SentryEnv {
  if (env && ENVS.includes(env)) return env as SentryEnv;
  return isDev ? 'development' : 'production';
}

export function buildSentryOptions(i: SentryConfigInput) {
  if (!i.dsn) return null;
  const environment = resolveEnv(i.env, i.isDev);
  const dist = String(i.versionCode ?? 0);
  return {
    dsn: i.dsn,
    environment,
    release: `${i.packageName ?? 'com.mikrolan.app'}@${i.version ?? '0.0.0'}+${dist}`,
    dist,
    debug: false,
    enableNative: true,
    enableNativeCrashHandling: true,
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30_000,
    attachStacktrace: true,
    attachScreenshot: false,
    attachViewHierarchy: false,
    maxBreadcrumbs: 50,
    tracesSampleRate: environment === 'production' ? PROD_TRACES_RATE : NON_PROD_TRACES_RATE,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
  };
}

let initialized = false;

/** Initialise une seule fois, et seulement si un DSN est présent. */
export function applySentry(init: (o: NonNullable<ReturnType<typeof buildSentryOptions>>) => void, i: SentryConfigInput): boolean {
  const options = buildSentryOptions(i);
  if (!options || initialized) return false;
  initialized = true;
  init(options);
  return true;
}
