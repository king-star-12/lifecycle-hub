import type { Asset, DocumentFinding, WeatherDay } from '../types.ts';
import { clamp, round, type Rng } from './rng.ts';

/**
 * Inspection and maintenance documents.
 *
 * These are generated as real report *prose*, not as pre-parsed records. The
 * document pipeline has to read them the way it would read a utility's actual
 * scanned inspection file. The structured finding is the answer key, held back
 * so extraction quality can be measured rather than assumed.
 *
 * An inspection observes the latent condition at the time it was performed --
 * with noise, and with a blind spot: a visual inspection of an exposed pipe
 * cannot see what the far side of the barrel is doing. That is the point of
 * the "no active leak detected" finding. It is true, and it is not
 * reassurance.
 */

export type GeneratedDocument = {
  document_id: string;
  filename: string;
  title: string;
  date: string;
  asset_ids: string[];
  /** Full report text, as it would appear in the PDF. */
  text: string;
  /** Ground-truth findings, withheld from the extraction pipeline. */
  findings: DocumentFinding[];
};

const INSPECTORS = [
  'R.Валанос, P.E.', 'M. Okonkwo, P.E.', 'D. Ferraro', 'S. Lindqvist, P.E.', 'J. Whitmore',
].map((s) => s.replace('Валанос', 'Valanos'));

const CONTRACTORS = [
  'Allegheny Pipeline Services',
  'Keystone Subsurface Inspection',
  'Monongahela Utility Consultants',
];

function severityFromCondition(condition: number, rng: Rng): DocumentFinding['severity'] {
  // Inspection is an imperfect instrument: it reads condition through soil,
  // coating and access limits.
  const observed = clamp(condition + rng.normal(0, 0.11), 0, 1);
  if (observed > 0.62) return 'severe';
  if (observed > 0.44) return 'moderate';
  if (observed > 0.26) return 'minor';
  return 'none';
}

function findingFor(
  asset: Asset,
  severity: DocumentFinding['severity'],
  rng: Rng,
): DocumentFinding['finding'] {
  if (severity === 'none') return 'no_defect_observed';
  const metallic = ['cast_iron', 'steel', 'ductile_iron'].includes(asset.material);
  return rng.weighted<DocumentFinding['finding']>([
    ['external_corrosion', metallic ? 40 : 6],
    ['internal_tuberculation', metallic ? 22 : 3],
    ['joint_leakage', 18],
    ['bedding_defect', 14],
    ['prior_excavation', 12],
  ]);
}

const EXCERPTS: Record<DocumentFinding['finding'], Record<string, string>> = {
  external_corrosion: {
    minor: 'Light surface oxidation noted on the exposed barrel. Coating largely intact. No measurable loss of wall thickness.',
    moderate: 'Moderate external corrosion observed on the crown and springline, with localised pitting to an estimated depth of 2–3 mm. Graphitization suspected but not confirmed by coupon.',
    severe: 'Extensive external corrosion with deep pitting and confirmed graphitization over an estimated 40% of the exposed circumference. Remaining wall thickness is materially reduced.',
  },
  internal_tuberculation: {
    minor: 'Minor tuberculation consistent with age. Carrying capacity not visibly affected.',
    moderate: 'Moderate tuberculation reducing effective diameter; C-factor estimated below design value.',
    severe: 'Heavy tuberculation with significant loss of effective diameter. Flushing recommended prior to any hydraulic assessment.',
  },
  joint_leakage: {
    minor: 'Damp staining observed at one bell-and-spigot joint. No active weeping at time of inspection.',
    moderate: 'Active weeping at the joint, estimated under 0.5 gpm. Gasket appears displaced.',
    severe: 'Sustained leakage at the joint with visible washout of surrounding bedding material.',
  },
  bedding_defect: {
    minor: 'Bedding material appears variable but supportive along the exposed run.',
    moderate: 'Voids observed beneath the barrel over an estimated 4 ft. Support is inconsistent.',
    severe: 'Substantial loss of bedding support with the pipe spanning an unsupported length; bending stress is a concern.',
  },
  prior_excavation: {
    minor: 'Evidence of previous excavation in the vicinity; backfill appears adequately compacted.',
    moderate: 'Prior excavation evident with poorly compacted backfill. Differential settlement possible.',
    severe: 'Repeated prior excavation with poor reinstatement. Segment has been disturbed multiple times.',
  },
  no_defect_observed: {
    none: 'No defects observed on the exposed section. Pipe wall and coating in serviceable condition.',
  },
};

