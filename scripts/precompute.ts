/**
 * Precomputes the map payload: every asset's geometry, static attributes and
 * current risk, small enough to ship to the browser in one request.
 *
 * Run: npm run precompute  (after npm run generate)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkBundle, TelemetrySeries } from '../src/lib/types.ts';
import { buildContext, scoreNetwork } from '../src/lib/risk/engine.ts';
import { round } from '../src/lib/sim/rng.ts';

const DATA = join(import.meta.dirname, '..', 'data', 'synthetic');
const bundle: NetworkBundle = JSON.parse(readFileSync(join(DATA, 'network.json'), 'utf8'));
const telemetry: TelemetrySeries[] = JSON.parse(readFileSync(join(DATA, 'telemetry.json'), 'utf8'));

const ctx = buildContext(bundle, telemetry);
const asOf = bundle.meta.days - 1;
console.log(`scoring ${bundle.assets.length} assets as of ${bundle.weather[asOf].date}...`);

const t0 = Date.now();
const scores = scoreNetwork(ctx, asOf);
const byId = new Map(scores.map((s) => [s.asset_id, s]));
console.log(`scored in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const failedIds = new Map<string, string>();
for (const f of bundle.failures) failedIds.set(f.asset_id, f.date);

const features = bundle.assets.map((a) => {
  const s = byId.get(a.asset_id)!;
  return {
    id: a.asset_id,
    // [lng, lat] pairs, GeoJSON order.
    p: [
      [round(a.geometry[0].lng, 5), round(a.geometry[0].lat, 5)],
      [round(a.geometry[1].lng, 5), round(a.geometry[1].lat, 5)],
    ],
    st: a.street,
    nb: a.neighborhood,
    mt: a.material,
    dia: a.diameter_in,
    yr: a.install_year,
    zn: a.pressure_zone,
    sen: a.has_sensor ? 1 : 0,
    cr: a.criticality,
    pop: a.population_served,
    risk: s.risk,
    conf: s.confidence,
    traj: s.trajectory,
    hz: s.horizon,
    fam: s.convergence.families,
    top: s.factors[0]?.label ?? null,
    brk: failedIds.get(a.asset_id) ?? null,
  };
});

const dist = [0, 20, 35, 50, 65, 80].map((lo, i, arr) => {
  const hi = arr[i + 1] ?? 101;
  return { band: `${lo}-${hi - 1}`, n: features.filter((f) => f.risk >= lo && f.risk < hi).length };
});

writeFileSync(
  join(DATA, 'map.json'),
  JSON.stringify({
    meta: { ...bundle.meta, as_of: bundle.weather[asOf].date },
    zones: bundle.zones,
    distribution: dist,
    features,
  }),
);

const kb = (readFileSync(join(DATA, 'map.json')).length / 1024).toFixed(0);
console.log(`wrote map.json (${kb} KB)`);
console.log('risk distribution:', dist.map((d) => `${d.band}:${d.n}`).join('  '));
const top = [...scores].sort((a, b) => b.risk - a.risk).slice(0, 8);
console.log('\nhighest risk today:');
for (const s of top) {
  const a = ctx.assets.get(s.asset_id)!;
  console.log(
    `  ${s.asset_id.padEnd(8)} risk ${String(s.risk).padStart(5)}  conf ${s.confidence.toFixed(2)}  ${s.convergence.families} families  ${a.install_year} ${a.material.padEnd(16)} ${a.street}, ${a.neighborhood}`,
  );
}
