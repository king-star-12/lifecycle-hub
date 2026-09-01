/**
 * Builds the synthetic network and writes it to data/synthetic/.
 *
 * Ground truth (latent condition, failure archetypes) is written to a separate
 * file that the application is never allowed to import. Only the backtest may
 * read it, and only to score predictions after the fact.
 *
 * Run: npm run generate
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRng } from '../src/lib/sim/rng.ts';
import { generateNetwork } from '../src/lib/sim/network.ts';
import { generateWeather } from '../src/lib/sim/weather.ts';
import { simulatePhysics } from '../src/lib/sim/physics.ts';
import { generateDocuments } from '../src/lib/sim/documents.ts';
import { SIM_CONFIG } from '../src/lib/sim/config.ts';
import { CITY } from '../src/lib/sim/city.ts';
import type { NetworkBundle } from '../src/lib/types.ts';

const OUT = join(import.meta.dirname, '..', 'data', 'synthetic');
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const rng = createRng(SIM_CONFIG.seed);

console.log('generating network...');
const net = generateNetwork(rng.fork('network'), SIM_CONFIG.targetAssets);

console.log('generating environment...');
const weather = generateWeather(rng.fork('weather'), SIM_CONFIG.startDate, SIM_CONFIG.days);

console.log('simulating degradation and failures (calibrating hazard)...');
const phys = simulatePhysics(rng.fork('physics'), net.assets, net.zones, net.neighbors, weather, {
  targetFailures: SIM_CONFIG.targetFailures,
});

console.log('generating inspection documents...');
const docs = generateDocuments(rng.fork('documents'), net.assets, weather, phys.latent, {
  inspectionCount: 420,
});

const endDate = weather[weather.length - 1].date;

const bundle: NetworkBundle = {
  meta: {
    seed: SIM_CONFIG.seed,
    generated_at: new Date().toISOString(),
    data_class: 'synthetic',
    city: CITY.name,
    utility: CITY.utility,
    start_date: SIM_CONFIG.startDate,
    end_date: endDate,
    days: SIM_CONFIG.days,
  },
  zones: net.zones,
  assets: net.assets,
  neighbors: net.neighbors,
  weather,
  failures: phys.failures,
  repairs: phys.repairs,
  complaints: phys.complaints,
  findings: docs.flatMap((d) => d.findings),
};

const write = (name: string, data: unknown) => {
  const path = join(OUT, name);
  writeFileSync(path, JSON.stringify(data));
  const mb = (Buffer.byteLength(JSON.stringify(data)) / 1e6).toFixed(1);
  console.log(`  ${name.padEnd(26)} ${mb.padStart(6)} MB`);
  return path;
};

console.log('\nwriting:');
write('network.json', bundle);
write('telemetry.json', phys.telemetry);
write('documents.json', docs.map(({ findings, ...d }) => d));
write('zone-series.json', phys.zoneSeries);

// Ground truth. Not importable by the application -- see data/synthetic/README.
write('_ground-truth.json', { latent: phys.latent, archetypes: phys.archetypes });

const miles = net.assets.reduce((s, a) => s + a.length_ft, 0) / 5280;
console.log(`
network      ${net.assets.length} segments, ${miles.toFixed(0)} miles, ${net.zones.length} pressure zones
history      ${SIM_CONFIG.startDate} to ${endDate} (${SIM_CONFIG.days} days)
failures     ${phys.failures.length} breaks (${((phys.failures.length / (SIM_CONFIG.days / 365.25) / miles) * 100).toFixed(1)} per 100 mi/yr)
repairs      ${phys.repairs.length}
complaints   ${phys.complaints.length}
documents    ${docs.length} inspection reports, ${bundle.findings.length} findings
sensors      ${net.assets.filter((a) => a.has_sensor).length} of ${net.assets.length} segments (${((net.assets.filter((a) => a.has_sensor).length / net.assets.length) * 100).toFixed(0)}%)
done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
