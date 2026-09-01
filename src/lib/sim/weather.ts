import type { WeatherDay } from '../types.ts';
import { clamp, round, type Rng } from './rng.ts';

/**
 * Pittsburgh climatology, roughly calibrated to NOAA normals:
 * January mean about -2 C, July mean about 23 C, ~965 mm precipitation a year,
 * and a winter freeze-thaw season that drives the real break season.
 *
 * The anomaly term is AR(1) on purpose. Independent daily noise would produce
 * a world with no cold snaps and no wet weeks, and the whole premise of this
 * product is that failures follow sustained environmental stress, not single days.
 */

const ANNUAL_MEAN_C = 10.9;
const ANNUAL_AMPLITUDE_C = 12.6;
/** Day of year of the coldest day. */
const COLDEST_DOY = 17;

export function generateWeather(rng: Rng, startDate: string, days: number): WeatherDay[] {
  const out: WeatherDay[] = [];
  const start = new Date(`${startDate}T00:00:00Z`);

  let tempAnomaly = 0;
  let soilMoisture = 0.45;
  let frostIndex = 0;

  for (let i = 0; i < days; i++) {
    const date = new Date(start.getTime() + i * 86_400_000);
    const doy = Math.floor(
      (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000,
    );

    // Seasonal baseline.
    const seasonal =
      ANNUAL_MEAN_C -
      ANNUAL_AMPLITUDE_C * Math.cos((2 * Math.PI * (doy - COLDEST_DOY)) / 365.25);

    // Persistent synoptic anomaly: cold snaps and warm spells last days.
    tempAnomaly = 0.78 * tempAnomaly + rng.normal(0, 3.1);
    const mean = seasonal + tempAnomaly;

    // Diurnal range is wider in clear, dry, cold air.
    const diurnal = clamp(rng.normal(10.4, 2.2) - 3.2 * soilMoisture, 3.5, 17);
    const tempMin = mean - diurnal / 2;
    const tempMax = mean + diurnal / 2;

    // Wet-day probability rises modestly in spring/summer convection season.
    const wetProb = 0.33 + 0.07 * Math.sin((2 * Math.PI * (doy - 100)) / 365.25);
    const precip = rng.chance(wetProb) ? -Math.log(1 - rng.next()) * 7.6 : 0;

    // Soil moisture: leaky bucket. Infiltration in (damped as the soil
    // saturates), drainage and evapotranspiration out. ET scales with
    // temperature, which is what produces wet springs and dry late summers --
    // and the summer shrink-swell that cracks pipe bedding.
    const et = clamp(0.004 + 0.0012 * Math.max(mean, 0), 0, 0.035);
    const infiltration = (precip / 40) * (1 - soilMoisture);
    soilMoisture = clamp(soilMoisture + infiltration - 0.03 * soilMoisture - et, 0.05, 1);

    // Frost index: accumulates freezing degree-days, drains during thaw.
    frostIndex =
      mean < 0
        ? frostIndex + Math.min(-mean, 18) * 0.9
        : Math.max(0, frostIndex - Math.max(mean, 0) * 1.6);

    out.push({
      date: date.toISOString().slice(0, 10),
      temp_min_c: round(tempMin, 1),
      temp_max_c: round(tempMax, 1),
      precip_mm: round(precip, 1),
      soil_moisture: round(soilMoisture, 3),
      freeze_thaw: tempMin < -1.5 && tempMax > 1.5,
      frost_index: round(frostIndex, 1),
    });
  }

  return out;
}
