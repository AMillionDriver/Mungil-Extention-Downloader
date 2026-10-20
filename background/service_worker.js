/**
 * TikTok Direct Downloader - Background Service Worker (Manifest V3)
 * Handles:
 * 1. IPC listener for DOWNLOAD_VIDEO, GET_STATS, and PING messages.
 * 2. Strict Windows NTFS filename sanitization enforcing tiktok_@[author]_[id].mp4.
 * 3. declarativeNetRequest dynamic header rules (Referer/Origin) for ByteDance CDNs.
 * 4. chrome.downloads.download with conflictAction: "uniquify".
 * 5. Persistent download telemetry in chrome.storage.local.
 */

// Dynamic declarativeNetRequest rules ensuring CDN requests include valid Referer
const TIKTOK_CDN_RULES = [
  {
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.tiktok.com/' },
        { header: 'Origin', operation: 'set', value: 'https://www.tiktok.com' }
      ]
    },
    condition: {
      urlFilter: '*tiktokcdn.com*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  },
  {
    id: 2,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.tiktok.com/' },
        { header: 'Origin', operation: 'set', value: 'https://www.tiktok.com' }
      ]
    },
    condition: {
      urlFilter: '*byteoversea.com*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  },
  {
    id: 3,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.tiktok.com/' },
        { header: 'Origin', operation: 'set', value: 'https://www.tiktok.com' }
      ]
    },
    condition: {
      urlFilter: '*ibytedtos.com*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  }
];

// Dynamic declarativeNetRequest rules for Bstation (Bilibili.tv) CDNs
const BSTATION_CDN_RULES = [
  {
    id: 11,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.bilibili.tv/' },
        { header: 'Origin', operation: 'set', value: 'https://www.bilibili.tv' }
      ]
    },
    condition: {
      urlFilter: '*biliapi.net*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  },
  {
    id: 12,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.bilibili.tv/' },
        { header: 'Origin', operation: 'set', value: 'https://www.bilibili.tv' }
      ]
    },
    condition: {
      urlFilter: '*bilivideo.com*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  },
  {
    id: 13,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.bilibili.tv/' },
        { header: 'Origin', operation: 'set', value: 'https://www.bilibili.tv' }
      ]
    },
    condition: {
      urlFilter: '*akamaized.net*',
      resourceTypes: ['xmlhttprequest', 'media', 'other']
    }
  }
];

// Dynamic declarativeNetRequest rules for JWPlyr (overfetch.video, jwplyr.com) CDNs
const JWPLYR_CDN_RULES = [
  {
    id: 21,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://jwplyr.com/' },
        { header: 'Origin', operation: 'set', value: 'https://jwplyr.com' }
      ]
    },
    condition: {
      urlFilter: '*overfetch.video*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  },
  {
    id: 22,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://jwplyr.com/' },
        { header: 'Origin', operation: 'set', value: 'https://jwplyr.com' }
      ]
    },
    condition: {
      urlFilter: '*jwplyr.com*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  }
];

// Dynamic declarativeNetRequest rules for YouTube (googlevideo.com) CDNs
const YOUTUBE_CDN_RULES = [
  {
    id: 31,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.youtube.com/' },
        { header: 'Origin', operation: 'set', value: 'https://www.youtube.com' }
      ]
    },
    condition: {
      urlFilter: '*googlevideo.com*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  },
  {
    id: 32,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.youtube.com/' },
        { header: 'Origin', operation: 'set', value: 'https://www.youtube.com' }
      ]
    },
    condition: {
      urlFilter: '*youtube.com*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  }
];

/**
 * Sanitizes author username for Windows NTFS compatibility.
 * Strips leading '@', removes forbidden Win32 characters (\ / : * ? " < > |),
 * removes ASCII control codes, collapses whitespace, trims trailing dots and underscores,
 * and limits component length to 64 characters.
 *
 * @param {string} author
 * @returns {string} Sanitized author handle
 */
