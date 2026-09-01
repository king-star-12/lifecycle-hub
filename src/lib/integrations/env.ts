// Server-side only. Imported by route handlers and by CLI scripts, so it cannot
// carry the `server-only` guard -- that package throws outside Next's bundler.
// Secrets here are read from process.env and are never NEXT_PUBLIC_, so nothing
// in this file can reach the browser bundle.

/**
 * Credential access. Every integration reports whether it is configured, so the
 * UI can state plainly which evidence layers are live rather than silently
 * showing a thinner picture.
 */
export function key(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export function integrationStatus() {
  return {
    serpapi: !!key('SERPAPI_API_KEY'),
    querit: !!key('QUERIT_API_KEY'),
    nutrient: !!key('NUTRIENT_API_KEY'),
    doctavian: !!key('DOCTAVIAN_API_KEY'),
    azure_openai: !!key('AZURE_OPENAI_API_KEY'),
    xano: !!key('XANO_INSTANCE_BASE_URL'),
    adx: !!key('ADX_CLUSTER_URI'),
    adt: !!key('ADT_INSTANCE_URL'),
  };
}
