'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FAMILY_LABEL, PROVENANCE_COLOR, riskColor } from '@/lib/risk-color';

type Frame = {
  day: number;
  date: string;
  days_before: number;
  risk: number;
  confidence: number;
  trajectory: string;
  families: number;
  factors: {
    key: string;
    label: string;
    family: string;
    contribution: number;
    detail: string;
    provenance: string;
  }[];
};

type Payload = {
  asset_id: string;
  anchor_date: string;
  failure: { date: string; severity: string; archetype: string; water_lost_gal: number; customers_affected: number } | null;
  frames: Frame[];
};

/**
 * Failure reconstruction.
 *
 * Each frame was scored independently against a history truncated at that day,
 * so what the operator watches is not a stored curve being replayed -- it is
 * the engine's actual answer at each point in the past. Where the line is flat
 * for weeks, the engine genuinely had nothing. That honesty is the argument.
 */
export default function Reconstruction({
  assetId,
  onClose,
}: {
  assetId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`/api/asset/${assetId}/reconstruct?span=200&step=4`)
      .then((r) => r.json())
      .then((p: Payload) => {
        setData(p);
        setI(0);
        setPlaying(true);
      });
  }, [assetId]);

  useEffect(() => {
    if (!playing || !data) return;
    timer.current = setInterval(() => {
      setI((prev) => {
        if (prev >= data.frames.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 150);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, data]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const frame = data?.frames[i];

  // Factors that have *appeared* by this point, in the order they first showed
  // up. The sequence is the story: which signal spoke first.
  const emergence = useMemo(() => {
    if (!data) return [];
    const first = new Map<string, { label: string; at: number; family: string; detail: string; provenance: string }>();
    for (let k = 0; k <= i; k++) {
      for (const f of data.frames[k].factors) {
        if (f.contribution < 1.2) continue;
        if (!first.has(f.key)) {
          first.set(f.key, {
            label: f.label,
            at: data.frames[k].days_before,
            family: f.family,
            detail: f.detail,
            provenance: f.provenance,
          });
        } else {
          first.get(f.key)!.detail = f.detail;
        }
      }
    }
    return [...first.entries()].sort((a, b) => b[1].at - a[1].at);
  }, [data, i]);

  if (!data || !frame) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur">
        <div className="text-center">
          <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-line border-t-accent" />
          <p className="text-sm text-ink-dim">Re-scoring history, day by day…</p>
          <p className="mt-1 text-[11px] text-ink-faint">
            Each frame is evaluated against a truncated dataset
          </p>
        </div>
      </div>
    );
  }

  const W = 900;
  const H = 240;
  const pad = 34;
  const maxRisk = Math.max(60, ...data.frames.map((f) => f.risk));
  const pt = (f: Frame, idx: number) => {
    const x = (idx / (data.frames.length - 1)) * (W - pad * 2) + pad;
    const y = H - pad - (f.risk / maxRisk) * (H - pad * 2);
    return [x, y] as const;
  };
  const path = data.frames
    .slice(0, i + 1)
    .map((f, idx) => {
      const [x, y] = pt(f, idx);
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const [cx, cy] = pt(frame, i);
  const atEnd = i >= data.frames.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ground/96 backdrop-blur-sm">
      <header className="flex items-center gap-4 border-b border-line px-6 py-3">
        <div>
          <h2 className="text-[15px] font-semibold">
            What was the system trying to tell us?
          </h2>
          <p className="text-[11px] text-ink-dim">
            {assetId} · re-scored at each date using only data available on that date
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => {
              if (atEnd) setI(0);
              setPlaying(!playing);
            }}
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-[11px] font-medium transition-colors hover:border-line-bright"
          >
            {playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
          </button>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-ink-faint transition-colors hover:bg-raised hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* chart */}
        <div className="flex min-w-0 flex-1 flex-col p-6">
          <div className="flex items-baseline gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">Risk</div>
              <div
                className="text-[38px] font-semibold leading-none nums"
                style={{ color: riskColor(frame.risk) }}
              >
                {frame.risk.toFixed(0)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">Date</div>
              <div className="text-[17px] nums">{frame.date}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">
                {data.failure ? 'Days before failure' : 'Days ago'}
              </div>
              <div className="text-[17px] nums">{frame.days_before}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">Confidence</div>
              <div className="text-[17px] nums">{(frame.confidence * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint">
                Evidence types
              </div>
              <div className="text-[17px] nums">{frame.families}</div>
            </div>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="mt-5 w-full" style={{ maxHeight: 260 }}>
            <defs>
              <linearGradient id="rc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={riskColor(frame.risk)} stopOpacity="0.3" />
                <stop offset="100%" stopColor={riskColor(frame.risk)} stopOpacity="0" />
              </linearGradient>
            </defs>

            {[0, 20, 35, 50, 65, 80].filter((v) => v <= maxRisk).map((v) => {
              const y = H - pad - (v / maxRisk) * (H - pad * 2);
              return (
                <g key={v}>
                  <line x1={pad} x2={W - pad} y1={y} y2={y} stroke="#1e2632" strokeWidth="1" />
                  <text x={8} y={y + 3} fill="#5d6b7d" fontSize="9" className="nums">
                    {v}
                  </text>
                </g>
              );
            })}

            {/* actionable band */}
            <line
              x1={pad}
              x2={W - pad}
              y1={H - pad - (65 / maxRisk) * (H - pad * 2)}
              y2={H - pad - (65 / maxRisk) * (H - pad * 2)}
              stroke="#d94f3d"
              strokeWidth="1"
              strokeDasharray="4 3"
              opacity="0.65"
            />
            <text
              x={W - pad}
              y={H - pad - (65 / maxRisk) * (H - pad * 2) - 5}
              fill="#d94f3d"
              fontSize="9"
              textAnchor="end"
            >
              actionable threshold
            </text>

            {path && (
              <>
                <path d={`${path} L${cx},${H - pad} L${pad},${H - pad} Z`} fill="url(#rc-fill)" />
                <path
                  d={path}
                  fill="none"
                  stroke={riskColor(frame.risk)}
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </>
            )}

            <circle cx={cx} cy={cy} r="5" fill={riskColor(frame.risk)} />
            <circle
              cx={cx}
              cy={cy}
              r="5"
              fill="none"
              stroke={riskColor(frame.risk)}
              strokeWidth="2"
              className="pulse-ring"
              style={{ transformOrigin: `${cx}px ${cy}px` }}
            />

            {data.failure && atEnd && (
              <g>
                <line
                  x1={W - pad}
                  x2={W - pad}
                  y1={pad - 12}
                  y2={H - pad}
                  stroke="#ff3b30"
                  strokeWidth="1.5"
                />
                <text x={W - pad - 6} y={pad - 16} fill="#ff3b30" fontSize="10" textAnchor="end">
                  FAILURE
                </text>
              </g>
            )}
          </svg>

          <input
            type="range"
            min={0}
            max={data.frames.length - 1}
            value={i}
            onChange={(e) => {
              setPlaying(false);
              setI(Number(e.target.value));
            }}
            className="mt-3 h-1 w-full cursor-pointer appearance-none rounded bg-line accent-accent"
          />

          {atEnd && data.failure && (
            <div className="fade-up mt-5 rounded-lg border border-line bg-surface px-4 py-3">
              <p className="text-[12px] leading-relaxed text-ink-dim">
                <span className="font-medium text-ink">
                  The break was not preceded by one decisive signal.
                </span>{' '}
                {emergence.length} independent signals appeared over the {data.frames[0].days_before}{' '}
                days before failure, the earliest{' '}
                <span className="text-ink">{emergence[0]?.[1].at}</span> days out. The score crossed
                the actionable threshold{' '}
                <span className="text-ink">
                  {data.frames.find((f) => f.risk >= 65)?.days_before ?? '—'}
                </span>{' '}
                days before the pipe failed.
              </p>
            </div>
          )}
        </div>

        {/* emergence log */}
        <aside className="w-[380px] shrink-0 overflow-y-auto border-l border-line bg-surface p-5">
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
            Signals, in the order they appeared
          </h3>
          <div className="mt-3 space-y-2.5">
            {emergence.map(([key, e]) => (
              <div key={key} className="fade-up relative border-l border-line pl-3">
                <span
                  className="absolute -left-[3px] top-1.5 h-[5px] w-[5px] rounded-full"
                  style={{ background: PROVENANCE_COLOR[e.provenance] ?? '#4da3ff' }}
                />
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium">{e.label}</span>
                  <span className="shrink-0 text-[10px] nums text-ink-faint">
                    T−{e.at}d
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] leading-relaxed text-ink-dim">{e.detail}</p>
                <span className="text-[9px] text-ink-faint">{FAMILY_LABEL[e.family]}</span>
              </div>
            ))}
            {!emergence.length && (
              <p className="text-[11px] leading-relaxed text-ink-faint">
                Nothing yet. At this point in history the engine had no elevated signal on this
                segment — which is itself the honest answer.
              </p>
            )}
          </div>

          {data.failure && (
            <div className="mt-5 rounded-lg border border-line bg-raised p-3">
              <h4 className="text-[10px] uppercase tracking-wider text-ink-faint">Outcome</h4>
              <p className="mt-1.5 text-[11px] leading-relaxed">
                Failed <span className="nums">{data.failure.date}</span> ·{' '}
                {data.failure.severity} break
              </p>
              <p className="mt-1 text-[10px] text-ink-dim">
                {data.failure.water_lost_gal.toLocaleString()} gal lost ·{' '}
                {data.failure.customers_affected.toLocaleString()} customers affected
              </p>
              <p className="mt-2 text-[9px] leading-relaxed text-ink-faint">
                Mechanism (simulator ground truth, withheld from the engine):{' '}
                {data.failure.archetype.replace(/_/g, ' ')}
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
