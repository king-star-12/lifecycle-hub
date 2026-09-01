import { getBundle, getContext, getTelemetry, latestDay, readJson } from '@/lib/data/store';
import { scoreAsset, zoneBaselines } from '@/lib/risk/engine';
import type { GeneratedDocument } from '@/lib/sim/documents';

/**
 * Everything an operator needs to interrogate one segment: the decomposed
 * score, the series behind it, the physical evidence, and the neighbourhood.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = getContext();
  const bundle = getBundle();
  const asset = ctx.assets.get(id);
  if (!asset) return Response.json({ error: 'unknown asset' }, { status: 404 });

  const asOf = latestDay();
  const score = scoreAsset(ctx, id, asOf, zoneBaselines(ctx, asOf));

  // One year of context, which is what the charts show.
  const WINDOW = 365;
  const from = Math.max(0, asOf - WINDOW + 1);
  const t = getTelemetry().find((x) => x.asset_id === id);
  const series = {
    dates: bundle.weather.slice(from, asOf + 1).map((w) => w.date),
    pressure_std: t?.pressure_std.slice(from, asOf + 1) ?? [],
    pressure_mean: t?.pressure_mean.slice(from, asOf + 1) ?? [],
    flow_mean: t?.flow_mean.slice(from, asOf + 1) ?? [],
    soil_moisture: bundle.weather.slice(from, asOf + 1).map((w) => w.soil_moisture),
    freeze_thaw: bundle.weather.slice(from, asOf + 1).map((w) => (w.freeze_thaw ? 1 : 0)),
    temp_min: bundle.weather.slice(from, asOf + 1).map((w) => w.temp_min_c),
  };

  const nearby = (ctx.nearbyFailures.get(id) ?? [])
    .map(([day, dist]) => ({ date: bundle.weather[day].date, distance_m: Math.round(dist), day }))
    .sort((a, b) => b.day - a.day)
    .slice(0, 12);

  const complaints = (ctx.nearbyComplaints.get(id) ?? [])
    .filter(([day]) => asOf - day <= 180)
    .map(([day, category]) => ({ date: bundle.weather[day].date, category }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Prefer findings recovered by the document pipeline over the simulator's
  // own record. Where a report has actually been run through Nutrient, the
  // product consumes what was *extracted* from the PDF -- the same position a
  // real deployment is in, reading a utility's archive rather than a database
  // it wishes existed. Provenance is reported either way.
  let nutrient: Record<string, unknown>[] = [];
  try {
    nutrient = readJson<Record<string, unknown>[]>('nutrient-findings.json');
  } catch {
    nutrient = [];
  }
  const extractedFor = new Map(
    nutrient.filter((f) => f.asset_id === id).map((f) => [f.document as string, f]),
  );
  const findings = (ctx.findings.get(id) ?? []).map(([, f]) => {
    const fromPdf = extractedFor.get(f.document);
    return fromPdf
      ? { ...f, ...fromPdf, evidence_source: 'nutrient_dws' as const }
      : { ...f, evidence_source: 'simulated_record' as const };
  });
  const docs = readJson<GeneratedDocument[]>('documents.json').filter((d) =>
    d.asset_ids.includes(id),
  );
  const ownFailures = bundle.failures.filter((f) => f.asset_id === id);
  const ownRepairs = bundle.repairs.filter((r) => r.asset_id === id);

  const neighborIds = bundle.neighbors[id] ?? [];

  return Response.json({
    asset,
    score,
    series,
    nearby_failures: nearby,
    complaints,
    findings,
    documents: docs,
    failures: ownFailures,
    repairs: ownRepairs,
    neighbor_count: neighborIds.length,
    zone: bundle.zones.find((z) => z.zone_id === asset.pressure_zone) ?? null,
    meta: bundle.meta,
  });
}
