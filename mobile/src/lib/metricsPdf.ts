import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { MetricsSummary, SessionStats, AnalyticsOverview } from './api';

function fmtXof(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' FCFA';
}

function fmtBytes(bytesStr: string): string {
  const bytes = Number(bytesStr);
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function buildHtml(
  metrics: MetricsSummary,
  periodLabel: string,
  sessionStats?: SessionStats,
  overview?: AnalyticsOverview,
): string {
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const conversionPct = metrics.ticketsGenerated > 0
    ? Math.round((metrics.ticketsUsed / metrics.ticketsGenerated) * 100)
    : null;
  const arpu = metrics.ticketsUsed > 0
    ? Math.round(metrics.revenueXof / metrics.ticketsUsed)
    : null;

  const planRows = metrics.byPlan
    .map(
      (p) => `<tr><td>${p.planName}</td><td style="text-align:right">${p.sold}</td><td style="text-align:right">${fmtXof(p.revenueXof)}</td></tr>`,
    )
    .join('');

  const sessionSection = sessionStats
    ? `
    <h2>Sessions & Réseau</h2>
    <div class="kpis">
      <div class="kpi"><span class="kpi-value">${sessionStats.totalSessions}</span><span class="kpi-label">Sessions totales</span></div>
      <div class="kpi"><span class="kpi-value">${sessionStats.activeSessions}</span><span class="kpi-label">Sessions actives</span></div>
      <div class="kpi"><span class="kpi-value">${sessionStats.averageDurationMinutes != null ? sessionStats.averageDurationMinutes + ' min' : '—'}</span><span class="kpi-label">Durée moyenne</span></div>
    </div>
    <table>
      <tr><th>Métrique</th><th style="text-align:right">Valeur</th></tr>
      <tr><td>Téléchargé</td><td style="text-align:right">${fmtBytes(sessionStats.totalBytesIn)}</td></tr>
      <tr><td>Envoyé</td><td style="text-align:right">${fmtBytes(sessionStats.totalBytesOut)}</td></tr>
      <tr><td>Total</td><td style="text-align:right">${fmtBytes(sessionStats.totalBytes)}</td></tr>
    </table>
    ${
      sessionStats.byRouter.length > 0
        ? `<h3>Par routeur</h3><table>
        <tr><th>Routeur</th><th style="text-align:right">Sessions</th><th style="text-align:right">Données</th></tr>
        ${sessionStats.byRouter.map((r) => `<tr><td>${r.routerName}</td><td style="text-align:right">${r.sessionCount}</td><td style="text-align:right">${fmtBytes((BigInt(r.bytesIn) + BigInt(r.bytesOut)).toString())}</td></tr>`).join('')}
        </table>`
        : ''
    }`
    : '';

  const routerSection = overview && overview.routersSummary.length > 0
    ? `<h2>Classement des routeurs</h2>
    <table>
      <tr><th>Routeur</th><th style="text-align:right">CA</th><th style="text-align:right">Ventes</th><th style="text-align:right">Part</th></tr>
      ${overview.routersSummary.map((r) => `<tr><td>${r.routerName}</td><td style="text-align:right">${fmtXof(r.revenueXof)}</td><td style="text-align:right">${r.salesCount}</td><td style="text-align:right">${r.contributionPercent.toFixed(0)}%</td></tr>`).join('')}
    </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a2e; padding: 24px; font-size: 13px; }
  h1 { font-size: 20px; color: #6C5CE7; margin-bottom: 2px; }
  h2 { font-size: 15px; color: #333; border-bottom: 2px solid #6C5CE7; padding-bottom: 4px; margin-top: 24px; }
  h3 { font-size: 13px; color: #666; margin-top: 16px; }
  .meta { color: #888; font-size: 11px; margin-bottom: 20px; }
  .kpis { display: flex; gap: 16px; margin: 12px 0; }
  .kpi { flex: 1; background: #f8f9fa; border-radius: 8px; padding: 12px; text-align: center; }
  .kpi-value { display: block; font-size: 22px; font-weight: 800; color: #00b894; }
  .kpi-label { display: block; font-size: 10px; color: #888; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 12px; }
  th { background: #f8f9fa; font-weight: 700; text-align: left; }
  .trend { font-weight: 700; }
  .trend-up { color: #00b894; }
  .trend-down { color: #e17055; }
  .quality { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; }
  .quality-exact { background: #d4edda; color: #155724; }
  .quality-estimated { background: #fff3cd; color: #856404; }
  .quality-mixed { background: #fff3cd; color: #856404; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ddd; color: #aaa; font-size: 10px; text-align: center; }
</style>
</head>
<body>
  <h1>Rapport MikroLan</h1>
  <div class="meta">${periodLabel} · Généré le ${date}</div>

  <h2>Chiffre d'affaires</h2>
  <div class="kpis">
    <div class="kpi"><span class="kpi-value">${fmtXof(metrics.revenueXof)}</span><span class="kpi-label">Revenu</span></div>
    <div class="kpi"><span class="kpi-value">${conversionPct != null ? conversionPct + '%' : '—'}</span><span class="kpi-label">Conversion</span></div>
    <div class="kpi"><span class="kpi-value">${arpu != null ? fmtXof(arpu) : '—'}</span><span class="kpi-label">Panier moyen</span></div>
    <div class="kpi"><span class="kpi-value">${metrics.activeSessions}</span><span class="kpi-label">En ligne</span></div>
  </div>

  ${metrics.trendPct != null ? `<p class="trend ${metrics.trendPct >= 0 ? 'trend-up' : 'trend-down'}">${metrics.trendPct >= 0 ? '+' : ''}${metrics.trendPct}% vs période précédente</p>` : ''}

  ${metrics.dataQuality && metrics.dataQuality !== 'EXACT' ? `<p><span class="quality quality-${metrics.dataQuality.toLowerCase()}">${metrics.dataQuality}</span> Exact: ${fmtXof(metrics.exactRevenueXof ?? 0)} · Estimé: ${fmtXof(metrics.estimatedRevenueXof ?? 0)}</p>` : ''}

  <h2>Répartition par forfait</h2>
  <table>
    <tr><th>Forfait</th><th style="text-align:right">Ventes</th><th style="text-align:right">Revenu</th></tr>
    ${planRows}
  </table>

  ${routerSection}
  ${sessionSection}

  <div class="footer">MikroLan · Rapport automatique</div>
</body>
</html>`;
}

export async function exportMetricsPdf(
  metrics: MetricsSummary,
  periodLabel: string,
  sessionStats?: SessionStats,
  overview?: AnalyticsOverview,
): Promise<void> {
  const html = buildHtml(metrics, periodLabel, sessionStats, overview);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Exporter le rapport PDF',
    });
  }
}
