/**
 * Walk-forward backtest.
 *
 * The question is not "can the engine describe a failure that already
 * happened". It is "standing at a date in the past, holding only what was
 * knowable then, would this have put the right pipe in front of an operator in
 * time to matter".
 *
 * So: step through history, score the network using strictly as-of data, and
 * ask what actually broke afterwards. Compare against the two prioritisation
 * methods utilities genuinely use today -- pipe age, and age plus break
 * history. Beating a strawman would prove nothing.
 *
 * Ground truth is opened here and only here.
 *
 * Run: npm run backtest
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkBundle, TelemetrySeries } from '../src/lib/types.ts';
import { buildContext, scoreNetwork } from '../src/lib/risk/engine.ts';

const DATA = join(import.meta.dirname, '..', 'data', 'synthetic');
const bundle: NetworkBundle = JSON.parse(readFileSync(join(DATA, 'network.json'), 'utf8'));
const telemetry: TelemetrySeries[] = JSON.parse(readFileSync(join(DATA, 'telemetry.json'), 'utf8'));

const ctx = buildContext(bundle, telemetry);
const dayIndex = ctx.dayIndex;
const assets = bundle.assets;

/** Prediction horizon: does this asset break in the next 90 days? */
const HORIZON = 90;
/** How many assets an operator can realistically act on per cycle. */
const TOP_K = [10, 25, 50];
const FIRST_EVAL = 300;
const STEP = 21;

const failuresByAsset = new Map<string, number[]>();
for (const f of bundle.failures) {
  const d = dayIndex.get(f.date);
  if (d === undefined) continue;
  const list = failuresByAsset.get(f.asset_id);
  if (list) list.push(d);
  else failuresByAsset.set(f.asset_id, [d]);
}

const evalDates: number[] = [];
for (let d = FIRST_EVAL; d <= bundle.meta.days - HORIZON - 1; d += STEP) evalDates.push(d);

console.log(
  `walk-forward: ${evalDates.length} evaluation dates, ${assets.length} assets, ${HORIZON}-day horizon\n`,
);

type Row = { model: string; score: number; assetId: string; label: 0 | 1 };
const allRows: Row[] = [];
const hits: Record<string, Record<number, { tp: number; fp: number; pos: number }>> = {};
const MODELS = ['age_only', 'age_plus_history', 'clustral'] as const;
for (const m of MODELS) {
  hits[m] = {};
  for (const k of TOP_K) hits[m][k] = { tp: 0, fp: 0, pos: 0 };
}

/**
 * asset -> earliest eval date at which Clustral crossed the actionable band.
 *
 * Deliberately NOT "first appeared in the top 50". A 1920s cast iron main sits
 * near the top of any ranked list permanently, so that measure reports the
 * start of the evaluation window rather than a warning, and inflates lead time
 * into the hundreds of days. What an operator needs to know is when an asset
 * *became* actionable -- when it crossed the risk band whose observed failure
 * rate justifies sending a crew.
 */
const ACTIONABLE = 65;
const firstFlag = new Map<string, number>();
const calibration: { risk: number; failed: number }[] = [];

