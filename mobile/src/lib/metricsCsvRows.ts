import type { MetricsSummary } from './api';

// Logique pure de construction des lignes CSV — aucune dépendance
// Expo/React Native (uniquement un import de type, effacé à la compilation).
// Extraite de metricsCsv.ts pour rester testable directement par Node/ts-jest
// sans charger expo-file-system/expo-sharing (audit/56 §7, audit/57 étape 5).

export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Construit les lignes du rapport CSV. Le bloc historique (titre, chiffre
 * d'affaires, tickets, sessions, tendance, tableau par forfait) conserve
 * exactement l'ordre, les libellés et la position qu'il avait avant
 * l'introduction des indicateurs de qualité (corrige audit/56 §7 : les
 * insérer au milieu décalait positionnellement tout ce qui suivait). Les
 * indicateurs de qualité forment une section additionnelle distincte,
 * ajoutée après ce bloc, seulement si le backend les a fournis.
 */
export function buildMetricsCsvRows(
  data: MetricsSummary,
  periodLabel: string,
): (string | number)[][] {
  const rows: (string | number)[][] = [
    ['Rapport de ventes WiFi', periodLabel],
    [],
    ['Chiffre d’affaires (FCFA)', data.revenueXof],
    ['Tickets vendus', data.ticketsGenerated],
    ['Tickets utilisés', data.ticketsUsed],
    ['Sessions actives', data.activeSessions],
    ['Tendance vs période précédente (%)', data.trendPct ?? ''],
    [],
    ['Forfait', 'Tickets', 'Revenu (FCFA)'],
    ...data.byPlan.map((p) => [p.planName, p.sold, p.revenueXof]),
  ];

  if (data.dataQuality != null) {
    rows.push(
      [],
      ['Qualité des données'],
      ['Qualité', data.dataQuality],
      ['Revenu exact (FCFA)', data.exactRevenueXof ?? 0],
      ['Revenu estimé (FCFA)', data.estimatedRevenueXof ?? 0],
      ['Ventes de provenance inconnue', data.unknownSalesCount ?? 0],
      ['Données invalides', data.invalidSourceCount ?? 0],
    );
  }

  return rows;
}

export function rowsToCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(';')).join('\n');
}
