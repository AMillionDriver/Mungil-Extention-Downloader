import { Context, Next } from 'hono';
import { Env } from '../types';

export async function tieredCache(c: Context<{ Bindings: Env }>, next: Next) {
  if (c.req.method !== 'GET') {
    return next();
  }

  const cache = (caches as any).default;
  const cacheKey = new Request(c.req.url, c.req.raw);

  // Layer 1: Cache API (Per-Colo Edge Memory, < 5ms)
  try {
    const coloHit = await cache.match(cacheKey);
    if (coloHit) {
      const res = new Response(coloHit.body, coloHit);
      res.headers.set('x-cache-layer', 'HIT_COLO_CACHE_API');
      return res;
    }
  } catch {
    // Ignore cache.match errors in development/testing
  }

  // Layer 2: Cloudflare KV (Global Fallback, 30-70ms)
  const targetUrl = c.req.query('url') || '';
  const kvKey = `stream:${new URL(c.req.url).pathname}:${encodeURIComponent(targetUrl)}`;

  if (c.env.APP_STORAGE) {
    try {
      const kvHit = await c.env.APP_STORAGE.get(kvKey, 'json');
      if (kvHit) {
        const response = c.json(kvHit);
        response.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
        response.headers.set('x-cache-layer', 'HIT_KV_GLOBAL');

        // Populate Layer 1 asynchronously for subsequent hits in this colo
        try {
          c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
        } catch {}
        return response;
      }
    } catch {}
  }

  // Layer 3: Cold path (Upstream Execution)
  await next();

  // STRICT DEFENSE: Set headers FIRST on c.res so cloned responses retain Cache-Control
  if (c.res && c.res.status === 200) {
    c.res.headers.set('x-cache-layer', 'MISS_UPSTREAM_RESOLVED');
    c.res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');

    const forCache = c.res.clone();
    const forKV = c.res.clone();

    // Populate Layer 1 (Cache API)
    try {
      c.executionCtx.waitUntil(cache.put(cacheKey, forCache));
    } catch {}

    // Populate Layer 2 (KV) only if result is valid success
    if (c.env.APP_STORAGE) {
      c.executionCtx.waitUntil(
        forKV
          .json()
          .then((json: any) => {
            if (json && json.success === true) {
              return c.env.APP_STORAGE.put(kvKey, JSON.stringify(json), {
                expirationTtl: 86400
              });
            }
          })
          .catch(() => {})
      );
    }
  }
}

