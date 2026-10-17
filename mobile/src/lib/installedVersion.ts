import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { resolveInstalledVersionCode } from './releaseDownload';

/**
 * Code de build réellement installé (versionCode du manifeste Android).
 * `expoConfig` (app.json) n'est qu'un repli : il peut diverger de build.gradle, et un code
 * erroné ferait afficher une bannière à un client à jour, ou le bloquer à tort.
 */
export function getInstalledVersionCode(): number | null {
  return resolveInstalledVersionCode({
    native: Application.nativeBuildVersion,
    constantsNative: Constants.nativeBuildVersion,
    config: Constants.expoConfig?.android?.versionCode,
  });
}

export function getInstalledVersionName(): string {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—';
}
