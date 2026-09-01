/** One place to change the world. Every artefact records this config. */
export const SIM_CONFIG = {
  seed: 'clustral-v1',
  targetAssets: 1800,
  /** Four years of daily history ending at the demo date. */
  startDate: '2022-09-01',
  days: 1461,
  /** Tuned to ~26 breaks per 100 miles per year, the US utility norm. */
  targetFailures: 118,
} as const;
