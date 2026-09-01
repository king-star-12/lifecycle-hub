import { readJson } from '@/lib/data/store';

export const dynamic = 'force-static';

/** The whole network, pre-scored, ~490 KB. One request, then the map is local. */
export async function GET() {
  return Response.json(readJson('map.json'));
}