function sanitizeAuthor(author) {
  if (author === null || author === undefined) return 'unknown';
  let str = String(author).trim();
  if (!str) return 'unknown';

  // Strip leading '@' symbols, dots, and whitespace
  str = str.replace(/^[@.\s]+/, '');

  // Replace Windows NTFS forbidden characters and control characters (0x00-0x1F, 0x7F-0x9F)
  str = str.replace(/[/\\:*?"<>|\x00-\x1f\x7f-\x9f]/g, '_');

  // Collapse consecutive whitespace into single underscore
  str = str.replace(/\s+/g, '_');

  // Strip trailing dots, spaces, and underscores to prevent Win32 subsystem errors
  str = str.replace(/[.\s_]+$/, '');

  // Truncate to maximum safe length for a single filename component
  str = str.slice(0, 64);

  return str || 'unknown';
}

/**
 * Sanitizes video ID to alphanumeric characters, dashes, and underscores.
 *
 * @param {string|number} id
 * @returns {string} Sanitized video ID
 */
function sanitizeVideoId(id) {
  if (id === null || id === undefined) return String(Date.now());
  let str = String(id).trim();
  if (!str) return String(Date.now());

  // Keep only alphanumeric characters, underscores, and dashes
  str = str.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

  return str || String(Date.now());
}

/**
 * Formats standard output filename: tiktok_@[author]_[id].mp4
 *
 * @param {string} author
 * @param {string|number} id
 * @returns {string}
 */
function formatFilename(author, id) {
  const safeAuthor = sanitizeAuthor(author);
  const safeId = sanitizeVideoId(id);
  return `tiktok_@${safeAuthor}_${safeId}.mp4`;
}

/**
 * Sanitizes Bstation Anime / Video title for Windows NTFS compatibility.
 * Replaces illegal colons (Re:Zero -> Re - Zero), slashes, quotes, and control codes.
 *
 * @param {string} title
 * @returns {string} Sanitized title
 */
function sanitizeBstationTitle(title) {
  if (title === null || title === undefined) return 'Anime';
  let str = String(title).trim();
  if (!str) return 'Anime';

  // Normalize colons and slashes to dashes/spaces (e.g. "Re:Zero" -> "Re - Zero")
  str = str.replace(/[:：]/g, ' - ');
  str = str.replace(/[/\\|]/g, '-');

  // Strip remaining Win32 forbidden characters (* ? " < >) and control codes (0x00-0x1F, 0x7F-0x9F)
  str = str.replace(/[*?"<>|\x00-\x1f\x7f-\x9f]/g, '');

  // Collapse consecutive whitespace and dashes
  str = str.replace(/\s+/g, ' ');
  str = str.replace(/-{2,}/g, '-');
  str = str.replace(/\s*-\s*/g, ' - ');

  // Trim leading/trailing dots, spaces, underscores, and hyphens to prevent Win32 subsystem errors
  str = str.replace(/^[.\s_-]+|[.\s_-]+$/g, '');

  // Truncate to maximum safe length (120 chars)
  str = str.slice(0, 120).trim();

  // Re-trim trailing dots/spaces/hyphens if truncation left any
  str = str.replace(/[.\s_-]+$/, '');

  return str || 'Anime';
}

/**
 * Normalizes episode identifier (e.g. 1 -> "E01", "05" -> "E05", "Episode 12" -> "E12").
 *
 * @param {string|number} ep
 * @returns {string} Normalized episode string (e.g. "E01")
 */
function formatBstationEpisode(ep) {
  if (ep === null || ep === undefined) return 'E01';
  const str = String(ep).trim();
  if (!str) return 'E01';

  // If already matches E01 or E101
  const eMatch = str.match(/^E(\d+)$/i);
  if (eMatch) {
    const num = parseInt(eMatch[1], 10);
    return num < 10 ? `E0${num}` : `E${num}`;
  }

  // Extract digits
  const digits = str.match(/\d+/);
  if (digits) {
    const num = parseInt(digits[0], 10);
    return num < 10 ? `E0${num}` : `E${num}`;
  }

  return 'E01';
}

/**
 * Formats Bstation standard output filename: [Judul Anime] - E01 [720p].mp4
 * Supports either an options object or positional arguments (title, episode, quality).
 *
 * @param {object|string} titleOrParams
 * @param {string|number} [epArg]
 * @param {string} [qArg]
 * @returns {string}
 */
function formatBstationFilename(titleOrParams, epArg, qArg) {
  let title = 'Anime';
  let episode = 'E01';
  let quality = '720p';

  if (titleOrParams && typeof titleOrParams === 'object' && !Array.isArray(titleOrParams)) {
    title = titleOrParams.title;
    episode =
      titleOrParams.episode !== undefined
        ? titleOrParams.episode
        : titleOrParams.epIndex !== undefined
          ? titleOrParams.epIndex
          : 'E01';
    quality = titleOrParams.quality || '720p';
  } else {
    title = titleOrParams;
    episode = epArg !== undefined ? epArg : 'E01';
    quality = qArg || '720p';
  }

  const safeTitle = sanitizeBstationTitle(title);
  const safeEp = formatBstationEpisode(episode);
  const rawQuality = quality ? String(quality).trim().toLowerCase() : '720p';
  const cleanQuality = rawQuality.replace(/[^a-z0-9+]/g, '') || '720p';

  return `[${safeTitle}] - ${safeEp} [${cleanQuality}].mp4`;
}

/**
 * Sanitizes JWPlyr video title for Windows NTFS compatibility.
 * Replaces illegal colons, slashes, quotes, and control codes.
 * Ensures clean single .mp4 extension.
 *
 * @param {string} title
 * @param {string|number} [id]
 * @returns {string} Sanitized filename
 */
function sanitizeJwplyrFilename(title, id) {
  let str = title !== null && title !== undefined ? String(title).trim() : '';
  if (!str) {
    return `jwplyr_${id || Date.now()}.mp4`;
  }

  // Normalize colons and slashes to dashes/spaces
  str = str.replace(/[:：]/g, ' - ');
  str = str.replace(/[/\\|]/g, '-');

  // Strip remaining Win32 forbidden characters (* ? " < >) and control codes
  str = str.replace(/[*?"<>|\x00-\x1f\x7f-\x9f]/g, '');

  // Collapse consecutive whitespace and dashes
  str = str.replace(/\s+/g, ' ');
  str = str.replace(/-{2,}/g, '-');
  str = str.replace(/\s*-\s*/g, ' - ');

  // Trim leading/trailing dots, spaces, underscores, and hyphens
  str = str.replace(/^[.\s_-]+|[.\s_-]+$/g, '');

  // Truncate to safe length (120 chars)
  str = str.slice(0, 120).trim();
  str = str.replace(/[.\s_-]+$/, '');

  if (!str) {
    str = `jwplyr_${id || Date.now()}`;
  }

  if (!str.toLowerCase().endsWith('.mp4')) {
    str += '.mp4';
  }

  return str;
}

/**
 * Sanitizes YouTube video title for Windows NTFS compatibility.
 * Replaces illegal colons (e.g. "Tutorial: Coding" -> "Tutorial - Coding"), slashes, quotes, and control codes.
 *
 * @param {string} title
 * @returns {string} Sanitized title
 */
function sanitizeYoutubeTitle(title) {
  if (title === null || title === undefined) return 'YouTube_Video';
  let str = String(title).trim();
  if (!str) return 'YouTube_Video';

  // Normalize colons and slashes to dashes/spaces
  str = str.replace(/[:：]/g, ' - ');
  str = str.replace(/[/\\|]/g, '-');

  // Strip remaining Win32 forbidden characters (* ? " < >) and control codes (0x00-0x1F, 0x7F-0x9F)
  str = str.replace(/[*?"<>|\x00-\x1f\x7f-\x9f]/g, '');

  // Collapse consecutive whitespace and dashes
  str = str.replace(/\s+/g, ' ');
  str = str.replace(/-{2,}/g, '-');
  str = str.replace(/\s*-\s*/g, ' - ');

  // Trim leading/trailing dots, spaces, underscores, and hyphens
  str = str.replace(/^[.\s_-]+|[.\s_-]+$/g, '');

  // Truncate to maximum safe length (120 chars)
  str = str.slice(0, 120).trim();
  str = str.replace(/[.\s_-]+$/, '');

  return str || 'YouTube_Video';
}

/**
 * Sanitizes YouTube channel / author name for Windows NTFS compatibility.
 *
 * @param {string} author
 * @returns {string} Sanitized channel name
 */
function sanitizeYoutubeAuthor(author) {
  if (author === null || author === undefined) return 'Creator';
  let str = String(author).trim();
  if (!str) return 'Creator';

  str = str.replace(/^[@.\s]+/, '');
  str = str.replace(/[/\\:*?"<>|\x00-\x1f\x7f-\x9f]/g, '_');
  str = str.replace(/\s+/g, '_');
  str = str.replace(/[.\s_]+$/, '');
  str = str.slice(0, 64);

  return str || 'Creator';
}

/**
 * Formats YouTube video filename: [YouTube] {Title} - {Author} ({VideoId}).mp4
 *
 * @param {object} params
 * @param {string} params.title
 * @param {string} [params.author]
 * @param {string|number} [params.videoId]
 * @returns {string} Windows NTFS safe filename
 */
function formatYoutubeFilename(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const safeTitle = sanitizeYoutubeTitle(p.title);
  const safeAuthor = sanitizeYoutubeAuthor(p.author);
  const videoId = p.videoId || p.id;
  const safeId = sanitizeVideoId(videoId);

  return `[YouTube] ${safeTitle} - ${safeAuthor} (${safeId}).mp4`;
}

/**
 * Fetches video stream from URL with authentic Referer & Origin headers,
 * returning a Blob object.
 *
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<Blob>}
 */
async function fetchVideoBlob(url, options = {}) {
  const cleanUrl = typeof url === 'string' ? url.trim() : '';
  const isYoutube =
    cleanUrl.includes('googlevideo.com') ||
    cleanUrl.includes('youtube.com') ||
    (options && options.platform === 'youtube');
  const isJwplyr =
    cleanUrl.includes('overfetch.video') ||
    cleanUrl.includes('jwplyr.com') ||
    (options && options.platform === 'jwplyr');
  const isBstation =
    cleanUrl.includes('bilivideo.com') ||
    cleanUrl.includes('biliapi.net') ||
    cleanUrl.includes('bilibili.tv') ||
    cleanUrl.includes('bstation.tv') ||
    cleanUrl.includes('akamaized.net') ||
    (options && options.platform === 'bstation');
  const isTeraBox =
    cleanUrl.includes('terabox') ||
    cleanUrl.includes('1024tera') ||
    cleanUrl.includes('baidupcs') ||
    (options && options.platform === 'terabox');

  const defaultReferer = isTeraBox
    ? 'https://www.terabox.app/'
    : isYoutube
      ? 'https://www.youtube.com/'
      : isJwplyr
        ? 'https://jwplyr.com/'
        : isBstation
          ? 'https://www.bilibili.tv/'
          : 'https://www.tiktok.com/';
  const defaultOrigin = isTeraBox
    ? 'https://www.terabox.app'
    : isYoutube
      ? 'https://www.youtube.com'
      : isJwplyr
        ? 'https://jwplyr.com'
        : isBstation
          ? 'https://www.bilibili.tv'
          : 'https://www.tiktok.com';

  const referer = options && options.referer ? options.referer : defaultReferer;
  const origin = options && options.origin ? options.origin : defaultOrigin;

  const response = await fetch(cleanUrl, {
    method: 'GET',
    headers: {
      Referer: referer,
      Origin: origin
    },
    referrer: referer,
    referrerPolicy: 'origin-when-cross-origin'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  // Guard against HTML, XML, or JSON error pages returned with HTTP 200 (which cause .htm/.xml file downloads)
  if (response.headers && typeof response.headers.get === 'function') {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/plain')) {
      throw new Error('Received plain text error response instead of video stream');
    }
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      throw new Error('Received HTML error page instead of video stream');
    }
    if (contentType.includes('application/json')) {
      throw new Error('Received JSON error response instead of video stream');
    }
    if (contentType.includes('text/xml') || contentType.includes('application/xml')) {
      throw new Error('Received XML error response instead of video stream');
    }
  }

  const blob = await response.blob();
  if (
    blob &&
    blob.type &&
    (blob.type.includes('text/html') || blob.type.includes('application/xhtml+xml'))
  ) {
    throw new Error('Received HTML error page instead of video stream');
  }
  if (blob && blob.type && blob.type.includes('application/json')) {
    throw new Error('Received JSON error response instead of video stream');
  }
  if (
    blob &&
    blob.type &&
    (blob.type.includes('text/xml') || blob.type.includes('application/xml'))
  ) {
    throw new Error('Received XML error response instead of video stream');
  }
  if (!blob || (typeof blob.size === 'number' && blob.size === 0)) {
    throw new Error('Received empty video stream (0 bytes)');
  }

  return blob;
}

/**
 * Converts a Blob to a Base64 Data URL using streaming C++ APIs
 * (FileReader / Buffer) to prevent V8 JS heap thrashing.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function blobToDataUrl(blob) {
  if (!blob) throw new Error('Blob is required');
  const mimeType = blob.type && !blob.type.includes('text/html') ? blob.type : 'video/mp4';

  // Strategy 1: Native FileReader streaming (V8 C++ pipeline)
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to convert blob to data URL'));
        }
      };
      reader.onerror = () => reject(reader.error || new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
  }

  // Strategy 2: Node.js Buffer direct conversion (zero intermediate chunk allocations)
  if (typeof Buffer !== 'undefined' && typeof blob.arrayBuffer === 'function') {
    const buffer = await blob.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:${mimeType};base64,${base64}`;
  }

  // Strategy 3: Fast chunked fallback
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(buffer).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Records download telemetry in chrome.storage.local.
 * Increments downloadCount and prepends metadata to recentDownloads history.
 *
 * @param {object} params
 * @param {string} [params.author]
 * @param {string|number} [params.videoId]
 * @param {string|number} [params.id]
 * @param {string} [params.filename]
 * @param {number|null} [params.downloadId]
 * @returns {Promise<{ success: boolean, downloadCount: number, filename: string }>}
 */
function recordDownloadTelemetry(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const safeAuthor = sanitizeAuthor(p.author);
  const videoId = p.videoId || p.id;
  const safeVideoId = sanitizeVideoId(videoId);
  const safeFilename =
    typeof p.filename === 'string' && p.filename.trim()
      ? p.filename.trim()
      : formatFilename(p.author, videoId);
  const downloadId = p.downloadId || null;

  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return resolve({
        success: true,
        downloadCount: 0,
        filename: safeFilename
      });
    }

    try {
      chrome.storage.local.get(['downloadCount', 'recentDownloads', 'downloadHistory'], (data) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
          console.warn('[TikTok Downloader SW] Storage get error:', chrome.runtime.lastError);
        }

        const rawCount = Number(data && data.downloadCount);
        const count = !isNaN(rawCount) && rawCount >= 0 ? Math.floor(rawCount) + 1 : 1;
        const recent = data && Array.isArray(data.recentDownloads) ? data.recentDownloads : [];
        const history =
          data && data.downloadHistory && typeof data.downloadHistory === 'object'
            ? data.downloadHistory
            : {};

        recent.unshift({
          downloadId,
          filename: safeFilename,
          author: safeAuthor,
          videoId: safeVideoId,
          timestamp: Date.now()
        });

        history[safeVideoId] = {
          videoId: safeVideoId,
          filename: safeFilename,
          author: safeAuthor,
          timestamp: Date.now()
        };
        if (videoId && videoId !== safeVideoId) {
          history[videoId] = history[safeVideoId];
        }

        chrome.storage.local.set(
          {
            downloadCount: count,
            recentDownloads: recent.slice(0, 50),
            downloadHistory: history
          },
          () => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
              console.warn('[TikTok Downloader SW] Storage set error:', chrome.runtime.lastError);
            }
            resolve({
              success: true,
              downloadCount: count,
              filename: safeFilename
            });
          }
        );
      });
    } catch (err) {
      console.warn('[TikTok Downloader SW] Storage exception:', err);
      resolve({
        success: false,
        error: err.message,
        downloadCount: 0,
        filename: safeFilename
      });
    }
  });
}

/**
 * Executes file download via Fetch-to-Blob and chrome.downloads.download,
 * updating telemetry in storage.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} [params.author]
 * @param {string|number} [params.videoId]
 * @returns {Promise<object>}
 */
async function executeDownload(params) {
  if (!params || !params.url || typeof params.url !== 'string') {
    throw new Error('Invalid or missing video download URL');
  }

  const cleanUrl = params.url.trim();
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    throw new Error('URL must be an HTTP or HTTPS stream');
  }

  const isYoutube =
    params.platform === 'youtube' ||
    cleanUrl.includes('googlevideo.com') ||
    cleanUrl.includes('youtube.com');
  const isJwplyr =
    params.platform === 'jwplyr' ||
    cleanUrl.includes('overfetch.video') ||
    cleanUrl.includes('jwplyr.com');
  const isBstation =
    params.platform === 'bstation' ||
    cleanUrl.includes('bilivideo.com') ||
    cleanUrl.includes('biliapi.net') ||
    cleanUrl.includes('bilibili.tv') ||
    cleanUrl.includes('bstation.tv');
  const isTerabox =
    params.platform === 'terabox' ||
    cleanUrl.includes('terabox.app') ||
    cleanUrl.includes('1024tera.com') ||
    cleanUrl.includes('baidupcs.com') ||
    cleanUrl.includes('terabox.com');

  const videoId = params.videoId || params.id;
  const filename =
    params.filename ||
    (isYoutube
      ? formatYoutubeFilename({
          title: params.title,
          author: params.author,
          videoId: videoId
        })
      : isJwplyr
        ? sanitizeJwplyrFilename(params.title, videoId)
        : isBstation
          ? formatBstationFilename({
              title: params.title,
              episode: params.episode || params.epIndex,
              quality: params.quality
            })
          : formatFilename(params.author, videoId));

  if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.download) {
    throw new Error('chrome.downloads API is unavailable in this context');
  }

  // For YouTube and TeraBox (large files), bypass in-memory Blob buffering
  // (which causes OOM crashes or connection drops on large files)
  // and pass the authentic stream URL directly to Chrome's native download manager.
  // For other platforms (TikTok), fetch to Blob to bypass anti-hotlinking protections.
  let downloadUrl = cleanUrl;
  let isBlobUrl = false;

  if (!isYoutube && !isTerabox) {
    try {
      const blob = await fetchVideoBlob(cleanUrl);
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        downloadUrl = URL.createObjectURL(blob);
        isBlobUrl = true;
      } else {
        downloadUrl = await blobToDataUrl(blob);
      }
    } catch (fetchErr) {
      throw new Error(`Video stream fetch failed: ${fetchErr.message}`);
    }
  }

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: downloadUrl,
        filename: filename,
        conflictAction: 'uniquify',
        saveAs: false
      },
      async (downloadId) => {
        if (chrome.runtime.lastError) {
          if (
            isBlobUrl &&
            typeof URL !== 'undefined' &&
            typeof URL.revokeObjectURL === 'function'
          ) {
            try {
              URL.revokeObjectURL(downloadUrl);
            } catch (_) {}
          }
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!downloadId) {
          if (
            isBlobUrl &&
            typeof URL !== 'undefined' &&
            typeof URL.revokeObjectURL === 'function'
          ) {
            try {
              URL.revokeObjectURL(downloadUrl);
            } catch (_) {}
          }
          return reject(new Error('Download failed to start'));
        }

        // Clean up blob URL once download finishes or after timeout
        if (isBlobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          let listener = null;
          let timer = null;
          const cleanup = () => {
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            if (listener && chrome.downloads?.onChanged?.removeListener) {
              try {
                chrome.downloads.onChanged.removeListener(listener);
              } catch (_) {}
              listener = null;
            }
            try {
              URL.revokeObjectURL(downloadUrl);
            } catch (_) {}
          };

          if (chrome.downloads.onChanged) {
            listener = (delta) => {
              if (
                delta &&
                delta.id === downloadId &&
                (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')
              ) {
                cleanup();
              }
            };
            chrome.downloads.onChanged.addListener(listener);
          }

          timer = setTimeout(cleanup, 2000);
        }

        // Persist download statistics in chrome.storage.local
        await recordDownloadTelemetry({
          author: params.author,
          videoId: videoId,
          filename,
          downloadId
        });

        resolve({
          success: true,
          downloadId,
          filename,
          message: 'Download initiated successfully'
        });
      }
    );
  });
}

