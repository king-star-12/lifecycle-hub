import type { Asset, PipeMaterial, PressureZone } from '../types.ts';
import { clamp, round, type Rng } from './rng.ts';
import { destination, midpoint, distanceM, buildGridIndex } from './geo.ts';
import { CRITICAL_FACILITIES, NEIGHBORHOODS, PRESSURE_ZONES } from './city.ts';

/** What a utility actually put in the ground, by decade. */
function materialForEra(year: number, rng: Rng): PipeMaterial {
  if (year < 1930) return rng.weighted([['cast_iron', 92], ['steel', 8]]);
  if (year < 1960)
    return rng.weighted([['cast_iron', 70], ['steel', 14], ['asbestos_cement', 16]]);
  if (year < 1980)
    return rng.weighted([
      ['ductile_iron', 46],
      ['asbestos_cement', 30],
      ['cast_iron', 14],
      ['pvc', 10],
    ]);
  if (year < 2000)
    return rng.weighted([['ductile_iron', 52], ['pvc', 38], ['hdpe', 10]]);
  return rng.weighted([['pvc', 44], ['ductile_iron', 34], ['hdpe', 22]]);
}

function diameterFor(roadClass: Asset['road_class'], rng: Rng): number {
  if (roadClass === 'arterial')
    return rng.weighted([[12, 30], [16, 26], [24, 22], [36, 12], [8, 10]]);
  if (roadClass === 'collector') return rng.weighted([[8, 34], [12, 34], [16, 20], [6, 12]]);
  return rng.weighted([[6, 42], [8, 40], [12, 18]]);
}

export type NetworkResult = {
  assets: Asset[];
  zones: PressureZone[];
  neighbors: Record<string, string[]>;
};

export function generateNetwork(rng: Rng, targetAssets: number): NetworkResult {
  const assets: Asset[] = [];

  // Weight each street by road class so arterials carry more of the network.
  const streetSlots: { hood: (typeof NEIGHBORHOODS)[number]; street: (typeof NEIGHBORHOODS)[number]['streets'][number]; weight: number }[] = [];
  for (const hood of NEIGHBORHOODS) {
    for (const street of hood.streets) {
      const weight = street.road_class === 'arterial' ? 3 : street.road_class === 'collector' ? 2 : 1.3;
      streetSlots.push({ hood, street, weight });
    }
  }
  const totalWeight = streetSlots.reduce((s, x) => s + x.weight, 0);

  let seq = 1000;
  for (const slot of streetSlots) {
    const { hood, street } = slot;
    const total = Math.max(6, Math.round((slot.weight / totalWeight) * targetAssets));
    const streetRng = rng.fork(`${hood.name}/${street.name}`);

    // A named street is laid out as several shorter runs rather than one long
    // chain, and alternate runs are turned through 90 degrees to act as cross
    // streets. Real distribution networks are grids: a single straight
    // one-and-a-half-mile main is neither realistic nor a fair test of the
    // spatial reasoning, because it gives every segment the same neighbours.
    const runs = Math.max(2, Math.min(4, Math.round(total / 7)));
    const perRun = Math.max(3, Math.round(total / runs));

    for (let r = 0; r < runs; r++) {
      const cross = r % 2 === 1;
      const bearing = hood.bearing + (cross ? 90 : 0) + streetRng.range(-5, 5);

      // Spread runs across the neighbourhood rather than stacking them.
      // Wide enough that adjacent neighbourhood grids meet. A distribution
      // network is continuous; rendering it as detached islands would misstate
      // the spatial relationships the engine reasons over.
      const lateral = ((r - (runs - 1) / 2) / Math.max(1, runs)) * 2900 + streetRng.range(-260, 260);
      const along = streetRng.range(-1100, 1100);
      let cursor = destination(
        destination(hood.anchor, bearing + 90, lateral),
        bearing,
        along - (perRun * 320 * 0.3048) / 2,
      );

      // A street was not laid all at once: it carries an original era plus
      // later replacement runs, which is why real networks are patchworks.
      let year = streetRng.int(hood.era[0], hood.era[1]);

      for (let i = 0; i < perRun; i++) {
        const lengthFt = streetRng.range(160, 420);
        const end = destination(cursor, bearing + streetRng.range(-3, 3), lengthFt * 0.3048);

        if (streetRng.chance(0.14)) {
          year = streetRng.chance(0.55)
            ? streetRng.int(1975, 2019)
            : streetRng.int(hood.era[0], hood.era[1]);
        }

        const material = materialForEra(year, streetRng);
        const diameter = diameterFor(street.road_class, streetRng);
        const centroid = midpoint(cursor, end);

        const facilityPool = CRITICAL_FACILITIES[hood.name] ?? [];
        const facilities =
          street.road_class === 'arterial' && facilityPool.length && streetRng.chance(0.3)
            ? [streetRng.pick(facilityPool)]
            : [];

        const population = Math.round(
          (street.road_class === 'arterial' ? 1 : street.road_class === 'collector' ? 0.62 : 0.34) *
            (diameter / 8) *
            streetRng.range(180, 900),
        );

        // Consequence of failure, not probability of failure. Kept separate on
        // purpose: an operator prioritises on both, and conflating them is how
        // risk tools lose trust.
        const criticality = clamp(
          0.16 +
            0.3 * clamp(diameter / 36, 0, 1) +
            0.2 *
              (street.road_class === 'arterial' ? 1 : street.road_class === 'collector' ? 0.5 : 0.15) +
            0.22 * clamp(population / 900, 0, 1) +
            (facilities.length ? 0.2 : 0) +
            streetRng.normal(0, 0.04),
          0.05,
          0.99,
        );

        assets.push({
          asset_id: `WM-${seq++}`,
          street: street.name,
          neighborhood: hood.name,
          material,
          diameter_in: diameter,
          install_year: year,
          length_ft: round(lengthFt, 0),
          geometry: [cursor, end],
          centroid,
          pressure_zone: hood.zone,
          criticality: round(criticality, 3),
          population_served: population,
          critical_facilities: facilities,
          // Real utilities are nowhere near fully instrumented. Coverage skews
          // to large mains, which is exactly why confidence must be reported.
          has_sensor: streetRng.chance(
            street.road_class === 'arterial' ? 0.74 : street.road_class === 'collector' ? 0.5 : 0.28,
          ),
          road_class: street.road_class,
        });

        cursor = end;
      }
    }
  }

  // Precompute 500 m neighbourhoods once; the risk engine hits this constantly.
  const index = buildGridIndex(assets.map((a) => ({ id: a.asset_id, at: a.centroid })));
  const neighbors: Record<string, string[]> = {};
  for (const asset of assets) {
    neighbors[asset.asset_id] = index
      .within(asset.centroid, 500)
      .filter((id) => id !== asset.asset_id);
  }

  return { assets, zones: PRESSURE_ZONES.map((z) => ({ ...z })), neighbors };
}

/** Distance between two assets, metres. Exported for the risk engine. */
export function assetDistance(a: Asset, b: Asset): number {
  return distanceM(a.centroid, b.centroid);
}
