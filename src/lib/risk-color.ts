/**
 * Shared risk ramp. Blue -> amber -> red, avoiding a red/green encoding: this
 * is a safety tool and ~8% of men have a red-green deficiency. Lightness
 * increases monotonically with risk so the ordering survives in greyscale.
 */
export const RISK_STOPS: [number, string][] = [
  [0, '#2b6cb0'],
  [20, '#4a9ecf'],
  [35, '#d9a441'],
  [50, '#e07b39'],
  [65, '#d94f3d'],
  [80, '#ff3b30'],
];

export function riskColor(risk: number): string {
  let out = RISK_STOPS[0][1];
  for (const [stop, color] of RISK_STOPS) if (risk >= stop) out = color;
  return out;
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

export const PROVENANCE_COLOR: Record<string, string> = {
  observed: '#4da3ff',
  inferred: '#b98bff',
  predicted: '#d9a441',
  recommended: '#5ac8a8',
};
