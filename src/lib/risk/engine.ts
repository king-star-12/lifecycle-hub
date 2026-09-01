import type {
  Asset,
  Complaint,
  DocumentFinding,
  FailureEvent,
  NetworkBundle,
  Provenance,
  TelemetrySeries,
} from '../types.ts';
import { clamp, round } from '../sim/rng.ts';
import { buildGridIndex, distanceM } from '../sim/geo.ts';
import { changePointScore, mean, median, saturate, slope } from './stats.ts';

/**
 * The Clustral risk engine.
 *
 * Two rules govern this file.
 *
 * 1. AS-OF DISCIPLINE. Every feature is computed from data strictly at or
 *    before `asOf`. No slice, no lookup and no aggregate may touch a later day.
 *    A backtest is worthless the moment one of them does, and leakage of this
 *    kind is invisible in the output -- it just makes the model look good.
 *
 * 2. ZONE NORMALISATION. A pipe is only interesting when it diverges from its
 *    neighbours. Pump changeovers, seasonal demand and reservoir operations
 *    move every asset in a pressure zone together, and a naive detector reads
 *    those as hundreds of simultaneous pipe anomalies. Hydraulic evidence here
 *    is always relative to the asset's own zone peers on the same day.
 *
 * The score is additive and fully decomposable. There is no black box: every
 * point on the 0-100 scale is attributable to a named factor with a stated
 * provenance, because an operator who cannot see why will not dig up a street.
 */

export const EVIDENCE_FAMILIES = [
  'asset_history',
  'hydraulic',
  'environmental',
  'spatial',
  'documentary',
  'external',
] as const;
export type EvidenceFamily = (typeof EVIDENCE_FAMILIES)[number];

export type RiskFactor = {
  key: string;
  label: string;
  family: EvidenceFamily;
  /** Points contributed to the 0-100 score. */
  contribution: number;
  /** Normalised signal strength, 0-1, before weighting. */
  strength: number;
  detail: string;
  provenance: Provenance;
};

export type RiskScore = {
  asset_id: string;
  as_of: string;
  risk: number;
  confidence: number;
  trajectory: 'decreasing' | 'stable' | 'increasing' | 'rapidly_increasing';
  horizon: string | null;
  factors: RiskFactor[];
  convergence: { families: number; bonus: number };
  confidence_reasons: { positive: string[]; negative: string[] };
  data_gaps: string[];
};

/** Maximum points each evidence family may contribute. */
const WEIGHTS: Record<EvidenceFamily, number> = {
  asset_history: 26,
  hydraulic: 24,
  spatial: 18,
  environmental: 14,
  documentary: 14,
  external: 6,
};
const CONVERGENCE_MAX = 12;

