/** Windowed statistics over telemetry slices. Kept separate so the scoring
 *  logic reads as reasoning rather than arithmetic. */

export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Ordinary least squares slope, per sample. */
export function slope(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const xbar = (n - 1) / 2;
  const ybar = mean(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xbar) * (xs[i] - ybar);
    den += (i - xbar) ** 2;
  }
  return den === 0 ? NaN : num / den;
}

/**
 * Robust z-score via median absolute deviation. Pressure data has genuine
 * outliers (hydrant flushing, main breaks elsewhere in the zone) and a mean/sd
 * z-score lets a single such day dominate the answer.
 */
export function robustZ(value: number, baseline: number[]): number {
  if (baseline.length < 8) return NaN;
  const med = median(baseline);
  const mad = median(baseline.map((x) => Math.abs(x - med)));
  // 1.4826 makes MAD a consistent estimator of sigma for normal data.
  const scale = mad * 1.4826;
  if (!Number.isFinite(scale) || scale < 1e-9) return 0;
  return (value - med) / scale;
}

/**
 * Cumulative-sum change-point score: the largest sustained departure from the
 * baseline mean, normalised. Answers "did this series shift regime", which is
 * a different and more useful question than "is today unusual".
 */
export function changePointScore(baseline: number[], recent: number[]): number {
  if (baseline.length < 10 || recent.length < 5) return NaN;
  const mu = mean(baseline);
  const sd = stdev(baseline);
  if (!Number.isFinite(sd) || sd < 1e-9) return 0;
  let cum = 0;
  let peak = 0;
  for (const x of recent) {
    cum = Math.max(0, cum + (x - mu) / sd - 0.5);
    if (cum > peak) peak = cum;
  }
  return peak / Math.sqrt(recent.length);
}

/** Squash an unbounded score into 0-1 with a soft knee. */
export function saturate(x: number, knee: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return 1 - Math.exp(-x / knee);
}
