'use client';

import { useEffect, useState } from 'react';
import Sparkline from './Sparkline';
import Reconstruction from './Reconstruction';
import type { AssetDetail } from './types';
import { FAMILY_LABEL, PROVENANCE_COLOR, riskColor, riskLabel } from '@/lib/risk-color';

const TRAJECTORY: Record<string, { label: string; arrow: string; tone: string }> = {
  rapidly_increasing: { label: 'Rising rapidly', arrow: '↑↑', tone: '#ff3b30' },
  increasing: { label: 'Rising', arrow: '↑', tone: '#e07b39' },
  stable: { label: 'Stable', arrow: '→', tone: '#97a3b4' },
  decreasing: { label: 'Falling', arrow: '↓', tone: '#5ac8a8' },
};

export default function AssetPanel({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [d, setD] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconstructing, setReconstructing] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setD(null);
    setOpenDoc(null);
    fetch(`/api/asset/${assetId}`)
      .then((r) => r.json())
      .then((json) => setD(json.error ? null : json))
      .finally(() => setLoading(false));
  }, [assetId]);

  if (loading || !d) {
    return (
      <aside className="w-[430px] shrink-0 border-l border-line bg-surface p-5">
        <div className="h-4 w-28 animate-pulse rounded bg-raised" />
        <div className="mt-4 h-24 animate-pulse rounded bg-raised" />
        <div className="mt-3 h-40 animate-pulse rounded bg-raised" />
      </aside>
    );
  }

  const { asset, score, series } = d;
  const traj = TRAJECTORY[score.trajectory] ?? TRAJECTORY.stable;
  const age = Number(score.as_of.slice(0, 4)) - asset.install_year;
  const broke = d.failures[0] ?? null;

  return (
    <aside className="flex w-[430px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      {/* header */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold">{asset.asset_id}</h2>
              {!asset.has_sensor && (
                <span className="rounded border border-line bg-raised px-1.5 py-[1px] text-[9px] text-ink-faint">
                  NO SENSOR
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-dim">
              {asset.street} · {asset.neighborhood}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition-colors hover:bg-raised hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="px-4 py-4">
        {/* score */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <svg width="76" height="76" viewBox="0 0 76 76">
              <circle cx="38" cy="38" r="32" fill="none" stroke="#1e2632" strokeWidth="6" />
              <circle
                cx="38"
                cy="38"
                r="32"
                fill="none"
                stroke={riskColor(score.risk)}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${(score.risk / 100) * 201} 201`}
                transform="rotate(-90 38 38)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[21px] font-semibold nums leading-none">
                {score.risk.toFixed(0)}
              </span>
              <span className="text-[8px] tracking-wider text-ink-faint">/ 100</span>
            </div>
          </div>

          <div className="flex-1 space-y-1.5">
            <div
              className="text-[11px] font-semibold tracking-wide"
              style={{ color: riskColor(score.risk) }}
            >
              {riskLabel(score.risk)}
            </div>
            <Row label="Trajectory">
              <span style={{ color: traj.tone }}>
                {traj.arrow} {traj.label}
              </span>
            </Row>
            <Row label="Confidence">
              <span className="nums">{(score.confidence * 100).toFixed(0)}%</span>
            </Row>
            {score.horizon && (
              <Row label="Horizon">
                <span className="nums">{score.horizon}</span>
              </Row>
            )}
          </div>
        </div>

        {/* convergence */}
        {score.convergence.families >= 3 && (
          <div className="mt-3 rounded-lg border border-accent/25 bg-accent/[0.07] px-3 py-2.5">
            <div className="text-[11px] leading-relaxed">
              <span className="font-medium text-accent">
                {score.convergence.families} independent evidence types agree.
              </span>{' '}
              <span className="text-ink-dim">
                No single signal here is decisive. The score reflects their convergence
                {score.convergence.bonus > 0 &&
                  ` (+${score.convergence.bonus.toFixed(0)} points)`}
                .
              </span>
            </div>
          </div>
        )}

        {broke && (
          <div className="mt-3 rounded-lg border border-[#ff3b30]/30 bg-[#ff3b30]/[0.08] px-3 py-2.5">
            <div className="text-[11px]">
              <span className="font-medium text-[#ff6b5e]">
                This segment failed on {broke.date}.
              </span>{' '}
              <span className="text-ink-dim">
                {broke.severity} break · {broke.water_lost_gal.toLocaleString()} gal lost ·{' '}
                {broke.customers_affected.toLocaleString()} customers affected.
              </span>
            </div>
            <button
              onClick={() => setReconstructing(true)}
              className="mt-2 w-full rounded-md bg-accent/90 px-3 py-1.5 text-[11px] font-medium text-ground transition-colors hover:bg-accent"
            >
              Reconstruct what the system knew before it broke →
            </button>
          </div>
        )}

        {/* attributes */}
        <Section title="Segment">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <Attr k="Material" v={asset.material.replace(/_/g, ' ')} />
            <Attr k="Installed" v={`${asset.install_year} (${age} yrs)`} />
            <Attr k="Diameter" v={`${asset.diameter_in}"`} />
            <Attr k="Length" v={`${asset.length_ft} ft`} />
            <Attr k="Zone" v={d.zone?.name ?? asset.pressure_zone} />
            <Attr k="Road class" v={asset.road_class} />
            <Attr k="Population" v={asset.population_served.toLocaleString()} />
            <Attr k="Criticality" v={asset.criticality.toFixed(2)} />
          </dl>
          {asset.critical_facilities.length > 0 && (
            <p className="mt-2 text-[10px] text-ink-dim">
              Serves {asset.critical_facilities.join(', ')}
            </p>
          )}
        </Section>

        {/* decomposition */}
        <Section title="Why this score">
          <div className="space-y-2">
            {score.factors.map((f) => (
              <div key={f.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium">{f.label}</span>
                  <span className="shrink-0 text-[11px] nums text-ink-dim">
                    +{f.contribution.toFixed(1)}
                  </span>
                </div>
                <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (f.contribution / 26) * 100)}%`,
                      background: PROVENANCE_COLOR[f.provenance] ?? '#4da3ff',
                    }}
                  />
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">{f.detail}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Tag color={PROVENANCE_COLOR[f.provenance]}>{f.provenance}</Tag>
                  <span className="text-[9px] text-ink-faint">{FAMILY_LABEL[f.family]}</span>
                </div>
              </div>
            ))}
            {!score.factors.length && (
              <p className="text-[11px] text-ink-faint">No elevated signals on this segment.</p>
            )}
          </div>
        </Section>

        {/* confidence */}
        <Section title={`Confidence · ${(score.confidence * 100).toFixed(0)}%`}>
          <ul className="space-y-1 text-[10px]">
            {score.confidence_reasons.positive.map((r) => (
              <li key={r} className="flex gap-1.5 text-ink-dim">
                <span className="text-[#5ac8a8]">✓</span>
                {r}
              </li>
            ))}
            {score.confidence_reasons.negative.map((r) => (
              <li key={r} className="flex gap-1.5 text-ink-dim">
                <span className="text-[#d9a441]">!</span>
                {r}
              </li>
            ))}
          </ul>
        </Section>

        {/* telemetry */}
        {asset.has_sensor ? (
          <Section title="Telemetry · 12 months">
            <Chart
              label="Pressure variability"
              unit="psi σ"
              values={series.pressure_std}
              color="#4da3ff"
            />
            <Chart label="Flow" unit="gpm" values={series.flow_mean} color="#b98bff" />
            <Chart
              label="Soil moisture"
              unit="0-1"
              values={series.soil_moisture}
              color="#5ac8a8"
            />
          </Section>
        ) : (
          <Section title="Telemetry">
            <p className="text-[11px] leading-relaxed text-ink-dim">
              No pressure or flow instrumentation covers this segment. Its score rests on asset
              history, spatial context, environment and documents — and its confidence is reduced
              accordingly.
            </p>
          </Section>
        )}

        {/* documents */}
        {d.findings.length > 0 && (
          <Section title="Inspection evidence">
            {d.findings.map((f) => {
              const doc = d.documents.find((x) => x.filename === f.document);
              return (
                <div key={f.finding_id} className="mb-2 rounded-md border border-line bg-raised p-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-medium capitalize">
                      {f.finding.replace(/_/g, ' ')}
                    </span>
                    <span
                      className="rounded px-1.5 py-[1px] text-[9px] uppercase"
                      style={{
                        background:
                          f.severity === 'severe'
                            ? '#ff3b3020'
                            : f.severity === 'moderate'
                              ? '#e07b3920'
                              : '#4da3ff18',
                        color:
                          f.severity === 'severe'
                            ? '#ff6b5e'
                            : f.severity === 'moderate'
                              ? '#e07b39'
                              : '#4da3ff',
                      }}
                    >
                      {f.severity}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] italic leading-relaxed text-ink-dim">
                    “{f.excerpt}”
                  </p>
                  <div className="mt-1.5 flex items-center justify-between text-[9px] text-ink-faint">
                    <span>
                      {f.document} · p.{f.page} · {f.date}
                    </span>
                    <span className="nums">
                      extraction {(f.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  {doc && (
                    <button
                      onClick={() => setOpenDoc(openDoc === doc.document_id ? null : doc.document_id)}
                      className="mt-1.5 text-[10px] text-accent hover:underline"
                    >
                      {openDoc === doc.document_id ? 'Hide source' : 'View source document'}
                    </button>
                  )}
                  {doc && openDoc === doc.document_id && (
                    <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-ground p-2 text-[9px] leading-relaxed text-ink-dim">
                      {doc.text}
                    </pre>
                  )}
                </div>
              );
            })}
          </Section>
        )}

        {/* spatial */}
        <Section title="Spatial context">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <Attr k="Neighbours ≤500 m" v={String(d.neighbor_count)} />
            <Attr k="Nearby breaks" v={String(d.nearby_failures.length)} />
            <Attr k="Complaints 180 d" v={String(d.complaints.length)} />
            <Attr k="Own repairs" v={String(d.repairs.length)} />
          </dl>
          {d.nearby_failures.length > 0 && (
            <div className="mt-2 space-y-1">
              {d.nearby_failures.slice(0, 5).map((n, i) => (
                <div key={i} className="flex justify-between text-[10px] text-ink-dim">
                  <span>{n.date}</span>
                  <span className="nums">{n.distance_m} m away</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {d.repairs.length > 0 && (
          <Section title="Repair history">
            {d.repairs.map((r) => (
              <div key={r.repair_id} className="mb-2 text-[10px]">
                <div className="flex justify-between">
                  <span className="font-medium capitalize">{r.type.replace(/_/g, ' ')}</span>
                  <span className="nums text-ink-faint">{r.date}</span>
                </div>
                <p className="mt-0.5 leading-relaxed text-ink-dim">{r.crew_notes}</p>
              </div>
            ))}
          </Section>
        )}

        {score.data_gaps.length > 0 && (
          <Section title="Known gaps">
            <ul className="space-y-1 text-[10px] text-ink-dim">
              {score.data_gaps.map((g) => (
                <li key={g} className="flex gap-1.5">
                  <span className="text-ink-faint">·</span>
                  {g}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <p className="mt-5 border-t border-line pt-3 text-[9px] leading-relaxed text-ink-faint">
          Decision support, not an autonomous control system. Every figure above derives from
          simulated telemetry and documents; no operational control is issued by this tool.
        </p>

        {!broke && (
          <button
            onClick={() => setReconstructing(true)}
            className="mt-3 w-full rounded-md border border-line bg-raised px-3 py-2 text-[11px] font-medium transition-colors hover:border-line-bright"
          >
            Replay how this score developed →
          </button>
        )}
      </div>

      {reconstructing && (
        <Reconstruction assetId={assetId} onClose={() => setReconstructing(false)} />
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-line pt-3.5">
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-faint">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-[11px]">
      <span className="text-ink-faint">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Attr({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-ink-faint">{k}</dt>
      <dd className="text-right capitalize">{v}</dd>
    </>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="rounded px-1 py-[1px] text-[9px] uppercase tracking-wide"
      style={{ background: `${color}18`, color }}
    >
      {children}
    </span>
  );
}

function Chart({
  label,
  unit,
  values,
  color,
}: {
  label: string;
  unit: string;
  values: number[];
  color: string;
}) {
  const last = values.filter(Number.isFinite).at(-1);
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] text-ink-dim">{label}</span>
        <span className="text-[10px] nums text-ink-faint">
          {last?.toFixed(2) ?? '—'} {unit}
        </span>
      </div>
      <Sparkline values={values} color={color} height={40} />
    </div>
  );
}
