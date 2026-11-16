// MikroLan Connect — Matrice officielle des statuts D0 §H.
// Source de vérité : D:\dev\mikrolan-prototypes\D0-charte-MikroLan-Connect.md
// Un alias statut pointe toujours vers une des trois sévérités (success /
// warning / danger) ou vers textMuted / primary. L'icône distinct garantit la
// distinction visuelle quand la couleur est partagée (ex. warning triangle vs
// supervisionDown bouclier, offline wifi barré vs invalid ban vs critical octogone).

import type { ConnectColorKey } from './colors';

export type StatusKey =
  | 'routerOnline'
  | 'routerUnstable'
  | 'routerOffline'
  | 'routerUnknown'
  | 'supervisionDown'
  | 'ticketReady'
  | 'ticketActive'
  | 'ticketExpired'
  | 'ticketInvalid'
  | 'payPending'
  | 'paySuccess'
  | 'payFailed'
  | 'payUnconfirmed'
  | 'wgActive'
  | 'wgDegraded'
  | 'wgDown'
  | 'opsHealthy'
  | 'opsDegraded'
  | 'opsCritical'
  | 'genRunning'
  | 'genUnconfirmed'
  | 'genPartial'
  | 'verifyChecking'
  | 'verifyOffline';

// Noms d'icônes Ionicons (string, pour éviter une dépendance de type à
// @expo/vector-icons dans ce module de tokens pur).
export type StatusDescriptor = {
  color: ConnectColorKey;
  bg: ConnectColorKey;
  icon: string;
  i18nKey: string;
  // Libellé FR par défaut, utilisé par StatusBadge quand i18n n'est pas câblé.
  fallbackLabel: string;
  severity: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
};

export const statusMatrix: Record<StatusKey, StatusDescriptor> = {
  routerOnline: {
    color: 'success', bg: 'successBg', icon: 'checkmark-circle',
    i18nKey: 'status.router.online', fallbackLabel: 'En ligne', severity: 'success',
  },
  routerUnstable: {
    color: 'warning', bg: 'warningBg', icon: 'warning',
    i18nKey: 'status.router.unstable', fallbackLabel: 'Instable', severity: 'warning',
  },
  routerOffline: {
    color: 'danger', bg: 'dangerBg', icon: 'close-circle',
    i18nKey: 'status.router.offline', fallbackLabel: 'Hors ligne', severity: 'danger',
  },
  routerUnknown: {
    color: 'textMuted', bg: 'routerUnknownBg', icon: 'help-circle',
    i18nKey: 'status.router.unknown', fallbackLabel: 'État inconnu', severity: 'neutral',
  },
  supervisionDown: {
    color: 'warning', bg: 'warningBg', icon: 'shield-half',
    i18nKey: 'status.supervision.down', fallbackLabel: 'Supervision indisponible', severity: 'warning',
  },
  ticketReady: {
    color: 'primary', bg: 'primaryTint', icon: 'ticket-outline',
    i18nKey: 'status.ticket.ready', fallbackLabel: 'Prêt', severity: 'info',
  },
  ticketActive: {
    color: 'success', bg: 'successBg', icon: 'play-circle',
    i18nKey: 'status.ticket.active', fallbackLabel: 'Actif', severity: 'success',
  },
  ticketExpired: {
    color: 'warning', bg: 'warningBg', icon: 'time',
    i18nKey: 'status.ticket.expired', fallbackLabel: 'Expiré', severity: 'warning',
  },
  ticketInvalid: {
    color: 'danger', bg: 'dangerBg', icon: 'ban',
    i18nKey: 'status.ticket.invalid', fallbackLabel: 'Invalide', severity: 'danger',
  },
  payPending: {
    color: 'warning', bg: 'warningBg', icon: 'time',
    i18nKey: 'status.pay.pending', fallbackLabel: 'En attente', severity: 'warning',
  },
  paySuccess: {
    color: 'success', bg: 'successBg', icon: 'checkmark-circle',
    i18nKey: 'status.pay.success', fallbackLabel: 'Payé', severity: 'success',
  },
  payFailed: {
    color: 'danger', bg: 'dangerBg', icon: 'close-circle',
    i18nKey: 'status.pay.failed', fallbackLabel: 'Paiement échoué', severity: 'danger',
  },
  payUnconfirmed: {
    color: 'warning', bg: 'warningBg', icon: 'warning',
    i18nKey: 'status.pay.unconfirmed', fallbackLabel: 'Résultat non confirmé', severity: 'warning',
  },
  wgActive: {
    color: 'success', bg: 'successBg', icon: 'shield-checkmark',
    i18nKey: 'status.wg.active', fallbackLabel: 'Actif', severity: 'success',
  },
  wgDegraded: {
    color: 'warning', bg: 'warningBg', icon: 'shield-half',
    i18nKey: 'status.wg.degraded', fallbackLabel: 'Dégradé', severity: 'warning',
  },
  wgDown: {
    color: 'danger', bg: 'dangerBg', icon: 'shield-outline',
    i18nKey: 'status.wg.down', fallbackLabel: 'Coupé', severity: 'danger',
  },
  opsHealthy: {
    color: 'success', bg: 'successBg', icon: 'checkmark-circle',
    i18nKey: 'status.ops.healthy', fallbackLabel: 'Sain', severity: 'success',
  },
  opsDegraded: {
    color: 'warning', bg: 'warningBg', icon: 'shield-half',
    i18nKey: 'status.ops.degraded', fallbackLabel: 'Dégradé', severity: 'warning',
  },
  opsCritical: {
    color: 'danger', bg: 'dangerBg', icon: 'alert-circle',
    i18nKey: 'status.ops.critical', fallbackLabel: 'Incident critique', severity: 'danger',
  },
  genRunning: {
    color: 'primary', bg: 'primaryTint', icon: 'refresh',
    i18nKey: 'status.gen.running', fallbackLabel: 'Génération en cours', severity: 'info',
  },
  genUnconfirmed: {
    color: 'warning', bg: 'warningBg', icon: 'warning',
    i18nKey: 'status.gen.unconfirmed', fallbackLabel: 'Résultat non confirmé', severity: 'warning',
  },
  genPartial: {
    color: 'warning', bg: 'warningBg', icon: 'warning',
    i18nKey: 'status.gen.partial', fallbackLabel: 'Succès partiel', severity: 'warning',
  },
  verifyChecking: {
    color: 'textMuted', bg: 'routerUnknownBg', icon: 'refresh',
    i18nKey: 'status.verify.checking', fallbackLabel: 'Vérification en cours', severity: 'neutral',
  },
  verifyOffline: {
    color: 'warning', bg: 'warningBg', icon: 'wifi',
    i18nKey: 'status.verify.offline', fallbackLabel: 'Connexion indisponible', severity: 'warning',
  },
};

// Garde-fou : un statut qui n'utiliserait QUE la couleur (sans icône) serait
// une régression. Chaque entrée doit avoir une icône non vide.
export function assertStatusHasIcon(key: StatusKey): void {
  const d = statusMatrix[key];
  if (!d.icon) throw new Error(`Status ${key} is missing an icon — colour-only states are forbidden by D0.`);
}