// Register dynamic declarativeNetRequest rules on install/update/startup (Fast / Cached)
async function ensureDnrRules() {
  try {
    if (
      typeof chrome !== 'undefined' &&
      chrome.declarativeNetRequest &&
      chrome.declarativeNetRequest.updateDynamicRules
    ) {
      const neededIds = [1, 2, 3, 11, 12, 13, 21, 22, 31, 32];

      // Fast check: Skip disk I/O if all dynamic rules are already active
      if (typeof chrome.declarativeNetRequest.getDynamicRules === 'function') {
        try {
          const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
          const currentIds = new Set(currentRules.map((r) => r.id));
          if (
            neededIds.every((id) => currentIds.has(id)) &&
            currentRules.length === neededIds.length
          ) {
            return;
          }
        } catch (_) {}
      }

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: neededIds,
        addRules: [
          ...TIKTOK_CDN_RULES,
          ...BSTATION_CDN_RULES,
          ...JWPLYR_CDN_RULES,
          ...YOUTUBE_CDN_RULES
        ]
      });
      console.log(
        '[Downloader SW] Dynamic DNR rules registered for ByteDance, Bstation, JWPlyr & YouTube CDNs'
      );
    }
  } catch (err) {
    console.warn('[Downloader SW] Failed to update dynamic DNR rules:', err);
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime) {
  if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(ensureDnrRules);
  }
  if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(ensureDnrRules);
  }
  // Guarantee DNR rules are immediately registered whenever Service Worker activates
  ensureDnrRules();
}

