import { Context } from 'hono';
import { Env, StreamResolutionResult } from '../types';

export async function resolveDoodstreamEdge(
  c: Context<{ Bindings: Env }>,
  targetUrl: string
): Promise<Response> {
  try {
    const pageRes = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Referer: targetUrl
      }
    });

    if (!pageRes.ok) {
      return c.json(
        {
          success: false,
          error: `Doodstream page HTTP ${pageRes.status}`
        },
        502
      );
    }

    const html = await pageRes.text();
    const md5Match = html.match(/\/pass_md5\/[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)/);
    if (!md5Match) {
      return c.json(
        {
          success: false,
          error: 'pass_md5 endpoint token not found in player markup'
        },
        404
      );
    }

    const md5Path = md5Match[0];
    const token = md5Match[1];
    const parsed = new URL(targetUrl);
    const md5Url = `${parsed.origin}${md5Path}`;

    const md5Res = await fetch(md5Url, {
      headers: {
        Referer: targetUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
      }
    });

    if (!md5Res.ok) {
      return c.json(
        {
          success: false,
          error: `pass_md5 fetch failed with HTTP ${md5Res.status}`
        },
        502
      );
    }

    const baseStreamUrl = (await md5Res.text()).trim();
    // Generate random 10-char token as per Doodstream protocol
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randStr = '';
    for (let i = 0; i < 10; i++) {
      randStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const finalStreamUrl = `${baseStreamUrl}${randStr}?token=${token}&expiry=${Date.now()}`;

    const payload: StreamResolutionResult = {
      success: true,
      source: 'doodstream',
      resolvedQuality: 'auto',
      directUrl: finalStreamUrl,
      cachedAt: Date.now()
    };

    return c.json(payload, 200);
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: `Doodstream resolution failed: ${err.message}`
      },
      500
    );
  }
}
