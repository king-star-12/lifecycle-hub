import type {
  Asset,
  Complaint,
  FailureArchetype,
  FailureEvent,
  PipeMaterial,
  PressureZone,
  RepairRecord,
  TelemetrySeries,
  WeatherDay,
} from '../types.ts';
import { clamp, round, type Rng } from './rng.ts';
import { destination } from './geo.ts';

/**
 * The degradation and observation model.
 *
 * The single most important property of this file: every asset carries a
 * latent condition C(t) that the risk engine never sees. Failures are drawn
 * from a hazard function of C, and telemetry is a *noisy, partial observation*
 * of C. Nothing downstream is allowed to read the latent array except the
 * backtest, and then only to score predictions after the fact.
 *
 * Without that separation a backtest is circular: the model would be scored on
 * recovering a signal it was handed. With it, the engine has to do the real
 * job -- infer a hidden state from weak, incomplete, correlated evidence.
 */

/** Relative degradation rate by material. Cast iron is the reference. */
const MATERIAL_RATE: Record<PipeMaterial, number> = {
  cast_iron: 1.0,
  asbestos_cement: 0.95,
  steel: 0.8,
  ductile_iron: 0.5,
  pvc: 0.26,
  hdpe: 0.18,
};

/** How much each material minds freeze-thaw. Brittle pipe minds a lot. */
const FROST_SENSITIVITY: Record<PipeMaterial, number> = {
  cast_iron: 1.0,
  asbestos_cement: 0.92,
  steel: 0.55,
  ductile_iron: 0.4,
  pvc: 0.62,
  hdpe: 0.18,
};

/** Corrosion in saturated soil. Metallic pipe minds; plastic does not. */
const CORROSION_SENSITIVITY: Record<PipeMaterial, number> = {
  cast_iron: 1.0,
  steel: 0.88,
  ductile_iron: 0.52,
  asbestos_cement: 0.3,
  pvc: 0.02,
  hdpe: 0.02,
};

export type ZoneDay = {
  /** Multiplier on nominal pressure from demand and pump scheduling. */
  pressure_factor: number;
  /** Zone-wide transient intensity: pump starts, valve operations, hydrant use. */
  transient_intensity: number;
  /** Demand multiplier. */
  demand_factor: number;
};

/**
 * Zone-wide operating conditions. These move every asset in a zone together,
 * which is exactly the confounder the risk engine has to defeat: a system-wide
 * pressure event is not evidence about any single pipe.
 */
export function simulateZones(
  rng: Rng,
  zones: PressureZone[],
  weather: WeatherDay[],
): Record<string, ZoneDay[]> {
  const out: Record<string, ZoneDay[]> = {};

  for (const zone of zones) {
    const zoneRng = rng.fork(`zone/${zone.zone_id}`);
    const series: ZoneDay[] = [];
    let pressureAnomaly = 0;

    for (let i = 0; i < weather.length; i++) {
      const day = weather[i];
      const meanTemp = (day.temp_min_c + day.temp_max_c) / 2;

      // Summer irrigation demand, winter is flatter.
      const seasonalDemand = 1 + 0.16 * clamp((meanTemp - 12) / 14, -0.6, 1);

      // Persistent operational anomaly: a pump running off its normal curve
      // for a week reads as a pressure shift across the whole zone.
      pressureAnomaly = 0.9 * pressureAnomaly + zoneRng.normal(0, 0.006);

      // Scheduled and unscheduled zone events.
      const pumpEvent = zoneRng.chance(0.035);
      const hydrantFlushing = meanTemp > 5 && zoneRng.chance(0.02);

      series.push({
        pressure_factor: clamp(
          1 + pressureAnomaly - 0.02 * (seasonalDemand - 1) + (pumpEvent ? zoneRng.range(-0.09, 0.09) : 0),
          0.82,
          1.18,
        ),
        transient_intensity: clamp(
          0.6 + (pumpEvent ? zoneRng.range(1.5, 4) : 0) + (hydrantFlushing ? zoneRng.range(1, 2.5) : 0) + zoneRng.normal(0, 0.25),
          0,
          8,
        ),
        demand_factor: clamp(seasonalDemand + zoneRng.normal(0, 0.045), 0.7, 1.5),
      });
    }
    out[zone.zone_id] = series;
  }

  return out;
}

