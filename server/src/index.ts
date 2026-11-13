import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env } from './types';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rate_limit';
import { tieredCache } from './middleware/tiered_cache';
import { SingleFlight } from './utils/single_flight';
import { validateTargetUrl } from './utils/url_validator';
import { resolveAnoBoyEdge } from './extractors/anoboy';
import { resolveDoodstreamEdge } from './extractors/doodstream';
import { checkDomainsHealth } from './extractors/domain_tracker';

const app = new Hono<{ Bindings: Env }>();

// Single-flight in-flight promise deduplicators
const anoboyFlight = new SingleFlight<Response>();
const doodstreamFlight = new SingleFlight<Response>();

// Enable CORS for extension contexts
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'x-mungil-client', 'Authorization']
  })
);

// Global per-colo rate limiting soft gate
app.use('*', rateLimitMiddleware);

// Public health check
app.get('/health', (c) => {
  return c.json({
    status: 'HEALTHY',
    service: 'mungil-si-validator',
    build_sha: 'BUILD_SHA_PLACEHOLDER',
    timestamp: Date.now()
  });
});

// Version endpoint
app.get('/version', (c) => {
  return c.json({
    version: '1.0.0',
    service: 'mungil-si-validator',
    build_sha: 'BUILD_SHA_PLACEHOLDER'
  });
});

// Active domains directory
app.get('/api/v1/domains', async (c) => {
  if (c.env.APP_STORAGE) {
    const cached = await c.env.APP_STORAGE.get('config:active_domains', 'json');
    if (cached) {
      return c.json({ success: true, cached: true, domains: cached });
    }
  }
  return checkDomainsHealth(c);
});

// Protected Edge Resolvers (Soft-gate Handshake + SSRF whitelist)
app.use('/api/v1/resolve/*', authMiddleware);
app.use('/api/v2/resolve/*', authMiddleware);

// AnoBoy Resolver (v1 & v2)
const handleAnoBoy = async (c: any) => {
  const url = c.req.query('url');
  const res = c.req.query('res') || '720p';

  if (!url) {
    return c.json({ success: false, error: 'Missing target url parameter' }, 400);
  }

  // SSRF Protection: Strict host whitelist validation
  if (!validateTargetUrl(url)) {
    return c.json(
      {
        success: false,
        error: 'Forbidden: Target host not allowed by SSRF policy'
      },
      403
    );
  }

  // Deduplicate concurrent requests in this isolate
  const flightKey = `anoboy:${url}:${res}`;
  return anoboyFlight.do(flightKey, () => resolveAnoBoyEdge(c, url, res));
};

app.get('/api/v1/resolve/anoboy', tieredCache, handleAnoBoy);
app.get('/api/v2/resolve/anoboy', tieredCache, handleAnoBoy);

// Doodstream Resolver (v1 & v2)
const handleDoodstream = async (c: any) => {
  const url = c.req.query('url');

  if (!url) {
    return c.json({ success: false, error: 'Missing target url parameter' }, 400);
  }

  // SSRF Protection: Strict host whitelist validation
  if (!validateTargetUrl(url)) {
    return c.json(
      {
        success: false,
        error: 'Forbidden: Target host not allowed by SSRF policy'
      },
      403
    );
  }

  const flightKey = `doodstream:${url}`;
  return doodstreamFlight.do(flightKey, () => resolveDoodstreamEdge(c, url));
};

app.get('/api/v1/resolve/doodstream', tieredCache, handleDoodstream);
app.get('/api/v2/resolve/doodstream', tieredCache, handleDoodstream);

export default app;
