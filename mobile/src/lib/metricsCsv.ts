import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { MetricsSummary } from './api';
import { buildMetricsCsvRows, rowsToCsv } from './metricsCsvRows';

// Builds a CSV of the sales report (revenue + per-plan breakdown) and hands it
// to the OS share sheet — the "Exporter CSV" action of the Rapport screen.
// Client-side, like the ticket PDF: no backend CSV endpoint needed.
// Row-building logic lives in metricsCsvRows.ts (pure, no Expo/RN import) so
// it stays testable outside the Expo runtime.

export async function exportMetricsCsv(
  data: MetricsSummary,
  periodLabel: string,
): Promise<void> {
  const csv = rowsToCsv(buildMetricsCsvRows(data, periodLabel));

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
