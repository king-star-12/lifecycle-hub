// Server-side only. Imported by route handlers and by CLI scripts, so it cannot
// carry the `server-only` guard -- that package throws outside Next's bundler.
// Secrets here are read from process.env and are never NEXT_PUBLIC_, so nothing
// in this file can reach the browser bundle.
import { cached } from './cache.ts';
import { key } from './env.ts';

/**
 * Live external context (SerpApi) and durable research retrieval (Querit).
 *
 * The two are deliberately separated, because they answer different questions
 * and carry different weight:
 *
 *   SerpApi  -> what is happening around this street *now*: construction
 *               permits, municipal notices, reported breaks, road work.
 *   Querit   -> what is known about this *failure mechanism* in general:
 *               engineering guidance, utility practice, published studies.
 *
 * Neither is ever treated as sensor truth. Web evidence can be wrong, stale,
 * or about a different street with the same name, so it is capped at a small
 * share of the score, always labelled with its source and retrieval time, and
 * never allowed to be the sole reason an asset is elevated.
 */

export type ExternalItem = {
  title: string;
  url: string;
  snippet: string;
  source: 'serpapi' | 'querit';
  published?: string | null;
  /** Which query produced it, so a reader can judge the association. */
  query: string;
  /** Keyword signal this item matched. */
  signal: 'break' | 'construction' | 'utility_work' | 'advisory' | 'general';
};

export type ExternalContext = {
  items: ExternalItem[];
  queries: string[];
  retrieved_at: string;
  live: boolean;
  configured: boolean;
  /** 0-1 strength handed to the risk engine. Small by design. */
  strength: number;
  detail: string;
  note: string;
  boundary: string;
};

const SIGNAL_PATTERNS: [ExternalItem['signal'], RegExp][] = [
  ['break', /\b(water main break|main break|burst|ruptur|water line break)\b/i],
  ['construction', /\b(construction|excavat|road work|roadwork|paving|street work|repaving)\b/i],
  ['utility_work', /\b(utility work|gas line|sewer|replacement program|infrastructure project|water main|lane restriction|restricted to one lane)\b/i],
  ['advisory', /\b(boil water|advisory|service disruption|outage|water pressure)\b/i],
];

function classify(text: string): ExternalItem['signal'] {
  for (const [signal, re] of SIGNAL_PATTERNS) if (re.test(text)) return signal;
  return 'general';
}

async function serpapi(query: string): Promise<ExternalItem[]> {
  const apiKey = key('SERPAPI_API_KEY');
  if (!apiKey) return [];
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('q', query);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('num', '10');
  url.searchParams.set('api_key', apiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`SerpApi ${res.status}`);
  const json = (await res.json()) as {
    organic_results?: { title?: string; link?: string; snippet?: string; date?: string }[];
  };
  return (json.organic_results ?? []).slice(0, 6).map((r) => ({
    title: r.title ?? '',
    url: r.link ?? '',
    snippet: r.snippet ?? '',
    source: 'serpapi' as const,
    published: r.date ?? null,
    query,
    signal: classify(`${r.title ?? ''} ${r.snippet ?? ''}`),
  }));
}

async function querit(query: string): Promise<ExternalItem[]> {
  const apiKey = key('QUERIT_API_KEY');
  if (!apiKey) return [];
  const res = await fetch('https://api.querit.ai/v1/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, max_results: 6 }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Querit ${res.status}`);
  const json = (await res.json()) as {
    results?: { result?: { title?: string; url?: string; snippet?: string; page_age?: string }[] };
  };
  return (json.results?.result ?? []).slice(0, 6).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.snippet ?? '',
    source: 'querit' as const,
    published: r.page_age ?? null,
    query,
    signal: classify(`${r.title ?? ''} ${r.snippet ?? ''}`),
  }));
}

export type AssetLocus = {
  asset_id: string;
  street: string;
  neighborhood: string;
  city: string;
  material: string;
};

/**
 * Retrieval funnel, per the cost strategy: a handful of targeted queries rather
 * than a broad sweep, results ranked and filtered, then cached for a week.
 */
export async function fetchExternalContext(locus: AssetLocus): Promise<ExternalContext> {
  const configured = !!key('SERPAPI_API_KEY') || !!key('QUERIT_API_KEY');
  const city = locus.city.split(',')[0];

  // Geospatial queries: an asset id means nothing publicly, but a street does.
  const liveQueries = [
    `"${locus.street}" ${locus.neighborhood} ${city} water main break`,
    `"${locus.street}" ${city} construction OR excavation OR "road work"`,
  ];
  // Mechanism research: durable, and shared across every asset of this material.
  const researchQuery = `${locus.material.replace(/_/g, ' ')} water main failure mechanism ${city} utility`;

  const cacheKey = `${locus.street}|${locus.neighborhood}|${locus.material}`;

  const { entry, live } = await cached<{ items: ExternalItem[]; queries: string[] }>(
    'external-context',
    cacheKey,
    7,
    async () => {
      const results = await Promise.allSettled([
        ...liveQueries.map((q) => serpapi(q)),
        querit(researchQuery),
      ]);
      const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      // Deduplicate by URL, keeping the first (highest-ranked) mention.
      const seen = new Set<string>();
      const deduped = items.filter((i) => {
        if (!i.url || seen.has(i.url)) return false;
        seen.add(i.url);
        return true;
      });
      return { items: deduped, queries: [...liveQueries, researchQuery] };
    },
  );

  const items = entry.value.items;
  const breaks = items.filter((i) => i.signal === 'break').length;
  const works = items.filter((i) => i.signal === 'construction' || i.signal === 'utility_work').length;
  const advisories = items.filter((i) => i.signal === 'advisory').length;

  // Corroboration required: a single loose match is not evidence. The ceiling
  // is low on purpose -- this layer nudges an ordering, it does not drive it.
  const corroborated = breaks >= 2 || works >= 2 || (breaks >= 1 && advisories >= 1);
  const strength = corroborated
    ? Math.min(0.28 + 0.12 * (breaks + works - 1), 0.75)
    : Math.min(0.1 * (breaks + works), 0.18);

  const parts: string[] = [];
  if (breaks) parts.push(`${breaks} public report${breaks > 1 ? 's' : ''} of water main breaks on or near ${locus.street}`);
  if (works) parts.push(`${works} construction or utility-work item${works > 1 ? 's' : ''} in this corridor`);
  if (advisories) parts.push(`${advisories} service advisor${advisories > 1 ? 'ies' : 'y'}`);

  return {
    items,
    queries: entry.value.queries,
    retrieved_at: entry.fetched_at,
    live,
    configured,
    strength,
    detail: parts.length
      ? `${parts.join('; ')} (public web, ${new Date(entry.fetched_at).toISOString().slice(0, 10)})`
      : 'No corroborating public reports found for this corridor',
    note: corroborated
      ? 'Corroborated across multiple independent public sources.'
      : 'Uncorroborated — contributes minimally and cannot elevate this asset on its own.',
    // Stated explicitly because this is the one place where genuinely real
    // information meets a simulated asset. These articles describe real events
    // on a real street; the pipe itself does not exist. Treating the two as the
    // same kind of fact would be the most misleading thing this product could do.
    boundary:
      'These are real public reports about this street. The segment is simulated, so this describes the corridor, not this pipe.',
  };
}