/** Which physical mechanism dominates this asset's life. Ground truth. */
function assignArchetype(asset: Asset, rng: Rng): FailureArchetype {
  const metallic =
    asset.material === 'cast_iron' || asset.material === 'steel' || asset.material === 'ductile_iron';
  const weights: [FailureArchetype, number][] = [
    ['corrosion', metallic ? 34 : 4],
    ['freeze_thaw', asset.diameter_in <= 8 ? 26 : 9],
    ['pressure_transient', asset.road_class === 'arterial' && asset.diameter_in >= 16 ? 24 : 7],
    ['soil_movement', asset.material === 'asbestos_cement' || asset.material === 'pvc' ? 24 : 11],
    ['aging_repeat_repair', asset.install_year < 1945 ? 22 : 6],
  ];
  return rng.weighted(weights);
}

export type PhysicsResult = {
  telemetry: TelemetrySeries[];
  failures: FailureEvent[];
  repairs: RepairRecord[];
  complaints: Complaint[];
  /** asset_id -> latent condition per day. Ground truth. Backtest only. */
  latent: Record<string, number[]>;
  /** asset_id -> dominant mechanism. Ground truth. */
  archetypes: Record<string, FailureArchetype>;
  zoneSeries: Record<string, ZoneDay[]>;
};

