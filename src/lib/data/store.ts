import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NetworkBundle, TelemetrySeries } from '../types.ts';
import { buildContext, type RiskContext } from '../risk/engine.ts';

/**
 * Server-side dataset store.
 *
 * The telemetry file is ~31 MB and the risk context builds a spatial index over
 * every complaint. Both are loaded once per process and reused; neither ever
 * crosses to the browser. `server-only` makes that a build error rather than a
 * silent 31 MB payload.
 */

const DATA_DIR = join(process.cwd(), 'data', 'synthetic');

let cachedBundle: NetworkBundle | null = null;
let cachedTelemetry: TelemetrySeries[] | null = null;
let cachedContext: RiskContext | null = null;

export function getBundle(): NetworkBundle {
  cachedBundle ??= JSON.parse(readFileSync(join(DATA_DIR, 'network.json'), 'utf8'));
  return cachedBundle!;
}

export function getTelemetry(): TelemetrySeries[] {
  cachedTelemetry ??= JSON.parse(readFileSync(join(DATA_DIR, 'telemetry.json'), 'utf8'));
  return cachedTelemetry!;
}

export function getContext(): RiskContext {
  cachedContext ??= buildContext(getBundle(), getTelemetry());
  return cachedContext!;
}

/** Day index of the most recent day in the dataset. */
export function latestDay(): number {
  return getBundle().meta.days - 1;
}

export function dayIndexFor(date: string): number | undefined {
  return getContext().dayIndex.get(date);
}

export function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as T;
}
