/**
 * Deterministic PRNG. Every number in the synthetic network traces back to one
 * seed, so a demo, a backtest and a screenshot all describe the same world.
 */

export type Rng = {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** Standard normal, Box-Muller. */
  normal(mean?: number, sd?: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniform pick. */
  pick<T>(items: readonly T[]): T;
  /** Pick by relative weight. */
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  /** Child generator, so adding a stage never shifts an earlier stage's draws. */
  fork(label: string): Rng;
};

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: string): Rng {
  let state = hashSeed(seed);
  let spare: number | null = null;

  const next = (): number => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    normal(mean = 0, sd = 1) {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return mean + sd * value;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const scale = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * scale;
      return mean + sd * u * scale;
    },
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted(items) {
      const total = items.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [value, weight] of items) {
        roll -= weight;
        if (roll <= 0) return value;
      }
      return items[items.length - 1][0];
    },
    fork: (label) => createRng(`${seed}::${label}`),
  };

  return rng;
}

/** Clamp helper used throughout the simulator and risk engine. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Round for compact serialisation — telemetry does not need 15 digits. */
export function round(value: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
