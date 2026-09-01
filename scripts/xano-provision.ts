/**
 * Provisions the Clustral backend in Xano via the Metadata API.
 *
 * Xano is the application system of record: operator-facing state, decisions
 * and the audit trail. It deliberately does not duplicate Azure's analytics
 * role -- telemetry and scoring live there. What lives here is the part a
 * utility would be audited on: which asset was flagged, on what evidence, what
 * was recommended, who approved it, and when.
 *
 * Idempotent: re-running reconciles schemas rather than creating duplicates.
 *
 * Run: npm run xano:provision
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const creds = readFileSync(join(homedir(), '.xano', 'credentials.yaml'), 'utf8');
const token = /access_token:\s*(\S+)/.exec(creds)?.[1];
const instance = /instance_origin:\s*(\S+)/.exec(creds)?.[1];
if (!token || !instance) throw new Error('Run `xano auth` first — no CLI credentials found.');

const BASE = `${instance}/api:meta`;
const WS = 1;

type Col = {
  name: string;
  type: string;
  nullable?: boolean;
  required?: boolean;
  access?: string;
  style?: string;
  default?: string;
};

const sys = (): Col[] => [
  { name: 'id', type: 'int', nullable: false, required: true, access: 'public', style: 'single' },
  {
    name: 'created_at',
    type: 'timestamp',
    nullable: false,
    default: 'now',
    required: false,
    access: 'private',
    style: 'single',
  },
];

const col = (name: string, type: string, nullable = true): Col => ({
  name,
  type,
  nullable,
  required: false,
  access: 'public',
  style: 'single',
});

const TABLES: { name: string; description: string; columns: Col[] }[] = [
  {
    name: 'assets',
    description:
      'Distribution main segments under management. Mirrors the asset registry; the authoritative geometry and telemetry stay in the analytics layer.',
    columns: [
      col('asset_id', 'text', false), col('street', 'text'), col('neighborhood', 'text'),
      col('material', 'text'), col('diameter_in', 'int'), col('install_year', 'int'),
      col('length_ft', 'int'), col('pressure_zone', 'text'), col('criticality', 'decimal'),
      col('population_served', 'int'), col('has_sensor', 'bool'), col('road_class', 'text'),
      col('lat', 'decimal'), col('lng', 'decimal'),
    ],
  },
  {
    name: 'risk_snapshots',
    description:
      'A scored assessment of one asset at one point in time. Immutable: a new assessment is a new row, so what was known on a given date can always be reconstructed.',
    columns: [
      col('asset_id', 'text', false), col('as_of', 'text', false), col('risk', 'decimal'),
      col('confidence', 'decimal'), col('trajectory', 'text'), col('horizon', 'text'),
      col('evidence_families', 'int'), col('convergence_bonus', 'decimal'),
      col('engine_version', 'text'), col('data_class', 'text'),
    ],
  },
  {
    name: 'risk_factors',
    description:
      'The decomposition of a snapshot: every point of the score attributed to a named factor with its provenance. No score is stored without its reasons.',
    columns: [
      col('snapshot_id', 'int'), col('asset_id', 'text'), col('factor_key', 'text'),
      col('label', 'text'), col('family', 'text'), col('contribution', 'decimal'),
      col('strength', 'decimal'), col('provenance', 'text'), col('detail', 'text'),
    ],
  },
  {
    name: 'evidence',
    description:
      'Normalised evidence records from every source: inspection documents, external web context, research retrieval. Provenance and retrieval time are mandatory.',
    columns: [
      col('asset_id', 'text'), col('kind', 'text'), col('source', 'text'),
      col('source_ref', 'text'), col('observed_at', 'text'), col('retrieved_at', 'text'),
      col('confidence', 'decimal'), col('summary', 'text'), col('excerpt', 'text'),
      col('provenance', 'text'), col('corroborated', 'bool'),
    ],
  },
  {
    name: 'investigations',
    description:
      'An operator asking why an asset is high risk. Records the question, the evidence considered and the conclusion reached.',
    columns: [
      col('asset_id', 'text'), col('question', 'text'), col('status', 'text'),
      col('opened_by', 'text'), col('opened_at', 'text'), col('closed_at', 'text'),
      col('conclusion', 'text'), col('evidence_count', 'int'),
    ],
  },
  {
    name: 'recommendations',
    description:
      'Proposed physical action. Always requires human approval: this system does not authorise excavation, and never issues operational control.',
    columns: [
      col('asset_id', 'text'), col('snapshot_id', 'int'), col('action', 'text'),
      col('priority', 'text'), col('rationale', 'text'), col('horizon', 'text'),
      col('status', 'text'), col('requires_approval', 'bool'), col('approved_by', 'text'),
      col('approved_at', 'text'), col('declined_reason', 'text'),
    ],
  },
  {
    name: 'audit_events',
    description:
      'Append-only record of every scoring run, recommendation and human decision, with the engine version that produced it.',
    columns: [
      col('actor', 'text'), col('action', 'text'), col('entity', 'text'),
      col('entity_id', 'text'), col('detail', 'text'), col('engine_version', 'text'),
      col('occurred_at', 'text'),
    ],
  },
];

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const existing = await api(`/workspace/${WS}/table`);
const byName = new Map<string, number>(
  (existing.items ?? []).map((t: { name: string; id: number }) => [t.name, t.id]),
);

// Remove the throwaway used to discover the schema format.
if (byName.has('clustral_probe')) {
  await api(`/workspace/${WS}/table/${byName.get('clustral_probe')}`, { method: 'DELETE' });
  console.log('  removed clustral_probe');
}

for (const table of TABLES) {
  let id = byName.get(table.name);
  if (id === undefined) {
    const created = await api(`/workspace/${WS}/table`, {
      method: 'POST',
      body: JSON.stringify({ name: table.name, description: table.description }),
    });
    id = created.id as number;
    console.log(`  created  ${table.name.padEnd(18)} #${id}`);
  } else {
    console.log(`  exists   ${table.name.padEnd(18)} #${id}`);
  }

  await api(`/workspace/${WS}/table/${id}/schema`, {
    method: 'PUT',
    body: JSON.stringify({ schema: [...sys(), ...table.columns] }),
  });
  const verified = await api(`/workspace/${WS}/table/${id}/schema`);
  console.log(`           ${verified.length} columns`);
}

console.log('\nXano backend provisioned.');