export function simulatePhysics(
  rng: Rng,
  assets: Asset[],
  zones: PressureZone[],
  neighbors: Record<string, string[]>,
  weather: WeatherDay[],
  opts: { targetFailures: number },
): PhysicsResult {
  const days = weather.length;
  const zoneSeries = simulateZones(rng.fork('zones'), zones, weather);
  const zoneById = new Map(zones.map((z) => [z.zone_id, z]));
  const assetById = new Map(assets.map((a) => [a.asset_id, a]));

  // Seven-day soil moisture swing: shrink-swell is about *change*, not level.
  const soilSwing: number[] = [];
  for (let i = 0; i < days; i++) {
    const back = Math.max(0, i - 7);
    soilSwing.push(Math.abs(weather[i].soil_moisture - weather[back].soil_moisture));
  }

  const telemetry: TelemetrySeries[] = [];
  const failures: FailureEvent[] = [];
  const repairs: RepairRecord[] = [];
  const complaints: Complaint[] = [];
  const latent: Record<string, number[]> = {};
  const archetypes: Record<string, FailureArchetype> = {};

  // Breaks in one street weaken their neighbours (excavation, surge, bedding
  // disturbance). Recorded as a shared field so clusters emerge naturally
  // rather than being painted on afterwards.
  const neighborStress: Record<string, Float32Array> = {};
  for (const a of assets) neighborStress[a.asset_id] = new Float32Array(days);

  const startDate = weather[0].date;
  let failureSeq = 1;
  let repairSeq = 1;
  let complaintSeq = 1;

  // Calibrate the hazard scale so the network breaks at a realistic rate:
  // US utilities see roughly 25 breaks per 100 miles of main per year.
  const totalMiles = assets.reduce((s, a) => s + a.length_ft, 0) / 5280;
  const expectedFailures = opts.targetFailures;
  let hazardScale = 1;

  const runPass = (scale: number, record: boolean): number => {
    let count = 0;
    if (record) {
      for (const a of assets) neighborStress[a.asset_id].fill(0);
    }

    for (const asset of assets) {
      // Same stream in both passes: the probe has to measure the world it is
      // calibrating, otherwise the scale factor is fitted to a different draw.
      const assetRng = rng.fork(`asset/${asset.asset_id}`);
      const archetype = assignArchetype(asset, assetRng);
      if (record) archetypes[asset.asset_id] = archetype;

      const zone = zoneById.get(asset.pressure_zone)!;
      const zoneDays = zoneSeries[asset.pressure_zone];

      // --- initial condition -------------------------------------------------
      const ageAtStart = 2022 - asset.install_year;
      const rate = MATERIAL_RATE[asset.material];
      // Condition accumulated before the simulation window opens, with real
      // variance: two 1920s cast iron mains are not in the same state.
      // Most of the network must start *below* the runaway threshold, with
      // only an unlucky tail near it. If age alone put every old main into the
      // danger zone, assets would fail from their opening draw and the
      // simulation would carry no temporal information at all.
      // Segment-specific vulnerability: bedding quality, backfill, weld and
      // joint workmanship, and how aggressive the soil is in this particular
      // trench. Log-normal, so a minority of segments in *any* material are
      // substantially worse than their material average. This is why utilities
      // see 1970s ductile iron and asbestos cement in their break logs and not
      // only Victorian cast iron -- material predicts risk, it does not
      // determine it.
      const vulnerability = Math.exp(assetRng.normal(0, 0.55));

      // Invariant: every asset starts BELOW the runaway threshold (0.68).
      //
      // This is what guarantees the dataset is honestly scoreable. If an asset
      // could open the window already committed to failure, its break would
      // carry no precursor inside the observed period and the backtest would be
      // grading the engine on information that was never present. Starting
      // everyone below the threshold means every failure in the window has a
      // real ramp -- detectable in principle, though not always in practice,
      // since 38% of the network has no sensor and the channel is noisy.
      //
      // Vulnerability enters mainly through the *rate*: it decides who climbs
      // fastest, not who starts closest.
      let condition = clamp(
        (ageAtStart / 118) * rate ** 0.75 * Math.sqrt(vulnerability) * assetRng.range(0.35, 1.0) * 0.75 +
          assetRng.normal(0, 0.04),
        0.02,
        0.62,
      );

      let repairCount = 0;
      const conditionSeries = new Array<number>(days);

      const pressureMean: number[] = [];
      const pressureStd: number[] = [];
      const flowMean: number[] = [];
      const transients: number[] = [];

      // Baselines for this segment.
      const nominal = zone.nominal_psi;
      const elevationOffset = assetRng.normal(0, 4.2);
      const baseFlow = (asset.diameter_in ** 2) * 0.42 * assetRng.range(0.75, 1.3);
      const sensorNoise = assetRng.range(0.8, 1.5);

      for (let i = 0; i < days; i++) {
        const day = weather[i];
        const zd = zoneDays[i];

        // --- degradation ---------------------------------------------------
        const frostStress =
          (day.freeze_thaw ? 1 : 0) * FROST_SENSITIVITY[asset.material] * 1.9 +
          clamp(day.frost_index / 60, 0, 1) * FROST_SENSITIVITY[asset.material] * 0.9;

        const corrosionStress =
          day.soil_moisture * CORROSION_SENSITIVITY[asset.material] * 1.15;

        const groundStress = soilSwing[i] * 9.5;
        const trafficStress =
          asset.road_class === 'arterial' ? 0.42 : asset.road_class === 'collector' ? 0.2 : 0.06;
        const surgeStress = clamp(zd.transient_intensity / 8, 0, 1) * 0.55;

        // The archetype decides which stressor actually drives this asset --
        // this is what gives each failure a distinguishable signature.
        const emphasis =
          archetype === 'corrosion' ? corrosionStress * 1.9
          : archetype === 'freeze_thaw' ? frostStress * 1.5
          : archetype === 'pressure_transient' ? surgeStress * 3.4
          : archetype === 'soil_movement' ? groundStress * 2.1
          : 0.5;

        const repairPenalty = 1 + 0.24 * repairCount;
        const neighborPenalty = 1 + neighborStress[asset.asset_id][i];

        // Deterioration is not linear, and this term is the reason the product
        // exists. Past a threshold, damage becomes self-reinforcing: corrosion
        // pitting concentrates stress, a weeping joint erodes its own bedding,
        // loss of support raises bending stress, which opens the defect
        // further. A pipe entering this regime is on a materially different
        // trajectory from one that is merely old -- and that divergence is
        // what a monitoring system can actually catch in time.
        const runaway = 1 + 260 * Math.max(0, condition - 0.68) ** 1.5;

        const daily =
          scale *
          2.35e-5 *
          rate *
          vulnerability *
          repairPenalty *
          neighborPenalty *
          runaway *
          (0.55 + frostStress + corrosionStress + groundStress + trafficStress + surgeStress + emphasis);

        // Never allowed to reach exactly 1: a saturated state has no gradient
        // left, and an asset with no gradient emits no precursor.
        condition = clamp(condition + daily, 0, 0.995);
        conditionSeries[i] = condition;

        // --- hazard ---------------------------------------------------------
        // Exponential in condition: a pipe at 0.9 is not 1.5x a pipe at 0.6,
        // it is an order of magnitude worse.
        // Acute triggers. Frost dominates: utilities in freeze-thaw climates
        // see winter break rates several times their summer baseline, and a
        // model that misses that seasonality is not describing this problem.
        const acute =
          1 +
          (day.freeze_thaw ? 3.5 * FROST_SENSITIVITY[asset.material] : 0) +
          clamp(day.frost_index / 40, 0, 1.6) * 1.8 * FROST_SENSITIVITY[asset.material] +
          (day.precip_mm > 22 ? 0.9 : 0) +
          clamp(zd.transient_intensity - 2.5, 0, 6) * 0.34;

        const hazard = 0.09 * Math.exp(20 * (condition - 1)) * acute * (asset.length_ft / 340);

        const failedToday = assetRng.next() < hazard;

        // --- observation model ----------------------------------------------
        if (record) {
          if (asset.has_sensor) {
            // Leakage grows as the pipe deteriorates: small head loss, and a
            // flow component that only becomes visible late.
            const leak = condition > 0.55 ? (condition - 0.55) ** 1.6 * 6.8 : 0;

            const p =
              nominal * zd.pressure_factor +
              elevationOffset -
              leak * 2.1 -
              (zd.demand_factor - 1) * 6.5 +
              assetRng.normal(0, 0.55 * sensorNoise);

            // The precursor channel. Variance grows superlinearly with
            // condition, so it is genuinely weak until the pipe is well
            // deteriorated -- which is what makes early detection hard and
            // makes convergence with other evidence necessary.
            const sd =
              (1.35 + 0.55 * zd.transient_intensity) * sensorNoise * (1 + 5.0 * condition ** 3.2) +
              Math.abs(assetRng.normal(0, 0.22));

            pressureMean.push(round(p, 2));
            pressureStd.push(round(sd, 2));
            flowMean.push(round(baseFlow * zd.demand_factor + leak * 6.2 + assetRng.normal(0, baseFlow * 0.035), 2));
            transients.push(
              Math.max(0, Math.round(zd.transient_intensity * 0.8 + condition ** 2 * 3.4 + assetRng.normal(0, 0.7))),
            );
          }

          // --- customer complaints ---------------------------------------------
          // Geolocated to an address near the segment, never to the pipe
          // itself: associating them is the engine's job, not the data's.
          const complaintRate =
            0.00035 * (1 + 9 * condition ** 3) * (asset.population_served / 400);
          if (assetRng.next() < complaintRate) {
            const at = destination(asset.centroid, assetRng.range(0, 360), assetRng.range(10, 120));
            const category = assetRng.weighted<Complaint['category']>([
              ['discoloration', condition > 0.7 ? 30 : 16],
              ['low_pressure', condition > 0.7 ? 26 : 12],
              ['noise', 10],
              ['street_water', condition > 0.8 ? 18 : 3],
              ['no_water', 4],
            ]);
            complaints.push({
              complaint_id: `CMP-${complaintSeq++}`,
              date: day.date,
              location: at,
              category,
              notes: COMPLAINT_NOTES[category],
            });
          }
        }

        // --- failure ---------------------------------------------------------
        if (failedToday) {
          count++;
          if (record) {
            const severity =
              condition > 0.88 && asset.diameter_in >= 16 ? 'major'
              : condition > 0.75 ? 'moderate' : 'minor';
            const outageDays = severity === 'major' ? assetRng.int(2, 5) : assetRng.int(1, 2);
            const repairDate = weather[Math.min(days - 1, i + outageDays)].date;

            failures.push({
              event_id: `BRK-${failureSeq++}`,
              asset_id: asset.asset_id,
              date: day.date,
              archetype,
              severity,
              water_lost_gal: Math.round(
                (severity === 'major' ? 480_000 : severity === 'moderate' ? 120_000 : 28_000) *
                  assetRng.range(0.6, 1.6),
              ),
              customers_affected: Math.round(asset.population_served * assetRng.range(0.3, 1.1)),
              repair_completed_date: repairDate,
            });

            const repairType =
              severity === 'major' ? 'full_replacement' : severity === 'moderate' ? 'spot_replacement' : 'clamp';
            repairs.push({
              repair_id: `RPR-${repairSeq++}`,
              asset_id: asset.asset_id,
              date: repairDate,
              type: repairType,
              crew_notes: crewNote(archetype, severity, assetRng),
              cost_usd: Math.round(
                (repairType === 'full_replacement' ? 118_000 : repairType === 'spot_replacement' ? 34_000 : 9_500) *
                  assetRng.range(0.7, 1.5),
              ),
            });

            // Excavation and surge disturb the neighbourhood for months.
            for (const nid of neighbors[asset.asset_id] ?? []) {
              const stress = neighborStress[nid];
              if (!stress) continue;
              for (let k = i; k < Math.min(days, i + 180); k++) {
                stress[k] += 0.5 * (1 - (k - i) / 180);
              }
            }
          }

          // Repair returns the segment to serviceable, not to new.
          condition = clamp(condition * 0.34 + assetRng.range(0.06, 0.16), 0.05, 0.6);
          repairCount++;
        }
      }

      if (record) {
        latent[asset.asset_id] = conditionSeries.map((c) => round(c, 4));
        telemetry.push({
          asset_id: asset.asset_id,
          start_date: startDate,
          days,
          pressure_mean: pressureMean,
          pressure_std: pressureStd,
          flow_mean: flowMean,
          transients,
        });
      }
    }

    return count;
  };

  // Calibrate the hazard scale to hit a realistic break rate.
  //
  // A single probe pass is not enough, because the break count feeds back on
  // itself: every break triggers a repair that resets condition, so *fewer*
  // breaks leaves the network in worse condition and pushes the count back up.
  // The response to `scale` is therefore strongly sublinear. Damped fixed-point
  // iteration converges in a handful of cheap unrecorded passes.
  for (let attempt = 0; attempt < 14; attempt++) {
    const count = runPass(hazardScale, false);
    if (count > 0 && Math.abs(count - expectedFailures) / expectedFailures < 0.06) break;
    const ratio = count > 0 ? expectedFailures / count : 4;
    // Damp in log space; the exponential hazard makes raw ratios overshoot.
    hazardScale = clamp(hazardScale * Math.exp(Math.log(ratio) * 0.85), 1e-3, 1e3);
  }
  const finalCount = runPass(hazardScale, true);

  void totalMiles;
  void finalCount;
  void assetById;

  failures.sort((a, b) => a.date.localeCompare(b.date));
  repairs.sort((a, b) => a.date.localeCompare(b.date));
  complaints.sort((a, b) => a.date.localeCompare(b.date));

  return { telemetry, failures, repairs, complaints, latent, archetypes, zoneSeries };
}

