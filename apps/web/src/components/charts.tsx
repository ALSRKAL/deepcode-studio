/**
 * Server-rendered SVG charts on the design tokens (docs/plan/03 §5): cyan primary
 * series, indigo second series, values labelled directly, tabular mono numerals.
 * Every chart has an accessible table alternative rendered next to it.
 */
export interface SeriesPoint {
  label: string;
  value: number;
}

const W = 640;
const H = 200;
const PAD = { top: 16, right: 12, bottom: 24, start: 12, end: 12 };

/** In RTL the page mirrors around the SVG; charts stay LTR (time flows left→right). */
export function LineChart({ series, secondary }: { series: SeriesPoint[]; secondary?: SeriesPoint[] }) {
  if (series.length === 0) return null;
  const max = Math.max(...series.map((s) => s.value), ...(secondary?.map((s) => s.value) ?? [0]), 1);
  const innerW = W - PAD.start - PAD.end;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.start + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const path = (pts: SeriesPoint[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  return (
    <span className="block w-full" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="chart">
        <path d={path(series)} fill="none" className="stroke-primary" strokeWidth="2" />
        {secondary && secondary.length > 0 ? <path d={path(secondary)} fill="none" className="stroke-secondary" strokeWidth="2" /> : null}
        <circle cx={x(series.length - 1)} cy={y(series[series.length - 1]!.value)} r="3" className="fill-primary" />
        <text x={x(series.length - 1) - 6} y={y(series[series.length - 1]!.value) - 8} textAnchor="end" fontSize="11" className="fill-fg-muted" fontFamily="var(--font-mono)">
          {series[series.length - 1]!.value.toLocaleString("en-US")}
        </text>
      </svg>
    </span>
  );
}

export function BarChart({ series }: { series: Array<SeriesPoint & { parts?: Array<{ label: string; value: number; color: string }> }> }) {
  if (series.length === 0) return null;
  const max = Math.max(...series.map((s) => s.value), 1);
  const innerW = W - PAD.start - PAD.end;
  const innerH = H - PAD.top - PAD.bottom;
  const bw = innerW / series.length;
  return (
    <span className="block w-full" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="chart">
        {series.map((s, i) => {
          const h = (s.value / max) * innerH;
          return (
            <g key={s.label}>
              <rect
                x={PAD.start + i * bw + bw * 0.15}
                y={PAD.top + innerH - h}
                width={bw * 0.7}
                height={Math.max(h, 1)}
                className="fill-primary"
                rx="2"
              />
            </g>
          );
        })}
        {series.map((s, i) =>
          i % Math.ceil(series.length / 8) === 0 ? (
            <text key={`l-${s.label}`} x={PAD.start + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" className="fill-fg-subtle" fontFamily="var(--font-mono)">
              {s.label}
            </text>
          ) : null,
        )}
      </svg>
    </span>
  );
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const w = 120;
  const h = 32;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`);
  return (
    <span dir="ltr" className="inline-block align-middle">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
        <polyline points={pts.join(" ")} fill="none" className="stroke-primary" strokeWidth="1.5" />
      </svg>
    </span>
  );
}
