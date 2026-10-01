/** Formats communs aux écrans hotspot (sessions, vérification de ticket) et admin. */

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** `JJ/MM/AAAA HH:MM:SS`, à partir d'une date ISO. */
export function fmtDateFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** `HH:MM:SS`, sans limite à 24h (ex. 48:00:00). */
export function fmtDurationHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

/** Date courte pour les listes admin ("21 sept. 26"), ou "—" si absente. */
export function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}

/** Parse un uptime RouterOS ("1h4m10s", "2d3h") en secondes. */
export function parseRouterOsUptime(uptime: string | null | undefined): number {
  if (!uptime) return 0;
  let total = 0;
  const d = uptime.match(/(\d+)d/);
  const h = uptime.match(/(\d+)h/);
  const m = uptime.match(/(\d+)m/);
  const s = uptime.match(/(\d+)s/);
  if (d) total += parseInt(d[1], 10) * 86400;
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (s) total += parseInt(s[1], 10);
  return total;
}