const MATERIAL_FRAILTY: Record<string, number> = {
  cast_iron: 1.0,
  asbestos_cement: 0.9,
  steel: 0.76,
  ductile_iron: 0.46,
  pvc: 0.24,
  hdpe: 0.16,
};
const FROST_EXPOSURE: Record<string, number> = {
  cast_iron: 1.0,
  asbestos_cement: 0.92,
  pvc: 0.6,
  steel: 0.55,
  ductile_iron: 0.4,
  hdpe: 0.18,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export type RiskContext = {
  bundle: NetworkBundle;
  telemetry: Map<string, TelemetrySeries>;
  dayIndex: Map<string, number>;
  assets: Map<string, Asset>;
  /** asset_id -> its own failures, as day indices. */
  ownFailures: Map<string, number[]>;
  /** asset_id -> its own repairs, as day indices. */
  ownRepairs: Map<string, number[]>;
  /** asset_id -> failures on other assets nearby: [dayIdx, metres]. */
  nearbyFailures: Map<string, [number, number][]>;
  /** asset_id -> complaints within 250 m: [dayIdx, category]. */
  nearbyComplaints: Map<string, [number, Complaint['category']][]>;
  /** asset_id -> document findings, as [dayIdx, finding]. */
  findings: Map<string, [number, DocumentFinding][]>;
  /** zone_id -> asset ids. */
  zoneMembers: Map<string, string[]>;
};

export function buildContext(
  bundle: NetworkBundle,
  telemetry: TelemetrySeries[],
): RiskContext {
  const dayIndex = new Map(bundle.weather.map((w, i) => [w.date, i]));
  const assets = new Map(bundle.assets.map((a) => [a.asset_id, a]));

  const ownFailures = new Map<string, number[]>();
  const ownRepairs = new Map<string, number[]>();
  const nearbyFailures = new Map<string, [number, number][]>();
  const nearbyComplaints = new Map<string, [number, Complaint['category']][]>();
  const findings = new Map<string, [number, DocumentFinding][]>();
  const zoneMembers = new Map<string, string[]>();

  for (const a of bundle.assets) {
    ownFailures.set(a.asset_id, []);
    ownRepairs.set(a.asset_id, []);
    nearbyFailures.set(a.asset_id, []);
    nearbyComplaints.set(a.asset_id, []);
    findings.set(a.asset_id, []);
    const zone = zoneMembers.get(a.pressure_zone);
    if (zone) zone.push(a.asset_id);
    else zoneMembers.set(a.pressure_zone, [a.asset_id]);
  }

  for (const f of bundle.failures) {
    const d = dayIndex.get(f.date);
    if (d === undefined) continue;
    ownFailures.get(f.asset_id)?.push(d);
    const origin = assets.get(f.asset_id);
    if (!origin) continue;
    // A break is evidence about its neighbours too: shared age, shared soil,
    // shared bedding contractor, and the excavation itself disturbs them.
    for (const nid of bundle.neighbors[f.asset_id] ?? []) {
      const n = assets.get(nid);
      if (!n) continue;
      nearbyFailures.get(nid)?.push([d, distanceM(origin.centroid, n.centroid)]);
    }
  }

  for (const r of bundle.repairs) {
    const d = dayIndex.get(r.date);
    if (d !== undefined) ownRepairs.get(r.asset_id)?.push(d);
  }

  // Complaints arrive geolocated to an address, not to a pipe. Associating
  // them with plausible assets is the engine's job.
  const index = buildGridIndex(bundle.assets.map((a) => ({ id: a.asset_id, at: a.centroid })));
  for (const c of bundle.complaints) {
    const d = dayIndex.get(c.date);
    if (d === undefined) continue;
    for (const id of index.within(c.location, 250)) {
      nearbyComplaints.get(id)?.push([d, c.category]);
    }
  }

  for (const f of bundle.findings) {
    const d = dayIndex.get(f.date);
    if (d !== undefined) findings.get(f.asset_id)?.push([d, f]);
  }

  return {
    bundle,
    telemetry: new Map(telemetry.map((t) => [t.asset_id, t])),
    dayIndex,
    assets,
    ownFailures,
    ownRepairs,
    nearbyFailures,
    nearbyComplaints,
    findings,
    zoneMembers,
  };
}

// ---------------------------------------------------------------------------
// Hydraulic features (zone-normalised)
// ---------------------------------------------------------------------------

const RECENT_DAYS = 21;
const BASELINE_START = 240;
const BASELINE_END = 120;

type Hydraulic = {
  varianceLift: number;
  changePoint: number;
  flowLift: number;
  varianceSlope: number;
  available: boolean;
};

function hydraulicRaw(ctx: RiskContext, assetId: string, asOf: number): Hydraulic {
  const t = ctx.telemetry.get(assetId);
  const empty: Hydraulic = {
    varianceLift: NaN,
    changePoint: NaN,
    flowLift: NaN,
    varianceSlope: NaN,
    available: false,
  };
  if (!t || !t.pressure_std.length || asOf < BASELINE_START + 10) return empty;

  const recentStd = t.pressure_std.slice(asOf - RECENT_DAYS, asOf);
  const baseStd = t.pressure_std.slice(asOf - BASELINE_START, asOf - BASELINE_END);
  const recentFlow = t.flow_mean.slice(asOf - RECENT_DAYS, asOf);
  const baseFlow = t.flow_mean.slice(asOf - BASELINE_START, asOf - BASELINE_END);
  if (recentStd.length < 10 || baseStd.length < 30) return empty;

  const baseMean = mean(baseStd);
  return {
    varianceLift: baseMean > 1e-6 ? mean(recentStd) / baseMean : NaN,
    changePoint: changePointScore(baseStd, recentStd),
    flowLift: mean(baseFlow) > 1e-6 ? mean(recentFlow) / mean(baseFlow) : NaN,
    // Slope over 60 days tells trajectory, which a ratio alone cannot.
    varianceSlope: slope(t.pressure_std.slice(Math.max(0, asOf - 60), asOf)),
    available: true,
  };
}

/** Median hydraulic behaviour per zone, so the engine can ask what is
 *  *unusual for this zone today* rather than what is merely happening. */
export function zoneBaselines(
  ctx: RiskContext,
  asOf: number,
): Map<string, { lift: number; changePoint: number; flow: number }> {
  const out = new Map<string, { lift: number; changePoint: number; flow: number }>();
  for (const [zone, members] of ctx.zoneMembers) {
    const lifts: number[] = [];
    const cps: number[] = [];
    const flows: number[] = [];
    for (const id of members) {
      const h = hydraulicRaw(ctx, id, asOf);
      if (!h.available) continue;
      if (Number.isFinite(h.varianceLift)) lifts.push(h.varianceLift);
      if (Number.isFinite(h.changePoint)) cps.push(h.changePoint);
      if (Number.isFinite(h.flowLift)) flows.push(h.flowLift);
    }
    out.set(zone, {
      lift: lifts.length >= 5 ? median(lifts) : 1,
      changePoint: cps.length >= 5 ? median(cps) : 0,
      flow: flows.length >= 5 ? median(flows) : 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scoreAsset(
  ctx: RiskContext,
  assetId: string,
  asOf: number,
  zoneStats: Map<string, { lift: number; changePoint: number; flow: number }>,
  externalBoost?: { strength: number; detail: string },
): RiskScore {
  const asset = ctx.assets.get(assetId)!;
  const asOfDate = ctx.bundle.weather[asOf].date;
  const factors: RiskFactor[] = [];
  const gaps: string[] = [];
  const push = (
    key: string,
    label: string,
    family: EvidenceFamily,
    strength: number,
    detail: string,
    provenance: Provenance,
  ) => {
    const s = clamp(strength, 0, 1);
    if (s <= 0.001) return;
    factors.push({
      key,
      label,
      family,
      strength: round(s, 3),
      contribution: round(s * WEIGHTS[family], 2),
      detail,
      provenance,
    });
  };

  // --- asset history ------------------------------------------------------
  const year = Number(asOfDate.slice(0, 4));
  const age = year - asset.install_year;
  const frailty = MATERIAL_FRAILTY[asset.material] ?? 0.5;
  const ageStrength = clamp((age / 110) * frailty, 0, 1);
  push(
    'age_material',
    'Age and material',
    'asset_history',
    ageStrength,
    `${age}-year-old ${asset.material.replace(/_/g, ' ')} main (installed ${asset.install_year}), ${asset.diameter_in}" diameter`,
    'observed',
  );

  const priorFailures = (ctx.ownFailures.get(assetId) ?? []).filter((d) => d < asOf);
  const priorRepairs = (ctx.ownRepairs.get(assetId) ?? []).filter((d) => d < asOf);
  if (priorFailures.length) {
    const last = Math.max(...priorFailures);
    const yearsSince = (asOf - last) / 365.25;
    // A segment that has broken before is the strongest single predictor in
    // the utility literature, and recency matters as much as count.
    const strength = clamp(
      (0.45 + 0.25 * (priorFailures.length - 1)) * Math.exp(-yearsSince / 4),
      0,
      1,
    );
    push(
      'repeat_failure',
      'Prior failures on this segment',
      'asset_history',
      strength,
      `${priorFailures.length} previous break${priorFailures.length > 1 ? 's' : ''}, most recent ${yearsSince.toFixed(1)} years ago`,
      'observed',
    );
  }
  if (priorRepairs.length >= 2) {
    push(
      'repair_burden',
      'Repeated repair history',
      'asset_history',
      clamp(0.2 * priorRepairs.length, 0, 0.8),
      `${priorRepairs.length} recorded repairs; each intervention leaves a weakened joint`,
      'observed',
    );
  }

  // --- hydraulic (zone-normalised) ---------------------------------------
  const h = hydraulicRaw(ctx, assetId, asOf);
  const zs = zoneStats.get(asset.pressure_zone) ?? { lift: 1, changePoint: 0, flow: 1 };
  let hydraulicStrength = 0;
  if (!asset.has_sensor) {
    gaps.push('No pressure or flow sensor covers this segment');
  } else if (!h.available) {
    gaps.push('Insufficient telemetry history at this date');
  } else {
    // The divergence, not the level. This is what survives a pump changeover.
    const relLift = h.varianceLift / Math.max(zs.lift, 0.2);
    const relCp = h.changePoint - zs.changePoint;

    const liftStrength = saturate(relLift - 1.05, 0.35);
    const cpStrength = saturate(relCp, 1.1);
    hydraulicStrength = clamp(0.62 * liftStrength + 0.38 * cpStrength, 0, 1);

    if (liftStrength > 0.02) {
      push(
        'pressure_variance',
        'Pressure variance rising against zone',
        'hydraulic',
        liftStrength,
        `Pressure variability is ${((relLift - 1) * 100).toFixed(0)}% above this segment's own baseline after removing ${asset.pressure_zone} zone-wide movement`,
        'inferred',
      );
    }
    if (cpStrength > 0.02) {
      push(
        'regime_change',
        'Hydraulic regime change',
        'hydraulic',
        cpStrength * 0.85,
        `Sustained departure from baseline behaviour (CUSUM ${relCp.toFixed(2)}), not a single-day excursion`,
        'inferred',
      );
    }
    const relFlow = h.flowLift / Math.max(zs.flow, 0.2);
    if (relFlow > 1.06) {
      push(
        'flow_anomaly',
        'Unexplained flow increase',
        'hydraulic',
        saturate(relFlow - 1.06, 0.18) * 0.7,
        `Flow ${((relFlow - 1) * 100).toFixed(0)}% above zone-adjusted baseline, consistent with developing leakage`,
        'inferred',
      );
    }
  }

  // --- spatial ------------------------------------------------------------
  const nearby = (ctx.nearbyFailures.get(assetId) ?? []).filter((x) => x[0] < asOf);
  const recentNearby = nearby.filter((x) => asOf - x[0] <= 365);
  if (recentNearby.length) {
    // Weight by proximity and recency: a break 80 m away last month is not
    // the same evidence as one 480 m away eleven months ago.
    let w = 0;
    for (const [d, dist] of recentNearby) {
      w += Math.exp(-dist / 220) * Math.exp(-(asOf - d) / 200);
    }
    const closest = Math.min(...recentNearby.map((x) => x[1]));
    push(
      'break_cluster',
      'Nearby breaks',
      'spatial',
      saturate(w, 1.1),
      `${recentNearby.length} break${recentNearby.length > 1 ? 's' : ''} within 500 m in the past year, nearest ${closest.toFixed(0)} m`,
      'observed',
    );
  }

  const complaints = (ctx.nearbyComplaints.get(assetId) ?? []).filter(
    (x) => x[0] < asOf && asOf - x[0] <= 90,
  );
  const telling = complaints.filter(
    (c) => c[1] === 'discoloration' || c[1] === 'low_pressure' || c[1] === 'street_water',
  );
  if (telling.length >= 2) {
    push(
      'complaint_cluster',
      'Customer complaint cluster',
      'spatial',
      saturate(telling.length - 1, 3.2) * 0.8,
      `${telling.length} pressure/discolouration/street-water reports within 250 m in 90 days`,
      'observed',
    );
  }

  // --- environmental ------------------------------------------------------
  const frostSens = FROST_EXPOSURE[asset.material] ?? 0.5;
  const win = ctx.bundle.weather.slice(Math.max(0, asOf - 30), asOf);
  const ftDays = win.filter((d) => d.freeze_thaw).length;
  const frostPeak = Math.max(0, ...win.map((d) => d.frost_index));
  if (ftDays >= 3) {
    push(
      'freeze_thaw',
      'Freeze-thaw loading',
      'environmental',
      clamp((ftDays / 18) * frostSens, 0, 1),
      `${ftDays} freeze-thaw cycles in the past 30 days, frost index peaked at ${frostPeak.toFixed(0)}`,
      'observed',
    );
  }
  const smNow = ctx.bundle.weather[asOf].soil_moisture;
  const smSwing = Math.max(...win.map((d) => d.soil_moisture)) - Math.min(...win.map((d) => d.soil_moisture));
  if (smSwing > 0.12) {
    push(
      'ground_movement',
      'Soil moisture swing',
      'environmental',
      clamp((smSwing - 0.12) / 0.35, 0, 1) * (asset.material === 'asbestos_cement' || asset.material === 'pvc' ? 1 : 0.7),
      `Soil moisture moved ${(smSwing * 100).toFixed(0)} points in 30 days (now ${smNow.toFixed(2)}); shrink-swell loads bedding`,
      'observed',
    );
  }

  // --- documentary --------------------------------------------------------
  const docs = (ctx.findings.get(assetId) ?? []).filter((x) => x[0] < asOf);
  if (docs.length) {
    docs.sort((a, b) => b[0] - a[0]);
    const [dayIdx, f] = docs[0];
    const yearsOld = (asOf - dayIdx) / 365.25;
    const sevWeight =
      f.severity === 'severe' ? 1 : f.severity === 'moderate' ? 0.62 : f.severity === 'minor' ? 0.28 : 0.04;
    // An old inspection is still evidence -- corrosion does not heal -- but it
    // is weaker evidence about today.
    const strength = clamp(sevWeight * f.confidence * Math.exp(-yearsOld / 7), 0, 1);
    push(
      'inspection_finding',
      'Inspection evidence',
      'documentary',
      strength,
      `${f.severity} ${f.finding.replace(/_/g, ' ')} recorded ${yearsOld.toFixed(1)} years ago in ${f.document} (p.${f.page})`,
      'observed',
    );
  } else {
    gaps.push('No inspection report on file for this segment');
  }

  // --- external context (supplied by the live web layer) ------------------
  if (externalBoost && externalBoost.strength > 0) {
    push(
      'external_context',
      'External context',
      'external',
      externalBoost.strength,
      externalBoost.detail,
      'inferred',
    );
  }

  // --- aggregate ----------------------------------------------------------
  const byFamily = new Map<EvidenceFamily, number>();
  for (const f of factors) {
    byFamily.set(f.family, (byFamily.get(f.family) ?? 0) + f.contribution);
  }
  // Each family is capped at its own weight, so eight weak hydraulic signals
  // can never outvote a severe corrosion finding.
  let base = 0;
  for (const [family, sum] of byFamily) base += Math.min(sum, WEIGHTS[family]);

  // Convergence. The product thesis: independent evidence types agreeing is
  // worth more than any one of them shouting. Only families carrying real
  // signal count, and the bonus is superlinear in how many agree.
  const activeFamilies = [...byFamily.entries()].filter(
    ([family, sum]) => sum >= 0.22 * WEIGHTS[family],
  ).length;
  const convergenceBonus =
    activeFamilies >= 3 ? CONVERGENCE_MAX * clamp((activeFamilies - 2) / 3, 0, 1) : 0;

  const risk = clamp(base + convergenceBonus, 0, 100);

  // --- trajectory ---------------------------------------------------------
  let trajectory: RiskScore['trajectory'] = 'stable';
  if (h.available && Number.isFinite(h.varianceSlope)) {
    const norm = h.varianceSlope * 60;
    if (norm > 0.55) trajectory = 'rapidly_increasing';
    else if (norm > 0.12) trajectory = 'increasing';
    else if (norm < -0.2) trajectory = 'decreasing';
  }
  if (trajectory === 'stable' && recentNearby.length >= 2 && hydraulicStrength > 0.3) {
    trajectory = 'increasing';
  }

  // --- confidence ---------------------------------------------------------
  const positive: string[] = [];
  const negative: string[] = [];
  let confidence = 0.34;

  if (asset.has_sensor && h.available) {
    confidence += 0.22;
    positive.push('Telemetry available with a full baseline window');
  } else {
    confidence -= 0.12;
    negative.push(
      asset.has_sensor ? 'Telemetry history too short at this date' : 'No sensor coverage on this segment',
    );
  }
  const familiesPresent = byFamily.size;
  if (familiesPresent >= 2) {
    confidence += Math.min(0.06 * (familiesPresent - 1), 0.2);
    positive.push(`${familiesPresent} independent evidence types agree`);
  } else {
    negative.push('Only one evidence type is contributing');
  }
  if (docs.length) {
    confidence += 0.11;
    positive.push('Physical inspection evidence on file');
  } else {
    confidence -= 0.06;
    negative.push('No inspection has ever been recorded here');
  }
  const nbCount = (ctx.bundle.neighbors[assetId] ?? []).length;
  if (nbCount >= 8) {
    confidence += 0.07;
    positive.push('Dense local network gives meaningful spatial context');
  } else {
    negative.push('Sparse local network limits spatial comparison');
  }
  if (!recentNearby.length) negative.push('No recent nearby failures to corroborate');

  confidence = clamp(confidence, 0.05, 0.95);

  // --- horizon ------------------------------------------------------------
  // Deliberately coarse. A precise date would be a fiction, and stating one
  // is how a decision-support tool gets treated as a prediction it cannot make.
  const horizon =
    risk >= 78 ? '7-30 days' : risk >= 62 ? '30-90 days' : risk >= 45 ? '3-12 months' : null;

  factors.sort((a, b) => b.contribution - a.contribution);

  return {
    asset_id: assetId,
    as_of: asOfDate,
    risk: round(risk, 1),
    confidence: round(confidence, 2),
    trajectory,
    horizon,
    factors,
    convergence: { families: activeFamilies, bonus: round(convergenceBonus, 2) },
    confidence_reasons: { positive, negative },
    data_gaps: gaps,
  };
}

/** Score every asset as of a given day. */
export function scoreNetwork(ctx: RiskContext, asOf: number): RiskScore[] {
  const zs = zoneBaselines(ctx, asOf);
  return ctx.bundle.assets.map((a) => scoreAsset(ctx, a.asset_id, asOf, zs));
}