// Strict Filename Extension Guard: Prevent Chrome from renaming .mp4 downloads to .txt on server warnings
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (item && item.filename) {
      let finalName = item.filename;
      // Suppress any corrupt videoplayback.txt or error text dumps from googlevideo
      if (
        item.url &&
        item.url.includes('googlevideo.com') &&
        (finalName.endsWith('.txt') || finalName === 'videoplayback')
      ) {
        try {
          chrome.downloads.cancel(item.id, () => {
            if (chrome.downloads.erase) chrome.downloads.erase({ id: item.id });
          });
        } catch (_) {}
        return false;
      }
      if (finalName.includes('[YouTube]') && finalName.endsWith('.txt')) {
        finalName = finalName.replace(/\.txt$/, '.mp4');
        suggest({ filename: finalName, conflictAction: 'uniquify' });
        return true;
      }
    }
  });
}

// Global Download Failure Guard: Automatically erase interrupted 403 / text plain downloads
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    if (
      delta &&
      delta.error &&
      (delta.error.current === 'SERVER_BAD_CONTENT' || delta.error.current === 'SERVER_FORBIDDEN')
    ) {
      try {
        if (chrome.downloads.erase) {
          chrome.downloads.erase({ id: delta.id });
        }
      } catch (_) {}
    }
  });
}

