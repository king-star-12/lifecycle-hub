import type { LatLng } from '../types.ts';

const EARTH_R_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(h));
}

/** Point at `distanceM` metres along `bearingDeg` from `origin`. */
export function destination(origin: LatLng, bearingDeg: number, distM: number): LatLng {
  const d = distM / EARTH_R_M;
  const brg = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/**
 * Spatial index over segment centroids. The risk engine asks "what else is
 * near this pipe" on every scored asset, so a linear scan is not acceptable.
 */
export type GridIndex = {
  within(point: LatLng, radiusM: number): string[];
};

export function buildGridIndex(points: { id: string; at: LatLng }[]): GridIndex {
  // ~500 m cells at Pittsburgh's latitude.
  const CELL_DEG = 0.005;
  const cells = new Map<string, { id: string; at: LatLng }[]>();
  const key = (lat: number, lng: number) =>
    `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;

  for (const p of points) {
    const k = key(p.at.lat, p.at.lng);
    const bucket = cells.get(k);
    if (bucket) bucket.push(p);
    else cells.set(k, [p]);
  }

  return {
    within(point, radiusM) {
      const span = Math.ceil(radiusM / 111_320 / CELL_DEG) + 1;
      const baseLat = Math.floor(point.lat / CELL_DEG);
      const baseLng = Math.floor(point.lng / CELL_DEG);
      const hits: string[] = [];
      for (let dy = -span; dy <= span; dy++) {
        for (let dx = -span; dx <= span; dx++) {
          const bucket = cells.get(`${baseLat + dy}:${baseLng + dx}`);
          if (!bucket) continue;
          for (const p of bucket) {
            if (distanceM(point, p.at) <= radiusM) hits.push(p.id);
          }
        }
      }
      return hits;
    },
  };
}
