// Server-side only. Imported by route handlers and by CLI scripts, so it cannot
// carry the `server-only` guard -- that package throws outside Next's bundler.
// Secrets here are read from process.env and are never NEXT_PUBLIC_, so nothing
// in this file can reach the browser bundle.
import { key } from './env.ts';

/**
 * Nutrient DWS document pipeline.
 *
 * Two operations, both against the Build API:
 *
 *   render()   HTML -> PDF. The synthetic inspection reports are held as prose,
 *              so this produces genuine PDFs to work from rather than pretending
 *              a JSON blob is a scanned document.
 *   extract()  PDF -> structured content. This is the core document operation:
 *              the pipeline reads a report the way it would read a utility's
 *              real inspection file, with no access to how it was generated.
 *
 * The structured finding that the simulator used to write each report is held
 * back as an answer key, so extraction quality is measured rather than assumed.
 */

const BUILD_URL = 'https://api.nutrient.io/build';

function auth(): string {
  const k = key('NUTRIENT_API_KEY');
  if (!k) throw new Error('NUTRIENT_API_KEY is not configured');
  return k;
}

/** Render report prose to a real PDF. */
export async function renderPdf(html: string, title: string): Promise<Buffer> {
  const form = new FormData();
  form.append('index.html', new Blob([html], { type: 'text/html' }), 'index.html');
  form.append('instructions', JSON.stringify({ parts: [{ html: 'index.html' }] }));

  const res = await fetch(BUILD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth()}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Nutrient render ${res.status}: ${(await res.text()).slice(0, 200)} [${title}]`);
  return Buffer.from(await res.arrayBuffer());
}

export type ExtractedPage = {
  plainText: string;
  tables: unknown[];
  keyValuePairs: unknown[];
};

/** Extract structured content from a PDF. */
export async function extractPdf(pdf: Buffer, filename: string): Promise<ExtractedPage[]> {
  const form = new FormData();
  form.append('doc', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), filename);
  form.append(
    'instructions',
    JSON.stringify({
      parts: [{ file: 'doc' }],
      output: { type: 'json-content', plainText: true, tables: true, keyValuePairs: true },
    }),
  );

  const res = await fetch(BUILD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth()}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Nutrient extract ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { pages?: ExtractedPage[] };
  return json.pages ?? [];
}

export type ParsedFinding = {
  asset_id: string | null;
  inspection_date: string | null;
  severity: 'none' | 'minor' | 'moderate' | 'severe' | null;
  finding: string | null;
  material: string | null;
  install_year: number | null;
  diameter_in: number | null;
  /** The sentence the classification came from, so a reviewer can check it. */
  evidence_sentence: string | null;
  /** Whether the report explicitly recorded no active leak. */
  no_active_leak: boolean;
};

/**
 * Parse extracted text into the structured evidence the risk engine consumes.
 *
 * Rule-based rather than an LLM call: these are short, highly templated
 * engineering documents, and a deterministic parser is cheaper, faster and
 * auditable. Anything it cannot find stays null rather than being guessed --
 * a wrong asset id would attach corrosion evidence to the wrong pipe.
 */
export function parseFinding(text: string): ParsedFinding {
  const flat = text.replace(/\r\n/g, '\n');
  const grab = (re: RegExp): string | null => re.exec(flat)?.[1]?.trim() ?? null;

  const severityRaw = grab(/Condition classification:\s*([A-Z]+)/i)?.toLowerCase() ?? null;
  const severity =
    severityRaw && ['none', 'minor', 'moderate', 'severe'].includes(severityRaw)
      ? (severityRaw as ParsedFinding['severity'])
      : null;

  const observations = /3\.\s*OBSERVATIONS\s*\n+([\s\S]*?)\n+\d\.\s/i.exec(flat)?.[1]?.trim() ?? null;

  return {
    asset_id: grab(/\b(WM-\d{3,5})\b/),
    inspection_date: grab(/Date of inspection:\s*(\d{4}-\d{2}-\d{2})/i),
    severity,
    finding: grab(/Primary observation:\s*([a-z ]+)/i)?.replace(/\s+/g, '_') ?? null,
    material: grab(/\b(cast iron|ductile iron|asbestos cement|steel|pvc|hdpe)\b/i)?.toLowerCase().replace(/\s+/g, '_') ?? null,
    install_year: Number(grab(/originally installed in\s*(\d{4})/i)) || null,
    diameter_in: Number(grab(/(\d+)-inch/i)) || null,
    evidence_sentence: observations ? observations.split('\n')[0] : null,
    no_active_leak: /No active leak (was )?(detected|observed)/i.test(flat),
  };
}
