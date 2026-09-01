import { getBundle } from '@/lib/data/store';

export async function GET() {
  const b = getBundle();
  return Response.json({
    ok: true,
    data_class: b.meta.data_class,
    assets: b.assets.length,
    as_of: b.meta.end_date,
  });
}