const NATIVE_HOST_NAME = 'com.direct.downloader.host';

// In-Memory and Synchronized Active Downloads Registry
const activeDownloads = {};

function broadcastToAllTabs(payload) {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) return;
  try {
    chrome.tabs.query({}, (tabs) => {
      if (!Array.isArray(tabs)) return;
      tabs.forEach((tab) => {
        if (tab && tab.id) {
          try {
            chrome.tabs.sendMessage(tab.id, payload, () => {
              if (chrome.runtime.lastError) {
                /* ignore closed tab */
              }
            });
          } catch (_) {}
        }
      });
    });
  } catch (_) {}
}

function updateActionBadge(text, color = '#2563eb') {
  if (typeof chrome === 'undefined' || !chrome.action) return;
  try {
    if (chrome.action.setBadgeText) {
      chrome.action.setBadgeText({ text: text ? String(text) : '' });
    }
    if (chrome.action.setBadgeBackgroundColor && color) {
      chrome.action.setBadgeBackgroundColor({ color });
    }
  } catch (_) {}
}

/**
 * Emits native Chrome desktop notification (Windows Notification Center / System Tray).
 * Displays video title, author, file size, date, time, and status/error details.
 *
 * @param {object} params
 */
function showDesktopNotification({
  success,
  title,
  author,
  size,
  videoId,
  error,
  errorCode,
  filename
}) {
  if (typeof chrome === 'undefined' || !chrome.notifications || !chrome.notifications.create) {
    return;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

  const notifId = `dl_${success ? 'ok' : 'err'}_${videoId || Date.now()}_${Date.now()}`;
  const icon =
    chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL('icons/icon128.png')
      : 'icons/icon128.png';

  if (success) {
    const lines = [
      `Judul: ${title || filename || 'Video'}`,
      `Author: ${author || 'Creator'}`,
      size ? `Ukuran: ${size}` : null,
      `Waktu: ${dateStr}, ${timeStr}`,
      `Lokasi: Folder Downloads`
    ]
      .filter(Boolean)
      .join('\n');

    try {
      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: icon,
        title: '✓ Video Berhasil Didownload!',
        message: lines,
        priority: 2
      });
    } catch (e) {
      console.warn('[SW] Notification error:', e);
    }
  } else {
    const errText = errorCode
      ? `[${errorCode}] ${error || 'Unknown'}`
      : error || 'Gagal memproses unduhan';
    const lines = [
      `Judul: ${title || videoId || 'Video'}`,
      `Author: ${author || 'Creator'}`,
      `Waktu: ${dateStr}, ${timeStr}`,
      `Error: ${errText}`
    ]
      .filter(Boolean)
      .join('\n');

    try {
      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: icon,
        title: '✗ Gagal Mengunduh Video',
        message: lines,
        priority: 2
      });
    } catch (e) {
      console.warn('[SW] Notification error:', e);
    }
  }
}

// Concurrency Limiter & Download Queue (Max 2 concurrent yt-dlp processes)
const MAX_CONCURRENT_DOWNLOADS = 2;
let activeDownloadWorkers = 0;
const downloadQueue = [];

function checkAndProcessQueue() {
  if (activeDownloadWorkers >= MAX_CONCURRENT_DOWNLOADS) return;
  if (downloadQueue.length === 0) return;

  const nextJob = downloadQueue.shift();
  if (!nextJob) return;

  activeDownloadWorkers++;
  executeNativeDownloadWorker(nextJob.params, nextJob.tabId)
    .then((result) => {
      activeDownloadWorkers = Math.max(0, activeDownloadWorkers - 1);
      nextJob.resolve(result);
      checkAndProcessQueue();
    })
    .catch((err) => {
      activeDownloadWorkers = Math.max(0, activeDownloadWorkers - 1);
      nextJob.reject(err);
      checkAndProcessQueue();
    });
}

/**
 * Downloads YouTube video via local yt-dlp + FFmpeg Native Messaging Host.
 * Implements global concurrency queueing and data-saver preference resolution.
 * @param {object} params
 * @param {number|null} [tabId]
 * @returns {Promise<object>}
 */
function downloadViaNativeYtDlp(params = {}, tabId = null) {
  return new Promise((resolve, reject) => {
    const videoId =
      params.videoId || params.id || (params.url ? sanitizeVideoId(params.url) : null);
    if (!videoId) {
      return reject(new Error('Missing video identifier'));
    }

    // Duplicate Download Guard: Reject concurrent downloads of identical video
    if (
      activeDownloads[videoId] &&
      (activeDownloads[videoId].status === 'downloading' ||
        activeDownloads[videoId].status === 'queued')
    ) {
      const active = activeDownloads[videoId];
      return resolve({
        success: true,
        alreadyActive: true,
        message:
          active.status === 'queued'
            ? `Video "${active.title || videoId}" ada di dalam antrean unduhan...`
            : `Video "${active.title || videoId}" sedang diunduh (${active.part || 'Memproses'}: ${Math.round(active.percent || 0)}%)`,
        details: active
      });
    }

    const platform =
      params.platform ||
      (params.url && (params.url.includes('bilibili.tv') || params.url.includes('bilibili.com'))
        ? 'bstation'
        : 'youtube');

    // If active workers at capacity, enqueue job
    if (activeDownloadWorkers >= MAX_CONCURRENT_DOWNLOADS) {
      activeDownloads[videoId] = {
        videoId,
        title: params.title || (platform === 'bstation' ? 'Bstation Video' : 'YouTube Video'),
        author: params.author || (platform === 'bstation' ? 'Bstation' : 'Creator'),
        platform,
        startTime: Date.now(),
        status: 'queued',
        part: 'Dalam Antrean...',
        percent: 0,
        speed: '',
        totalSize: '',
        eta: ''
      };

      const queuedPayload = {
        type: 'YT_NATIVE_PROGRESS',
        platform,
        videoId: videoId,
        title: params.title,
        author: params.author,
        part: 'Dalam Antrean...',
        percent: 0,
        status: 'queued',
        message: 'Menunggu antrean unduhan lain selesai...'
      };
      broadcastToAllTabs(queuedPayload);
      broadcastToAllTabs({ ...queuedPayload, type: 'NATIVE_DOWNLOAD_PROGRESS' });

      downloadQueue.push({ params, tabId, resolve, reject });
      return;
    }

    activeDownloadWorkers++;
    executeNativeDownloadWorker(params, tabId)
      .then((res) => {
        activeDownloadWorkers = Math.max(0, activeDownloadWorkers - 1);
        resolve(res);
        checkAndProcessQueue();
      })
      .catch((err) => {
        activeDownloadWorkers = Math.max(0, activeDownloadWorkers - 1);
        reject(err);
        checkAndProcessQueue();
      });
  });
}

