import { Context } from 'hono';
import { Env, StreamResolutionResult } from '../types';
import { cleanAnoBoyToken, isValidAnoBoyToken } from '../utils/token_validator';

/**
 * Extracts direct Google Video stream URL from Blogger Video Player HTML.
 *
 * @param html - Raw HTML returned by blogger.com/video.g?token=...
 * @param preferredRes - '720p' or '360p'
 * @returns Direct MP4 stream URL or null
 */
export function extractStreamFromBloggerHtml(
  bloggerHtml: string,
  preferredRes = '720p'
): { url: string; quality: string; itag: number } | null {
  if (!bloggerHtml || typeof bloggerHtml !== 'string') return null;

  // Strict regex: domain must directly be *.googlevideo.com
  const re =
    /https?:\/\/(?:[a-zA-Z0-9.\-_]+\.)?googlevideo\.com(?:\/|\\\/)videoplayback[^"'\s<>&;]+/g;
  let match;
  const streams: Array<{ itag: number; url: string }> = [];

  while ((match = re.exec(bloggerHtml)) !== null) {
    const raw = match[0];
    const decoded = raw
      .replace(/\\\\u0026|\\u0026/g, '&')
      .replace(/\\\\u003d|\\u003d/g, '=')
      .replace(/\\\\\//g, '/')
      .replace(/\\\//g, '/')
      .replace(/\\+$/, '')
      .trim();

    const itagMatch = decoded.match(/itag=(\d+)/);
    const itag = itagMatch ? parseInt(itagMatch[1], 10) : 0;
    if (itag > 0) {
      streams.push({ itag, url: decoded });
    }
  }

  if (streams.length === 0) return null;

  if (preferredRes && (preferredRes.includes('1080') || preferredRes.includes('720'))) {
    const s720 = streams.find((s) => s.itag === 22);
    if (s720) return { url: s720.url, quality: '720p', itag: 22 };
  }

  const s360 = streams.find((s) => s.itag === 18);
  if (s360) return { url: s360.url, quality: '360p', itag: 18 };

  return {
    url: streams[0].url,
    quality: streams[0].itag === 22 ? '720p' : '360p',
    itag: streams[0].itag
  };
}

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

    // Extract video token candidate patterns using cleanAnoBoyToken
    const candidates: Array<{ quality: string; token: string }> = [];

    // Check 720p button/iframe/anchor attributes
    const rawMatches720 = Array.from(
      html.matchAll(/(?:data-video|href|src)=["']([^"']*(?:720|adsbatch720)[^"']*)["']/gi)
    );
    for (const rm of rawMatches720) {
      const clean = cleanAnoBoyToken(rm[1]);
      if (clean && !candidates.some((c) => c.token === clean)) {
        candidates.push({ quality: '720p', token: clean });
      }
    }

    // Check 360p button/iframe/anchor attributes
    const rawMatches360 = Array.from(
      html.matchAll(/(?:data-video|href|src)=["']([^"']*(?:360|adsbatch360)[^"']*)["']/gi)
    );
    for (const rm of rawMatches360) {
      const clean = cleanAnoBoyToken(rm[1]);
      if (clean && !candidates.some((c) => c.token === clean)) {
        candidates.push({ quality: '360p', token: clean });
      }
    }

    // General token parameter matches on the page
    const genericTokenMatches = html.matchAll(/[?&]token=([a-zA-Z0-9_-]{15,})/g);
    for (const gm of genericTokenMatches) {
      const clean = cleanAnoBoyToken(gm[1]);
      if (clean && !candidates.some((c) => c.token === clean)) {
        candidates.push({ quality: '360p', token: clean });
      }
    }

    // Sort candidates according to preferredRes
    const prioritized = candidates.sort((a, b) => {
      if (a.quality === preferredRes) return -1;
      if (b.quality === preferredRes) return 1;
      return 0;
    });

    // Subrequest 2: Resolve candidate token through Blogger directly to final Google Video MP4 stream
    for (const cand of prioritized) {
      try {
        const bloggerUrl = `https://www.blogger.com/video.g?token=${cand.token}`;
        const bRes = await fetch(bloggerUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            Referer: targetUrl
          }
        });

        if (bRes.ok) {
          const bHtml = await bRes.text();
          const stream = extractStreamFromBloggerHtml(bHtml, preferredRes);

          if (stream && stream.url) {
            const payload: StreamResolutionResult = {
              success: true,
              source: 'anoboy',
              resolvedQuality: stream.quality,
              directUrl: stream.url, // GUARANTEED to be direct .googlevideo.com MP4 stream!
              title,
              mirrors: prioritized.map((p) => ({
                quality: p.quality,
                url: `https://www.blogger.com/video.g?token=${p.token}`,
                label: `Blogger ${p.quality}`
              })),
              cachedAt: Date.now()
            };
            return c.json(payload, 200);
          }
        }
      } catch (_) {
        // Try next candidate mirror
      }
    }

    // Fallback: check direct <video> source tags
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

    // Fallback: check mirrors like mp4upload or gofile
    const mirrorMatch = html.match(
      /href=["'](https?:\/\/[^"']*(?:gofile\.io|mp4upload\.com)[^"']*)["']/i
    );
    if (mirrorMatch) {
      const payload: StreamResolutionResult = {
        success: true,
        source: 'anoboy',
        resolvedQuality: 'mirror',
        directUrl: mirrorMatch[1],
        title,
        cachedAt: Date.now()
      };
      return c.json(payload, 200);
    }

    return c.json(
      {
        success: false,
        error: 'No playable video stream or valid token found on page'
      },
      404
    );
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
