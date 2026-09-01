/**
 * Simulation validation.
 *
 * The synthetic network is the evidentiary basis for every number this product
 * shows a judge or an operator. If it drifts away from how real distribution
 * systems behave, every downstream metric becomes decoration. These checks run
 * against published utility statistics and fail loudly.
 *
 * Run: npm run validate
 */
import { createRng } from '../src/lib/sim/rng.ts';
import { generateNetwork } from '../src/lib/sim/network.ts';
import { generateWeather } from '../src/lib/sim/weather.ts';
import { simulatePhysics } from '../src/lib/sim/physics.ts';
import { SIM_CONFIG } from '../src/lib/sim/config.ts';

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

let failures = 0;
function check(name: string, value: number, lo: number, hi: number, unit = '') {
  const ok = value >= lo && value <= hi;
  if (!ok) failures++;
  const status = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(
    `  ${status}  ${name.padEnd(42)} ${value.toFixed(2).padStart(8)}${unit.padEnd(4)} expected ${lo}–${hi}${unit}`,
  );
}

const rng = createRng(SIM_CONFIG.seed);
const net = generateNetwork(rng.fork('network'), SIM_CONFIG.targetAssets);
const weather = generateWeather(rng.fork('weather'), SIM_CONFIG.startDate, SIM_CONFIG.days);
const phys = simulatePhysics(rng.fork('physics'), net.assets, net.zones, net.neighbors, weather, {
  targetFailures: SIM_CONFIG.targetFailures,
});

const years = SIM_CONFIG.days / 365.25;
const miles = net.assets.reduce((s, a) => s + a.length_ft, 0) / 5280;

console.log('\n\x1b[1mENVIRONMENT\x1b[0m  (vs NOAA Pittsburgh normals)');
const annualPrecip = weather.reduce((s, d) => s + d.precip_mm, 0) / years;
check('annual precipitation', annualPrecip, 850, 1080, 'mm');
check('freeze-thaw days per year', weather.filter((d) => d.freeze_thaw).length / years, 45, 80, 'd');
const julyT = weather.filter((d) => d.date.slice(5, 7) === '07').map((d) => (d.temp_min_c + d.temp_max_c) / 2);
const janT = weather.filter((d) => d.date.slice(5, 7) === '01').map((d) => (d.temp_min_c + d.temp_max_c) / 2);
check('July mean temperature', mean(julyT), 20, 26, 'C');
check('January mean temperature', mean(janT), -4, 2, 'C');
check('soil moisture, annual mean', mean(weather.map((d) => d.soil_moisture)), 0.3, 0.7, '');

console.log('\n\x1b[1mFAILURE REGIME\x1b[0m  (vs AWWA / utility benchmarks)');
check('break rate per 100 mi per year', (phys.failures.length / years / miles) * 100, 18, 34, '');
const byMonth: Record<string, number> = {};
for (const f of phys.failures) byMonth[f.date.slice(5, 7)] = (byMonth[f.date.slice(5, 7)] ?? 0) + 1;
const winter = ['12', '01', '02', '03'].reduce((s, m) => s + (byMonth[m] ?? 0), 0);
const summer = ['06', '07', '08', '09'].reduce((s, m) => s + (byMonth[m] ?? 0), 0);
check('winter:summer break ratio', winter / Math.max(summer, 1), 1.5, 4.0, 'x');
const assetById = new Map(net.assets.map((a) => [a.asset_id, a]));
const failedAge = phys.failures.map((f) => 2022 - assetById.get(f.asset_id)!.install_year);
const netAge = net.assets.map((a) => 2022 - a.install_year);
check('mean age of failed pipe', mean(failedAge), 70, 115, 'y');
check('  (network mean, for contrast)', mean(netAge), 0, 999, 'y');
const ciShare =
  phys.failures.filter((f) => assetById.get(f.asset_id)!.material === 'cast_iron').length /
  phys.failures.length;
check('cast iron share of breaks', ciShare * 100, 55, 92, '%');

console.log('\n\x1b[1mPRECURSOR DETECTABILITY\x1b[0m  (the product premise)');
const tel = new Map(phys.telemetry.map((t) => [t.asset_id, t]));
const dayIdx = new Map(weather.map((w, i) => [w.date, i]));
const lifts: number[] = [];
const rises: number[] = [];
for (const f of phys.failures) {
  const a = assetById.get(f.asset_id)!;
  if (!a.has_sensor) continue;
  const t = tel.get(f.asset_id)!;
  const i = dayIdx.get(f.date)!;
  if (i < 260) continue;
  lifts.push(mean(t.pressure_std.slice(i - 21, i)) / mean(t.pressure_std.slice(i - 240, i - 120)));
  const L = phys.latent[f.asset_id];
  rises.push(L[i] - L[i - 90]);
}
// Control: identical measurement on assets that never failed.
const failedIds = new Set(phys.failures.map((f) => f.asset_id));
const never = net.assets.filter((a) => a.has_sensor && !failedIds.has(a.asset_id));
const ctrlRng = createRng('validate/control');
const ctrl: number[] = [];
for (let k = 0; k < 600; k++) {
  const a = ctrlRng.pick(never);
  const t = tel.get(a.asset_id)!;
  const i = ctrlRng.int(300, SIM_CONFIG.days - 20);
  ctrl.push(mean(t.pressure_std.slice(i - 21, i)) / mean(t.pressure_std.slice(i - 240, i - 120)));
}
check('median pre-failure variance lift', median(lifts), 1.15, 2.0, 'x');
check('median control variance lift', median(ctrl), 0.95, 1.05, 'x');
check('failures showing lift >1.15x', (lifts.filter((x) => x > 1.15).length / lifts.length) * 100, 45, 90, '%');
check('controls showing lift >1.15x (FP floor)', (ctrl.filter((x) => x > 1.15).length / ctrl.length) * 100, 0, 10, '%');
// A perfectly detectable world would be a fantasy. Some failures must be
// genuinely invisible, or the backtest is measuring a rigged game.
check('failures with NO precursor (honest misses)', (lifts.filter((x) => x < 1.0).length / lifts.length) * 100, 2, 30, '%');
check('mean latent rise over 90d pre-failure', mean(rises), 0.03, 0.3, '');

console.log('\n\x1b[1mCOVERAGE\x1b[0m');
check('sensor coverage', (net.assets.filter((a) => a.has_sensor).length / net.assets.length) * 100, 45, 75, '%');
check('assets', net.assets.length, 1500, 2200, '');
check('mean neighbours within 500 m', mean(Object.values(net.neighbors).map((n) => n.length)), 12, 60, '');

console.log(
  failures === 0
    ? '\n\x1b[32m✓ simulation validated\x1b[0m\n'
    : `\n\x1b[31m✗ ${failures} check(s) failed\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
