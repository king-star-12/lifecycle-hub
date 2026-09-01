import { getBundle, getContext, latestDay, readJson } from '@/lib/data/store';
import { scoreAsset, zoneBaselines } from '@/lib/risk/engine';
import { generateReport } from '@/lib/integrations/report';
import type { DocumentFinding } from '@/lib/types';

const ENGINE_VERSION = 'clustral-risk/0.1.0';

/** Streams the Pre-Failure Intelligence Report for one segment as a PDF. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = getContext();
  const bundle = getBundle();
  const asset = ctx.assets.get(id);
  if (!asset) return Response.json({ error: 'unknown asset' }, { status: 404 });

  const asOf = latestDay();
  const score = scoreAsset(ctx, id, asOf, zoneBaselines(ctx, asOf));

  let nutrient: Record<string, unknown>[] = [];
  try {
    nutrient = readJson<Record<string, unknown>[]>('nutrient-findings.json');
  } catch {
    nutrient = [];
  }
  const extracted = new Map(nutrient.filter((f) => f.asset_id === id).map((f) => [f.document as string, f]));
  const findings = (ctx.findings.get(id) ?? []).map(([, f]) => ({
    ...f,
    ...(extracted.get(f.document) ?? {}),
  })) as DocumentFinding[];

  const nearby = (ctx.nearbyFailures.get(id) ?? []).map(([day, dist]) => ({
    date: bundle.weather[day].date,
    distance_m: Math.round(dist),
  }));
  const complaints = (ctx.nearbyComplaints.get(id) ?? [])
    .filter(([day]) => asOf - day <= 180)
    .map(([day, category]) => ({ date: bundle.weather[day].date, category }));

  try {
    const { pdf, renderer } = await generateReport({
      asset,
      score,
      findings,
      failure: bundle.failures.find((f) => f.asset_id === id) ?? null,
      nearbyFailures: nearby,
      complaints,
      external: null,
      dataClass: bundle.meta.data_class,
      utility: bundle.meta.utility,
      engineVersion: ENGINE_VERSION,
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="clustral-report-${id}.pdf"`,
        'X-Clustral-Renderer': renderer.provider,
        'X-Clustral-Renderer-Reason': renderer.reason,
      },
    });
  } catch (err) {
    return Response.json(
      { error: 'report generation failed', message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
