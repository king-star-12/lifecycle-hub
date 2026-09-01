'use client';

type Props = {
  values: number[];
  /** Optional second series drawn faintly behind, for context. */
  behind?: number[];
  color?: string;
  behindColor?: string;
  height?: number;
  /** Index to mark with a vertical rule, e.g. an inspection or a break. */
  marks?: { at: number; color: string; label?: string }[];
  fill?: boolean;
};

/**
 * Inline SVG series. Deliberately not a charting library: these are dense,
 * repeated, and need to stay legible at 40px tall next to a number.
 */
export default function Sparkline({
  values,
  behind,
  color = '#4da3ff',
  behindColor = '#2c3745',
  height = 44,
  marks = [],
  fill = true,
}: Props) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-ink-faint"
        style={{ height }}
      >
        no data
      </div>
    );
  }

  const W = 300;
  const H = height;
  const pad = 3;
  const all = behind?.length ? [...clean, ...behind.filter(Number.isFinite)] : clean;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const path = (series: number[]) =>
    series
      .map((v, i) => {
        const x = (i / (series.length - 1)) * (W - pad * 2) + pad;
        const y = H - pad - ((v - min) / span) * (H - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const id = `sg-${color.replace('#', '')}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {behind && behind.length > 1 && (
        <path d={path(behind)} fill="none" stroke={behindColor} strokeWidth="1" />
      )}
      {fill && (
        <path
          d={`${path(clean)} L${W - pad},${H} L${pad},${H} Z`}
          fill={`url(#${id})`}
          stroke="none"
        />
      )}
      <path d={path(clean)} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" />
      {marks.map((m, i) => {
        const x = (m.at / (clean.length - 1)) * (W - pad * 2) + pad;
        return (
          <line
            key={i}
            x1={x}
            x2={x}
            y1={0}
            y2={H}
            stroke={m.color}
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity="0.8"
          />
        );
      })}
    </svg>
  );
}
