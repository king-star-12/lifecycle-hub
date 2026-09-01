/**
 * Loads the network into Azure Data Explorer via blob staging.
 *
 * Direct REST ingestion would work for a toy volume, but the production path
 * for anything at telemetry scale is stage-to-blob then ingest-from-blob, so
 * that is what this does. ADX is the analytics layer: high-volume time series,
 * KQL feature extraction, and the queries that would run continuously in a real
 * deployment. It is deliberately not where the application's decisions live --
 * that is Xano.
 *
 * Run: npm run azure:ingest
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { NetworkBundle, TelemetrySeries } from '../src/lib/types.ts';

const CLUSTER = 'https://clustralwater.centralindia.kusto.windows.net';
const DB = 'clustral';
const RG = 'clustral-rg';
const STORAGE = 'clustralwaterdocs';
const CONTAINER = 'ingest';
/** One year of daily summaries is enough to demonstrate the analytics. */
const WINDOW_DAYS = 365;

const DATA = join(import.meta.dirname, '..', 'data', 'synthetic');
const STAGE = join(import.meta.dirname, '..', 'data', 'stage');
mkdirSync(STAGE, { recursive: true });

const az = (args: string[]): string =>
  execFileSync('az', [...args, '--only-show-errors'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

const token = az(['account', 'get-access-token', '--resource', CLUSTER, '--query', 'accessToken', '-o', 'tsv']);

async function kusto(endpoint: 'mgmt' | 'query', csl: string): Promise<unknown> {
  const res = await fetch(`${CLUSTER}/v1/rest/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ db: DB, csl }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kusto ${endpoint} ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

/** Pull rows out of a Kusto v1 response. */
function rows(result: unknown): unknown[][] {
  const tables = (result as { Tables?: { Rows?: unknown[][] }[] }).Tables ?? [];
  return tables[0]?.Rows ?? [];
}

const bundle: NetworkBundle = JSON.parse(readFileSync(join(DATA, 'network.json'), 'utf8'));
const telemetry: TelemetrySeries[] = JSON.parse(readFileSync(join(DATA, 'telemetry.json'), 'utf8'));
const zoneOf = new Map(bundle.assets.map((a) => [a.asset_id, a.pressure_zone]));

// --- stage ------------------------------------------------------------------
console.log('staging NDJSON...');
const start = bundle.meta.days - WINDOW_DAYS;

const telemetryLines: string[] = [];
for (const t of telemetry) {
  if (!t.pressure_std.length) continue; // uninstrumented segments have no series
  for (let i = start; i < bundle.meta.days; i++) {
    telemetryLines.push(
      JSON.stringify({
        AssetId: t.asset_id,
        Date: bundle.weather[i].date,
        PressureMean: t.pressure_mean[i],
        PressureStd: t.pressure_std[i],
        FlowMean: t.flow_mean[i],
        Transients: t.transients[i],
        PressureZone: zoneOf.get(t.asset_id) ?? '',
      }),
    );
  }
}
const assetLines = bundle.assets.map((a) =>
  JSON.stringify({
    AssetId: a.asset_id, Street: a.street, Neighborhood: a.neighborhood, Material: a.material,
    DiameterIn: a.diameter_in, InstallYear: a.install_year, LengthFt: a.length_ft,
    PressureZone: a.pressure_zone, Criticality: a.criticality, HasSensor: a.has_sensor,
    Lat: a.centroid.lat, Lng: a.centroid.lng,
  }),
);
const failureLines = bundle.failures.map((f) =>
  JSON.stringify({
    EventId: f.event_id, AssetId: f.asset_id, Date: f.date, Severity: f.severity,
    WaterLostGal: f.water_lost_gal, CustomersAffected: f.customers_affected,
  }),
);

const files: [string, string[]][] = [
  ['telemetry.ndjson', telemetryLines],
  ['assets.ndjson', assetLines],
  ['failures.ndjson', failureLines],
];
for (const [name, lines] of files) {
  writeFileSync(join(STAGE, name), lines.join('\n'));
  console.log(`  ${name.padEnd(20)} ${lines.length.toLocaleString().padStart(9)} rows`);
}

// --- upload -----------------------------------------------------------------
console.log('\nuploading to blob storage...');
const conn = az(['storage', 'account', 'show-connection-string', '-n', STORAGE, '-g', RG, '--query', 'connectionString', '-o', 'tsv']);
try {
  az(['storage', 'container', 'create', '-n', CONTAINER, '--connection-string', conn]);
} catch {
  // already exists
}
for (const [name] of files) {
  az(['storage', 'blob', 'upload', '--connection-string', conn, '-c', CONTAINER, '-n', name,
      '-f', join(STAGE, name), '--overwrite', 'true']);
  console.log(`  uploaded ${name}`);
}

// A short-lived read SAS so ADX can pull the blobs itself.
const expiry = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 16) + 'Z';
const sas = az(['storage', 'container', 'generate-sas', '--connection-string', conn, '-n', CONTAINER,
                '--permissions', 'rl', '--expiry', expiry, '-o', 'tsv']);

// --- schema -----------------------------------------------------------------
console.log('\ncreating tables and mappings...');
const schema = [
  `.create-merge table Telemetry (AssetId:string, Date:datetime, PressureMean:real, PressureStd:real, FlowMean:real, Transients:int, PressureZone:string)`,
  `.create-merge table Assets (AssetId:string, Street:string, Neighborhood:string, Material:string, DiameterIn:int, InstallYear:int, LengthFt:int, PressureZone:string, Criticality:real, HasSensor:bool, Lat:real, Lng:real)`,
  `.create-merge table Failures (EventId:string, AssetId:string, Date:datetime, Severity:string, WaterLostGal:long, CustomersAffected:long)`,
  `.create-or-alter table Telemetry ingestion json mapping 'TelemetryMap' '[{"column":"AssetId","path":"$.AssetId"},{"column":"Date","path":"$.Date"},{"column":"PressureMean","path":"$.PressureMean"},{"column":"PressureStd","path":"$.PressureStd"},{"column":"FlowMean","path":"$.FlowMean"},{"column":"Transients","path":"$.Transients"},{"column":"PressureZone","path":"$.PressureZone"}]'`,
  `.create-or-alter table Assets ingestion json mapping 'AssetsMap' '[{"column":"AssetId","path":"$.AssetId"},{"column":"Street","path":"$.Street"},{"column":"Neighborhood","path":"$.Neighborhood"},{"column":"Material","path":"$.Material"},{"column":"DiameterIn","path":"$.DiameterIn"},{"column":"InstallYear","path":"$.InstallYear"},{"column":"LengthFt","path":"$.LengthFt"},{"column":"PressureZone","path":"$.PressureZone"},{"column":"Criticality","path":"$.Criticality"},{"column":"HasSensor","path":"$.HasSensor"},{"column":"Lat","path":"$.Lat"},{"column":"Lng","path":"$.Lng"}]'`,
  `.create-or-alter table Failures ingestion json mapping 'FailuresMap' '[{"column":"EventId","path":"$.EventId"},{"column":"AssetId","path":"$.AssetId"},{"column":"Date","path":"$.Date"},{"column":"Severity","path":"$.Severity"},{"column":"WaterLostGal","path":"$.WaterLostGal"},{"column":"CustomersAffected","path":"$.CustomersAffected"}]'`,
];
for (const cmd of schema) await kusto('mgmt', cmd);
console.log('  schema ready');

// --- ingest -----------------------------------------------------------------
console.log('\ningesting from blob...');
const account = `https://${STORAGE}.blob.core.windows.net`;
for (const [table, file, mapping] of [
  ['Telemetry', 'telemetry.ndjson', 'TelemetryMap'],
  ['Assets', 'assets.ndjson', 'AssetsMap'],
  ['Failures', 'failures.ndjson', 'FailuresMap'],
] as const) {
  await kusto('mgmt', `.clear table ${table} data`);
  await kusto(
    'mgmt',
    `.ingest into table ${table} ('${account}/${CONTAINER}/${file}?${sas}') with (format='multijson', ingestionMappingReference='${mapping}')`,
  );
  console.log(`  ingested ${table}`);
}

// --- verify with real KQL ---------------------------------------------------
console.log('\n--- KQL: rows landed ---');
for (const t of ['Telemetry', 'Assets', 'Failures']) {
  const r = rows(await kusto('query', `${t} | count`));
  console.log(`  ${t.padEnd(11)} ${Number(r[0][0]).toLocaleString()}`);
}

console.log('\n--- KQL: pressure variance rising fastest, last 21d vs prior 120d ---');
const analytic = `
let recent = Telemetry
  | where Date > ago(21d)
  | summarize RecentStd = avg(PressureStd) by AssetId;
let baseline = Telemetry
  | where Date between (ago(240d) .. ago(120d))
  | summarize BaseStd = avg(PressureStd) by AssetId;
recent
| join kind=inner baseline on AssetId
| extend Lift = RecentStd / BaseStd
| join kind=inner (Assets | project AssetId, Street, Neighborhood, Material, InstallYear) on AssetId
// Ranked rather than thresholded. A fixed cutoff bakes in an assumption about
// how much divergence exists on any given day -- on this date the network's
// maximum lift is about 1.18, so a 1.2 filter would silently return nothing and
// read as "all clear". Ranking always answers the question actually being asked:
// which segments are diverging most from their zone right now.
| project AssetId, Street, Neighborhood, Material, InstallYear, Lift = round(Lift, 3)
| top 8 by Lift desc`;
for (const r of rows(await kusto('query', analytic))) {
  console.log(`  ${String(r[0]).padEnd(9)} ${String(r[5]).padStart(6)}x  ${String(r[4])} ${String(r[3]).padEnd(16)} ${r[1]}, ${r[2]}`);
}

console.log('\nAzure Data Explorer loaded.');
