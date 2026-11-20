export function xof(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return `${v.toLocaleString('fr-FR')} FCFA`;
}

export function dateFr(input: string | number | Date | null | undefined): string {
  if (!input) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function bytes(n: number | null | undefined): string {
  let v = typeof n === 'number' ? n : 0;
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
