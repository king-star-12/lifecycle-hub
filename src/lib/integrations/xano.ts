// Server-side only. Imported by route handlers and by CLI scripts, so it cannot
// carry the `server-only` guard -- that package throws outside Next's bundler.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Xano client, authenticated from the credentials the Xano CLI stores after
 * `xano auth`. Nothing is pasted into an env file, and no secret is committed.
 *
 * Xano holds the application system of record: which asset was flagged, on
 * what evidence, what was recommended, who approved it, and when. It is
 * deliberately not where telemetry lives -- that would duplicate the analytics
 * layer and put a million rows a day through a backend that exists to serve an
 * operator's decisions.
 */

export type XanoConfig = { base: string; token: string; workspace: number };

export function xanoConfig(): XanoConfig | null {
  try {
    const creds = readFileSync(join(homedir(), '.xano', 'credentials.yaml'), 'utf8');
    const token = /access_token:\s*(\S+)/.exec(creds)?.[1];
    const instance = /instance_origin:\s*(\S+)/.exec(creds)?.[1];
    const workspace = Number(/workspace:\s*(\d+)/.exec(creds)?.[1] ?? 1);
    if (!token || !instance) return null;
    return { base: `${instance}/api:meta`, token, workspace };
  } catch {
    return null;
  }
}

export async function xano<T = unknown>(
  cfg: XanoConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${cfg.base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Xano ${init?.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/** Resolve table name -> id once, so callers work in names. */
export async function tableIds(cfg: XanoConfig): Promise<Map<string, number>> {
  const res = await xano<{ items: { id: number; name: string }[] }>(
    cfg,
    `/workspace/${cfg.workspace}/table`,
  );
  return new Map(res.items.map((t) => [t.name, t.id]));
}

export async function insert(
  cfg: XanoConfig,
  tableId: number,
  row: Record<string, unknown>,
): Promise<{ id: number }> {
  return xano(cfg, `/workspace/${cfg.workspace}/table/${tableId}/content`, {
    method: 'POST',
    body: JSON.stringify(row),
  });
}

/**
 * Insert with bounded concurrency and retry; the Metadata API is per-row.
 *
 * Rows are retried with backoff because the failures seen here are transient --
 * the API rate-limits under concurrency, and the same row inserts cleanly on a
 * second attempt. The earlier version swallowed those rejections entirely and
 * reported a short count, which is the worst possible behaviour for a system of
 * record: the sync looked like it worked and the audit trail was quietly
 * incomplete. Permanent failures are now returned to the caller so the sync can
 * say so out loud.
 */
export async function insertMany(
  cfg: XanoConfig,
  tableId: number,
  rows: Record<string, unknown>[],
  concurrency = 6,
): Promise<{ inserted: number; failed: { row: Record<string, unknown>; error: string }[] }> {
  let inserted = 0;
  let cursor = 0;
  const failed: { row: Record<string, unknown>; error: string }[] = [];

  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      let lastError = '';
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await insert(cfg, tableId, row);
          inserted++;
          lastError = '';
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          // Exponential backoff with jitter, so retries do not resynchronise
          // into the same burst that caused the rejection.
          await new Promise((r) => setTimeout(r, 250 * 2 ** attempt + Math.random() * 200));
        }
      }
      if (lastError) failed.push({ row, error: lastError });
    }
  });

  await Promise.all(workers);
  return { inserted, failed };
}

/**
 * Remove every row from a table, so a sync is a replace rather than an append.
 *
 * `reset` is required by the API and controls whether the primary key sequence
 * restarts; without it the call 400s. This used to swallow its own failure,
 * which meant every sync silently appended a fresh copy of the assessment on
 * top of the last one -- exactly the corruption a system of record must not
 * have. It now throws, because a failed clear has to stop the sync rather than
 * quietly double the data.
 */
export async function truncate(cfg: XanoConfig, tableId: number): Promise<void> {
  await xano(cfg, `/workspace/${cfg.workspace}/table/${tableId}/truncate`, {
    method: 'DELETE',
    body: JSON.stringify({ reset: true }),
  });
}
