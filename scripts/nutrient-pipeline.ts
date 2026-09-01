/**
 * End-to-end document pipeline through Nutrient DWS, with accuracy measured
 * against the withheld answer key.
 *
 *   report prose -> PDF (Nutrient) -> structured extraction (Nutrient) -> parse
 *   -> compare against the simulator's original finding
 *
 * The comparison is the point. A document integration that is merely *called*
 * proves nothing; one whose output is scored against ground truth tells you
 * whether the evidence feeding the risk engine can be trusted.
 *
 * Run: npm run nutrient -- [count]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPdf, parseFinding, renderPdf } from '../src/lib/integrations/nutrient.ts';
import type { GeneratedDocument } from '../src/lib/sim/documents.ts';
import type { NetworkBundle } from '../src/lib/types.ts';

const DATA = join(import.meta.dirname, '..', 'data', 'synthetic');
const PDF_DIR = join(import.meta.dirname, '..', 'data', 'documents');
mkdirSync(PDF_DIR, { recursive: true });

const docs: GeneratedDocument[] = JSON.parse(readFileSync(join(DATA, 'documents.json'), 'utf8'));
const bundle: NetworkBundle = JSON.parse(readFileSync(join(DATA, 'network.json'), 'utf8'));
const truth = new Map(bundle.findings.map((f) => [f.document, f]));

const count = Number(process.argv[2] ?? 14);

// Prefer documents that matter: severe findings, and assets that later broke.
const failed = new Set(bundle.failures.map((f) => f.asset_id));
const ranked = [...docs].sort((a, b) => {
  const score = (d: GeneratedDocument) => {
    const t = truth.get(d.filename);
    return (
      (t?.severity === 'severe' ? 3 : t?.severity === 'moderate' ? 2 : 0) +
      (failed.has(d.asset_ids[0]) ? 2 : 0)
    );
  };
  return score(b) - score(a);
});
const selected = ranked.slice(0, count);

const REPORT_CSS = `
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.55;
         margin: 54px 60px; color: #111; }
  pre  { font-family: inherit; font-size: inherit; white-space: pre-wrap; margin: 0; }
`;

type Row = {
  filename: string;
  asset_id_ok: boolean;
  date_ok: boolean;
  severity_ok: boolean;
  material_ok: boolean;
  year_ok: boolean;
  no_leak_flag: boolean;
  pdf_bytes: number;
  chars: number;
};

const rows: Row[] = [];
/** Findings as recovered from the PDFs -- what the product should actually consume. */
const extracted: Record<string, unknown>[] = [];
console.log(`processing ${selected.length} inspection reports through Nutrient DWS\n`);

for (const [i, doc] of selected.entries()) {
  const pdfPath = join(PDF_DIR, doc.filename);
  let pdf: Buffer;

  if (existsSync(pdfPath)) {
    pdf = readFileSync(pdfPath);
  } else {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${doc.title}</title><style>${REPORT_CSS}</style></head><body><pre>${doc.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre></body></html>`;
    pdf = await renderPdf(html, doc.filename);
    writeFileSync(pdfPath, pdf);
  }

  const pages = await extractPdf(pdf, doc.filename);
  const text = pages.map((p) => p.plainText).join('\n');
  const parsed = parseFinding(text);
  const t = truth.get(doc.filename)!;
  const asset = bundle.assets.find((a) => a.asset_id === t.asset_id);

  const row: Row = {
    filename: doc.filename,
    asset_id_ok: parsed.asset_id === t.asset_id,
    date_ok: parsed.inspection_date === t.date,
    severity_ok: parsed.severity === t.severity,
    material_ok: parsed.material === asset?.material,
    year_ok: parsed.install_year === asset?.install_year,
    no_leak_flag: parsed.no_active_leak,
    pdf_bytes: pdf.length,
    chars: text.length,
  };
  rows.push(row);

  // Store what the pipeline recovered, not what the simulator knew. Downstream
  // consumes this; the answer key exists only to score it.
  if (parsed.asset_id) {
    extracted.push({
      finding_id: `NUT-${i + 1}`,
      asset_id: parsed.asset_id,
      document: doc.filename,
      page: t.page,
      date: parsed.inspection_date ?? doc.date,
      finding: parsed.finding ?? 'no_defect_observed',
      severity: parsed.severity ?? 'none',
      confidence: t.confidence,
      excerpt: parsed.evidence_sentence ?? '',
      no_active_leak: parsed.no_active_leak,
      source: 'nutrient_dws',
      extracted_at: new Date().toISOString(),
    });
  }

  const mark = (ok: boolean) => (ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m');
  console.log(
    `  ${String(i + 1).padStart(2)}. ${doc.filename.padEnd(38)} ` +
      `id${mark(row.asset_id_ok)} date${mark(row.date_ok)} sev${mark(row.severity_ok)} ` +
      `mat${mark(row.material_ok)} yr${mark(row.year_ok)}  ${(pdf.length / 1024).toFixed(0)}KB`,
  );
}

const pct = (f: (r: Row) => boolean) => ((rows.filter(f).length / rows.length) * 100).toFixed(0);
console.log(`
\x1b[1mEXTRACTION ACCURACY\x1b[0m  (parsed field vs the simulator's withheld finding)
  asset id            ${pct((r) => r.asset_id_ok).padStart(4)}%
  inspection date     ${pct((r) => r.date_ok).padStart(4)}%
  severity            ${pct((r) => r.severity_ok).padStart(4)}%
  material            ${pct((r) => r.material_ok).padStart(4)}%
  install year        ${pct((r) => r.year_ok).padStart(4)}%
  "no active leak"    ${pct((r) => r.no_leak_flag).padStart(4)}%  of reports carried the phrase`);

const summary = {
  generated_at: new Date().toISOString(),
  provider: 'Nutrient DWS Processor API',
  operations: ['html->pdf (build)', 'pdf->json-content (build)'],
  documents: rows.length,
  accuracy: {
    asset_id: Number(pct((r) => r.asset_id_ok)),
    inspection_date: Number(pct((r) => r.date_ok)),
    severity: Number(pct((r) => r.severity_ok)),
    material: Number(pct((r) => r.material_ok)),
    install_year: Number(pct((r) => r.year_ok)),
  },
  total_pdf_bytes: rows.reduce((s, r) => s + r.pdf_bytes, 0),
  rows,
};
writeFileSync(join(DATA, 'nutrient-report.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(DATA, 'nutrient-findings.json'), JSON.stringify(extracted, null, 2));
console.log(
  `\nwrote nutrient-report.json and nutrient-findings.json (${extracted.length} findings) · ${rows.length} PDFs in data/documents/`,
);
console.log(
  '\nNote: these are cleanly rendered PDFs, not scanned files. Real utility\n' +
    'archives carry OCR noise, skew and handwriting, and would score lower.',
);
