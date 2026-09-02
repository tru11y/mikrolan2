import type { MetricsSummary, SessionStats } from './api';

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
function fmtBytesForCsv(bytesStr: string): string {
  const bytes = Number(bytesStr);
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

export function buildMetricsCsvRows(
  data: MetricsSummary,
  periodLabel: string,
  sessionStats?: SessionStats,
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

  if (sessionStats) {
    rows.push(
      [],
      ['Sessions & réseau'],
      ['Sessions totales', sessionStats.totalSessions],
      ['Sessions actives', sessionStats.activeSessions],
      ['Sessions terminées', sessionStats.terminatedSessions],
      ['Durée moyenne (min)', sessionStats.averageDurationMinutes ?? ''],
      ['Téléchargé', fmtBytesForCsv(sessionStats.totalBytesIn)],
      ['Envoyé', fmtBytesForCsv(sessionStats.totalBytesOut)],
      ['Total données', fmtBytesForCsv(sessionStats.totalBytes)],
    );
    if (sessionStats.byRouter.length > 0) {
      rows.push([], ['Routeur', 'Sessions', 'Données']);
      for (const r of sessionStats.byRouter) {
        rows.push([r.routerName, r.sessionCount, fmtBytesForCsv((BigInt(r.bytesIn) + BigInt(r.bytesOut)).toString())]);
      }
    }
  }

  return rows;
}

export function rowsToCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(';')).join('\n');
}