async function getNetscapeCookiesForUrl(targetUrl) {
  if (typeof chrome === 'undefined' || !chrome.cookies || !chrome.cookies.getAll) {
    return '';
  }
  try {
    const domainsToQuery = [];
    if (
      targetUrl.includes('bilibili.tv') ||
      targetUrl.includes('bilibili.com') ||
      targetUrl.includes('bstation.tv')
    ) {
      domainsToQuery.push(
        '.bilibili.tv',
        'bilibili.tv',
        '.bilibili.com',
        'bilibili.com',
        '.bstation.tv',
        'bstation.tv'
      );
    } else if (targetUrl.includes('youtube.com') || targetUrl.includes('youtu.be')) {
      domainsToQuery.push('.youtube.com', 'youtube.com', '.google.com');
    }

    if (domainsToQuery.length === 0) return '';

    const seenCookies = new Map();
    for (const d of domainsToQuery) {
      try {
        const list = await chrome.cookies.getAll({ domain: d });
        if (Array.isArray(list)) {
          for (const c of list) {
            const key = `${c.domain}:${c.name}:${c.path}`;
            if (!seenCookies.has(key)) {
              seenCookies.set(key, c);
            }
          }
        }
      } catch (_) {}
    }

    if (seenCookies.size === 0) return '';

    let netscape = '# Netscape HTTP Cookie File\n# http://curl.haxx.se/rfc/cookie_spec.html\n\n';
    const nowSec = Math.round(Date.now() / 1000);
    const oneYearFromNow = nowSec + 86400 * 365;

    for (const c of seenCookies.values()) {
      const d = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
      const sub = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const p = c.path || '/';
      const sec = c.secure ? 'TRUE' : 'FALSE';
      const exp = c.expirationDate ? Math.round(c.expirationDate) : oneYearFromNow;
      netscape += `${d}\t${sub}\t${p}\t${sec}\t${exp}\t${c.name}\t${c.value}\n`;
    }

    return netscape;
  } catch (err) {
    console.warn('[SW Cookie Exporter] Failed to extract cookies:', err);
    return '';
  }
}

async function executeNativeDownloadWorker(params = {}, _tabId = null) {
  const videoId = params.videoId || params.id;

  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connectNative) {
    throw new Error('chrome.runtime.connectNative is unavailable');
  }

  // Check data saver preference
  let isDataSaver = false;
  try {
    if (chrome.storage && chrome.storage.local) {
      const stored = await chrome.storage.local.get(['codecPreference']);
      isDataSaver = stored?.codecPreference === 'data_saver';
    }
  } catch (_) {}

  // Determine video URL and extract session cookies from Chrome if available
  const videoUrl =
    params.url ||
    (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)
      ? `https://www.youtube.com/watch?v=${videoId}`
      : null);

  let cookiesText = '';
  try {
    cookiesText = await getNetscapeCookiesForUrl(videoUrl || params.url || '');
  } catch (_) {}

  return new Promise((resolve, reject) => {
    let port = null;
    let isSettled = false;

    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (err) {
      return reject(new Error('Failed to connect to Native Host: ' + err.message));
    }

    const platform =
      params.platform ||
      (params.url && (params.url.includes('bilibili.tv') || params.url.includes('bilibili.com'))
        ? 'bstation'
        : 'youtube');

    // Register active download state
    activeDownloads[videoId] = {
      videoId,
      title: params.title || (platform === 'bstation' ? 'Bstation Video' : 'YouTube Video'),
      author: params.author || (platform === 'bstation' ? 'Bstation' : 'Creator'),
      platform,
      startTime: Date.now(),
      status: 'downloading',
      part: isDataSaver ? 'Video (Progressive)' : 'Memulai...',
      percent: 0,
      speed: '',
      totalSize: '',
      eta: ''
    };

    updateActionBadge('0%', '#2563eb');

    port.onMessage.addListener(async (msg) => {
      if (!msg) return;

      // Handle intermediate progress updates
      if (msg.type === 'PROGRESS') {
        const percent = typeof msg.percent === 'number' ? msg.percent : 0;
        const part = msg.part || (msg.status === 'merging' ? 'Muxing MP4' : 'Video');

        if (activeDownloads[videoId]) {
          activeDownloads[videoId].part = part;
          activeDownloads[videoId].percent = percent;
          activeDownloads[videoId].speed = msg.speed || '';
          activeDownloads[videoId].totalSize = msg.totalSize || '';
          activeDownloads[videoId].eta = msg.eta || '';
          activeDownloads[videoId].status = msg.status === 'merging' ? 'merging' : 'downloading';
        }

        // Update toolbar action badge
        if (msg.status === 'merging') {
          updateActionBadge('MUX', '#06b6d4');
        } else {
          const badgeText = `${Math.round(percent)}%`;
          const badgeColor = part.includes('Audio') ? '#8b5cf6' : '#2563eb';
          updateActionBadge(badgeText, badgeColor);
        }

        // Broadcast real-time progress to all tabs and popup
        const progPayload = {
          type: 'YT_NATIVE_PROGRESS',
          platform,
          videoId: videoId,
          title: params.title,
          author: params.author,
          part: part,
          percent: percent,
          speed: msg.speed,
          totalSize: msg.totalSize,
          eta: msg.eta,
          status: msg.status,
          message: msg.message
        };
        broadcastToAllTabs(progPayload);
        broadcastToAllTabs({ ...progPayload, type: 'NATIVE_DOWNLOAD_PROGRESS' });
        return;
      }

      // Handle final completion
      if (msg.success) {
        if (isSettled) return;
        isSettled = true;
        const finalName = msg.filename || `${params.title || 'YouTube_Video'}.mp4`;
        const sizeFormatted = msg.size || '';

        const now = new Date();
        const dateStr = now.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        const timeStr =
          now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

        if (activeDownloads[videoId]) {
          activeDownloads[videoId].status = 'complete';
          activeDownloads[videoId].filename = finalName;
          activeDownloads[videoId].size = sizeFormatted;
          activeDownloads[videoId].percent = 100;
        }

        updateActionBadge('✓', '#22c55e');
        setTimeout(() => {
          updateActionBadge('');
          delete activeDownloads[videoId];
        }, 8000);

        // Native Windows Desktop Notification
        showDesktopNotification({
          success: true,
          title: params.title,
          author: params.author,
          size: sizeFormatted,
          filename: finalName,
          videoId: videoId
        });

        const completePayload = {
          type: 'YT_NATIVE_COMPLETE',
          platform,
          videoId: videoId,
          filename: finalName,
          title: params.title,
          author: params.author,
          size: sizeFormatted,
          dateStr: dateStr,
          timeStr: timeStr,
          folder: msg.folder,
          message: 'Video berhasil tersimpan di Downloads!'
        };
        broadcastToAllTabs(completePayload);
        broadcastToAllTabs({ ...completePayload, type: 'NATIVE_DOWNLOAD_COMPLETE' });

        await recordDownloadTelemetry({
          author: params.author,
          videoId: videoId,
          title: params.title,
          platform: platform,
          filename: finalName
        });

        resolve({
          success: true,
          native: true,
          filename: finalName,
          size: sizeFormatted,
          folder: msg.folder,
          message: msg.message || 'Video tersimpan di folder Downloads!'
        });
        try {
          port.disconnect();
        } catch (_) {}
      } else {
        if (isSettled) return;
        isSettled = true;
        const now = new Date();
        const dateStr = now.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        const timeStr =
          now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
        const errorCode = msg.errorCode || 'ERR_YTDLP_FAIL';

        let displayError = msg.error || 'Download failed';
        if (
          displayError.includes('This video is only available for registered users') ||
          displayError.includes('login required')
        ) {
          displayError =
            'Episode ini memerlukan login akun Bstation. Silakan login ke akun Bstation kamu di browser lalu coba unduh lagi.';
        }

        if (activeDownloads[videoId]) {
          activeDownloads[videoId].status = 'error';
          activeDownloads[videoId].error = displayError;
          activeDownloads[videoId].errorCode = errorCode;
        }
        updateActionBadge('ERR', '#ef4444');
        setTimeout(() => {
          updateActionBadge('');
          delete activeDownloads[videoId];
        }, 6000);

        // Native Windows Desktop Notification (Error)
        showDesktopNotification({
          success: false,
          title: params.title,
          author: params.author,
          error: displayError,
          errorCode: errorCode,
          videoId: videoId
        });

        broadcastToAllTabs({
          type: 'YT_NATIVE_ERROR',
          videoId: videoId,
          title: params.title,
          author: params.author,
          error: displayError,
          errorCode: errorCode,
          dateStr: dateStr,
          timeStr: timeStr
        });

        reject(new Error(displayError));
        try {
          port.disconnect();
        } catch (_) {}
      }
    });

    port.onDisconnect.addListener(() => {
      if (isSettled) return;
      isSettled = true;
      try {
        port.postMessage({ action: 'CANCEL' });
      } catch (_) {}
      const err = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : 'Native host disconnected unexpectedly';
      delete activeDownloads[videoId];
      updateActionBadge('');
      reject(new Error(err));
    });

    // Send the DOWNLOAD command to the native host
    port.postMessage({
      action: 'DOWNLOAD',
      url: videoUrl,
      videoId: videoId,
      title: params.title,
      author: params.author,
      filename: params.filename,
      quality: params.quality || (isDataSaver ? '720p' : '1080p'),
      dataSaver: isDataSaver,
      cookiesText: cookiesText || undefined
    });
  });
}

