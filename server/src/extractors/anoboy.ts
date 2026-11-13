import { Context } from 'hono';
import { Env, StreamResolutionResult } from '../types';
import { isValidAnoBoyToken } from '../utils/token_validator';

export async function resolveAnoBoyEdge(
  c: Context<{ Bindings: Env }>,
  targetUrl: string,
  preferredRes = '720p'
): Promise<Response> {
  try {
    const pageRes = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: targetUrl
      }
    });

    if (!pageRes.ok) {
      return c.json(
        {
          success: false,
          error: `Upstream page returned HTTP ${pageRes.status}`
        },
        502
      );
    }

    const html = await pageRes.text();

    // Extract title
    const titleMatch =
      html.match(/<h1[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>(.*?)<\/h1>/i) ||
      html.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'AnoBoy Video';

    // Extract video token candidate patterns
    // 1. Check for blogger token in iframe/embed or buttons
    const candidates: Array<{ quality: string; token: string }> = [];

    // Check 720p
    const match720 =
      html.match(/data-video=["']([^"']+)["'][^>]*>.*?720/i) ||
      html.match(/href=["'][^"']*adsbatch720\.php\?url=([^"&]+)["']/i) ||
      html.match(/src=["'][^"']*blogger\.com\/video\.g\?token=([^"&]+)["']/i);
    if (match720 && isValidAnoBoyToken(match720[1])) {
      candidates.push({ quality: '720p', token: match720[1] });
    }

    // Check 360p / SD
    const match360 =
      html.match(/data-video=["']([^"']+)["'][^>]*>.*?360/i) ||
      html.match(/href=["'][^"']*adsbatch360\.php\?url=([^"&]+)["']/i) ||
      html.match(/src=["'][^"']*blogger\.com\/video\.g\?token=([^"&]+)["'][^>]*>.*?360/i);
    if (match360 && isValidAnoBoyToken(match360[1])) {
      candidates.push({ quality: '360p', token: match360[1] });
    }

    // Generic token lookup if not captured above
    const genericTokenMatches = html.matchAll(/token=([a-zA-Z0-9_-]{10,})/g);
    for (const gm of genericTokenMatches) {
      if (isValidAnoBoyToken(gm[1]) && !candidates.some((c) => c.token === gm[1])) {
        candidates.push({ quality: '360p', token: gm[1] });
      }
    }

    // Select based on preference or fallback
    let selected = candidates.find((cand) => cand.quality === preferredRes);
    if (!selected && candidates.length > 0) {
      selected = candidates[0];
    }

    if (!selected) {
      // Look for direct video source tags
      const srcMatch =
        html.match(/<source[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i) ||
        html.match(/<video[^>]+src=["'](https?:\/\/[^"']+\.mp4[^"']*)["']/i);

      if (srcMatch) {
        const payload: StreamResolutionResult = {
          success: true,
          source: 'anoboy',
          resolvedQuality: 'direct',
          directUrl: srcMatch[1],
          title,
          cachedAt: Date.now()
        };
        return c.json(payload, 200);
      }

      return c.json(
        {
          success: false,
          error: 'No valid video token or direct stream found on page'
        },
        404
      );
    }

    const bloggerUrl = `https://www.blogger.com/video.g?token=${selected.token}`;
    const payload: StreamResolutionResult = {
      success: true,
      source: 'anoboy',
      resolvedQuality: selected.quality,
      directUrl: bloggerUrl,
      title,
      mirrors: candidates.map((cand) => ({
        quality: cand.quality,
        url: `https://www.blogger.com/video.g?token=${cand.token}`,
        label: `Blogger ${cand.quality}`
      })),
      cachedAt: Date.now()
    };

    return c.json(payload, 200);
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: `Edge resolution failed: ${err.message}`
      },
      500
    );
  }
}
