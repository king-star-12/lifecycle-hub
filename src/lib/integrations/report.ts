// Server-side only. Imported by route handlers and CLI scripts.
import { renderPdf } from './nutrient.ts';
import { key } from './env.ts';
import type { RiskScore } from '../risk/engine.ts';
import type { Asset, DocumentFinding, FailureEvent } from '../types.ts';

/**
 * The Pre-Failure Intelligence Report.
 *
 * This is the artefact that makes the system useful outside the dashboard: the
 * thing an asset manager forwards to a planner, or files against a work order.
 *
 * Rendering is deliberately behind an interface. Doctavian is the intended
 * renderer, but its generate endpoint requires a pre-uploaded DOCX template and
 * two encrypted AES JWTs, and the supplied key is currently rejected with
 * ApiKeyNotFound. Rather than block the feature on a credential, the report is
 * composed here and rendered through whichever provider is actually available.
 * The content is identical either way; only the renderer changes.
 */

export type ReportInput = {
  asset: Asset;
  score: RiskScore;
  findings: DocumentFinding[];
  failure: FailureEvent | null;
  nearbyFailures: { date: string; distance_m: number }[];
  complaints: { date: string; category: string }[];
  external?: { detail: string; note: string; boundary: string; items: { title: string; url: string }[] } | null;
  dataClass: string;
  utility: string;
  engineVersion: string;
};

export type RenderTarget = { provider: 'doctavian' | 'nutrient'; reason: string };