const t0 = Date.now();
for (const T of evalDates) {
  const scores = scoreNetwork(ctx, T);
  const year = Number(bundle.weather[T].date.slice(0, 4));

  const labelled = scores.map((s) => {
    const a = ctx.assets.get(s.asset_id)!;
    const fails = failuresByAsset.get(s.asset_id) ?? [];
    const label: 0 | 1 = fails.some((d) => d > T && d <= T + HORIZON) ? 1 : 0;

    // Baseline A: age. What most utilities start from.
    const ageScore = year - a.install_year;

    // Baseline B: age plus break history, the standard next step.
    const prior = (ctx.ownFailures.get(s.asset_id) ?? []).filter((d) => d < T);
    const recency = prior.length ? Math.exp(-(T - Math.max(...prior)) / 730) : 0;
    const histScore = ageScore + 40 * prior.length + 30 * recency;

    return { assetId: s.asset_id, label, age: ageScore, hist: histScore, clustral: s.risk, conf: s.confidence };
  });

  const positives = labelled.filter((r) => r.label === 1).length;

  for (const [model, key] of [
    ['age_only', 'age'],
    ['age_plus_history', 'hist'],
    ['clustral', 'clustral'],
  ] as const) {
    const ranked = [...labelled].sort((a, b) => (b[key] as number) - (a[key] as number));
    for (const k of TOP_K) {
      const top = ranked.slice(0, k);
      const tp = top.filter((r) => r.label === 1).length;
      hits[model][k].tp += tp;
      hits[model][k].fp += k - tp;
      hits[model][k].pos += positives;
    }
    for (const r of labelled) {
      allRows.push({ model, score: r[key] as number, assetId: r.assetId, label: r.label });
    }
  }

  // Lead time and calibration, Clustral only.
  for (const r of labelled) {
    if (r.clustral >= ACTIONABLE && !firstFlag.has(r.assetId)) firstFlag.set(r.assetId, T);
  }
  for (const r of labelled) calibration.push({ risk: r.clustral, failed: r.label });
}
console.log(`scored in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// --- precision / recall ----------------------------------------------------
console.log('\x1b[1mDETECTION\x1b[0m  (does the top-k list contain pipes that break in the next 90 days)');
console.log('  model                 k    precision   recall');
for (const m of MODELS) {
  for (const k of TOP_K) {
    const h = hits[m][k];
    const prec = h.tp / (h.tp + h.fp);
    const rec = h.tp / Math.max(h.pos, 1);
    const name = m === 'clustral' ? '\x1b[1mclustral\x1b[0m        ' : m.padEnd(16);
    console.log(
      `  ${name}  ${String(k).padStart(4)}   ${(prec * 100).toFixed(1).padStart(7)}%  ${(rec * 100).toFixed(1).padStart(7)}%`,
    );
  }
}

// --- PR-AUC ----------------------------------------------------------------
function prAuc(rows: Row[]): number {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const total = sorted.filter((r) => r.label === 1).length;
  if (!total) return NaN;
  let tp = 0;
  let fp = 0;
  let prev = 0;
  let auc = 0;
  for (const r of sorted) {
    if (r.label === 1) tp++;
    else fp++;
    const recall = tp / total;
    const precision = tp / (tp + fp);
    if (recall > prev) {
      auc += (recall - prev) * precision;
      prev = recall;
    }
  }
  return auc;
}
console.log('\n\x1b[1mRANKING QUALITY\x1b[0m  (PR-AUC over every asset-date pair)');
const base = allRows.filter((r) => r.model === 'clustral');
const prevalence = base.filter((r) => r.label === 1).length / base.length;
for (const m of MODELS) {
  const auc = prAuc(allRows.filter((r) => r.model === m));
  const lift = auc / prevalence;
  console.log(
    `  ${(m === 'clustral' ? 'clustral' : m).padEnd(18)} PR-AUC ${auc.toFixed(4)}   ${lift.toFixed(1)}x random`,
  );
}
console.log(`  (random baseline = prevalence = ${(prevalence * 100).toFixed(3)}%)`);

// --- lead time -------------------------------------------------------------
const leads: number[] = [];
let flaggedBefore = 0;
let neverFlagged = 0;
for (const f of bundle.failures) {
  const d = dayIndex.get(f.date);
  if (d === undefined || d < FIRST_EVAL) continue;
  const first = firstFlag.get(f.asset_id);
  if (first !== undefined && first < d) {
    leads.push(d - first);
    flaggedBefore++;
  } else {
    neverFlagged++;
  }
}
leads.sort((a, b) => a - b);
const q = (p: number) => (leads.length ? leads[Math.floor(p * (leads.length - 1))] : NaN);
console.log(`\n\x1b[1mWARNING LEAD TIME\x1b[0m  (days between first crossing risk ${ACTIONABLE} and the break)`);
console.log(`  failures flagged in advance   ${flaggedBefore} of ${flaggedBefore + neverFlagged} (${((flaggedBefore / (flaggedBefore + neverFlagged)) * 100).toFixed(0)}%)`);
console.log(`  never flagged                 ${neverFlagged}   <- the honest misses`);
console.log(`  median lead time              ${q(0.5)} days`);
console.log(`  25th / 75th percentile        ${q(0.25)} / ${q(0.75)} days`);

// --- calibration -----------------------------------------------------------
console.log('\n\x1b[1mCALIBRATION\x1b[0m  (does a stated risk band mean what it says)');
const bands = [0, 20, 35, 50, 65, 80, 101];
console.log('  risk band     n        observed 90d failure rate');
for (let i = 0; i < bands.length - 1; i++) {
  const inBand = calibration.filter((c) => c.risk >= bands[i] && c.risk < bands[i + 1]);
  if (!inBand.length) continue;
  const rate = inBand.filter((c) => c.failed).length / inBand.length;
  const bar = '█'.repeat(Math.round(rate * 400));
  console.log(
    `  ${String(bands[i]).padStart(3)}-${String(bands[i + 1] - 1).padEnd(3)}  ${String(inBand.length).padStart(7)}   ${(rate * 100).toFixed(2).padStart(6)}%  ${bar}`,
  );
}

const summary = {
  generated_at: new Date().toISOString(),
  config: { horizon_days: HORIZON, eval_dates: evalDates.length, step_days: STEP, first_eval_day: FIRST_EVAL },
  detection: Object.fromEntries(
    MODELS.map((m) => [
      m,
      Object.fromEntries(
        TOP_K.map((k) => [
          k,
          {
            precision: hits[m][k].tp / (hits[m][k].tp + hits[m][k].fp),
            recall: hits[m][k].tp / Math.max(hits[m][k].pos, 1),
          },
        ]),
      ),
    ]),
  ),
  pr_auc: Object.fromEntries(MODELS.map((m) => [m, prAuc(allRows.filter((r) => r.model === m))])),
  prevalence,
  lead_time: {
    actionable_threshold: ACTIONABLE,
    flagged_in_advance: flaggedBefore,
    never_flagged: neverFlagged,
    median_days: q(0.5),
    p25_days: q(0.25),
    p75_days: q(0.75),
  },
  calibration: bands.slice(0, -1).map((lo, i) => {
    const inBand = calibration.filter((c) => c.risk >= lo && c.risk < bands[i + 1]);
    return {
      band: `${lo}-${bands[i + 1] - 1}`,
      n: inBand.length,
      observed_rate: inBand.length ? inBand.filter((c) => c.failed).length / inBand.length : null,
    };
  }),
};
writeFileSync(join(DATA, 'backtest.json'), JSON.stringify(summary, null, 2));
console.log('\nwrote data/synthetic/backtest.json');
