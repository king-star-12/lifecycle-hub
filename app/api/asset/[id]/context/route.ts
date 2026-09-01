import { getContext, getBundle } from '@/lib/data/store';
import { fetchExternalContext } from '@/lib/integrations/external-context';

/**
 * Live external context for one asset. Called on demand from the investigation
 * panel rather than during scoring: it costs quota and latency, and it is only
 * worth spending on an asset an operator is actually looking at.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = getContext();
  const asset = ctx.assets.get(id);
  if (!asset) return Response.json({ error: 'unknown asset' }, { status: 404 });

  try {
    const result = await fetchExternalContext({
      asset_id: id,
      street: asset.street,
      neighborhood: asset.neighborhood,
      city: getBundle().meta.city,
      material: asset.material,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: 'retrieval failed', message: err instanceof Error ? err.message : String(err), items: [] },
      { status: 502 },
    );
  }
}
