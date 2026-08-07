import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { MetricsSummary } from './api';

// Builds a CSV of the sales report (revenue + per-plan breakdown) and hands it
// to the OS share sheet — the "Exporter CSV" action of the Rapport screen.
// Client-side, like the ticket PDF: no backend CSV endpoint needed.

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportMetricsCsv(
  data: MetricsSummary,
  periodLabel: string,
): Promise<void> {
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
  const csv = rows.map((r) => r.map(csvCell).join(';')).join('\n');

  const uri = `${FileSystem.cacheDirectory}rapport-ventes.csv`;
  await FileSystem.writeAsStringAsync(uri, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'text/csv',
      dialogTitle: 'Exporter le rapport CSV',
    });
  }
}