// Primary IPC Listener
function handleMessage(message, sender, sendResponse) {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const actionType = message.type || message.action;

  // Handle CHECK_NATIVE_HOST
  if (actionType === 'CHECK_NATIVE_HOST') {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendNativeMessage) {
      sendResponse({ success: false, available: false });
      return false;
    }
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { action: 'PING' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          sendResponse({
            success: false,
            available: false,
            error: chrome.runtime.lastError?.message
          });
        } else {
          sendResponse({ success: true, available: true, details: response });
        }
      });
    } catch (e) {
      sendResponse({ success: false, available: false, error: e.message });
    }
    return true;
  }

  // Handle GET_ACTIVE_DOWNLOADS (For in-page button and popup active queue)
  if (actionType === 'GET_ACTIVE_DOWNLOADS') {
    sendResponse({
      success: true,
      activeDownloads: activeDownloads,
      count: Object.keys(activeDownloads).length
    });
    return true;
  }

  // Handle CHECK_DOWNLOADED_STATUS (For button gray state and redownload prompt)
  if (actionType === 'CHECK_DOWNLOADED_STATUS') {
    const vid = message.videoId || message.id;
    if (!vid) {
      sendResponse({ success: false, downloaded: false });
      return false;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['recentDownloads', 'downloadHistory'], (data) => {
        const recent = Array.isArray(data?.recentDownloads) ? data.recentDownloads : [];
        const history =
          data?.downloadHistory && typeof data.downloadHistory === 'object'
            ? data.downloadHistory
            : {};
        const safeId = sanitizeVideoId(vid);
        const match =
          history[safeId] ||
          history[vid] ||
          recent.find((r) => r.videoId === safeId || r.videoId === vid);
        sendResponse({
          success: true,
          downloaded: Boolean(match),
          details: match || null
        });
      });
      return true;
    } else {
      sendResponse({ success: true, downloaded: false });
      return false;
    }
  }

  // Handle RECORD_DOWNLOAD (Telemetry from in-page content script downloads)
  if (actionType === 'RECORD_DOWNLOAD') {
    const payload =
      message.payload && typeof message.payload === 'object' ? message.payload : message;
    recordDownloadTelemetry({
      author: payload.author,
      videoId: payload.videoId || payload.id,
      title: payload.title,
      platform: payload.platform,
      filename: payload.filename,
      downloadId: payload.downloadId
    })
      .then((result) => {
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[TikTok Downloader SW] RECORD_DOWNLOAD error:', err);
        sendResponse({
          success: false,
          error: err.message || 'Failed to record download telemetry'
        });
      });

    return true; // Keep IPC channel open for asynchronous response
  }

  // Handle DOWNLOAD_VIDEO (Fallback and direct downloads)
  if (actionType === 'DOWNLOAD_VIDEO') {
    const payload =
      message.payload && typeof message.payload === 'object' ? message.payload : message;
    const tabId = sender && sender.tab ? sender.tab.id : null;

    // If downloading from YouTube or Bstation, prioritize native yt-dlp host
    if (
      payload.platform === 'youtube' ||
      payload.platform === 'bstation' ||
      (payload.url &&
        (payload.url.includes('youtube.com') ||
          payload.url.includes('bilibili.tv') ||
          payload.url.includes('bilibili.com'))) ||
      payload.nativeOnly
    ) {
      downloadViaNativeYtDlp(payload, tabId)
        .then((result) => sendResponse(result))
        .catch((err) => {
          console.warn('[SW] Native yt-dlp error:', err.message);
          sendResponse({
            success: false,
            error: err.message || 'Gagal menjalankan yt-dlp host'
          });
        });
      return true;
    }

    executeDownload({
      url: payload.url,
      author: payload.author,
      videoId: payload.videoId || payload.id,
      title: payload.title || payload.desc,
      platform: payload.platform,
      episode: payload.episode || payload.epIndex,
      quality: payload.quality,
      filename: payload.filename
    })
      .then((result) => {
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[TikTok Downloader SW] DOWNLOAD_VIDEO error:', err);
        sendResponse({
          success: false,
          error: err.message || 'Download failed',
          details: err.stack || undefined
        });
      });

    return true; // Keep IPC channel open for asynchronous response
  }

  // Handle GET_STATS
  if (actionType === 'GET_STATS') {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['downloadCount', 'recentDownloads'], (data) => {
        sendResponse({
          success: true,
          downloadCount: (data && data.downloadCount) || 0,
          recentDownloads: data && Array.isArray(data.recentDownloads) ? data.recentDownloads : []
        });
      });
    } else {
      sendResponse({ success: true, downloadCount: 0, recentDownloads: [] });
    }
    return true;
  }

  // Handle OPEN_TAB (immune to browser popup blocker)
  if (actionType === 'OPEN_TAB') {
    const targetUrl = message.url || message.payload?.url;
    if (targetUrl && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: targetUrl, active: true }, (tab) => {
        sendResponse({ success: true, tabId: tab?.id });
      });
      return true;
    } else {
      sendResponse({ success: false, error: 'Invalid URL or chrome.tabs unavailable' });
      return false;
    }
  }

  // Handle PING
  if (actionType === 'PING') {
    sendResponse({ success: true, message: 'PONG', timestamp: Date.now() });
    return false;
  }

  return false;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener(handleMessage);
}

