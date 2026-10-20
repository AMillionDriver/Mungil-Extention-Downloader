/**
 * YouTube Direct Downloader - MAIN World Bridge
 *
 * Runs in the webpage's MAIN execution world to directly interface with
 * the YouTube HTML5 Player API (#movie_player) and window.ytInitialPlayerResponse.
 * Extracts clean direct media streams (progressive MP4 / multi-codec formats)
 * with zero third-party dependencies or external conversion servers.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__YT_DIRECT_BRIDGE_INITIALIZED__) return;
  window.__YT_DIRECT_BRIDGE_INITIALIZED__ = true;

  const LOG_PREFIX = '[YouTube Bridge]';

  /**
   * Safely retrieves the YouTube Player element & API instance.
   * @returns {HTMLElement|null}
   */
  function getMoviePlayer() {
    return (
      document.getElementById('movie_player') ||
      document.querySelector('.html5-video-player') ||
      document.querySelector('ytd-player #movie_player')
    );
  }

  /**
   * Retrieves player response from Player API, window global, or player config.
   * @returns {object|null}
   */
  function getPlayerResponse() {
    const player = getMoviePlayer();

    // 1. Primary: player.getPlayerResponse() API
    if (player && typeof player.getPlayerResponse === 'function') {
      try {
        const resp = player.getPlayerResponse();
        if (resp && resp.streamingData) return resp;
      } catch (e) {
        console.warn(`${LOG_PREFIX} Error calling player.getPlayerResponse():`, e);
      }
    }

    // 2. Secondary: window.ytInitialPlayerResponse
    if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.streamingData) {
      return window.ytInitialPlayerResponse;
    }

    // 3. Tertiary: ytplayer.config.args.raw_player_response
    if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
      const raw = window.ytplayer.config.args.raw_player_response;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.streamingData) return parsed;
        } catch (_) {}
      } else if (raw && typeof raw === 'object' && raw.streamingData) {
        return raw;
      }
    }

    return null;
  }

  /**
   * Pre-computed fallback operations for signature deciphering.
   * Derived from YouTube HTML5 base.js transformation sequence:
   * 1. Reverse
   * 2. Swap 0 with pos 8
   * 3. Slice 2
   * 4. Swap 0 with pos 21
   * 5. Slice 3
   * 6. Reverse
   * 7. Swap 0 with pos 65
   * 8. Slice 2
   * 9. Swap 0 with pos 43
   */
  let decipherOperations = [
    { type: 'reverse', arg: 0 },
    { type: 'swap', arg: 8 },
    { type: 'slice', arg: 2 },
    { type: 'swap', arg: 21 },
    { type: 'slice', arg: 3 },
    { type: 'reverse', arg: 0 },
    { type: 'swap', arg: 65 },
    { type: 'slice', arg: 2 },
    { type: 'swap', arg: 43 }
  ];

  /**
   * Deciphers an obfuscated signatureCipher 's' token using reverse, swap, and slice mutations.
   * @param {string} s
   * @returns {string}
   */
  function decipherSignature(s) {
    if (!s || typeof s !== 'string') return s;
    try {
      const decoded = decodeURIComponent(s);
      const arr = decoded.split('');
      for (const op of decipherOperations) {
        if (op.type === 'reverse') {
          arr.reverse();
        } else if (op.type === 'slice') {
          arr.splice(0, op.arg);
        } else if (op.type === 'swap') {
          if (arr.length > 0) {
            const temp = arr[0];
            const targetIdx = op.arg % arr.length;
            arr[0] = arr[targetIdx];
            arr[targetIdx] = temp;
          }
        }
      }
      return arr.join('');
    } catch (_) {
      return s;
    }
  }

  /**
   * Dynamically inspects the current active base.js player script on the page
   * to automatically extract latest decipher operations and keep them continuously synchronized.
   */
  async function syncDecipherFromPlayerScript() {
    try {
      if (typeof document === 'undefined') return;
      const scriptEl = document.querySelector('script[src*="/base.js"]');
      if (!scriptEl || !scriptEl.src) return;
      const res = await fetch(scriptEl.src);
      if (!res.ok) return;
      const code = await res.text();

      const fMatch = code.match(/f\$="([^"]+)"\.split\(";"\)/);
      if (!fMatch) return;
      const f$ = fMatch[1].split(';');

      const swapIdx = code.indexOf('var e=f[0];f[0]=f[a%');
      if (swapIdx === -1) return;
      const objDefStart = code.lastIndexOf('d$={', swapIdx);
      if (objDefStart === -1) return;
      const objEnd = code.indexOf('};', swapIdx);
      const objFull = code.substring(objDefStart, objEnd + 2);

      const swapKey = (objFull.match(/([a-zA-Z0-9$]+):function\([^)]*\)\{[^}]*var e=f\[0\]/) ||
        [])[1];
      const sliceKey = (objFull.match(/([a-zA-Z0-9$]+):function\([^)]*\)\{[^}]*\(0,a\)/) || [])[1];
      const reverseKey = (objFull.match(/([a-zA-Z0-9$]+):function\([^)]*\)\{[^}]*f\$\[23\]/) ||
        [])[1];

      if (!swapKey || !sliceKey) return;

      const funcMatch = code.match(
        /([a-zA-Z0-9$]+)=function\(f,a,e,T\)\{var q=a\^f;if\(\(f\|72\)==f\)\{var F=e\[f\$\[q\^7700\]\]\(f\$\[q\^7727\]\);(.*?);var E=F\[f\$\[q\^7730\]\]\(f\$\[q\^7727\]\)\}/
      );
      if (!funcMatch) return;
      const stepCalls = funcMatch[2];

      const q = 7798 ^ 72;
      const stepRegex = /([a-zA-Z0-9$]+)\[f\$\[q\^(\d+)\]\]\(F(?:,\s*(?:q\^(\d+)|\d+))?\)/g;
      let sm;
      const ops = [];
      while ((sm = stepRegex.exec(stepCalls)) !== null) {
        const opIdx = q ^ parseInt(sm[2], 10);
        const opName = f$[opIdx];
        let arg = 0;
        if (sm[3]) {
          arg = q ^ parseInt(sm[3], 10);
        } else {
          const commaMatch = sm[0].match(/,\s*(\d+)/);
          if (commaMatch) arg = parseInt(commaMatch[1], 10);
        }

        let type = 'unknown';
        if (opName === swapKey) type = 'swap';
        else if (opName === sliceKey) type = 'slice';
        else if (opName === reverseKey) type = 'reverse';

        if (type !== 'unknown') {
          ops.push({ type, arg });
        }
      }

      if (ops.length >= 3) {
        decipherOperations = ops;
      }
    } catch (_) {}
  }

  // Trigger background synchronization if player script exists on page
  try {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      setTimeout(syncDecipherFromPlayerScript, 100);
    }
  } catch (_) {}

  /**
   * Transforms the n parameter via YouTube player's built-in _yt_player.kq helper if available in window.
   * @param {string} url
   * @returns {string}
   */
  function transformNParam(url) {
    if (!url || typeof url !== 'string') return url;
    try {
      if (
        typeof window !== 'undefined' &&
        window._yt_player &&
        typeof window._yt_player.kq === 'function'
      ) {
        const helper = new window._yt_player.kq(url, true);
        const transformedN = helper.get('n');
        if (transformedN) {
          try {
            const u = new URL(url);
            if (u.searchParams.has('n') && u.searchParams.get('n') !== transformedN) {
              u.searchParams.set('n', transformedN);
              return u.toString();
            }
          } catch (_) {}
          const pm = url.match(/\/n\/([^/]+)/);
          if (pm && pm[1] !== transformedN) {
            return url.replace('/n/' + pm[1], '/n/' + transformedN);
          }
        }
      }
    } catch (_) {}
    return url;
  }

  /**
   * Normalizes a streaming format entry, extracting clean URL and resolution info.
   * Deciphers signatureCipher / cipher parameters to unlock restricted / protected streams.
   * @param {object} format
   * @returns {object|null}
   */
  function parseFormat(format) {
    if (!format || typeof format !== 'object') return null;

    let directUrl = format.url || '';
    if (!directUrl && (format.cipher || format.signatureCipher)) {
      const cipherStr = format.cipher || format.signatureCipher;
      try {
        const params = new URLSearchParams(cipherStr);
        let baseUrl = params.get('url') || '';
        const sig = params.get('s') || params.get('sig') || params.get('signature');
        const sp = params.get('sp') || 'sig';
        if (baseUrl && sig) {
          const decipheredSig = decipherSignature(sig);
          const sep = baseUrl.includes('?') ? '&' : '?';
          directUrl = `${baseUrl}${sep}${sp}=${encodeURIComponent(decipheredSig)}&alr=yes`;
        } else {
          directUrl = baseUrl;
        }
      } catch (_) {}
    }

    if (!directUrl) return null;

    // Apply n-parameter transform if player VM is loaded
    directUrl = transformNParam(directUrl);

    const itag = Number(format.itag) || 0;
    const qualityLabel = format.qualityLabel || `${format.height || 360}p`;
    const mimeType = format.mimeType || 'video/mp4';
    const isProgressive =
      !mimeType.includes('audio/') &&
      (itag === 18 || itag === 22 || (format.audioChannels && format.width));

    return {
      itag,
      url: directUrl,
      qualityLabel,
      quality: format.quality || 'medium',
      mimeType,
      width: format.width || 0,
      height: format.height || 0,
      bitrate: format.bitrate || 0,
      contentLength: format.contentLength || null,
      isProgressive: Boolean(isProgressive),
      hasAudio: Boolean(format.audioChannels || isProgressive)
    };
  }

  /**
   * Selects the optimal stream URL based on codec and data_saver preferences.
   *
   * Priority Matrix:
   * - Data Saver Mode:
   *     1. Progressive MP4 360p (itag 18) - Saves ~60-70% bandwidth while retaining full audio+video
   *     2. Progressive MP4 720p (itag 22)
   *     3. Any progressive stream
   * - Standard / Best Mode:
   *     1. Progressive MP4 720p (itag 22) - Highest single-file progressive resolution
   *     2. Progressive MP4 360p (itag 18)
   *     3. Best available progressive stream
   *
   * @param {object} streamingData
   * @param {string} preference - 'data_saver' | 'best'
   * @returns {object|null}
   */
  function selectOptimalStream(streamingData, preference = 'data_saver') {
    if (!streamingData) return null;

    const rawFormats = Array.isArray(streamingData.formats) ? streamingData.formats : [];
    const parsedFormats = rawFormats
      .map(parseFormat)
      .filter((f) => f && f.url && f.url.startsWith('http'));

    if (parsedFormats.length === 0) {
      // Fallback: check adaptiveFormats for video stream
      const rawAdaptive = Array.isArray(streamingData.adaptiveFormats)
        ? streamingData.adaptiveFormats
        : [];
      const parsedAdaptive = rawAdaptive
        .map(parseFormat)
        .filter((f) => f && f.url && f.url.startsWith('http') && f.mimeType.startsWith('video/'));

      if (parsedAdaptive.length === 0) return null;

      if (preference === 'data_saver') {
        parsedAdaptive.sort((a, b) => (a.height || 360) - (b.height || 360));
      } else {
        parsedAdaptive.sort((a, b) => (b.height || 360) - (a.height || 360));
      }
      return parsedAdaptive[0];
    }

    if (preference === 'data_saver') {
      // Prioritize 360p (itag 18) for data savings (~60-70% smaller)
      const itag18 = parsedFormats.find((f) => f.itag === 18);
      if (itag18) return itag18;

      // Otherwise sort by lowest resolution
      parsedFormats.sort((a, b) => (a.height || 360) - (b.height || 360));
      return parsedFormats[0];
    }

    // Standard / Best mode: prioritize 720p (itag 22) or highest progressive resolution
    const itag22 = parsedFormats.find((f) => f.itag === 22);
    if (itag22) return itag22;

    parsedFormats.sort((a, b) => (b.height || 360) - (a.height || 360));
    return parsedFormats[0];
  }

  /**
   * Resolves complete video metadata and direct stream URL.
   * @param {string} preference
   * @returns {object}
   */
  function extractStreamData(preference = 'data_saver') {
    const player = getMoviePlayer();
    const playerResp = getPlayerResponse();

    const videoDetails = playerResp?.videoDetails || {};
    let videoId = videoDetails.videoId || '';
    let title = videoDetails.title || '';
    let author = videoDetails.author || '';

    // Fallback: extract from DOM or Player API
    if (player && typeof player.getVideoData === 'function') {
      try {
        const vData = player.getVideoData();
        if (vData) {
          if (!videoId) videoId = vData.video_id || '';
          if (!title) title = vData.title || '';
          if (!author) author = vData.author || '';
        }
      } catch (_) {}
    }

    if (!videoId) {
      const urlParams = new URLSearchParams(window.location.search);
      videoId = urlParams.get('v') || '';
      if (!videoId && window.location.pathname.startsWith('/shorts/')) {
        videoId = window.location.pathname.split('/shorts/')[1]?.split(/[?#&]/)[0] || '';
      }
    }

    if (!title) {
      const titleEl = document.querySelector(
        'h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title'
      );
      title =
        titleEl?.textContent?.trim() ||
        document.title.replace(/ - YouTube$/, '').trim() ||
        'YouTube Video';
    }

    if (!author) {
      const authorEl = document.querySelector(
        'ytd-channel-name a, #channel-name a, #upload-info #channel-name'
      );
      author = authorEl?.textContent?.trim() || 'Creator';
    }

    const streamingData = playerResp?.streamingData;
    const selected = selectOptimalStream(streamingData, preference);
    const hasProgressive = Boolean(selected && selected.isProgressive);

    if (!selected || !selected.url) {
      return {
        success: false,
        isSabrOnly: true,
        hasProgressive: false,
        error: 'Direct video stream URL could not be resolved from YouTube player data',
        videoId,
        title,
        author
      };
    }

    return {
      success: true,
      streamUrl: selected.url,
      videoId,
      title,
      author,
      quality: selected.qualityLabel || `${selected.height}p`,
      itag: selected.itag,
      isProgressive: Boolean(selected.isProgressive),
      isSabrOnly: !selected.isProgressive,
      hasProgressive,
      isDataSaver: preference === 'data_saver'
    };
  }

  // ==========================================================================
  // IPC Event Listeners with ISOLATED World
  // ==========================================================================

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    // 1. Direct Stream Resolution Request
    window.addEventListener('__YT_EXT_GET_STREAM__', (event) => {
      const req = event.detail || {};
      const requestId = req.requestId;
      const preference = req.codecPreference || 'data_saver';

      const result = extractStreamData(preference);

      window.dispatchEvent(
        new CustomEvent('__YT_EXT_STREAM_RESOLVED__', {
          detail: {
            requestId,
            ...result
          }
        })
      );
    });

    // 2. Metadata Query Request (for popup sync)
    window.addEventListener('__YT_EXT_METADATA_QUERY__', (event) => {
      const req = event.detail || {};
      const requestId = req.requestId;
      const preference = req.codecPreference || 'data_saver';

      const result = extractStreamData(preference);

      window.dispatchEvent(
        new CustomEvent('__YT_EXT_METADATA_RESPONSE__', {
          detail: {
            requestId,
            ready: result.success,
            videoId: result.videoId,
            title: result.title,
            author: result.author,
            quality: result.quality,
            itag: result.itag,
            isDataSaver: result.isDataSaver
          }
        })
      );
    });
  }

  // Export functions on window for unit testing in Node environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      decipherSignature,
      parseFormat,
      selectOptimalStream,
      extractStreamData
    };
  }
})();
