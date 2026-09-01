import { getBundle, getContext, latestDay } from '@/lib/data/store';
import { scoreAsset, zoneBaselines } from '@/lib/risk/engine';

/**
 * Failure reconstruction: re-scores one asset at successive points in the past,
 * each time using only what was knowable on that day.
 *
 * This is the signature view. It is not a replay of a stored score -- every
 * frame is a fresh evaluation against a truncated history, which is why the
 * risk curve is allowed to be flat, jumpy, or wrong. Precomputing it would
 * make the reveal a slideshow rather than a demonstration.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const ctx = getContext();
  const bundle = getBundle();
  if (!ctx.assets.has(id)) return Response.json({ error: 'unknown asset' }, { status: 404 });

  // Anchor on the asset's break if it has one, otherwise on today.
  const failure = bundle.failures.find((f) => f.asset_id === id);
  const anchorParam = url.searchParams.get('anchor');
  const anchor = anchorParam
    ? (ctx.dayIndex.get(anchorParam) ?? latestDay())
    : failure
      ? (ctx.dayIndex.get(failure.date) ?? latestDay())
      : latestDay();

  const span = Math.min(Number(url.searchParams.get('span') ?? 180), 400);
  const step = Math.max(Number(url.searchParams.get('step') ?? 5), 1);
  const start = Math.max(300, anchor - span);

  const frames = [];
  for (let day = start; day <= anchor; day += step) {
    const score = scoreAsset(ctx, id, day, zoneBaselines(ctx, day));
    frames.push({
      day,
      date: bundle.weather[day].date,
      days_before: anchor - day,
      risk: score.risk,
      confidence: score.confidence,
      trajectory: score.trajectory,
      families: score.convergence.families,
      factors: score.factors.map((f) => ({
        key: f.key,
        label: f.label,
        family: f.family,
        contribution: f.contribution,
        detail: f.detail,
        provenance: f.provenance,
      })),
    });
  }

  return Response.json({
    asset_id: id,
    anchor_date: bundle.weather[anchor].date,
    failure: failure ?? null,
    frames,
  });
}
