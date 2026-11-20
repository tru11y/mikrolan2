'use client';

// Composants graphiques internes au cluster Sessions/Rapport/Analytics.
// SVG inline maison, aucune librairie de charting. Lisibles en dark,
// accessibles (role img + aria-label décrivant la série).

export type ChartBar = { label: string; value: number };

type BarChartProps = {
  data: ChartBar[];
  ariaLabel: string;
  formatValue?: (n: number) => string;
  /** Nombre max de libellés d'axe X affichés (évite le chevauchement). */
  maxLabels?: number;
  height?: number;
  className?: string;
};

export function BarChart({
  data,
  ariaLabel,
  formatValue = (n) => String(n),
  maxLabels = 8,
  height = 140,
  className = '',
}: BarChartProps) {
  const width = 320;
  const padBottom = 22;
  const padTop = 6;
  const chartH = height - padBottom - padTop;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const gap = n > 1 ? 2 : 0;
  const barW = n > 0 ? (width - gap * (n - 1)) / n : 0;
  const labelStep = Math.max(1, Math.ceil(n / maxLabels));

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`h-auto w-full ${className}`}
    >
      <line
        x1={0}
        y1={padTop + chartH}
        x2={width}
        y2={padTop + chartH}
        className="stroke-border"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <g className="text-primary">
        {data.map((d, i) => {
          const h = max > 0 ? (d.value / max) * chartH : 0;
          const x = i * (barW + gap);
          const y = padTop + chartH - h;
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, d.value > 0 ? 1 : 0)}
              rx={1.5}
              fill="currentColor"
            >
              <title>{`${d.label} : ${formatValue(d.value)}`}</title>
            </rect>
          );
        })}
      </g>
      <g className="fill-muted" style={{ fontSize: 9 }}>
        {data.map((d, i) =>
          i % labelStep === 0 ? (
            <text
              key={i}
              x={i * (barW + gap) + barW / 2}
              y={height - 6}
              textAnchor="middle"
            >
              {d.label}
            </text>
          ) : null,
        )}
      </g>
    </svg>
  );
}

export type ChartPoint = { label: string; value: number; lower?: number; upper?: number };

type LineChartProps = {
  data: ChartPoint[];
  ariaLabel: string;
  formatValue?: (n: number) => string;
  /** Affiche la bande lowerBound/upperBound (prévisions). */
  showBand?: boolean;
  maxLabels?: number;
  height?: number;
  className?: string;
};

export function LineChart({
  data,
  ariaLabel,
  formatValue = (n) => String(n),
  showBand = false,
  maxLabels = 6,
  height = 160,
  className = '',
}: LineChartProps) {
  const width = 320;
  const padX = 4;
  const padBottom = 22;
  const padTop = 8;
  const chartH = height - padBottom - padTop;
  const n = data.length;

  const values = data.flatMap((d) =>
    showBand ? [d.value, d.lower ?? d.value, d.upper ?? d.value] : [d.value],
  );
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;

  const xAt = (i: number) => padX + (n > 1 ? (i / (n - 1)) * (width - padX * 2) : (width - padX * 2) / 2);
  const yAt = (v: number) => padTop + chartH - ((v - min) / span) * chartH;

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(d.value).toFixed(1)}`).join(' ');

  const bandPath =
    showBand && n > 1
      ? [
          ...data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(d.upper ?? d.value).toFixed(1)}`),
          ...data
            .slice()
            .reverse()
            .map((d, ri) => {
              const i = n - 1 - ri;
              return `L${xAt(i).toFixed(1)},${yAt(d.lower ?? d.value).toFixed(1)}`;
            }),
          'Z',
        ].join(' ')
      : null;

  const labelStep = Math.max(1, Math.ceil(n / maxLabels));

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`h-auto w-full ${className}`}
    >
      <line
        x1={0}
        y1={padTop + chartH}
        x2={width}
        y2={padTop + chartH}
        className="stroke-border"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {bandPath && <path d={bandPath} className="fill-primary" fillOpacity={0.12} />}
      {n > 1 && (
        <path
          d={line}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <g className="fill-primary">
        {data.map((d, i) => (
          <circle key={i} cx={xAt(i)} cy={yAt(d.value)} r={2}>
            <title>{`${d.label} : ${formatValue(d.value)}`}</title>
          </circle>
        ))}
      </g>
      <g className="fill-muted" style={{ fontSize: 9 }}>
        {data.map((d, i) =>
          i % labelStep === 0 ? (
            <text key={i} x={xAt(i)} y={height - 6} textAnchor="middle">
              {d.label}
            </text>
          ) : null,
        )}
      </g>
    </svg>
  );
}

type TabItem<T extends string> = { key: T; label: string };

export function PeriodTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel = 'Période',
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex gap-1 rounded-xl border border-border bg-surface2 p-1">
      {items.map((it) => {
        const active = it.key === value;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              active ? 'bg-primary text-white' : 'text-muted hover:text-fg'
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
