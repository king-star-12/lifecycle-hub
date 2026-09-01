import { readJson } from '@/lib/data/store';

export const dynamic = 'force-static';

export async function GET() {
  return Response.json(readJson('backtest.json'));
}
