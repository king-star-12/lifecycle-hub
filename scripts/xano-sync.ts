/**
 * Publishes the current assessment into Xano.
 *
 * What goes in is what an operator and an auditor need: the assets under
 * management, the scored snapshot with its full decomposition, the evidence
 * behind it, the resulting recommendations, and an append-only audit trail.
 * Telemetry does not go in -- that belongs in the analytics layer, and pushing
 * a million rows a day through the application backend would be the wrong
 * architecture wearing the right logo.
 *
 * Run: npm run xano:sync
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkBundle, TelemetrySeries } from '../src/lib/types.ts';
import { buildContext, scoreNetwork } from '../src/lib/risk/engine.ts';
import { insertMany, tableIds, truncate, xanoConfig } from '../src/lib/integrations/xano.ts';

const ENGINE_VERSION = 'clustral-risk/0.1.0';
const DATA = join(import.meta.dirname, '..', 'data', 'synthetic');

const cfg = xanoConfig();
if (!cfg) throw new Error('No Xano credentials. Run `xano auth` first.');

const bundle: NetworkBundle = JSON.parse(readFileSync(join(DATA, 'network.json'), 'utf8'));
const telemetry: TelemetrySeries[] = JSON.parse(readFileSync(join(DATA, 'telemetry.json'), 'utf8'));
let nutrient: Record<string, string | number | boolean>[] = [];
try {
  nutrient = JSON.parse(readFileSync(join(DATA, 'nutrient-findings.json'), 'utf8'));
} catch {
  nutrient = [];
}

const ctx = buildContext(bundle, telemetry);
const asOf = bundle.meta.days - 1;
const asOfDate = bundle.weather[asOf].date;
const scores = scoreNetwork(ctx, asOf);

// Publish the assets an operator would actually work on: everything elevated,
// plus everything with a recorded break. Pushing all 1,892 would be noise.
const failed = new Set(bundle.failures.map((f) => f.asset_id));
const selected = scores
  .filter((s) => s.risk >= 45 || failed.has(s.asset_id))
  .sort((a, b) => b.risk - a.risk)
  .slice(0, 120);

console.log(`syncing ${selected.length} assets as of ${asOfDate}\n`);
const ids = await tableIds(cfg);
const T = (name: string) => {
  const id = ids.get(name);
  if (id === undefined) throw new Error(`Table ${name} missing — run npm run xano:provision`);
  return id;
};

for (const name of ['assets', 'risk_snapshots', 'risk_factors', 'evidence', 'recommendations', 'audit_events', 'investigations']) {
  await truncate(cfg, T(name));
}
console.log('  cleared previous sync');

// --- assets -----------------------------------------------------------------
const assetRows = selected.map((s) => {
  const a = ctx.assets.get(s.asset_id)!;
  return {
    asset_id: a.asset_id, street: a.street, neighborhood: a.neighborhood,
    material: a.material, diameter_in: a.diameter_in, install_year: a.install_year,
    length_ft: a.length_ft, pressure_zone: a.pressure_zone, criticality: a.criticality,
    population_served: a.population_served, has_sensor: a.has_sensor,
    road_class: a.road_class, lat: a.centroid.lat, lng: a.centroid.lng,
  };
});
console.log(`  assets           ${await insertMany(cfg, T('assets'), assetRows, 10)} / ${assetRows.length}`);

// --- snapshots + decomposition ----------------------------------------------
const snapshotRows = selected.map((s) => ({
  asset_id: s.asset_id, as_of: s.as_of, risk: s.risk, confidence: s.confidence,
  trajectory: s.trajectory, horizon: s.horizon ?? '', evidence_families: s.convergence.families,
  convergence_bonus: s.convergence.bonus, engine_version: ENGINE_VERSION,
  data_class: bundle.meta.data_class,
}));
console.log(`  risk_snapshots   ${await insertMany(cfg, T('risk_snapshots'), snapshotRows, 10)} / ${snapshotRows.length}`);

const factorRows = selected.flatMap((s) =>
  s.factors.map((f) => ({
    asset_id: s.asset_id, factor_key: f.key, label: f.label, family: f.family,
    contribution: f.contribution, strength: f.strength, provenance: f.provenance,
    detail: f.detail,
  })),
);
console.log(`  risk_factors     ${await insertMany(cfg, T('risk_factors'), factorRows, 10)} / ${factorRows.length}`);

// --- evidence ---------------------------------------------------------------
const selectedIds = new Set(selected.map((s) => s.asset_id));
const evidenceRows = [
  ...nutrient
    .filter((f) => selectedIds.has(String(f.asset_id)))
    .map((f) => ({
      asset_id: String(f.asset_id), kind: 'inspection_finding', source: 'Nutrient DWS',
      source_ref: String(f.document), observed_at: String(f.date),
      retrieved_at: String(f.extracted_at ?? new Date().toISOString()),
      confidence: Number(f.confidence), summary: `${f.severity} ${f.finding}`.replace(/_/g, ' '),
      excerpt: String(f.excerpt ?? ''), provenance: 'observed', corroborated: true,
    })),
  ...bundle.failures
    .filter((f) => selectedIds.has(f.asset_id))
    .slice(0, 60)
    .map((f) => ({
      asset_id: f.asset_id, kind: 'recorded_failure', source: 'Work order system',
      source_ref: f.event_id, observed_at: f.date, retrieved_at: new Date().toISOString(),
      confidence: 1, summary: `${f.severity} break, ${f.water_lost_gal.toLocaleString()} gal lost`,
      excerpt: '', provenance: 'observed', corroborated: true,
    })),
];
console.log(`  evidence         ${await insertMany(cfg, T('evidence'), evidenceRows, 10)} / ${evidenceRows.length}`);

// --- recommendations --------------------------------------------------------
// Every recommendation is proposed, never applied. requires_approval is not a
// configuration flag: this system does not authorise excavation.
const recRows = selected
  .filter((s) => s.risk >= 55)
  .map((s) => ({
    asset_id: s.asset_id, action:
      s.risk >= 78 ? 'Targeted acoustic inspection'
      : s.risk >= 65 ? 'Field inspection and pressure logging'
      : 'Add to condition-assessment queue',
    priority: s.risk >= 78 ? 'high' : s.risk >= 65 ? 'medium' : 'routine',
    rationale: s.factors.slice(0, 3).map((f) => f.label).join('; '),
    horizon: s.horizon ?? '3-12 months', status: 'proposed', requires_approval: true,
    approved_by: '', approved_at: '', declined_reason: '',
  }));
console.log(`  recommendations  ${await insertMany(cfg, T('recommendations'), recRows, 10)} / ${recRows.length}`);

// --- audit ------------------------------------------------------------------
const now = new Date().toISOString();
const auditRows = [
  {
    actor: 'clustral-risk-engine', action: 'network_scored', entity: 'network',
    entity_id: bundle.meta.seed,
    detail: `Scored ${scores.length} segments as of ${asOfDate}; ${selected.length} published. Data class: ${bundle.meta.data_class}.`,
    engine_version: ENGINE_VERSION, occurred_at: now,
  },
  ...recRows.slice(0, 40).map((r) => ({
    actor: 'clustral-risk-engine', action: 'recommendation_proposed', entity: 'asset',
    entity_id: r.asset_id,
    detail: `${r.action} (${r.priority}). Awaiting human approval — no physical work is authorised by this system.`,
    engine_version: ENGINE_VERSION, occurred_at: now,
  })),
];
console.log(`  audit_events     ${await insertMany(cfg, T('audit_events'), auditRows, 10)} / ${auditRows.length}`);

console.log(`\npublished to Xano workspace ${cfg.workspace}.`);