export function generateDocuments(
  rng: Rng,
  assets: Asset[],
  weather: WeatherDay[],
  latent: Record<string, number[]>,
  opts: { inspectionCount: number },
): GeneratedDocument[] {
  const docs: GeneratedDocument[] = [];
  // Inspection programmes are not random: utilities inspect large mains,
  // arterials and known-old pipe far more often than quiet residential runs.
  const pool = assets.map((a) => {
    const age = 2022 - a.install_year;
    const weight =
      1 +
      (a.diameter_in >= 16 ? 2.4 : 0) +
      (a.road_class === 'arterial' ? 1.6 : 0) +
      (age > 80 ? 2.2 : age > 50 ? 0.9 : 0) +
      (a.critical_facilities.length ? 1.5 : 0);
    return [a, weight] as const;
  });

  let seq = 1;
  let findingSeq = 1;
  const seen = new Set<string>();

  for (let n = 0; n < opts.inspectionCount; n++) {
    const docRng = rng.fork(`doc/${n}`);
    const asset = docRng.weighted(pool);
    // Allow repeat inspections of the same asset in different years -- the
    // "we looked at this in 2023 and it was fine" narrative depends on it.
    const dayIdx = docRng.int(30, weather.length - 30);
    const date = weather[dayIdx].date;
    const key = `${asset.asset_id}/${date.slice(0, 7)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const condition = latent[asset.asset_id]?.[dayIdx] ?? 0.3;
    const severity = severityFromCondition(condition, docRng);
    const finding = findingFor(asset, severity, docRng);
    const excerpt = EXCERPTS[finding][severity] ?? EXCERPTS.no_defect_observed.none;

    const inspector = docRng.pick(INSPECTORS);
    const contractor = docRng.pick(CONTRACTORS);
    const page = docRng.int(2, 9);
    const filename = `inspection_${asset.asset_id}_${date.replace(/-/g, '')}.pdf`;

    // Deliberately reports the absence of an active leak. Historically this is
    // the sentence that gets an asset deprioritised -- and it is exactly the
    // wrong conclusion to draw from it.
    const leakLine =
      condition > 0.5 && docRng.chance(0.7)
        ? 'No active leak was detected at the time of inspection.'
        : 'No active leak observed.';

    const text = `${contractor.toUpperCase()}
DISTRIBUTION MAIN CONDITION ASSESSMENT

Report reference: CA-${date.slice(0, 4)}-${String(seq).padStart(4, '0')}
Date of inspection: ${date}
Inspector: ${inspector}
Client: Three Rivers Water Authority

1. SCOPE

Visual and limited non-destructive assessment of distribution main segment
${asset.asset_id}, located on ${asset.street} in the ${asset.neighborhood} area of the
${asset.pressure_zone} pressure zone. The segment is a ${asset.diameter_in}-inch
${asset.material.replace(/_/g, ' ')} main of approximately ${asset.length_ft} ft,
originally installed in ${asset.install_year}.

2. METHOD

Access was obtained by test pit at one location. The exposed section was cleaned
and examined visually. Wall thickness was assessed by ultrasonic spot readings
where surface condition permitted. No internal inspection was performed.

3. OBSERVATIONS

${excerpt}

${leakLine} Soil at pipe depth was ${condition > 0.5 ? 'damp with poor drainage' : 'moderately drained'}.

4. FINDING

Condition classification: ${severity.toUpperCase()}
Primary observation: ${finding.replace(/_/g, ' ')}

5. RECOMMENDATION

${
  severity === 'severe'
    ? 'Prioritise this segment for replacement planning. Re-inspect within 12 months if replacement cannot be scheduled.'
    : severity === 'moderate'
      ? 'Include in the medium-term renewal programme. Monitor for changes in operating pressure.'
      : 'No immediate action required. Reassess at the next scheduled cycle.'
}

This assessment reflects the condition of the exposed section only and should not
be taken as representative of the entire segment.

Page ${page} of ${page + 2}`;

    docs.push({
      document_id: `DOC-${seq++}`,
      filename,
      title: `Distribution Main Condition Assessment — ${asset.asset_id}`,
      date,
      asset_ids: [asset.asset_id],
      text,
      findings: [
        {
          finding_id: `FND-${findingSeq++}`,
          asset_id: asset.asset_id,
          document: filename,
          page,
          date,
          finding,
          severity,
          confidence: round(clamp(0.72 + docRng.range(0, 0.26), 0, 0.99), 2),
          excerpt,
        },
      ],
    });
  }

  docs.sort((a, b) => a.date.localeCompare(b.date));
  return docs;
}
