'use client';

import { useEffect, useMemo, useState } from 'react';
import NetworkMap from './NetworkMap';
import AssetPanel from './AssetPanel';
import type { MapFeature, MapPayload } from './types';
import { riskColor, riskLabel } from '@/lib/risk-color';

const MATERIALS = [
  ['cast_iron', 'Cast iron'],
  ['ductile_iron', 'Ductile iron'],
  ['asbestos_cement', 'Asbestos cement'],
  ['steel', 'Steel'],
  ['pvc', 'PVC'],
  ['hdpe', 'HDPE'],
] as const;

export default function Console() {
  const [data, setData] = useState<MapPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [minRisk, setMinRisk] = useState(0);
  const [material, setMaterial] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [sensorOnly, setSensorOnly] = useState(false);
  const [focus, setFocus] = useState<{ lng: number; lat: number; zoom: number } | null>(null);

  useEffect(() => {
    fetch('/api/map')
      .then((r) => r.json())
      .then((payload: MapPayload) => {
        setData(payload);
        // Deep link: ?asset=WM-1385 opens straight onto a segment. Demos and
        // shared links should land on the thing being discussed, not on a
        // map someone then has to search.
        const want = new URLSearchParams(window.location.search).get('asset');
        const hit = want ? payload.features.find((f) => f.id === want) : null;
        if (hit) {
          setSelected(hit.id);
          setFocus({
            lng: (hit.p[0][0] + hit.p[1][0]) / 2,
            lat: (hit.p[0][1] + hit.p[1][1]) / 2,
            zoom: 15.6,
          });
        }
      })
      .catch(() => setData(null));
  }, []);

  // Keep the URL in step with the selection, without adding history entries.
  //
  // Guarded on `data`: on mount the selection is still null while the network
  // is being fetched, and writing that back would strip the very ?asset=
  // parameter the fetch is about to read.
  useEffect(() => {
    if (!data) return;
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set('asset', selected);
    else url.searchParams.delete('asset');
    window.history.replaceState(null, '', url);
  }, [selected, data]);

  const filter = useMemo(
    () => ({ minRisk, material, zone, sensorOnly }),
    [minRisk, material, zone, sensorOnly],
  );

  const visible = useMemo(() => {
    if (!data) return [];
    return data.features.filter(
      (f) =>
        f.risk >= minRisk &&
        (!material || f.mt === material) &&
        (!zone || f.zn === zone) &&
        (!sensorOnly || f.sen === 1),
    );
  }, [data, minRisk, material, zone, sensorOnly]);

  const queue = useMemo(
    () => [...visible].sort((a, b) => b.risk - a.risk).slice(0, 40),
    [visible],
  );

  const focusOn = (f: MapFeature) => {
    setSelected(f.id);
    setFocus({
      lng: (f.p[0][0] + f.p[1][0]) / 2,
      lat: (f.p[0][1] + f.p[1][1]) / 2,
      zoom: 15.6,
    });
  };

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-9 w-9 rounded-full border-2 border-line border-t-accent animate-spin" />
          <p className="text-sm text-ink-dim">Loading network…</p>
        </div>
      </div>
    );
  }

  const elevated = data.features.filter((f) => f.risk >= 50).length;
  const high = data.features.filter((f) => f.risk >= 65).length;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* ---------------- header ---------------- */}
      <header className="flex shrink-0 items-center gap-5 border-b border-line bg-surface px-5 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold tracking-tight">Clustral</span>
          <span className="text-[11px] text-ink-faint">Water Main Failure Intelligence</span>
        </div>

        <span
          className="rounded border border-amber-500/35 bg-amber-500/10 px-2 py-[3px] text-[10px] font-medium tracking-wide text-amber-300"
          title="Every pipe, sensor reading, failure and inspection report in this system is simulated. Street and zone names are real Pittsburgh references so that live external-context search returns genuine municipal information."
        >
          SYNTHETIC DATA
        </span>

        <div className="ml-auto flex items-center gap-6 text-[11px] nums">
          <Stat label="segments" value={data.features.length.toLocaleString()} />
          <Stat label="elevated" value={String(elevated)} tone="#e07b39" />
          <Stat label="high" value={String(high)} tone="#d94f3d" />
          <Stat label="as of" value={data.meta.as_of} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------------- left rail ---------------- */}
        <aside className="flex w-[290px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="border-b border-line px-4 py-3">
            <Label>Risk threshold</Label>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={80}
                value={minRisk}
                onChange={(e) => setMinRisk(Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded bg-line accent-accent"
              />
              <span className="w-9 text-right text-xs nums text-ink-dim">{minRisk}</span>
            </div>

            <div className="mt-3 flex h-8 items-end gap-[3px]">
              {data.distribution.map((d) => {
                const maxN = Math.max(...data.distribution.map((x) => x.n));
                const lo = Number(d.band.split('-')[0]);
                return (
                  <div key={d.band} className="group relative flex-1" title={`${d.band}: ${d.n}`}>
                    <div
                      className="w-full rounded-sm transition-opacity"
                      style={{
                        height: Math.max(2, (d.n / maxN) * 32),
                        background: riskColor(lo),
                        opacity: lo >= minRisk ? 1 : 0.22,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-b border-line px-4 py-3">
            <Label>Material</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {MATERIALS.map(([key, name]) => (
                <Chip key={key} active={material === key} onClick={() => setMaterial(material === key ? null : key)}>
                  {name}
                </Chip>
              ))}
            </div>
            <div className="mt-3">
              <Label>Pressure zone</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {data.zones.map((z) => (
                  <Chip key={z.zone_id} active={zone === z.zone_id} onClick={() => setZone(zone === z.zone_id ? null : z.zone_id)}>
                    {z.name}
                  </Chip>
                ))}
              </div>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-ink-dim">
              <input
                type="checkbox"
                checked={sensorOnly}
                onChange={(e) => setSensorOnly(e.target.checked)}
                className="accent-accent"
              />
              Instrumented segments only
            </label>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label>Priority queue</Label>
              <span className="text-[10px] nums text-ink-faint">{visible.length} shown</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {queue.map((f) => (
                <button
                  key={f.id}
                  onClick={() => focusOn(f)}
                  className={`mb-1 w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
                    selected === f.id
                      ? 'border-accent/60 bg-accent/10'
                      : 'border-transparent hover:border-line-bright hover:bg-raised'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-6 w-[3px] shrink-0 rounded-full"
                      style={{ background: riskColor(f.risk) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] font-medium">{f.id}</span>
                        <span className="text-[12px] nums" style={{ color: riskColor(f.risk) }}>
                          {f.risk.toFixed(0)}
                        </span>
                      </div>
                      <div className="truncate text-[10px] text-ink-faint">
                        {f.st} · {f.nb} · {f.yr}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
              {!queue.length && (
                <p className="px-3 py-6 text-center text-[11px] text-ink-faint">
                  No segments match these filters.
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* ---------------- map ---------------- */}
        <main className="relative min-w-0 flex-1">
          <NetworkMap
            features={data.features}
            selectedId={selected}
            onSelect={setSelected}
            filter={filter}
            focus={focus}
          />

          <div className="pointer-events-none absolute bottom-6 left-3 z-10 rounded-lg border border-line bg-surface/92 px-3 py-2.5 backdrop-blur">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
              Failure risk
            </div>
            <div className="flex items-center gap-1">
              {[0, 20, 35, 50, 65, 80].map((v) => (
                <div key={v} className="flex flex-col items-center gap-1">
                  <div className="h-2 w-9 rounded-sm" style={{ background: riskColor(v) }} />
                  <span className="text-[9px] nums text-ink-faint">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-faint">
              <span className="inline-block h-2 w-2 rounded-full border border-[#ff6b5e]" />
              recorded break
            </div>
          </div>
        </main>

        {/* ---------------- right panel ---------------- */}
        {selected && <AssetPanel assetId={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</span>
      <span style={{ color: tone }} className={tone ? '' : 'text-ink'}>
        {value}
      </span>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
      {children}
    </span>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded border px-1.5 py-[3px] text-[10px] transition-colors ${
        active
          ? 'border-accent/60 bg-accent/15 text-accent'
          : 'border-line text-ink-dim hover:border-line-bright hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

export { riskLabel };