// Context Menu (Right-Click) Handler for TikTok Web
if (typeof chrome !== 'undefined' && chrome.contextMenus) {
  function setupContextMenu() {
    try {
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create(
          {
            id: 'download-tiktok-active',
            title: '⬇ Download Video/Konten TikTok Ini',
            contexts: ['all'],
            documentUrlPatterns: ['*://*.tiktok.com/*']
          },
          () => {
            if (chrome.runtime.lastError) {
              // Ignore duplicate menu warnings
            }
          }
        );

        chrome.contextMenus.create(
          {
            id: 'download-jwplyr-active',
            title: '⬇ Download Video JWPlyr Ini',
            contexts: ['all'],
            documentUrlPatterns: ['*://*.jwplyr.com/*']
          },
          () => {
            if (chrome.runtime.lastError) {
              // Ignore duplicate menu warnings
            }
          }
        );

        chrome.contextMenus.create(
          {
            id: 'download-youtube-active',
            title: '⬇ Download Video YouTube Ini (MP4)',
            contexts: ['all'],
            documentUrlPatterns: ['*://*.youtube.com/*']
          },
          () => {
            if (chrome.runtime.lastError) {
              // Ignore duplicate menu warnings
            }
          }
        );

        chrome.contextMenus.create(
          {
            id: 'download-terabox-active',
            title: '⬇ Download File TeraBox Ini',
            contexts: ['all'],
            documentUrlPatterns: [
              '*://*.terabox.com/*',
              '*://*.terabox.app/*',
              '*://*.1024tera.com/*'
            ]
          },
          () => {
            if (chrome.runtime.lastError) {
              // Ignore duplicate menu warnings
            }
          }
        );
      });
    } catch (_) {}
  }

  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(setupContextMenu);
  } else {
    setupContextMenu();
  }

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (
      (info.menuItemId === 'download-tiktok-active' ||
        info.menuItemId === 'download-jwplyr-active' ||
        info.menuItemId === 'download-youtube-active' ||
        info.menuItemId === 'download-terabox-active') &&
      tab &&
      tab.id
    ) {
      chrome.tabs.sendMessage(tab.id, { type: 'DOWNLOAD_ACTIVE_VIDEO' }, (_response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Direct Downloader] Tab messaging error:', chrome.runtime.lastError);
        }
      });
    }
  });
}

// ===========================================================================
// Mungil Security Shield: Dynamic Adblock Rules & DNR Synchronization
// ===========================================================================

const ADBLOCK_DYNAMIC_RULES = [
  {
    id: 90001,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||adsterra.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90002,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||popcash.net^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90003,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||propellerads.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90004,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||monetag.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90005,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||exoclick.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90006,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||clickadu.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90007,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||hilltopads.net^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90008,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||juicyads.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90009,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||yadro.ru^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90010,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||trafficspecialist.org^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90011,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||ophionbonish.cfd^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90012,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||073m.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image']
    }
  },
  {
    id: 90013,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||frs2c.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image', 'other']
    }
  },
  {
    id: 90014,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||fundingchoicesmessages.google.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image', 'other']
    }
  },
  {
    id: 90015,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||googleads.g.doubleclick.net^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image', 'other']
    }
  },
  {
    id: 90016,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||highperformancegate.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image', 'other']
    }
  },
  {
    id: 90017,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||admaven.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image', 'other']
    }
  },
  {
    id: 90018,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '||vidoomy.com^',
      resourceTypes: ['script', 'sub_frame', 'xmlhttprequest', 'image', 'other']
    }
  }
];

async function syncShieldAdblockRules(isEnabled) {
  if (
    typeof chrome === 'undefined' ||
    !chrome.declarativeNetRequest ||
    !chrome.declarativeNetRequest.updateDynamicRules
  ) {
    return;
  }
  const ruleIds = ADBLOCK_DYNAMIC_RULES.map((r) => r.id);
  try {
    if (isEnabled) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds,
        addRules: ADBLOCK_DYNAMIC_RULES
      });
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds
      });
    }
  } catch (err) {
    console.warn('[SW Shield] Failed to update dynamic DNR rules:', err);
  }
}

// Listen to storage changes for shield_adblock
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shield_adblock) {
      syncShieldAdblockRules(Boolean(changes.shield_adblock.newValue));
    }
  });
}

// Initialize on startup/install
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['shield_adblock'], (res) => {
    if (res?.shield_adblock) {
      syncShieldAdblockRules(true);
    }
  });
}

/**
 * Sanitizes TeraBox filename against Windows NTFS reserved characters & length constraints.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeTeraBoxFilename(raw) {
  if (!raw || typeof raw !== 'string') return 'TeraBox_File';

  let clean = raw
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .replace(/-+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  if (reserved.test(clean)) {
    clean = `TeraBox_${clean}`;
  }

  clean = clean.replace(/[. ]+$/, '');

  if (clean.length > 180) {
    const extMatch = clean.match(/\.[0-9a-z]{1,8}$/i);
    const ext = extMatch ? extMatch[0] : '';
    clean = clean.slice(0, 180 - ext.length) + ext;
  }

  return clean || 'TeraBox_File';
}

// Export for unit tests in Node environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeAuthor,
    sanitizeVideoId,
    formatFilename,
    fetchVideoBlob,
    blobToDataUrl,
    executeDownload,
    recordDownloadTelemetry,
    handleMessage,
    TIKTOK_CDN_RULES,
    BSTATION_CDN_RULES,
    JWPLYR_CDN_RULES,
    YOUTUBE_CDN_RULES,
    sanitizeBstationTitle,
    formatBstationEpisode,
    formatBstationFilename,
    sanitizeJwplyrFilename,
    sanitizeYoutubeTitle,
    sanitizeYoutubeAuthor,
    formatYoutubeFilename,
    sanitizeTeraBoxFilename,
    ADBLOCK_DYNAMIC_RULES,
    syncShieldAdblockRules
  };
}
