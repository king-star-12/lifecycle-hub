import 'server-only';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Disk cache for every outbound third-party call.
 *
 * External quota is finite and a demo re-runs the same handful of queries
 * dozens of times. Caching keeps a rehearsal from costing anything, keeps the
 * demo fast, and -- more importantly -- keeps it deterministic: the evidence
 * shown on stage is the evidence that was retrieved and reviewed, not whatever
 * the live web happens to return at that moment.
 *
 * Every entry records when it was fetched, because evidence without a
 * retrieval time is not auditable.
 */

const DIR = join(process.cwd(), '.cache');

export type Cached<T> = { fetched_at: string; ttl_days: number; value: T };

function pathFor(namespace: string, key: string): string {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
  const dir = join(DIR, namespace);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${hash}.json`);
}

export function readCache<T>(namespace: string, key: string): Cached<T> | null {
  const p = pathFor(namespace, key);
  if (!existsSync(p)) return null;
  try {
    const entry = JSON.parse(readFileSync(p, 'utf8')) as Cached<T>;
    const ageDays = (Date.now() - Date.parse(entry.fetched_at)) / 86_400_000;
    if (ageDays > entry.ttl_days) return null;
    return entry;
  } catch {
    return null;
  }
}

export function writeCache<T>(namespace: string, key: string, value: T, ttlDays: number): Cached<T> {
  const entry: Cached<T> = { fetched_at: new Date().toISOString(), ttl_days: ttlDays, value };
  writeFileSync(pathFor(namespace, key), JSON.stringify(entry, null, 2));
  return entry;
}

/** Fetch through the cache. Returns the entry plus whether it was a live call. */
export async function cached<T>(
  namespace: string,
  key: string,
  ttlDays: number,
  fetcher: () => Promise<T>,
): Promise<{ entry: Cached<T>; live: boolean }> {
  const hit = readCache<T>(namespace, key);
  if (hit) return { entry: hit, live: false };
  const value = await fetcher();
  return { entry: writeCache(namespace, key, value, ttlDays), live: true };
}