const COMPLAINT_NOTES: Record<Complaint['category'], string> = {
  low_pressure: 'Resident reports weak flow at fixtures, worse in the morning.',
  discoloration: 'Brown/rusty water reported at kitchen tap, clears after several minutes.',
  noise: 'Persistent hissing or knocking heard near the curb stop.',
  street_water: 'Standing water in the roadway with no recent rainfall.',
  no_water: 'Complete loss of service reported at the address.',
};

function crewNote(archetype: FailureArchetype, severity: string, rng: Rng): string {
  const base: Record<FailureArchetype, string[]> = {
    corrosion: [
      'Circumferential break with heavy graphitization on the pipe wall; wall thickness substantially reduced.',
      'External corrosion pitting observed around the break; soil is wet and corrosive at this depth.',
    ],
    freeze_thaw: [
      'Longitudinal split consistent with frost loading; frost depth measured at 30 in.',
      'Beam-break pattern observed; ground frozen above the crown at time of excavation.',
    ],
    pressure_transient: [
      'Blowout at the joint following a reported surge event; gasket displaced.',
      'Bell split near the joint; surge suspected after pump start upstream.',
    ],
    soil_movement: [
      'Shear break with visible bedding voids beneath the barrel; poor support in this run.',
      'Pipe out of alignment at the break; bedding washed out.',
    ],
    aging_repeat_repair: [
      'Third repair on this segment in six years; recommend replacement rather than further clamps.',
      'Break located 20 ft from a prior clamp repair; segment is at end of service life.',
    ],
  };
  const note = rng.pick(base[archetype]);
  return severity === 'major' ? `${note} Full segment replacement required.` : note;
}
