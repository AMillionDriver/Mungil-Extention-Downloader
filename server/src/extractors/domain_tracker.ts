import { Context } from 'hono';
import { Env, DomainHealthStatus } from '../types';

export async function checkDomainsHealth(c: Context<{ Bindings: Env }>): Promise<Response> {
  const domains = ['anoboy.at', 'anoboy.ninja', 'anoboy.quest', 'anoboy.online', 'anoboy.pro'];

  const results: DomainHealthStatus[] = [];

  for (const domain of domains) {
    const start = Date.now();
    try {
      const res = await fetch(`https://${domain}/`, {
        method: 'HEAD',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
        }
      });
      const latencyMs = Date.now() - start;
      results.push({
        domain,
        status: res.ok ? 'ONLINE' : 'UNSTABLE',
        httpStatus: res.status,
        lastChecked: Date.now(),
        latencyMs
      });
    } catch {
      results.push({
        domain,
        status: 'OFFLINE',
        lastChecked: Date.now(),
        latencyMs: Date.now() - start
      });
    }
  }

  // Coalesce into single KV write
  if (c.env.APP_STORAGE) {
    c.executionCtx.waitUntil(
      c.env.APP_STORAGE.put('config:active_domains', JSON.stringify(results), {
        expirationTtl: 86400
      })
    );
  }

  return c.json({ success: true, timestamp: Date.now(), domains: results });
}