/** Which renderer is actually usable right now. */
export async function selectRenderer(): Promise<RenderTarget> {
  const dk = key('DOCTAVIAN_API_KEY');
  if (dk) {
    try {
      const res = await fetch('https://api.doctavian.com/common/service/token', {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': dk, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) return { provider: 'doctavian', reason: 'Doctavian service token issued' };
      return {
        provider: 'nutrient',
        reason: `Doctavian rejected the credential (${res.status}); rendered via Nutrient DWS instead`,
      };
    } catch (err) {
      return {
        provider: 'nutrient',
        reason: `Doctavian unreachable (${err instanceof Error ? err.message : 'error'}); rendered via Nutrient DWS`,
      };
    }
  }
  return { provider: 'nutrient', reason: 'No Doctavian credential configured; rendered via Nutrient DWS' };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function composeReportHtml(input: ReportInput, renderer: RenderTarget): string {
  const { asset, score, findings, failure } = input;
  const age = Number(score.as_of.slice(0, 4)) - asset.install_year;
  const band =
    score.risk >= 80 ? 'CRITICAL' : score.risk >= 65 ? 'HIGH' : score.risk >= 50 ? 'ELEVATED' : score.risk >= 35 ? 'MODERATE' : 'LOW';

  const action =
    score.risk >= 78 ? 'Targeted acoustic inspection'
    : score.risk >= 65 ? 'Field inspection with pressure logging'
    : score.risk >= 50 ? 'Add to condition-assessment queue'
    : 'Monitor; no intervention proposed';

  // Evidence quality is a function of independent corroboration and coverage,
  // not of how high the score happens to be.
  const families = new Set(score.factors.map((f) => f.family)).size;
  const quality = families >= 4 && asset.has_sensor ? 'High' : families >= 3 ? 'Moderate' : 'Limited';

  const row = (k: string, v: string) =>
    `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Pre-Failure Intelligence Report — ${esc(asset.asset_id)}</title>
<style>
  @page { margin: 20mm 18mm; }
  body { font-family: Georgia,'Times New Roman',serif; font-size: 10.5pt; line-height: 1.5; color: #14171c; }
  h1 { font-size: 17pt; margin: 0 0 2px; letter-spacing: -0.2px; }
  h2 { font-size: 11pt; margin: 20px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #c9cfd8;
       text-transform: uppercase; letter-spacing: 0.06em; }
  .sub { color: #5b6572; font-size: 9pt; margin-bottom: 14px; }
  .banner { border: 1.5px solid #b3541e; background: #fdf3e7; padding: 8px 11px; margin: 12px 0;
            font-size: 9pt; color: #7a3a11; }
  .score { display: flex; gap: 26px; align-items: baseline; margin: 10px 0 4px; }
  .score .n { font-size: 34pt; font-weight: bold; line-height: 1; }
  .band { font-size: 12pt; font-weight: bold; letter-spacing: 0.05em; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 9.5pt; }
  th { text-align: left; width: 34%; color: #5b6572; font-weight: normal; padding: 3px 8px 3px 0;
       vertical-align: top; }
  td { padding: 3px 0; vertical-align: top; }
  ol, ul { margin: 4px 0 4px 18px; padding: 0; }
  li { margin-bottom: 5px; }
  .factor { font-weight: bold; }
  .detail { color: #3d4552; }
  .prov { font-size: 8pt; color: #7a838f; text-transform: uppercase; letter-spacing: 0.05em; }
  .foot { margin-top: 22px; padding-top: 8px; border-top: 1px solid #c9cfd8; font-size: 8pt; color: #6b7480; }
  .approve { border: 1.5px solid #14171c; padding: 10px 12px; margin-top: 14px; font-size: 9.5pt; }
</style></head><body>

<h1>Pre-Failure Intelligence Report</h1>
<div class="sub">${esc(asset.asset_id)} &middot; ${esc(asset.street)}, ${esc(asset.neighborhood)} &middot; ${esc(input.utility)}</div>

<div class="banner"><strong>Decision support &mdash; not an autonomous control system.</strong><br/>
This assessment is generated from <strong>${esc(input.dataClass)}</strong> telemetry and documents. It
recommends inspection only. It does not authorise excavation and issues no operational control.</div>

<div class="score">
  <div><div class="n">${score.risk.toFixed(0)}</div><div class="prov">of 100</div></div>
  <div>
    <div class="band">${band}</div>
    <div class="prov">confidence ${(score.confidence * 100).toFixed(0)}% &middot; ${esc(score.trajectory.replace(/_/g, ' '))}${score.horizon ? ` &middot; horizon ${esc(score.horizon)}` : ''}</div>
  </div>
</div>

<h2>Asset</h2>
<table>
${row('Segment', asset.asset_id)}
${row('Location', `${asset.street}, ${asset.neighborhood}`)}
${row('Material', `${asset.material.replace(/_/g, ' ')}, ${asset.diameter_in}" diameter`)}
${row('Installed', `${asset.install_year} (${age} years in service)`)}
${row('Length', `${asset.length_ft} ft`)}
${row('Pressure zone', asset.pressure_zone)}
${row('Population served', asset.population_served.toLocaleString())}
${row('Instrumentation', asset.has_sensor ? 'Pressure and flow monitored' : 'No sensor coverage')}
${asset.critical_facilities.length ? row('Critical facilities', asset.critical_facilities.join(', ')) : ''}
</table>

<h2>Key finding</h2>
<p>${
    score.convergence.families >= 3
      ? `${score.convergence.families} independent categories of evidence are converging on this segment. No single signal is decisive; the assessment rests on their agreement.`
      : `Assessment rests on ${score.convergence.families} evidence categor${score.convergence.families === 1 ? 'y' : 'ies'}. Corroboration is limited and the score should be read accordingly.`
  }</p>

<h2>Contributing signals</h2>
<ol>
${score.factors
  .map(
    (f) =>
      `<li><span class="factor">${esc(f.label)}</span> &nbsp;<span class="prov">+${f.contribution.toFixed(1)} &middot; ${esc(f.provenance)}</span><br/><span class="detail">${esc(f.detail)}</span></li>`,
  )
  .join('\n')}
</ol>

${
  findings.length
    ? `<h2>Document evidence</h2>${findings
        .map(
          (f) =>
            `<p><strong>${esc(f.severity)} ${esc(f.finding.replace(/_/g, ' '))}</strong> &mdash; ${esc(f.document)}, p.${f.page}, ${esc(f.date)}<br/><em>&ldquo;${esc(f.excerpt)}&rdquo;</em></p>`,
        )
        .join('')}`
    : ''
}

${
  input.nearbyFailures.length
    ? `<h2>Spatial context</h2><p>${input.nearbyFailures.length} recorded break${input.nearbyFailures.length > 1 ? 's' : ''} within 500 m, nearest ${Math.min(...input.nearbyFailures.map((n) => n.distance_m))} m. ${input.complaints.length} customer report${input.complaints.length === 1 ? '' : 's'} in the surrounding 250 m over the past 180 days.</p>`
    : ''
}

${
  input.external
    ? `<h2>External context</h2><p>${esc(input.external.detail)}</p><p class="prov">${esc(input.external.boundary)}</p><ul>${input.external.items
        .slice(0, 4)
        .map((i) => `<li>${esc(i.title)}<br/><span class="prov">${esc(i.url)}</span></li>`)
        .join('')}</ul>`
    : ''
}

<h2>Confidence and known gaps</h2>
<ul>
${score.confidence_reasons.positive.map((r) => `<li>${esc(r)}</li>`).join('')}
${score.confidence_reasons.negative.map((r) => `<li>${esc(r)}</li>`).join('')}
${score.data_gaps.map((g) => `<li>${esc(g)}</li>`).join('')}
</ul>
<table>${row('Evidence quality', quality)}${row('Independent evidence types', String(new Set(score.factors.map((f) => f.family)).size))}</table>

<h2>Recommended action</h2>
<table>
${row('Action', action)}
${row('Priority', score.risk >= 78 ? 'High — schedule ahead of routine maintenance' : score.risk >= 65 ? 'Medium' : 'Routine')}
${row('Suggested checks', 'Valve condition; pressure logger deployment; acoustic survey; surface inspection')}
</table>

<div class="approve">
<strong>Human approval required.</strong> This report proposes an inspection. No physical work is
authorised until an accountable engineer signs off.<br/><br/>
Approved by: ______________________________ &nbsp;&nbsp; Date: ________________
</div>

${
  failure
    ? `<h2>Failure history of record</h2><p>This segment previously failed on ${esc(failure.date)} (${esc(failure.severity)} break, ${failure.water_lost_gal.toLocaleString()} gal lost, ${failure.customers_affected.toLocaleString()} customers affected). It was repaired and returned to service; the assessment above reflects its condition since.</p>`
    : ''
}

<div class="foot">
Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC &middot; engine ${esc(input.engineVersion)}
&middot; assessment as of ${esc(score.as_of)} &middot; rendered via ${esc(renderer.provider)}<br/>
${esc(renderer.reason)}<br/>
Data class: ${esc(input.dataClass)}. Figures derive from simulated telemetry and documents and must not
be used for operational decisions on a real network.
</div>
</body></html>`;
}

export async function generateReport(input: ReportInput): Promise<{ pdf: Buffer; renderer: RenderTarget }> {
  const renderer = await selectRenderer();
  const html = composeReportHtml(input, renderer);
  const pdf = await renderPdf(html, `report-${input.asset.asset_id}`);
  return { pdf, renderer };
}
