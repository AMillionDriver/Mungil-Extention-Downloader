/**
 * TikTok Direct Downloader - Facebook Reels MAIN World Bridge
 *
 * Runs in the web page execution context (MAIN world) at document_start.
 * Directly inspects window.__relay_store, Comet script tags, and intercepts
 * video element play/fetch calls to extract highest resolution .fbcdn.net streams.
 */

(function () {
  'use strict';

  if (window.__mungilFbBridgeActive) return;
  window.__mungilFbBridgeActive = true;

  const resolvedStreams = new Map();

  function sanitizeFbUrl(url) {
    if (!url || typeof url !== 'string') return null;
    return url
      .replace(/\\u0025/g, '%')
      .replace(/\\u0026/g, '&')
      .replace(/\\\//g, '/');
  }

  function extractStreamsFromObj(obj, results = []) {
    if (!obj || typeof obj !== 'object') return results;

    // Check direct progressive keys commonly used in Meta Comet / Relay
    const hdUrl =
      obj.browser_native_hd_url ||
      obj.playable_url_quality_hd ||
      obj.hd_src ||
      obj.hd_src_no_ratelimit;
    const sdUrl =
      obj.browser_native_sd_url || obj.playable_url || obj.sd_src || obj.sd_src_no_ratelimit;

    if (hdUrl) {
      results.push({
        url: sanitizeFbUrl(hdUrl),
        quality: 'HD',
        width: obj.original_width || 1080,
        height: obj.original_height || 1920
      });
    }
    if (sdUrl) {
      results.push({
        url: sanitizeFbUrl(sdUrl),
        quality: 'SD',
        width: obj.original_width || 540,
        height: obj.original_height || 960
      });
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        extractStreamsFromObj(item, results);
      }
    } else {
      for (const key of Object.keys(obj)) {
        if (
          key === 'playback_video' ||
          key === 'video' ||
          key === 'creation_story' ||
          key === 'node'
        ) {
          extractStreamsFromObj(obj[key], results);
        }
      }
    }
    return results;
  }

  function scanDomScripts() {
    const scripts = document.querySelectorAll('script[type="application/json"]');
    for (const s of scripts) {
      if (!s.textContent) continue;
      if (
        s.textContent.includes('browser_native_hd_url') ||
        s.textContent.includes('playable_url') ||
        s.textContent.includes('playable_url_quality_hd')
      ) {
        try {
          const json = JSON.parse(s.textContent);
          const streams = extractStreamsFromObj(json);
          if (streams.length > 0) {
            // Pick highest quality available
            const best = streams.find((s) => s.quality === 'HD') || streams[0];
            return best;
          }
        } catch (_) {}
      }
    }
    return null;
  }

  // Intercept HTMLVideoElement playback
  try {
    const originalPlay = HTMLVideoElement.prototype.play;
    HTMLVideoElement.prototype.play = function () {
      try {
        const src = this.currentSrc || this.src;
        if (src && (src.includes('fbcdn.net') || src.includes('.mp4'))) {
          const cleanUrl = sanitizeFbUrl(src);
          if (cleanUrl) {
            window.postMessage(
              {
                type: 'MUNGIL_FB_STREAM_CAPTURED',
                streamUrl: cleanUrl,
                quality: 'HD'
              },
              '*'
            );
          }
        }
      } catch (_) {}
      return originalPlay.apply(this, arguments);
    };
  } catch (_) {}

  // Respond to query from ISOLATED world
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'MUNGIL_FB_REQUEST_STREAM') {
      const reelId = event.data.reelId;
      let stream = resolvedStreams.get(reelId) || null;

      if (!stream) {
        stream = scanDomScripts();
        if (stream && reelId) {
          resolvedStreams.set(reelId, stream);
        }
      }

      window.postMessage(
        {
          type: 'MUNGIL_FB_STREAM_RESPONSE',
          reelId,
          streamUrl: stream?.url || null,
          quality: stream?.quality || 'HD'
        },
        '*'
      );
    }
  });

  // Self-announcement
  window.postMessage({ type: 'MUNGIL_FB_BRIDGE_READY' }, '*');
})();
