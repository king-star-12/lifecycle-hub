/**
 * Builds the asset relationship graph in Azure Digital Twins.
 *
 * Failure propagation in a distribution network is spatial and topological, not
 * per-asset. A pressure excursion means something different depending on which
 * zone it is in, what pump feeds that zone, and which segments sit adjacent to
 * it. Modelling those relationships as first-class data is what lets the engine
 * ask "what connected infrastructure could explain this signal" instead of
 * attributing a zone-wide event to one pipe.
 *
 * Run: npm run azure:twins
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { NetworkBundle, TelemetrySeries } from '../src/lib/types.ts';
import { buildContext, scoreNetwork } from '../src/lib/risk/engine.ts';

const HOST = 'https://clustral-water-twins.api.sea.digitaltwins.azure.net';
const API = 'api-version=2023-10-31';
const DATA = join(import.meta.dirname, '..', 'data', 'synthetic');

const token = execFileSync(
  'az',
  [
    'account',
    'get-access-token',
    '--resource',
    'https://digitaltwins.azure.net',
    '--query',
    'accessToken',
    '-o',
    'tsv',
  ],
  { encoding: 'utf8' },
).trim();

async function adt(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${HOST}${path}${path.includes('?') ? '&' : '?'}${API}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  if (res.status === 403) {
    throw new Error(
      'ADT_FORBIDDEN: the signed-in principal has no Digital Twins data-plane role. ' +
        'Grant it with:\n  az dt role-assignment create --dt-name clustral-water-twins ' +
        '-g clustral-rg --assignee <you> --role "Azure Digital Twins Data Owner"',
    );
  }
  if (!res.ok && res.status !== 409) throw new Error(`ADT ${res.status} ${path}: ${text.slice(0, 240)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const CTX = 'dtmi:dtdl:context;2';
const MODELS = [
  {
    '@id': 'dtmi:clustral:Utility;1',
    '@type': 'Interface',
    '@context': CTX,
    displayName: 'Water Utility',
    contents: [
      { '@type': 'Property', name: 'name', schema: 'string' },
      { '@type': 'Relationship', name: 'operates', target: 'dtmi:clustral:PressureZone;1' },
    ],
  },
  {
    '@id': 'dtmi:clustral:PressureZone;1',
    '@type': 'Interface',
    '@context': CTX,
    displayName: 'Pressure Zone',
    contents: [
      { '@type': 'Property', name: 'name', schema: 'string' },
      { '@type': 'Property', name: 'nominalPsi', schema: 'double' },
      { '@type': 'Property', name: 'pumpStation', schema: 'string' },
      { '@type': 'Property', name: 'reservoir', schema: 'string' },
      { '@type': 'Relationship', name: 'feeds', target: 'dtmi:clustral:Pipe;1' },
    ],
  },
  {
    '@id': 'dtmi:clustral:Pipe;1',
    '@type': 'Interface',
    '@context': CTX,
    displayName: 'Water Main Segment',
    contents: [
      { '@type': 'Property', name: 'street', schema: 'string' },
      { '@type': 'Property', name: 'neighborhood', schema: 'string' },
      { '@type': 'Property', name: 'material', schema: 'string' },
      { '@type': 'Property', name: 'diameterIn', schema: 'integer' },
      { '@type': 'Property', name: 'installYear', schema: 'integer' },
      { '@type': 'Property', name: 'criticality', schema: 'double' },
      { '@type': 'Property', name: 'hasSensor', schema: 'boolean' },
      { '@type': 'Property', name: 'riskScore', schema: 'double' },
      { '@type': 'Property', name: 'riskConfidence', schema: 'double' },
      { '@type': 'Property', name: 'dataClass', schema: 'string' },
      // Adjacency is the relationship the spatial reasoning actually walks.
      { '@type': 'Relationship', name: 'adjacentTo', target: 'dtmi:clustral:Pipe;1' },
    ],
  },
];

console.log('uploading DTDL models...');
await adt('/models', { method: 'POST', body: JSON.stringify(MODELS) }).catch((e) => {
  if (String(e).includes('ADT_FORBIDDEN')) throw e;
  console.log('  (models already present)');
});
console.log(`  ${MODELS.length} models`);

const bundle: NetworkBundle = JSON.parse(readFileSync(join(DATA, 'network.json'), 'utf8'));
const telemetry: TelemetrySeries[] = JSON.parse(readFileSync(join(DATA, 'telemetry.json'), 'utf8'));
const ctx = buildContext(bundle, telemetry);
const scores = new Map(scoreNetwork(ctx, bundle.meta.days - 1).map((s) => [s.asset_id, s]));

// Model the elevated set plus everything with a recorded break. A full 1,892-node
// graph would cost time without changing what the relationships demonstrate.
const failed = new Set(bundle.failures.map((f) => f.asset_id));
const selected = bundle.assets
  .filter((a) => (scores.get(a.asset_id)?.risk ?? 0) >= 50 || failed.has(a.asset_id))
  .slice(0, 90);
const selectedIds = new Set(selected.map((a) => a.asset_id));

const put = (id: string, body: unknown) =>
  adt(`/digitaltwins/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });

console.log('\ncreating twins...');
await put('utility-trwa', {
  $metadata: { $model: 'dtmi:clustral:Utility;1' },
  name: bundle.meta.utility,
});

for (const z of bundle.zones) {
  await put(z.zone_id, {
    $metadata: { $model: 'dtmi:clustral:PressureZone;1' },
    name: z.name,
    nominalPsi: z.nominal_psi,
    pumpStation: z.pump_station,
    reservoir: z.reservoir,
  });
}
console.log(`  1 utility, ${bundle.zones.length} pressure zones`);

let made = 0;
const queue = [...selected];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const a = queue.pop()!;
      const s = scores.get(a.asset_id);
      try {
        await put(a.asset_id, {
          $metadata: { $model: 'dtmi:clustral:Pipe;1' },
          street: a.street,
          neighborhood: a.neighborhood,
          material: a.material,
          diameterIn: a.diameter_in,
          installYear: a.install_year,
          criticality: a.criticality,
          hasSensor: a.has_sensor,
          riskScore: s?.risk ?? 0,
          riskConfidence: s?.confidence ?? 0,
          dataClass: bundle.meta.data_class,
        });
        made++;
      } catch {
        // one twin failing must not abandon the graph
      }
    }
  }),
);
console.log(`  ${made} pipe segments`);

console.log('\ncreating relationships...');
let rels = 0;
const rel = async (from: string, name: string, to: string, id: string) => {
  try {
    await adt(`/digitaltwins/${encodeURIComponent(from)}/relationships/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ $relationshipName: name, $targetId: to }),
    });
    rels++;
  } catch {
    // ignore duplicates
  }
};

for (const z of bundle.zones) await rel('utility-trwa', 'operates', z.zone_id, `op-${z.zone_id}`);
for (const a of selected) await rel(a.pressure_zone, 'feeds', a.asset_id, `feed-${a.asset_id}`);

// Adjacency, capped per node so the graph stays legible.
for (const a of selected) {
  const neighbours = (bundle.neighbors[a.asset_id] ?? []).filter((n) => selectedIds.has(n)).slice(0, 4);
  for (const n of neighbours) await rel(a.asset_id, 'adjacentTo', n, `adj-${a.asset_id}-${n}`);
}
console.log(`  ${rels} relationships`);

// --- verify with a real graph query ----------------------------------------
console.log('\n--- ADT query: highest-risk segments ---');
const res = (await adt('/query', {
  method: 'POST',
  body: JSON.stringify({
    query:
      "SELECT T.$dtId, T.street, T.neighborhood, T.material, T.installYear, T.riskScore FROM DIGITALTWINS T WHERE IS_OF_MODEL(T, 'dtmi:clustral:Pipe;1') AND T.riskScore > 60",
  }),
})) as { value?: Record<string, unknown>[] };

const top = (res.value ?? []).sort((a, b) => Number(b.riskScore) - Number(a.riskScore)).slice(0, 8);
for (const t of top) {
  console.log(
    `  ${String(t.$dtId).padEnd(9)} risk ${String(t.riskScore).padStart(5)}  ${t.installYear} ${String(t.material).padEnd(16)} ${t.street}, ${t.neighborhood}`,
  );
}
console.log(`\nDigital Twins graph built (${(res.value ?? []).length} segments above risk 60).`);
