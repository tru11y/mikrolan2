// Logique pure du portail de téléchargement APK, sans import runtime
// (react-native, axios…) pour être couverte par `node --test` (cf. lotState.ts).

export type InstalledState = 'upToDate' | 'updateAvailable' | 'updateRequired';

/** `required` dès que la version installée est sous le plancher imposé par le serveur. */
export function installedState(
  installedCode: number | null,
  latest: { versionCode: number; minVersionCode: number },
): InstalledState {
  if (installedCode === null) return 'updateAvailable';
  if (installedCode < latest.minVersionCode) return 'updateRequired';
  return installedCode < latest.versionCode ? 'updateAvailable' : 'upToDate';
}

/** Code de build natif Android ("37") → entier, sinon null. */
export function parseVersionCode(raw: string | number | null | undefined): number | null {
  const n = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 12_582_912 → "12,0 Mo" (base 1024, format français). */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const text = i === 0 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');
  return `${text} ${units[i]}`;
}

export type DownloadStep =
  | { kind: 'open'; url: string }
  | { kind: 'fail'; reason: 'no-url' };

/** Décide quoi faire d'une release fraîchement récupérée : ouvrir l'URL signée ou échouer. */
export function nextDownloadStep(latest: { downloadUrl: string | null }): DownloadStep {
  return latest.downloadUrl
    ? { kind: 'open', url: latest.downloadUrl }
    : { kind: 'fail', reason: 'no-url' };
}

/** Le tracking est « au mieux » : seules ces réponses bloquent le téléchargement. */
export function logFailureBlocksDownload(status: number | null): boolean {
  return status === 404 || status === 409;
}
