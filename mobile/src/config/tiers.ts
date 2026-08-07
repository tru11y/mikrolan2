import { api, type BillingPeriod, type Tier } from '@/src/lib/api';

/**
 * Grille tarifaire.
 *
 * La source est le serveur (`GET /subscriptions/tiers`), alimenté par le super
 * admin. Les montants vivaient auparavant en dur ici *et* dans le backend, si
 * bien qu'ils pouvaient diverger sans que rien ne le signale, et qu'un
 * changement de prix imposait de publier une nouvelle version de l'app.
 *
 * La copie ci-dessous ne sert qu'à afficher quelque chose de cohérent quand le
 * réseau est coupé — situation courante sur le terrain. Elle n'est jamais
 * utilisée pour facturer : le montant est calculé côté serveur au moment de la
 * demande d'activation.
 */

export type { Tier, TierFeature } from '@/src/lib/api';

const OFFLINE_FALLBACK: Tier[] = [
  {
    id: 'offline-essentiel',
    key: 'essentiel',
    name: 'Essentiel',
    monthlyXof: 5000,
    annualMonthlyXof: 4000,
    annualDiscount: 20,
    routerLimit: 3,
    remoteAccess: false,
    a4Printing: false,
    cloudBackup: false,
    prioritySupport: false,
    badge: null,
    tagline: 'Jusqu’à 3 routeurs',
    displayOrder: 0,
    active: true,
    features: [
      { label: 'Jusqu’à 3 routeurs MikroTik', included: true },
      { label: 'Génération de tickets illimitée', included: true },
      { label: 'Impression thermique Bluetooth', included: true },
      { label: 'Templates de tickets basiques', included: true },
      { label: 'Sauvegarde Cloud automatique', included: false },
      { label: 'Accès distant multi-sites', included: false },
    ],
  },
  {
    id: 'offline-avance',
    key: 'avance',
    name: 'Avancé',
    monthlyXof: 15000,
    annualMonthlyXof: 12000,
    annualDiscount: 20,
    routerLimit: 10,
    remoteAccess: true,
    a4Printing: true,
    cloudBackup: true,
    prioritySupport: false,
    badge: 'LE PLUS CHOISI',
    tagline: 'Jusqu’à 10 routeurs',
    displayOrder: 1,
    active: true,
    features: [
      { label: 'Jusqu’à 10 routeurs MikroTik', included: true },
      { label: 'Génération de tickets illimitée', included: true },
      { label: 'Impression thermique + PDF A4/A3', included: true },
      { label: 'Tous les templates Premium', included: true },
      { label: 'Sauvegarde Cloud automatique 24/7', included: true },
      { label: 'Accès distant multi-sites', included: true },
    ],
  },
  {
    id: 'offline-entreprise',
    key: 'entreprise',
    name: 'Entreprise',
    monthlyXof: 35000,
    annualMonthlyXof: 28000,
    annualDiscount: 20,
    routerLimit: null,
    remoteAccess: true,
    a4Printing: true,
    cloudBackup: true,
    prioritySupport: true,
    badge: null,
    tagline: 'Routeurs illimités',
    displayOrder: 2,
    active: true,
    features: [
      { label: 'Routeurs MikroTik illimités', included: true },
      { label: 'Tickets & baux DHCP illimités', included: true },
      { label: 'Support technique dédié 24/7', included: true },
      { label: 'Personnalisation white-label', included: true },
      { label: 'Sauvegarde Cloud & API', included: true },
      { label: 'Accès distant multi-sites', included: true },
    ],
  },
];

/** Grille du serveur, ou la copie hors ligne si l'API est injoignable. */
export async function loadTiers(): Promise<Tier[]> {
  try {
    const tiers = await api.subscriptions.tiers();
    return tiers.length ? tiers : OFFLINE_FALLBACK;
  } catch {
    return OFFLINE_FALLBACK;
  }
}

/** Mensualité affichée selon la périodicité choisie. */
export function monthlyPrice(tier: Tier, annual: boolean): number {
  return annual ? tier.annualMonthlyXof : tier.monthlyXof;
}

/** Montant réellement débité pour la période. */
export function periodPrice(tier: Tier, annual: boolean): number {
  return annual ? tier.annualMonthlyXof * 12 : tier.monthlyXof;
}

export function billingPeriod(annual: boolean): BillingPeriod {
  return annual ? 'ANNUAL' : 'MONTHLY';
}

export function formatXof(amount: number): string {
  return `${amount.toLocaleString('fr-FR')} FCFA`;
}
