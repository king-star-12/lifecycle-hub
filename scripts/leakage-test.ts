/**
 * Leakage test.
 *
 * The backtest's entire value rests on one claim: scoring at time T uses only
 * data available at time T. Leakage is invisible in the output -- it simply
 * makes the model look better than it is -- so the claim has to be proved
 * rather than asserted.
 *
 * Method: score assets against the full dataset, then score them again against
 * a dataset physically truncated at T (every later day, failure, repair,
 * complaint and finding removed). If a single feature peeks, the two scores
 * diverge.
 *
 * Run: npm run test:leakage
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkBundle, TelemetrySeries } from '../src/lib/types.ts';
import { buildContext, scoreNetwork } from '../src/lib/risk/engine.ts';
import { createRng } from '../src/lib/sim/rng.ts';

const DATA = join(import.meta.dirname, '..', 'data', 'synthetic');
const full: NetworkBundle = JSON.parse(readFileSync(join(DATA, 'network.json'), 'utf8'));
const telemetry: TelemetrySeries[] = JSON.parse(readFileSync(join(DATA, 'telemetry.json'), 'utf8'));

const CUTS = [420, 700, 1000, 1290];
let mismatches = 0;
let compared = 0;

for (const T of CUTS) {
  const cutoff = full.weather[T].date;

  // Full dataset, scored as-of T.
  const ctxFull = buildContext(full, telemetry);
  const scoresFull = new Map(scoreNetwork(ctxFull, T).map((s) => [s.asset_id, s]));

  // Truncated dataset: the future does not exist at all.
  const truncated: NetworkBundle = {
    ...full,
    weather: full.weather.slice(0, T + 1),
    failures: full.failures.filter((f) => f.date <= cutoff),
    repairs: full.repairs.filter((r) => r.date <= cutoff),
    complaints: full.complaints.filter((c) => c.date <= cutoff),
    findings: full.findings.filter((f) => f.date <= cutoff),
  };
  const telTrunc: TelemetrySeries[] = telemetry.map((t) => ({
    ...t,
    days: Math.min(t.days, T + 1),
    pressure_mean: t.pressure_mean.slice(0, T + 1),
    pressure_std: t.pressure_std.slice(0, T + 1),
    flow_mean: t.flow_mean.slice(0, T + 1),
    transients: t.transients.slice(0, T + 1),
  }));
  const ctxTrunc = buildContext(truncated, telTrunc);
  const scoresTrunc = scoreNetwork(ctxTrunc, T);

  let worst = 0;
  let worstAsset = '';
  for (const s of scoresTrunc) {
    const f = scoresFull.get(s.asset_id);
    if (!f) continue;
    compared++;
    const delta = Math.abs(f.risk - s.risk) + Math.abs(f.confidence - s.confidence) * 100;
    if (delta > 1e-9) {
      mismatches++;
      if (delta > worst) {
        worst = delta;
        worstAsset = s.asset_id;
      }
    }
  }
  const ok = worst === 0;
  console.log(
    `  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  cutoff day ${String(T).padStart(4)} (${cutoff})  ` +
      `max divergence ${worst.toExponential(2)}${worstAsset ? ` on ${worstAsset}` : ''}`,
  );
}

// Also confirm the engine never imports ground truth.
const engineSrc = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'risk', 'engine.ts'), 'utf8');
const touchesGroundTruth = /ground-truth|_ground|latent/i.test(engineSrc);
console.log(
  `  ${touchesGroundTruth ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32mPASS\x1b[0m'}  risk engine contains no reference to latent state or ground truth`,
);

const rng = createRng('leakage');
void rng;

console.log(
  mismatches === 0 && !touchesGroundTruth
    ? `\n\x1b[32m✓ no leakage across ${compared.toLocaleString()} asset-date scorings\x1b[0m\n`
    : `\n\x1b[31m✗ ${mismatches} divergent scorings\x1b[0m\n`,
);
process.exit(mismatches === 0 && !touchesGroundTruth ? 0 : 1);
