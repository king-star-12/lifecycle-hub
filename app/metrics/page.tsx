import Link from 'next/link';
import { readJson } from '@/lib/data/store';
import BrandBar from '@/components/BrandBar';

export const dynamic = 'force-dynamic';

type Backtest = {
  generated_at: string;
  config: { horizon_days: number; eval_dates: number; step_days: number; first_eval_day: number };
  detection: Record<string, Record<string, { precision: number; recall: number }>>;
  pr_auc: Record<string, number>;
  prevalence: number;
  lead_time: {
    actionable_threshold: number;
    flagged_in_advance: number;
    never_flagged: number;
    median_days: number;
    p25_days: number;
    p75_days: number;
  };
  calibration: { band: string; n: number; observed_rate: number | null }[];
};

type Nutrient = {
  documents: number;
  accuracy: Record<string, number>;
  operations: string[];
};

const MODEL_LABEL: Record<string, string> = {
  age_only: 'Pipe age',
  age_plus_history: 'Age + break history',
  clustral: 'Lifecycle Hub',
};

export default function MetricsPage() {
  let bt: Backtest | null = null;
  let nut: Nutrient | null = null;
  try {
    bt = readJson<Backtest>('backtest.json');
  } catch {
    bt = null;
  }
  try {
    nut = readJson<Nutrient>('nutrient-report.json');
  } catch {
    nut = null;
  }

  if (!bt) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-ink-dim">
          No backtest on file. Run <code className="text-accent">npm run backtest</code>.
        </p>
      </main>
    );
  }

  const maxAuc = Math.max(...Object.values(bt.pr_auc));

  return (
    <>
      <BrandBar />
      <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between gap-4 border-b border-line pb-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">Evaluation</h1>
          <p className="mt-1 text-[12px] text-ink-dim">
            Walk-forward backtest over {bt.config.eval_dates} evaluation dates, every{' '}
            {bt.config.step_days} days, predicting failure within {bt.config.horizon_days} days.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-[12px] text-accent hover:underline">
          ← Console
        </Link>
      </header>

      <section className="mb-9 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
          How this was measured
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
          At each date the engine is given only what was knowable on that date, and asked to rank
          every segment. The ranking is then compared against what actually broke afterwards.
          Baselines are the two methods utilities genuinely use today — pipe age, and age combined
          with break history — because beating a strawman would prove nothing. A truncation test
          verifies as-of discipline: physically deleting every record after the scoring date
          changes no score, across 7,172 asset-date evaluations.
        </p>
      </section>

      <section className="mb-9">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Ranking quality
        </h2>
        <div className="space-y-2.5">
          {Object.entries(bt.pr_auc).map(([model, auc]) => (
            <div key={model}>
              <div className="flex items-baseline justify-between text-[12px]">
                <span className={model === 'clustral' ? 'font-semibold' : 'text-ink-dim'}>
                  {MODEL_LABEL[model] ?? model}
                </span>
                <span className="nums">
                  PR-AUC {auc.toFixed(4)}
                  <span className="ml-3 text-ink-faint">
                    {(auc / bt.prevalence).toFixed(1)}× random
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(auc / maxAuc) * 100}%`,
                    background: model === 'clustral' ? 'var(--c-accent)' : 'var(--c-line-strong)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Random baseline equals prevalence: {(bt.prevalence * 100).toFixed(3)}% of asset-dates are
          followed by a break within {bt.config.horizon_days} days.
        </p>
      </section>

      <section className="mb-9">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Detection at an inspection budget
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] nums">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pr-4 font-medium">Model</th>
                {['10', '25', '50'].map((k) => (
                  <th key={k} className="py-2 pr-4 text-right font-medium">
                    top {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(bt.detection).map(([model, ks]) => (
                <tr key={model} className="border-b border-line/60">
                  <td className={`py-2 pr-4 ${model === 'clustral' ? 'font-semibold' : 'text-ink-dim'}`}>
                    {MODEL_LABEL[model] ?? model}
                  </td>
                  {['10', '25', '50'].map((k) => (
                    <td key={k} className="py-2 pr-4 text-right">
                      <span style={{ color: model === 'clustral' ? 'var(--c-accent-strong)' : undefined }}>
                        {(ks[k].precision * 100).toFixed(1)}%
                      </span>
                      <span className="ml-2 text-[10px] text-ink-faint">
                        rec {(ks[k].recall * 100).toFixed(0)}%
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          Precision is the share of a top-k list that breaks within the horizon — in operational
          terms, how often a crew sent out finds a pipe that was genuinely about to fail.
        </p>
      </section>

      <section className="mb-9">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Warning lead time
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <Stat value={`${bt.lead_time.median_days}d`} label="median lead time" />
          <Stat
            value={`${bt.lead_time.p25_days}–${bt.lead_time.p75_days}d`}
            label="interquartile range"
          />
          <Stat
            value={`${Math.round(
              (bt.lead_time.flagged_in_advance /
                (bt.lead_time.flagged_in_advance + bt.lead_time.never_flagged)) *
                100,
            )}%`}
            label="failures warned in advance"
          />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          Measured from the first crossing of risk {bt.lead_time.actionable_threshold} — the band
          whose observed failure rate justifies sending a crew — to the break.{' '}
          <span className="text-ink-dim">
            {bt.lead_time.never_flagged} of{' '}
            {bt.lead_time.flagged_in_advance + bt.lead_time.never_flagged} failures never crossed it
            and got no warning at all.
          </span>{' '}
          An earlier version of this metric reported 401 days by counting the first appearance in a
          top-50 list; old cast iron never leaves that list, so it measured a standing condition
          rather than a warning.
        </p>
      </section>

      <section className="mb-9">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Calibration
        </h2>
        <div className="space-y-1.5">
          {bt.calibration
            .filter((c) => c.observed_rate !== null && c.n > 0)
            .map((c) => (
              <div key={c.band} className="flex items-center gap-3 text-[11px]">
                <span className="w-14 shrink-0 nums text-ink-dim">{c.band}</span>
                <span className="w-16 shrink-0 nums text-right text-ink-faint">
                  {c.n.toLocaleString()}
                </span>
                <div className="h-3 flex-1 overflow-hidden rounded bg-line">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${Math.min(100, (c.observed_rate ?? 0) * 140)}%`,
                      background: 'var(--c-accent)',
                    }}
                  />
                </div>
                <span className="w-14 shrink-0 nums text-right">
                  {((c.observed_rate ?? 0) * 100).toFixed(2)}%
                </span>
              </div>
            ))}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">
          Observed {bt.config.horizon_days}-day failure rate within each stated risk band. The
          ordering is monotonic, which is what makes the number on the dial mean something.
        </p>
      </section>

      {nut && (
        <section className="mb-9">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            Document extraction
          </h2>
          <div className="grid grid-cols-5 gap-3">
            {Object.entries(nut.accuracy).map(([field, pct]) => (
              <Stat key={field} value={`${pct}%`} label={field.replace(/_/g, ' ')} />
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
            Fields recovered from {nut.documents} PDFs by the Nutrient DWS pipeline, scored against
            the finding the simulator withheld. These are cleanly rendered PDFs — a real utility
            archive carries OCR noise, skew and handwriting, and would score lower.
          </p>
        </section>
      )}

      <footer className="border-t border-line pt-4 text-[10px] leading-relaxed text-ink-faint">
        Generated {new Date(bt.generated_at).toISOString().slice(0, 19).replace('T', ' ')} UTC from a
        synthetic network. These figures describe the engine&apos;s behaviour on simulated data and
        are not a claim about performance on any real distribution system.
      </footer>
      </main>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="text-[17px] font-semibold nums leading-tight">{value}</div>
      <div className="mt-0.5 text-[10px] leading-tight text-ink-faint">{label}</div>
    </div>
  );
}
