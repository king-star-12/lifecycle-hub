/**
 * Risk ramp and provenance colours.
 *
 * Every value is read from a CSS custom property rather than hard-coded, so the
 * canvas map, the SVG charts and the Tailwind surfaces all repaint together
 * when the theme changes. `cssVar` falls back to the light-theme literal during
 * server rendering, where there is no computed style to read.
 */

export const RISK_STOPS = [0, 20, 35, 50, 65, 80] as const;

const LIGHT_FALLBACK: Record<string, string> = {
  '--c-risk-0': '#4ade80',
  '--c-risk-1': '#22c55e',
  '--c-risk-2': '#facc15',
  '--c-risk-3': '#fb923c',
  '--c-risk-4': '#ea580c',
  '--c-risk-5': '#c2410c',
  '--c-observed': '#15803d',
  '--c-inferred': '#a16207',
  '--c-predicted': '#c2410c',
  '--c-recommended': '#0f766e',
  '--c-map-bg': '#ffffff',
  '--c-map-grid': 'rgba(15,23,42,0.05)',
  '--c-map-label': 'rgba(15,23,42,0.34)',
  '--c-map-select': '#0f172a',
  '--c-break-ring': '#c2410c',
  '--c-accent': '#16a34a',
  '--c-line': '#e5e7eb',
};

export function cssVar(name: string): string {
  if (typeof window === 'undefined') return LIGHT_FALLBACK[name] ?? '#000000';
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || LIGHT_FALLBACK[name] || '#000000';
}

/** Index into the ramp for a 0-100 risk score. */
export function riskIndex(risk: number): number {
  let idx = 0;
  for (let i = 0; i < RISK_STOPS.length; i++) if (risk >= RISK_STOPS[i]) idx = i;
  return idx;
}

export function riskColor(risk: number): string {
  return cssVar(`--c-risk-${riskIndex(risk)}`);
}

export function riskLabel(risk: number): string {
  if (risk >= 80) return 'CRITICAL';
  if (risk >= 65) return 'HIGH';
  if (risk >= 50) return 'ELEVATED';
  if (risk >= 35) return 'MODERATE';
  if (risk >= 20) return 'LOW';
  return 'MINIMAL';
}

export const FAMILY_LABEL: Record<string, string> = {
  asset_history: 'Asset history',
  hydraulic: 'Hydraulic',
  environmental: 'Environmental',
  spatial: 'Spatial',
  documentary: 'Documentary',
  external: 'External context',
};

export function provenanceColor(p: string): string {
  return cssVar(`--c-${p}`);
}
