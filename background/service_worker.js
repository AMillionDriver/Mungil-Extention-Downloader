/**
 * TikTok Direct Downloader - Background Service Worker (Manifest V3)
 * Handles:
 * 1. IPC listener for DOWNLOAD_VIDEO, GET_STATS, and PING messages.
 * 2. Strict Windows NTFS filename sanitization enforcing tiktok_@[author]_[id].mp4.
 * 3. declarativeNetRequest dynamic header rules (Referer/Origin) for ByteDance CDNs.
 * 4. chrome.downloads.download with conflictAction: "uniquify".
 * 5. Persistent download telemetry in chrome.storage.local.
 */

// Diagnostic Tracker Module (Manifest V3 Service Worker + Node.js Dual Support)
let diagnosticTrackerInstance = null;
if (typeof importScripts === 'function') {
  try {
    importScripts('diagnostic_tracker.js');
    if (typeof self !== 'undefined' && self.diagnosticTracker) {
      diagnosticTrackerInstance = self.diagnosticTracker;
      diagnosticTrackerInstance.loadJobs().catch(() => {});
    }
  } catch (_e) {}
} else if (typeof require === 'function') {
  try {
    const dt = require('./diagnostic_tracker.js');
    diagnosticTrackerInstance = dt.diagnosticTracker;
  } catch (_e) {}
}

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
      excludedInitiatorDomains: ['studio.youtube.com', 'upload.youtube.com'],
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
      excludedRequestDomains: [
        'studio.youtube.com',
        'upload.youtube.com',
        'accounts.youtube.com',
        'admin.youtube.com',
        'analytics.youtube.com'
      ],
      excludedInitiatorDomains: [
        'studio.youtube.com',
        'upload.youtube.com',
        'accounts.youtube.com',
        'admin.youtube.com',
        'analytics.youtube.com'
      ],
      resourceTypes: ['xmlhttprequest', 'media', 'other']
    }
  }
];

// Dynamic declarativeNetRequest rules for CosplayTele & Cossora stream CDNs
const COSPLAYTELE_CDN_RULES = [
  {
    id: 61,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://cosplaytele.com/' },
        { header: 'Origin', operation: 'set', value: 'https://cosplaytele.com' }
      ]
    },
    condition: {
      urlFilter: '*cosplaytele.com*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'image', 'other']
    }
  },
  {
    id: 62,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://cossora.stream/' },
        { header: 'Origin', operation: 'set', value: 'https://cossora.stream' }
      ],
      responseHeaders: [
        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
        { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, HEAD, OPTIONS' },
        { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' }
      ]
    },
    condition: {
      urlFilter: '*cossora.stream*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  }
];

// Dynamic declarativeNetRequest rules for Pinterest (*.pinimg.com) CDNs
const PINTEREST_CDN_RULES = [
  {
    id: 71,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://www.pinterest.com/' },
        { header: 'Origin', operation: 'set', value: 'https://www.pinterest.com' }
      ],
      responseHeaders: [
        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
        { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, HEAD, OPTIONS' },
        { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' }
      ]
    },
    condition: {
      urlFilter: '*pinimg.com*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'media', 'image', 'other']
    }
  }
];

// Dynamic declarativeNetRequest rules for Blogger Video (*.blogger.com) CDNs used by Anoboy
const ANOBOY_CDN_RULES = [
  {
    id: 81,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://anoboy.at/' },
        { header: 'Origin', operation: 'set', value: 'https://anoboy.at' }
      ],
      responseHeaders: [
        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
        { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, HEAD, OPTIONS' },
        { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' }
      ]
    },
    condition: {
      urlFilter: '*blogger.com/video.g*',
      resourceTypes: ['sub_frame', 'xmlhttprequest', 'media', 'other']
    }
  }
];

// Dynamic declarativeNetRequest rules for Shinigami Comics (*.shngm.io / *.shngm.id)
const SHINIGAMI_CDN_RULES = [
  {
    id: 91,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://11.shinigami.asia/' },
        { header: 'Origin', operation: 'set', value: 'https://11.shinigami.asia' }
      ],
      responseHeaders: [
        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
        { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, HEAD, OPTIONS' },
        { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' }
      ]
    },
    condition: {
      urlFilter: '*shngm.io*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'media', 'other']
    }
  },
  {
    id: 92,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Referer', operation: 'set', value: 'https://11.shinigami.asia/' },
        { header: 'Origin', operation: 'set', value: 'https://11.shinigami.asia' }
      ],
      responseHeaders: [
        { header: 'Access-Control-Allow-Origin', operation: 'set', value: '*' },
        { header: 'Access-Control-Allow-Methods', operation: 'set', value: 'GET, HEAD, OPTIONS' },
        { header: 'Access-Control-Allow-Headers', operation: 'set', value: '*' }
      ]
    },
    condition: {
      urlFilter: '*shngm.id*',
      resourceTypes: ['main_frame', 'sub_frame', 'image', 'xmlhttprequest', 'media', 'other']
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
 * Sanitizes CosplayTele post title / filename for Windows NTFS compatibility.
 * Replaces illegal colons, slashes, quotes, and control codes.
 *
 * @param {string} title
 * @returns {string} Sanitized title
 */
function sanitizeCosplayteleTitle(title) {
  if (title === null || title === undefined) return 'CosplayTele_Photo';
  let str = String(title).trim();
  if (!str) return 'CosplayTele_Photo';

  // Decode basic HTML entities (e.g. &#8211; -> -, &#8220; / &#8221; -> ")
  str = str.replace(/&#8211;|&#8212;/g, '-');
  str = str.replace(/&#8220;|&#8221;|&quot;/g, '');
  str = str.replace(/&amp;/g, '&');
  str = str.replace(/&lt;/g, '<');
  str = str.replace(/&gt;/g, '>');

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

  // Truncate to maximum safe length (120 chars)
  str = str.slice(0, 120).trim();
  str = str.replace(/[.\s_-]+$/, '');

  return str || 'CosplayTele_Photo';
}

/**
 * Formats CosplayTele image/video filename: {Title} - {Index}.{ext}
 *
 * @param {object} params
 * @param {string} params.title
 * @param {number|string} [params.index]
 * @param {string} [params.ext]
 * @returns {string} Windows NTFS safe filename
 */
function formatCosplayteleFilename(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const safeTitle = sanitizeCosplayteleTitle(p.title);
  const idx = p.index !== undefined && p.index !== null ? String(p.index).padStart(2, '0') : '';
  const ext = p.ext ? String(p.ext).replace(/^\./, '') : 'webp';

  if (idx) {
    return `${safeTitle} - ${idx}.${ext}`;
  }
  return `${safeTitle}.${ext}`;
}

/**
 * Sanitizes Pinterest Pin title / description for Windows NTFS compatibility.
 * Strips Win32 forbidden characters (\ / : * ? " < > |), control codes, and truncates to 120 chars.
 *
 * @param {string} title
 * @returns {string} Sanitized title
 */
function sanitizePinterestTitle(title) {
  if (title === null || title === undefined) return 'Pin';
  let str = String(title).trim();
  if (!str) return 'Pin';

  // Decode basic HTML entities
  str = str.replace(/&#8211;|&#8212;/g, '-');
  str = str.replace(/&#8220;|&#8221;|&quot;/g, '');
  str = str.replace(/&amp;/g, '&');
  str = str.replace(/&lt;/g, '<');
  str = str.replace(/&gt;/g, '>');

  // Normalize colons and slashes to dashes/spaces
  str = str.replace(/[:：]/g, ' - ');
  str = str.replace(/[/\\|]/g, '-');

  // Strip Win32 forbidden characters (* ? " < >) and control codes
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

  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  if (reserved.test(str)) {
    str = `Pin_${str}`;
  }

  return str || 'Pin';
}

/**
 * Sanitizes Pinterest pinner username / handle.
 *
 * @param {string} author
 * @returns {string} Sanitized author
 */
function sanitizePinterestAuthor(author) {
  if (author === null || author === undefined) return 'pinner';
  let str = String(author).trim();
  if (!str) return 'pinner';

  str = str.replace(/^[@.\s]+/, '');
  str = str.replace(/[/\\:*?"<>|\x00-\x1f\x7f-\x9f]/g, '_');
  str = str.replace(/\s+/g, '_');
  str = str.replace(/[.\s_]+$/, '');
  str = str.slice(0, 50);

  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reserved.test(str)) {
    str = `user_${str}`;
  }

  return str || 'pinner';
}

/**
 * Formats Pinterest image or video filename: [Pinterest] {Author} - {Title} ({pinId}).{ext}
 *
 * @param {object} params
 * @param {string} [params.author]
 * @param {string} [params.title]
 * @param {string|number} [params.pinId]
 * @param {number|string} [params.index]
 * @param {string} [params.ext]
 * @returns {string} Windows NTFS safe filename
 */
function formatPinterestFilename(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const safeAuthor = sanitizePinterestAuthor(p.author);
  const safeTitle = sanitizePinterestTitle(p.title);
  const safeId = p.pinId ? String(p.pinId).replace(/[^0-9a-zA-Z_-]/g, '') : '';
  const idx =
    p.index !== undefined && p.index !== null ? `_slide${String(p.index).padStart(2, '0')}` : '';
  const ext = p.ext ? String(p.ext).replace(/^\./, '') : 'jpg';

  const idSuffix = safeId ? ` (${safeId})` : '';
  return `[Pinterest] ${safeAuthor} - ${safeTitle}${idSuffix}${idx}.${ext}`;
}

/**
 * Sanitizes AnoBoy anime title / episode name for Windows NTFS compatibility.
 * Strips Win32 forbidden characters (\ / : * ? " < > |), control codes, and truncates to 120 chars.
 *
 * @param {string} title
 * @returns {string} Sanitized title
 */
function sanitizeAnoboyTitle(title) {
  if (title === null || title === undefined) return 'Anime';
  let str = String(title).trim();
  if (!str) return 'Anime';

  // Decode basic HTML entities
  str = str.replace(/&#8211;|&#8212;/g, '-');
  str = str.replace(/&#8220;|&#8221;|&quot;/g, '');
  str = str.replace(/&amp;/g, '&');
  str = str.replace(/&lt;/g, '<');
  str = str.replace(/&gt;/g, '>');

  // Normalize colons and slashes to dashes/spaces
  str = str.replace(/[:：]/g, ' - ');
  str = str.replace(/[/\\|]/g, '-');

  // Strip Win32 forbidden characters (* ? " < >) and control codes
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

  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  if (reserved.test(str)) {
    str = `Anime_${str}`;
  }

  return str || 'Anime';
}

/**
 * Formats AnoBoy video download filename.
 * Pattern: {ANIMETITLE}_{EPISODENUMBER}.mp4
 *
 * @param {object} params
 * @param {string} [params.animeTitle]
 * @param {string|number} [params.episodeNum]
 * @param {string} [params.ext]
 * @returns {string} Windows NTFS safe filename
 */
function formatAnoboyFilename(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const safeAnime = sanitizeAnoboyTitle(p.animeTitle || 'Anime');
  const epsRaw =
    p.episodeNum !== undefined && p.episodeNum !== null ? String(p.episodeNum).trim() : '01';
  const safeEps = epsRaw.padStart(2, '0');
  const ext = p.ext ? String(p.ext).replace(/^\./, '') : 'mp4';

  return `${safeAnime}_${safeEps}.${ext}`;
}

/**
 * Sanitizes Shinigami comic / manga title for Windows NTFS compatibility.
 *
 * @param {string} title
 * @returns {string} Safe title
 */
function sanitizeShinigamiTitle(title) {
  if (title === null || title === undefined) return 'Manga';
  let str = String(title).trim();
  if (!str) return 'Manga';

  str = str.replace(/&#8211;|&#8212;/g, '-');
  str = str.replace(/&#8220;|&#8221;|&quot;/g, '');
  str = str.replace(/&amp;/g, '&');
  str = str.replace(/&lt;/g, '<');
  str = str.replace(/&gt;/g, '>');

  str = str.replace(/[:：]/g, ' - ');
  str = str.replace(/[/\\|]/g, '-');
  str = str.replace(/[*?"<>|\x00-\x1f\x7f-\x9f]/g, '');
  str = str.replace(/\s+/g, ' ');
  str = str.replace(/-{2,}/g, '-');
  str = str.replace(/\s*-\s*/g, ' - ');
  str = str.replace(/^[.\s_-]+|[.\s_-]+$/g, '');
  str = str.slice(0, 120).trim();
  str = str.replace(/[.\s_-]+$/, '');

  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  if (reserved.test(str)) {
    str = `Manga_${str}`;
  }

  return str || 'Manga';
}

/**
 * Formats Shinigami comic download filename.
 * Pattern: {MANGATITLE}_Chapter_{CHAPTERNUMBER}.{ext}
 *
 * @param {object} params
 * @param {string} [params.mangaTitle]
 * @param {string} [params.title]
 * @param {string|number} [params.chapterNumber]
 * @param {string} [params.ext]
 * @returns {string} Windows NTFS safe filename
 */
function formatShinigamiFilename(titleOrParams, chapterNumber, ext) {
  let mangaTitle = '';
  let ch = chapterNumber;
  let fileExt = ext;

  if (typeof titleOrParams === 'object' && titleOrParams !== null) {
    mangaTitle = titleOrParams.mangaTitle || titleOrParams.title || 'Shinigami_Comic';
    ch = titleOrParams.chapterNumber;
    fileExt = titleOrParams.ext;
  } else {
    mangaTitle = titleOrParams || 'Shinigami_Comic';
  }

  const safeManga = sanitizeShinigamiTitle(mangaTitle)
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
  const chRaw = ch !== undefined && ch !== null ? String(ch).trim() : '1';
  const cleanExt = fileExt ? String(fileExt).replace(/^\./, '') : 'pdf';

  return `${safeManga}_Chapter_${chRaw}.${cleanExt}`;
}

/**
 * Decrypts Cossora.stream AES-256-CBC cipher link.
 * First 16 bytes is IV, remaining is ciphertext.
 *
 * @param {string} b64Cipher Base64 ciphertext
 * @param {string} keyStr UTF-8 key string (32 bytes)
 * @returns {Promise<string>} Decrypted playlist URL
 */
async function decryptCossoraVideoUrl(b64Cipher, keyStr) {
  if (!b64Cipher || !keyStr) throw new Error('Missing cipher or key');

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const rawStr = atob(b64Cipher);
    const rawBytes = new Uint8Array(rawStr.length);
    for (let i = 0; i < rawStr.length; i++) {
      rawBytes[i] = rawStr.charCodeAt(i);
    }
    const iv = rawBytes.slice(0, 16);
    const ciphertext = rawBytes.slice(16);
    const enc = new TextEncoder();
    const keyData = enc.encode(keyStr);

    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'AES-CBC' }, false, [
      'decrypt'
    ]);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: iv },
      cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBuffer);
  } else if (typeof require !== 'undefined') {
    const nodeCrypto = require('crypto');
    const raw = Buffer.from(b64Cipher, 'base64');
    const iv = raw.slice(0, 16);
    const ct = raw.slice(16);
    const key = Buffer.from(keyStr, 'utf8');
    const decipher = nodeCrypto.createDecipheriv('aes-256-cbc', key, iv);
    return decipher.update(ct, null, 'utf8') + decipher.final('utf8');
  }
  throw new Error('No crypto implementation available');
}

/**
 * Extracts and decrypts direct stream URL from Cossora embed iframe page.
 *
 * @param {string} embedUrl
 * @returns {Promise<{ streamUrl: string, posterUrl: string }>}
 */
async function extractCossoraStream(embedUrl) {
  if (!embedUrl || typeof embedUrl !== 'string') {
    throw new Error('Invalid embed URL');
  }

  const res = await fetch(embedUrl, {
    headers: {
      Referer: 'https://cosplaytele.com/',
      Origin: 'https://cosplaytele.com'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Cossora embed: HTTP ${res.status}`);
  }

  const html = await res.text();

  const vMatch = html.match(/const\s+videoURL\s*=\s*['"]([^'"]+)['"]/i);
  const kMatch = html.match(/decryptLink\(videoURL,\s*['"]([^'"]+)['"]\)/i);
  const pMatch = html.match(/const\s+portadaURL\s*=\s*['"]([^'"]+)['"]/i);

  if (!vMatch || !kMatch) {
    throw new Error('Video cipher parameters not found in Cossora embed');
  }

  const cipher = vMatch[1];
  const key = kMatch[1];
  const streamUrl = await decryptCossoraVideoUrl(cipher, key);

  let posterUrl = null;
  if (pMatch) {
    try {
      posterUrl = await decryptCossoraVideoUrl(pMatch[1], key);
    } catch (_) {}
  }

  return { streamUrl, posterUrl };
}

/**
 * Downloads and concatenates Cossora HLS video segments in the background,
 * bypassing content-script CORS restrictions, and dispatches to chrome.downloads.
 *
 * @param {string} embedUrl
 * @param {string} title
 * @param {number|null} [tabId]
 * @returns {Promise<{ success: boolean, downloadId: number, filename: string }>}
 */
async function downloadCossoraHlsStream(embedUrl, title, tabId = null) {
  const { streamUrl } = await extractCossoraStream(embedUrl);
  if (!streamUrl) throw new Error('Stream URL tidak ditemukan');

  const masterRes = await fetch(streamUrl);
  if (!masterRes.ok) throw new Error(`HTTP ${masterRes.status} saat membaca playlist video`);
  const masterText = await masterRes.text();

  let subM3u8Url = streamUrl;
  if (masterText.includes('#EXT-X-STREAM-INF')) {
    const lines = masterText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        subM3u8Url = trimmed.startsWith('http') ? trimmed : new URL(trimmed, streamUrl).href;
        break;
      }
    }
  }

  let segmentsText = masterText;
  if (subM3u8Url !== streamUrl) {
    const subRes = await fetch(subM3u8Url);
    if (!subRes.ok) throw new Error(`HTTP ${subRes.status} saat membaca sub-playlist video`);
    segmentsText = await subRes.text();
  }

  const segmentUrls = [];
  const lines = segmentsText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const fullUrl = trimmed.startsWith('http') ? trimmed : new URL(trimmed, subM3u8Url).href;
      segmentUrls.push(fullUrl);
    }
  }

  if (segmentUrls.length === 0) {
    throw new Error('Tidak ada segmen video Cossora yang ditemukan');
  }

  const buffers = new Array(segmentUrls.length);
  let completed = 0;
  const concurrency = 3;
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < segmentUrls.length) {
      const idx = nextIdx++;
      const segUrl = segmentUrls[idx];
      const res = await fetch(segUrl);
      if (!res.ok) throw new Error(`Gagal mengunduh segmen video ${idx + 1}`);
      buffers[idx] = await res.arrayBuffer();
      completed++;
      const pct = Math.round((completed / segmentUrls.length) * 100);
      if (tabId && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.sendMessage) {
        chrome.tabs
          .sendMessage(tabId, {
            type: 'COSSORA_DOWNLOAD_PROGRESS',
            completed,
            total: segmentUrls.length,
            percent: pct
          })
          .catch(() => {});
      }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, segmentUrls.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  const mergedBlob = new Blob(buffers, { type: 'video/mp4' });
  const filename = `${sanitizeCosplayteleTitle(title)}.mp4`;

  let downloadUrl;
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    downloadUrl = URL.createObjectURL(mergedBlob);
  } else {
    downloadUrl = await blobToDataUrl(mergedBlob);
  }

  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.download) {
      recordDownloadTelemetry({ platform: 'cosplaytele' });
      resolve({ success: true, downloadId: 9999, filename });
      return;
    }
    chrome.downloads.download(
      {
        url: downloadUrl,
        filename: filename,
        conflictAction: 'uniquify'
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          recordDownloadTelemetry({ platform: 'cosplaytele' });
          resolve({ success: true, downloadId, filename });
        }
      }
    );
  });
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
  const isCosplaytele =
    cleanUrl.includes('cosplaytele.com') || (options && options.platform === 'cosplaytele');
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

  const defaultReferer = isCosplaytele
    ? 'https://cosplaytele.com/'
    : isTeraBox
      ? 'https://www.terabox.app/'
      : isYoutube
        ? 'https://www.youtube.com/'
        : isJwplyr
          ? 'https://jwplyr.com/'
          : isBstation
            ? 'https://www.bilibili.tv/'
            : 'https://www.tiktok.com/';
  const defaultOrigin = isCosplaytele
    ? 'https://cosplaytele.com'
    : isTeraBox
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
      chrome.storage.local.get(
        ['downloadCount', 'recentDownloads', 'downloadHistory', 'smartDownloadHistory'],
        (data) => {
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
          const smartHistory =
            data && Array.isArray(data.smartDownloadHistory) ? data.smartDownloadHistory : [];

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

          const histId = `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const defaultFolder = 'C:\\Users\\flami\\Downloads';
          const resolvedPath =
            p.originalPath ||
            (p.folder ? `${p.folder}\\${safeFilename}` : `${defaultFolder}\\${safeFilename}`);

          smartHistory.unshift({
            id: histId,
            filename: safeFilename,
            title: p.title || safeFilename.replace(/\.[a-zA-Z0-9]+$/, ''),
            author: safeAuthor,
            platform: p.platform || 'video',
            sourceUrl: p.url || p.sourceUrl || null,
            downloadedAt: Date.now(),
            originalPath: resolvedPath,
            folder: p.folder || defaultFolder,
            size: p.size || '',
            sizeBytes: typeof p.sizeBytes === 'number' ? p.sizeBytes : null,
            resolution: p.quality || p.resolution || null,
            fileStatus: {
              state: 'EXISTS_ORIGINAL',
              currentPath: resolvedPath,
              lastChecked: Date.now()
            }
          });

          chrome.storage.local.set(
            {
              downloadCount: count,
              recentDownloads: recent.slice(0, 50),
              downloadHistory: history,
              smartDownloadHistory: smartHistory.slice(0, 500)
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
        }
      );
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
  const isCosplaytele = params.platform === 'cosplaytele' || cleanUrl.includes('cosplaytele.com');
  const isAnoboy =
    params.platform === 'anoboy' ||
    cleanUrl.includes('googlevideo.com') ||
    cleanUrl.includes('blogger.com') ||
    cleanUrl.includes('anoboy.');
  const isShinigami =
    params.platform === 'shinigami' ||
    cleanUrl.includes('shinigami.') ||
    cleanUrl.includes('shngm.');

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
          : isCosplaytele
            ? formatCosplayteleFilename({
                title: params.title,
                index: params.index,
                ext: params.ext
              })
            : isAnoboy
              ? formatAnoboyFilename({
                  animeTitle: params.title,
                  episodeNum: params.episode
                })
              : isShinigami
                ? formatShinigamiFilename({
                    mangaTitle: params.title,
                    chapterNumber: params.episode || params.chapter,
                    ext: params.ext
                  })
                : formatFilename(params.author, videoId));

  if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.download) {
    throw new Error('chrome.downloads API is unavailable in this context');
  }

  // Register desired filename for onDeterminingFilename override
  if (filename) {
    pendingFilenames.set(cleanUrl, filename);
  }

  // For YouTube, TeraBox, AnoBoy, and Shinigami (large files), bypass in-memory Blob buffering
  // (which causes OOM crashes or connection drops on large files)
  // and pass the authentic stream URL directly to Chrome's native download manager.
  // For other platforms (TikTok), fetch to Blob to bypass anti-hotlinking protections.
  let downloadUrl = cleanUrl;
  let isBlobUrl = false;

  if (!isYoutube && !isTerabox && !isAnoboy && !isShinigami) {
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
    if (downloadUrl && filename) {
      pendingFilenames.set(downloadUrl, filename);
    }
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
      const allRules = [
        ...TIKTOK_CDN_RULES,
        ...BSTATION_CDN_RULES,
        ...JWPLYR_CDN_RULES,
        ...YOUTUBE_CDN_RULES,
        ...COSPLAYTELE_CDN_RULES,
        ...PINTEREST_CDN_RULES,
        ...ANOBOY_CDN_RULES,
        ...SHINIGAMI_CDN_RULES
      ];
      const neededIds = allRules.map((r) => r.id);

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
        addRules: allRules
      });
      console.log(
        '[Downloader SW] Dynamic DNR rules registered for ByteDance, Bstation, JWPlyr, YouTube, CosplayTele, Pinterest, AnoBoy & Shinigami CDNs'
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

// Pending custom filenames registry for downloads where server Content-Disposition headers attempt to override
const pendingFilenames = new Map();

// Strict Filename Extension Guard: Prevent Chrome from renaming .mp4 downloads to .txt on server warnings
if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    if (!item) return;

    // Check if we registered an authentic custom filename for this download URL
    const desiredName =
      pendingFilenames.get(item.url) ||
      (item.finalUrl ? pendingFilenames.get(item.finalUrl) : null);

    if (desiredName) {
      suggest({ filename: desiredName, conflictAction: 'uniquify' });
      setTimeout(() => {
        pendingFilenames.delete(item.url);
        if (item.finalUrl) pendingFilenames.delete(item.finalUrl);
      }, 30000);
      return true;
    }

    if (item.filename) {
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
      suggest({ filename: finalName, conflictAction: 'uniquify' });
      return true;
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
const activeNativePorts = new Map();

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
          activeDownloads[videoId].status =
            msg.status === 'paused'
              ? 'paused'
              : msg.status === 'merging'
                ? 'merging'
                : 'downloading';
        }

        // Update toolbar action badge
        if (msg.status === 'paused') {
          updateActionBadge('||', '#f59e0b');
        } else if (msg.status === 'merging') {
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
        broadcastToAllTabs({ ...progPayload, type: 'DOOD_NATIVE_PROGRESS' });
        return;
      }

      // Ignore intermediate progress and pause/resume acks from completion handler
      if (
        msg.action === 'PAUSE_FAST_DOWNLOAD' ||
        msg.action === 'RESUME_FAST_DOWNLOAD' ||
        msg.status === 'paused'
      ) {
        return;
      }

      // Handle final completion - strictly require status === 'complete' or type === 'COMPLETE'
      if (msg.success && (msg.status === 'complete' || msg.type === 'COMPLETE')) {
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
      } else if (
        !msg.success &&
        msg.action !== 'PAUSE_FAST_DOWNLOAD' &&
        msg.action !== 'RESUME_FAST_DOWNLOAD'
      ) {
        if (isSettled) return;
        if (msg.status === 'paused' || activeDownloads[videoId]?.status === 'paused') {
          return;
        }
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
      activeNativePorts.delete(videoId);
      if (isSettled) return;
      if (activeDownloads[videoId] && activeDownloads[videoId].status === 'paused') {
        return;
      }
      isSettled = true;
      try {
        port.postMessage({ action: 'CANCEL' });
      } catch (_) {}
      const err = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : 'Native host disconnected unexpectedly';
      if (diagnosticTrackerInstance) {
        try {
          diagnosticTrackerInstance.failJob(videoId, err, {
            errorType: 'NATIVE_HOST_DISCONNECT'
          });
        } catch (_) {}
      }
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

/**
 * Downloads direct video streams (Blogger / Google Video / AnoBoy) using
 * multi-connection HTTP Range chunking via Chrome Native Messaging Host.
 * Bypasses Google's single-stream throttling without opening browser tabs.
 *
 * @param {object} params
 * @param {number|null} [tabId]
 * @returns {Promise<object>}
 */
async function downloadViaNativeChunker(params, _tabId) {
  const videoId =
    params.jobId ||
    params.videoId ||
    params.id ||
    `${params.platform || 'anoboy'}_${params.episode || Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  let cleanStreamUrl = (params.url || '').replace(/[\r\n]/g, '').trim();

  if (!cleanStreamUrl) {
    throw new Error('URL stream video tidak ditemukan.');
  }

  // Emergency resolution guard: If cleanStreamUrl points to Blogger iframe embed or raw ads token,
  // resolve it to a direct video stream first to prevent 16 KB HTML corruption.
  if (
    cleanStreamUrl.includes('blogger.com/video.g?token=') ||
    cleanStreamUrl.includes('adsbatch')
  ) {
    try {
      const resolved = await resolveAnoboyStream({
        url: cleanStreamUrl,
        preferredRes: params.resolution || '720p',
        referer: params.referer || 'https://anoboy.at/'
      });
      if (resolved && resolved.success && resolved.streamUrl) {
        cleanStreamUrl = resolved.streamUrl;
        params.url = resolved.streamUrl;
      } else {
        throw new Error(
          'CORRUPTED_STREAM: Server upstream tidak menyediakan stream video yang valid.'
        );
      }
    } catch (resErr) {
      throw new Error('Gagal meresolusi stream ke server Google Video: ' + resErr.message);
    }
  }

  try {
    const p = new URL(cleanStreamUrl);
    if (p.protocol !== 'https:' && p.protocol !== 'http:') {
      throw new Error(`Protokol tidak aman atau tidak didukung: ${p.protocol}`);
    }
  } catch (err) {
    throw new Error('URL stream tidak valid: ' + err.message);
  }

  // Initialize Diagnostic Job
  if (diagnosticTrackerInstance) {
    try {
      diagnosticTrackerInstance.createJob({
        jobId: videoId,
        platform: params.platform || 'anoboy',
        title: params.title || 'Video',
        rawUrl: cleanStreamUrl,
        episodeNum: params.episode || params.episodeNum || 1,
        resolution: params.resolution || '720p',
        expectedBytes: params.expectedBytes || 0,
        filename: params.filename || `${params.title || videoId}.mp4`
      });
    } catch (_) {}
  }

  return new Promise((resolve, reject) => {
    let port = null;
    let isSettled = false;

    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      activeNativePorts.set(videoId, port);
    } catch (err) {
      if (diagnosticTrackerInstance) {
        diagnosticTrackerInstance.failJob(
          videoId,
          'Gagal menghubungkan ke Native Host: ' + err.message,
          {
            errorType: 'NATIVE_HOST_CONNECT_FAIL'
          }
        );
      }
      if (diagnosticTrackerInstance) {
        diagnosticTrackerInstance.failJob(
          videoId,
          'Gagal menghubungkan ke Native Host: ' + err.message,
          {
            errorType: 'NATIVE_HOST_CONNECT_FAIL'
          }
        );
      }
      return reject(new Error('Gagal menghubungkan ke Native Host: ' + err.message));
    }

    const platform = params.platform || 'anoboy';

    // Register active download state
    activeDownloads[videoId] = {
      videoId,
      title: params.title || 'AnoBoy Episode',
      author: params.author || 'AnoBoy',
      platform,
      startTime: Date.now(),
      status: 'downloading',
      part: 'Turbo Chunker (16x)',
      percent: 0,
      speed: '',
      totalSize: '',
      eta: ''
    };

    updateActionBadge('0%', '#10b981');

    port.onMessage.addListener(async (msg) => {
      if (!msg) return;

      // Handle intermediate progress updates
      if (msg.type === 'PROGRESS') {
        const percent = typeof msg.percent === 'number' ? msg.percent : 0;
        const concurrencyStr = msg.concurrency ? ` (${msg.concurrency}x Adaptive)` : '';
        const part = msg.part || `Turbo Chunker${concurrencyStr}`;

        if (diagnosticTrackerInstance) {
          try {
            diagnosticTrackerInstance.updateProgress(videoId, percent, msg.speed, msg.eta);
            if (msg.chunk) {
              diagnosticTrackerInstance.recordChunk(videoId, msg.chunk);
            }
          } catch (_) {}
        }

        if (activeDownloads[videoId]) {
          activeDownloads[videoId].part = part;
          activeDownloads[videoId].percent = percent;
          activeDownloads[videoId].speed = msg.speed || '';
          activeDownloads[videoId].totalSize = msg.totalSize || '';
          activeDownloads[videoId].eta = msg.eta || '';
          activeDownloads[videoId].concurrency = msg.concurrency || null;
          activeDownloads[videoId].status = msg.status === 'paused' ? 'paused' : 'downloading';
        }

        if (msg.status === 'paused') {
          updateActionBadge('||', '#f59e0b');
        } else {
          const badgeText = `${Math.round(percent)}%`;
          updateActionBadge(badgeText, '#10b981');
        }

        const progPayload = {
          type: 'ANOBOY_NATIVE_PROGRESS',
          platform,
          jobId: videoId,
          videoId: videoId,
          title: params.title,
          part: part,
          percent: percent,
          speed: msg.speed,
          totalSize: msg.totalSize,
          eta: msg.eta,
          concurrency: msg.concurrency || null,
          status: msg.status,
          message: msg.message
        };
        broadcastToAllTabs(progPayload);
        broadcastToAllTabs({ ...progPayload, type: 'NATIVE_DOWNLOAD_PROGRESS' });
        broadcastToAllTabs({ ...progPayload, type: 'DOOD_NATIVE_PROGRESS' });
        return;
      }

      // Ignore intermediate progress and pause/resume acks from completion handler
      if (
        msg.action === 'PAUSE_FAST_DOWNLOAD' ||
        msg.action === 'RESUME_FAST_DOWNLOAD' ||
        msg.status === 'paused'
      ) {
        return;
      }

      // Handle final completion - strictly require status === 'complete' or type === 'COMPLETE'
      if (msg.success && (msg.status === 'complete' || msg.type === 'COMPLETE')) {
        if (isSettled) return;
        isSettled = true;
        const finalName = msg.filename || `${params.title || 'Video'}.mp4`;
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

        updateActionBadge('✓', '#10b981');
        setTimeout(() => {
          updateActionBadge('');
          delete activeDownloads[videoId];
        }, 8000);

        showDesktopNotification({
          success: true,
          title: params.title,
          author: params.author || 'AnoBoy',
          size: sizeFormatted,
          filename: finalName,
          videoId: videoId
        });

        const completePayload = {
          type: 'ANOBOY_NATIVE_COMPLETE',
          platform,
          jobId: videoId,
          videoId: videoId,
          filename: finalName,
          title: params.title,
          author: params.author || 'AnoBoy',
          size: sizeFormatted,
          dateStr: dateStr,
          timeStr: timeStr,
          folder: msg.folder,
          message: 'Video tersimpan di folder Downloads via Turbo Chunker!'
        };
        broadcastToAllTabs(completePayload);
        broadcastToAllTabs({ ...completePayload, type: 'NATIVE_DOWNLOAD_COMPLETE' });
        broadcastToAllTabs({ ...completePayload, type: 'DOOD_NATIVE_COMPLETE' });

        await recordDownloadTelemetry({
          author: params.author || 'AnoBoy',
          videoId: videoId,
          title: params.title,
          platform: platform,
          filename: finalName
        });

        if (diagnosticTrackerInstance) {
          try {
            diagnosticTrackerInstance.completeJob(videoId, {
              finalBytes: msg.rawBytes || 0,
              sha256: msg.sha256 || null,
              filePath: finalName
            });
          } catch (_) {}
        }

        activeNativePorts.delete(videoId);
        resolve({
          success: true,
          native: true,
          filename: finalName,
          size: sizeFormatted,
          folder: msg.folder,
          message: msg.message || 'Video tersimpan di folder Downloads via Turbo Chunker!'
        });
        try {
          port.disconnect();
        } catch (_) {}
      } else if (
        !msg.success &&
        msg.action !== 'PAUSE_FAST_DOWNLOAD' &&
        msg.action !== 'RESUME_FAST_DOWNLOAD'
      ) {
        if (isSettled) return;
        if (msg.status === 'paused' || activeDownloads[videoId]?.status === 'paused') {
          return;
        }
        isSettled = true;
        activeNativePorts.delete(videoId);
        const errorCode = msg.errorCode || 'ERR_TURBO_CHUNK_FAIL';
        const displayError = msg.error || 'Unduhan Turbo Chunker gagal';

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

        if (diagnosticTrackerInstance) {
          try {
            diagnosticTrackerInstance.failJob(videoId, displayError, {
              errorType: errorCode
            });
          } catch (_) {}
        }

        showDesktopNotification({
          success: false,
          title: params.title,
          author: params.author || 'AnoBoy',
          error: displayError,
          errorCode: errorCode,
          videoId: videoId
        });

        broadcastToAllTabs({
          type: 'ANOBOY_NATIVE_ERROR',
          jobId: videoId,
          videoId: videoId,
          title: params.title,
          error: displayError,
          errorCode: errorCode
        });
        broadcastToAllTabs({
          type: 'DOOD_NATIVE_ERROR',
          jobId: videoId,
          videoId: videoId,
          title: params.title,
          error: displayError,
          errorCode: errorCode
        });

        reject(new Error(displayError));
        try {
          port.disconnect();
        } catch (_) {}
      }
    });

    port.onDisconnect.addListener(() => {
      activeNativePorts.delete(videoId);
      if (isSettled) return;
      if (activeDownloads[videoId] && activeDownloads[videoId].status === 'paused') {
        return;
      }
      isSettled = true;
      try {
        port.postMessage({ action: 'CANCEL' });
      } catch (_) {}
      const err = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : 'Native host disconnected unexpectedly';
      if (diagnosticTrackerInstance) {
        try {
          diagnosticTrackerInstance.failJob(videoId, err, {
            errorType: 'NATIVE_HOST_DISCONNECT'
          });
        } catch (_) {}
      }
      delete activeDownloads[videoId];
      updateActionBadge('');
      reject(new Error(err));
    });

    const forwardHeaders = {};
    if (params.headers && typeof params.headers === 'object') {
      for (const [k, v] of Object.entries(params.headers)) {
        if (typeof k === 'string' && v !== null && v !== undefined) {
          const cleanK = k.replace(/[\r\n]/g, '').trim();
          const cleanV = String(v)
            .replace(/[\r\n]/g, '')
            .trim();
          if (cleanK) forwardHeaders[cleanK] = cleanV;
        }
      }
    }
    if (params.referer && typeof params.referer === 'string') {
      forwardHeaders['Referer'] = params.referer.replace(/[\r\n]/g, '').trim();
    }
    if (params.userAgent && typeof params.userAgent === 'string') {
      forwardHeaders['User-Agent'] = params.userAgent.replace(/[\r\n]/g, '').trim();
    }

    // Send FAST_RANGE_DOWNLOAD to native host
    port.postMessage({
      action: 'FAST_RANGE_DOWNLOAD',
      url: cleanStreamUrl,
      filename: params.filename,
      referer: params.referer || forwardHeaders['Referer'] || 'https://anoboy.at/',
      headers: forwardHeaders,
      customHeaders: forwardHeaders,
      videoId: videoId,
      jobId: videoId,
      title: params.title,
      author: params.author || (params.platform === 'doodstream' ? 'Doodstream' : 'AnoBoy'),
      userAgent: params.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      bloggerToken: params.bloggerToken || null,
      episodeUrl: params.episodeUrl || params.url || null
    });
  });
}

// =========================================================================
// AnoBoy / Blogger Video Direct Stream Resolvers
// =========================================================================

function extractStreamFromBloggerHtml(bloggerHtml, preferredRes = '720p') {
  if (!bloggerHtml || typeof bloggerHtml !== 'string') return null;

  // Strict regex: domain must directly be *.googlevideo.com
  const re =
    /https?:\/\/(?:[a-zA-Z0-9.\-_]+\.)?googlevideo\.com(?:\/|\\\/)videoplayback[^"'\s<>&;]+/g;
  let match;
  const streams = [];

  while ((match = re.exec(bloggerHtml)) !== null) {
    const raw = match[0];
    let decoded = raw
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
    if (s720) return s720.url;
  }
  if (preferredRes && preferredRes.includes('360')) {
    const s360 = streams.find((s) => s.itag === 18);
    if (s360) return s360.url;
  }

  // Fallback to highest available itag (22 > 18)
  streams.sort((a, b) => b.itag - a.itag);
  return streams[0].url;
}

function cleanAnoBoyToken(raw) {
  if (typeof raw !== 'string') return null;
  const str = raw.trim();
  if (!str) return null;

  const urlParamMatch = str.match(/[?&]url=([^&'"\s]+)/i);
  let candidate = urlParamMatch ? urlParamMatch[1] : str;

  const tokenParamMatch = candidate.match(/[?&]token=([^&'"\s]+)/i);
  if (tokenParamMatch) {
    candidate = tokenParamMatch[1];
  }

  candidate = candidate.split('&')[0].split('?')[0].split('#')[0].trim();
  return isValidAnoBoyToken(candidate) ? candidate : null;
}

function isValidAnoBoyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const clean = token.trim();
  const lower = clean.toLowerCase();

  if (
    !clean ||
    lower === 'none' ||
    lower.includes('none') ||
    lower === 'null' ||
    lower === 'undefined' ||
    lower === 'false' ||
    lower.includes('adsbatch') ||
    lower.includes('/') ||
    lower.includes('\\') ||
    lower.includes('.php') ||
    lower.includes('.html')
  ) {
    return false;
  }
  return clean.length >= 10;
}

function extractAnoBoyCandidateTokens(html, preferredRes = '720p') {
  if (!html || typeof html !== 'string') return [];
  const isHd = !preferredRes || preferredRes.includes('720') || preferredRes.includes('1080');

  // 1. Parse all <a ... id="allmiror" ...> elements
  const mirrorRegex =
    /<a[^>]*id=["']allmiror["'][^>]*data-video=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const mirrors = [];
  while ((m = mirrorRegex.exec(html)) !== null) {
    const videoData = m[1];
    const label = m[2].trim();
    const tokenClean = cleanAnoBoyToken(videoData);
    if (tokenClean) {
      mirrors.push({ label, token: tokenClean, videoData });
    }
  }

  const candidateTokens = [];

  // 2. If HD requested, prioritize mirrors matching 720 / HD with valid token
  if (isHd) {
    const m720 = mirrors.filter((x) => /720|hd/i.test(x.label));
    m720.forEach((item) => {
      if (!candidateTokens.includes(item.token)) candidateTokens.push(item.token);
    });
  }

  // 3. Add 360 / SD mirrors
  const m360 = mirrors.filter((x) => /360|sd/i.test(x.label));
  m360.forEach((item) => {
    if (!candidateTokens.includes(item.token)) candidateTokens.push(item.token);
  });

  // 4. Add any remaining mirrors with valid tokens
  mirrors.forEach((item) => {
    if (!candidateTokens.includes(item.token)) candidateTokens.push(item.token);
  });

  // 5. Check iframe #mediaplayer fallback
  const mediaplayerMatch = html.match(/id=["']mediaplayer["'][^>]*src=["']([^"']+)["']/i);
  if (mediaplayerMatch) {
    const clean = cleanAnoBoyToken(mediaplayerMatch[1]);
    if (clean && !candidateTokens.includes(clean)) {
      candidateTokens.push(clean);
    }
  }

  // 6. Check adsbatch fallback
  const generalMatch = html.match(/adsbatch(?:720)?\.php\?url=([^&"'>\s]+)/i);
  if (generalMatch) {
    const clean = cleanAnoBoyToken(generalMatch[1]);
    if (clean && !candidateTokens.includes(clean)) {
      candidateTokens.push(clean);
    }
  }

  return candidateTokens;
}

function extractAnoBoyTokenFromHtml(html, preferredRes = '720p') {
  const tokens = extractAnoBoyCandidateTokens(html, preferredRes);
  return tokens.length > 0 ? tokens[0] : null;
}

const WORKER_CONTROL_PLANE_URL = 'https://mungil-si-validator.nanangnurmansah5.workers.dev';
const WORKER_CLIENT_HANDSHAKE = 'mungil-extension/v1.0';

/**
 * Attempts fast edge resolution via Cloudflare Worker Control Plane with 600ms fail-fast budget.
 *
 * @param {string} targetUrl
 * @param {string} preferredRes
 * @param {string} [workerBase]
 * @returns {Promise<object|null>}
 */
async function resolveViaWorker(
  targetUrl,
  preferredRes = '720p',
  workerBase = WORKER_CONTROL_PLANE_URL
) {
  if (!targetUrl || typeof targetUrl !== 'string') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600);

  try {
    const endpoint = `${workerBase}/api/v2/resolve/anoboy?url=${encodeURIComponent(targetUrl)}&res=${encodeURIComponent(preferredRes)}`;
    const res = await fetch(endpoint, {
      headers: {
        'x-mungil-client': WORKER_CLIENT_HANDSHAKE
      },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data && data.success && data.directUrl) {
        // If directUrl returned is still an embed page, resolve it locally
        if (data.directUrl.includes('blogger.com/video.g?token=')) {
          const bloggerDirect = await resolveAnoboyStream({
            url: data.directUrl,
            preferredRes: data.resolvedQuality || preferredRes
          });
          if (bloggerDirect && bloggerDirect.success && bloggerDirect.streamUrl) {
            return {
              success: true,
              streamUrl: bloggerDirect.streamUrl,
              source: 'worker+blogger',
              resolvedQuality: bloggerDirect.itag === 22 ? '720p' : '360p',
              cacheLayer: res.headers.get('x-cache-layer') || 'UNKNOWN'
            };
          }
        }
        return {
          success: true,
          streamUrl: data.directUrl,
          source: 'worker',
          resolvedQuality: data.resolvedQuality || preferredRes,
          cacheLayer: res.headers.get('x-cache-layer') || 'UNKNOWN'
        };
      }
    }
  } catch (_e) {
    clearTimeout(timer);
  }
  return null;
}

async function resolveAnoboyStream(payload = {}) {
  const targetUrl = payload.url || '';
  const preferredRes = payload.preferredRes || payload.resolution || '720p';

  // Step 0: Try Edge Worker Control Plane (600ms fail-fast budget)
  if (targetUrl && (targetUrl.includes('anoboy.at') || targetUrl.includes('anoboy.'))) {
    const edgeResolved = await resolveViaWorker(targetUrl, preferredRes);
    if (edgeResolved && edgeResolved.success) {
      return edgeResolved;
    }
  }

  const tokens = [];

  if (payload.bloggerToken && isValidAnoBoyToken(payload.bloggerToken)) {
    tokens.push(payload.bloggerToken);
  }

  const directTokenMatch = targetUrl.match(/token=([a-zA-Z0-9_-]+)/);
  if (directTokenMatch && isValidAnoBoyToken(directTokenMatch[1])) {
    if (!tokens.includes(directTokenMatch[1])) tokens.push(directTokenMatch[1]);
  }

  // If targetUrl is an episode web page, fetch page to locate candidate tokens
  if (targetUrl && (targetUrl.includes('anoboy.at') || targetUrl.includes('anoboy.'))) {
    try {
      const pageRes = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (pageRes.ok) {
        const pageHtml = await pageRes.text();
        const extracted = extractAnoBoyCandidateTokens(pageHtml, preferredRes);
        extracted.forEach((t) => {
          if (!tokens.includes(t)) tokens.push(t);
        });

        if (tokens.length === 0) {
          // Check udl mirrors
          const mirrorMatch = pageHtml.match(
            /href=["'](https?:\/\/[^"']*(?:mp4upload\.com|gofile\.io)[^"']*)["']/i
          );
          if (mirrorMatch && mirrorMatch[1]) {
            return { success: true, streamUrl: mirrorMatch[1], isMirror: true };
          }
        }
      }
    } catch (e) {
      console.warn('[SW] resolveAnoboyStream page fetch error:', e.message);
    }
  }

  const activeReferer =
    payload.referer ||
    (payload.url && payload.url.startsWith('http')
      ? new URL(payload.url).origin + '/'
      : 'https://anoboy.at/');

  for (const token of tokens) {
    if (!isValidAnoBoyToken(token)) continue;
    try {
      const bloggerUrl = `https://www.blogger.com/video.g?token=${token}`;
      const res = await fetch(bloggerUrl, {
        headers: { Referer: activeReferer }
      });
      if (res.ok) {
        const html = await res.text();
        const directUrl = extractStreamFromBloggerHtml(html, preferredRes);
        if (directUrl) {
          return {
            success: true,
            streamUrl: directUrl,
            itag: directUrl.includes('itag=22') ? 22 : 18,
            isFallback:
              !directUrl.includes('itag=22') &&
              (preferredRes.includes('720') || preferredRes.includes('1080'))
          };
        }
      }
    } catch (e) {
      console.warn('[SW] resolveAnoboyStream Blogger fetch error:', e.message);
    }
  }

  return { success: false, error: 'Could not resolve playable stream for episode' };
}

/**
 * Post-processes literal machine translation into lively Indonesian comic scanlation style.
 * Adapts tone, pronouns, slang, and scene dynamics based on chosen comic genre.
 *
 * @param {string} text
 * @param {string} [genre]
 * @returns {string} Naturalized scanlation text
 */
function applyScanlationFilter(text, genre = 'action') {
  if (!text || typeof text !== 'string') return text;
  let str = text.trim();

  // Universal Comic Flow: Eliminate overly rigid formal phrasing
  str = str.replace(/\bPergilah\b/g, 'Hasil Investigasi');
  str = str.replace(/Di ruang pengarahan/gi, 'Ruang pers');
  str = str.replace(
    /Investigasi penuh di depan wartawan/gi,
    'Penyelidikan terbuka di hadapan media'
  );
  str = str.replace(/Hasilnya diumumkan\.?/gi, 'Pengumuman hasil akhir.');
  str = str.replace(/\bTidak mungkin\b/gi, 'Gak mungkin');
  str = str.replace(/\bTentu saja\b/gi, 'Tentu aja');
  str = str.replace(/\bTelah diumumkan\b/gi, 'Diumumkan');
  str = str.replace(/\bTelah terjadi\b/gi, 'Terjadi');
  str = str.replace(/\bSangat (senang|bahagia|marah|kecewa|takut)\b/gi, '$1 banget');
  str = str.replace(/\bMengapa kamu\b/gi, 'Kenapa lu');
  str = str.replace(/\bApa yang kamu lakukan\b/gi, 'Ngapain lu');
  str = str.replace(/\bTerkutuklah kamu\b/gi, 'Sialan lu');
  str = str.replace(/\bTerkutuk\b/gi, 'Sialan');

  if (genre === 'action') {
    // Action / School / Tawuran (e.g. True Education, Lookism, Weak Hero)
    str = str.replace(/\bApakah kamu\b/gi, 'Lu');
    str = str.replace(/\bKamu\b/g, 'Lu');
    str = str.replace(/\bSaya\b/g, 'Gue');
    str = str.replace(/\bAku\b/g, 'Gue');
    str = str.replace(/\bSaya akan\b/gi, 'Bakal gue');
    str = str.replace(/\bAku akan\b/gi, 'Bakal gue');
    str = str.replace(/\bMembunuhmu\b/gi, 'Habisi lu');
    str = str.replace(/\bHentikan\b/gi, 'Berhenti');
    str = str.replace(/\bSial\b/gi, 'Sialan');
  } else if (genre === 'fantasy' || genre === 'murim') {
    // Murim / Martial Arts / Fantasy
    str = str.replace(/\bApakah kamu\b/gi, 'Apa kau');
    str = str.replace(/\bSaya\b/g, 'Aku');
    str = str.replace(/\bTuan\b/gi, 'Tetua');
  } else if (genre === 'romance') {
    // Romance / Drama / Slice of Life
    str = str.replace(/\bApakah kamu\b/gi, 'Kamu...');
    str = str.replace(/\bSaya\b/g, 'Aku');
    str = str.replace(/\bSangat mencintaimu\b/gi, 'Sayang banget sama kamu');
  }

  return str;
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

  // Handle PAUSE_FAST_DOWNLOAD / PAUSE_DOWNLOAD
  if (actionType === 'PAUSE_FAST_DOWNLOAD' || actionType === 'PAUSE_DOWNLOAD') {
    const videoId = message.videoId || message.id || message.taskId;
    if (activeNativePorts.has(videoId)) {
      try {
        activeNativePorts.get(videoId).postMessage({ action: 'PAUSE_FAST_DOWNLOAD', videoId });
        if (activeDownloads[videoId]) activeDownloads[videoId].status = 'paused';
        broadcastToAllTabs({
          type: 'ANOBOY_NATIVE_PROGRESS',
          videoId,
          status: 'paused',
          speed: 'Dijeda'
        });
        sendResponse({ success: true, status: 'paused', videoId });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return false;
    }
    if (
      message.downloadId &&
      typeof chrome !== 'undefined' &&
      chrome.downloads &&
      chrome.downloads.pause
    ) {
      chrome.downloads.pause(message.downloadId, () => {
        sendResponse({
          success: !chrome.runtime.lastError,
          error: chrome.runtime.lastError?.message
        });
      });
      return true;
    }
    sendResponse({ success: false, error: 'Download not found or not active' });
    return false;
  }

  // Handle RESUME_FAST_DOWNLOAD / RESUME_DOWNLOAD
  if (actionType === 'RESUME_FAST_DOWNLOAD' || actionType === 'RESUME_DOWNLOAD') {
    const videoId = message.videoId || message.id || message.taskId;
    if (activeNativePorts.has(videoId)) {
      try {
        activeNativePorts.get(videoId).postMessage({ action: 'RESUME_FAST_DOWNLOAD', videoId });
        if (activeDownloads[videoId]) activeDownloads[videoId].status = 'downloading';
        const curPercent = activeDownloads[videoId]?.percent ?? 0;
        broadcastToAllTabs({
          type: 'ANOBOY_NATIVE_PROGRESS',
          videoId,
          status: 'downloading',
          percent: curPercent,
          speed: 'Melanjutkan...'
        });
        sendResponse({ success: true, status: 'downloading', videoId });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return false;
    }
    if (
      message.downloadId &&
      typeof chrome !== 'undefined' &&
      chrome.downloads &&
      chrome.downloads.resume
    ) {
      chrome.downloads.resume(message.downloadId, () => {
        sendResponse({
          success: !chrome.runtime.lastError,
          error: chrome.runtime.lastError?.message
        });
      });
      return true;
    }
    sendResponse({ success: false, error: 'Download not found or not paused' });
    return false;
  }

  // Handle CANCEL_FAST_DOWNLOAD / CANCEL_DOWNLOAD
  if (actionType === 'CANCEL_FAST_DOWNLOAD' || actionType === 'CANCEL_DOWNLOAD') {
    const videoId = message.videoId || message.id || message.taskId;
    if (activeNativePorts.has(videoId)) {
      try {
        activeNativePorts.get(videoId).postMessage({ action: 'CANCEL_FAST_DOWNLOAD', videoId });
        delete activeDownloads[videoId];
        activeNativePorts.delete(videoId);
        if (diagnosticTrackerInstance) {
          try {
            diagnosticTrackerInstance.failJob(videoId, 'Pengunduhan dibatalkan oleh pengguna', {
              errorType: 'CANCELLED_BY_USER',
              httpStatus: 499
            });
          } catch (_) {}
        }
        broadcastToAllTabs({
          type: 'ANOBOY_NATIVE_PROGRESS',
          videoId,
          status: 'cancelled',
          speed: 'Dibatalkan'
        });
        sendResponse({ success: true, status: 'cancelled', videoId });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return false;
    }
    if (
      message.downloadId &&
      typeof chrome !== 'undefined' &&
      chrome.downloads &&
      chrome.downloads.cancel
    ) {
      chrome.downloads.cancel(message.downloadId, () => {
        sendResponse({
          success: !chrome.runtime.lastError,
          error: chrome.runtime.lastError?.message
        });
      });
      return true;
    }
    sendResponse({ success: false, error: 'Download not found' });
    return false;
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

  // Handle EXTRACT_COSSORA_STREAM
  if (actionType === 'EXTRACT_COSSORA_STREAM') {
    extractCossoraStream(message.embedUrl)
      .then((result) => {
        sendResponse({ success: true, ...result });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // Handle DOWNLOAD_COSSORA_VIDEO
  if (actionType === 'DOWNLOAD_COSSORA_VIDEO') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    downloadCossoraHlsStream(message.embedUrl, message.title, tabId)
      .then((res) => {
        sendResponse(res);
      })
      .catch((err) => {
        console.error('[SW] Cossora HLS download error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
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

  // Handle RESOLVE_ANOBOY_STREAM
  if (actionType === 'RESOLVE_ANOBOY_STREAM') {
    const payload =
      message.payload && typeof message.payload === 'object' ? message.payload : message;
    resolveAnoboyStream(payload)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Handle DOWNLOAD_ANOBOY_NATIVE (Multi-connection Turbo Range Chunker)
  if (actionType === 'DOWNLOAD_ANOBOY_NATIVE') {
    const payload =
      message.payload && typeof message.payload === 'object' ? message.payload : message;
    const tabId = sender && sender.tab ? sender.tab.id : null;

    downloadViaNativeChunker(payload, tabId)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.warn('[SW] Turbo Chunker error:', err.message);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // Diagnostic Telemetry & Forensic Export Handlers
  if (actionType === 'DIAGNOSTIC_RECORD_JOB') {
    if (diagnosticTrackerInstance) {
      const job = diagnosticTrackerInstance.createJob(message.params || {});
      sendResponse({ success: true, job });
    } else {
      sendResponse({ success: false, error: 'Diagnostic tracker not active' });
    }
    return true;
  }
  if (actionType === 'DIAGNOSTIC_GET_JOB') {
    if (diagnosticTrackerInstance) {
      (async () => {
        if (diagnosticTrackerInstance.memoryJobs.size === 0) {
          await diagnosticTrackerInstance.loadJobs();
        }
        const job = diagnosticTrackerInstance.getJob(message.jobId);
        sendResponse({ success: true, job });
      })().catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    } else {
      sendResponse({ success: false, error: 'Diagnostic tracker not active' });
    }
    return true;
  }
  if (actionType === 'DIAGNOSTIC_GET_ALL') {
    if (diagnosticTrackerInstance) {
      (async () => {
        if (diagnosticTrackerInstance.memoryJobs.size === 0) {
          await diagnosticTrackerInstance.loadJobs();
        }
        const jobs = diagnosticTrackerInstance.getAllJobs();
        sendResponse({ success: true, jobs });
      })().catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    } else {
      sendResponse({ success: false, error: 'Diagnostic tracker not active' });
    }
    return true;
  }
  if (actionType === 'DIAGNOSTIC_EXPORT_MD') {
    if (diagnosticTrackerInstance) {
      (async () => {
        if (diagnosticTrackerInstance.memoryJobs.size === 0) {
          await diagnosticTrackerInstance.loadJobs();
        }
        const markdown = diagnosticTrackerInstance.generateMarkdownReport(message.jobId || null);
        sendResponse({ success: true, markdown });
      })().catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    } else {
      sendResponse({ success: false, error: 'Diagnostic tracker not active' });
    }
    return true;
  }
  if (actionType === 'DIAGNOSTIC_CLEAR') {
    if (diagnosticTrackerInstance) {
      diagnosticTrackerInstance.clearJobs();
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Diagnostic tracker not active' });
    }
    return true;
  }

  // Handle RESOLVE_DOOD_STREAM (Pass MD5 Token Handshake)
  if (actionType === 'RESOLVE_DOOD_STREAM') {
    const passUrl = message.passUrl;
    const referer = message.referer || 'https://dood.to/';
    fetch(passUrl, {
      method: 'GET',
      headers: {
        Referer: referer,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Doodstream HTTP ${res.status}: ${res.statusText}`);
        }
        const text = await res.text();
        sendResponse({ success: true, baseCdnUrl: text.trim() });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // Handle DOWNLOAD_DOOD_NATIVE / NATIVE_DOWNLOAD_STREAM
  if (actionType === 'DOWNLOAD_DOOD_NATIVE' || actionType === 'NATIVE_DOWNLOAD_STREAM') {
    const payload =
      message.payload && typeof message.payload === 'object' ? message.payload : message;
    const tabId = sender && sender.tab ? sender.tab.id : null;
    payload.platform = 'doodstream';
    payload.author = payload.author || 'Doodstream';
    payload.referer = payload.referer || payload.headers?.Referer || 'https://dood.to/';

    downloadViaNativeChunker(payload, tabId)
      .then((result) => sendResponse(result))
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  if (actionType === 'DOWNLOAD_VIDEO') {
    const payload =
      message.payload && typeof message.payload === 'object' ? message.payload : message;
    const tabId = sender && sender.tab ? sender.tab.id : null;

    // Auto-resolve Blogger HTML embeds to Google Video MP4 stream
    if (payload.url && payload.url.includes('blogger.com/video.g?token=')) {
      resolveAnoboyStream({ url: payload.url, preferredRes: payload.quality || '720p' })
        .then((resolved) => {
          if (resolved.success && resolved.streamUrl) {
            payload.url = resolved.streamUrl;
          }
          return executeDownload({
            url: payload.url,
            author: payload.author,
            videoId: payload.videoId || payload.id,
            title: payload.title || payload.desc,
            platform: payload.platform,
            episode: payload.episode || payload.epIndex,
            quality: payload.quality,
            filename: payload.filename
          });
        })
        .then((result) => sendResponse(result))
        .catch((err) => {
          console.error('[TikTok Downloader SW] DOWNLOAD_VIDEO error:', err);
          sendResponse({
            success: false,
            error: err.message || 'Download failed',
            details: err.stack || undefined
          });
        });
      return true;
    }

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

  // =========================================================================
  // Smart History & File Lifecycle Tracker Handlers
  // =========================================================================

  function callNativeHostOneOff(payload) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendNativeMessage) {
        return reject(new Error('chrome.runtime.sendNativeMessage is unavailable'));
      }
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        resolve(response);
      });
    });
  }

  // Handle GET_SMART_HISTORY
  if (actionType === 'GET_SMART_HISTORY') {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['smartDownloadHistory'], (data) => {
        const history = Array.isArray(data?.smartDownloadHistory) ? data.smartDownloadHistory : [];
        sendResponse({ success: true, history });
      });
    } else {
      sendResponse({ success: true, history: [] });
    }
    return true;
  }

  // Handle AUDIT_ALL_HISTORY_FILES
  if (actionType === 'AUDIT_ALL_HISTORY_FILES') {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['smartDownloadHistory'], async (data) => {
        const history = Array.isArray(data?.smartDownloadHistory) ? data.smartDownloadHistory : [];
        if (history.length === 0) {
          return sendResponse({ success: true, history: [] });
        }

        try {
          const res = await callNativeHostOneOff({
            action: 'AUDIT_FILE_STATUS_BATCH',
            items: history
          });

          if (res && res.success && Array.isArray(res.results)) {
            const resultMap = new Map(res.results.map((r) => [r.id, r]));
            const updatedHistory = history.map((item) => {
              if (resultMap.has(item.id)) {
                const audited = resultMap.get(item.id);
                return {
                  ...item,
                  fileStatus: {
                    state: audited.state,
                    currentPath: audited.currentPath,
                    sizeBytes: audited.sizeBytes,
                    lastChecked: audited.lastChecked
                  }
                };
              }
              return item;
            });

            chrome.storage.local.set({ smartDownloadHistory: updatedHistory }, () => {
              sendResponse({ success: true, history: updatedHistory });
            });
            return;
          }
          sendResponse({ success: true, history });
        } catch (err) {
          sendResponse({ success: false, error: err.message, history });
        }
      });
    } else {
      sendResponse({ success: false, error: 'Storage unavailable' });
    }
    return true;
  }

  // Handle OPEN_FILE_LOCATION
  if (actionType === 'OPEN_FILE_LOCATION') {
    const targetPath = message.filePath || message.path;
    callNativeHostOneOff({ action: 'OPEN_FILE_LOCATION', filePath: targetPath })
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Handle PLAY_LOCAL_VIDEO
  if (actionType === 'PLAY_LOCAL_VIDEO') {
    const targetPath = message.filePath || message.path;
    callNativeHostOneOff({ action: 'PLAY_VIDEO_FILE', filePath: targetPath })
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Handle OPEN_RECYCLE_BIN
  if (actionType === 'OPEN_RECYCLE_BIN') {
    callNativeHostOneOff({ action: 'OPEN_RECYCLE_BIN' })
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Handle CLEAR_SMART_HISTORY
  if (actionType === 'CLEAR_SMART_HISTORY') {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ smartDownloadHistory: [] }, () => {
        sendResponse({ success: true, history: [] });
      });
    } else {
      sendResponse({ success: true, history: [] });
    }
    return true;
  }

  // Handle REMOVE_HISTORY_ITEM
  if (actionType === 'REMOVE_HISTORY_ITEM') {
    const itemId = message.id;
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['smartDownloadHistory'], (data) => {
        const history = Array.isArray(data?.smartDownloadHistory) ? data.smartDownloadHistory : [];
        const filtered = history.filter((it) => it.id !== itemId);
        chrome.storage.local.set({ smartDownloadHistory: filtered }, () => {
          sendResponse({ success: true, history: filtered });
        });
      });
    } else {
      sendResponse({ success: true });
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

  // Handle FETCH_IMAGE_DATA (Background bypass for CORS-restricted image CDNs like assets.shngm.id)
  if (actionType === 'FETCH_IMAGE_DATA') {
    const imgUrl = message.url;
    if (!imgUrl) {
      sendResponse({ success: false, error: 'Missing image URL' });
      return false;
    }
    const referer = message.referer || 'https://11.shinigami.asia/';
    const origin = message.origin || 'https://11.shinigami.asia';

    fetch(imgUrl, {
      headers: {
        Referer: referer,
        Origin: origin
      }
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then(blobToDataUrl)
      .then((dataUrl) => {
        sendResponse({ success: true, dataUrl });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // Handle TRANSLATE_TEXT (Google Translate Free API proxy)
  if (actionType === 'TRANSLATE_TEXT') {
    const rawText = String(message.text || '').trim();
    const targetLang = message.targetLang || 'id';
    const sourceLang = message.sourceLang || 'auto';
    const genre = message.genre || 'action';

    if (!rawText) {
      sendResponse({ success: true, translation: '' });
      return false;
    }

    const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(rawText)}`;
    fetch(apiUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        let translation = rawText;
        if (data && Array.isArray(data[0])) {
          translation = data[0]
            .map((seg) => (seg && seg[0] ? seg[0] : ''))
            .filter(Boolean)
            .join(' ');
        }
        if (targetLang === 'id') {
          translation = applyScanlationFilter(translation, genre);
        }
        sendResponse({
          success: true,
          translation,
          detectedLang: data && data[2] ? data[2] : sourceLang
        });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message, translation: rawText });
      });
    return true;
  }

  // In-memory translation cache for instant 0ms retrieval on repeated phrases
  const comicTranslationCache = new Map();

  // Free OCR.space API key pool with automatic failover rotation to defuse E551 throttling
  const OCR_API_KEYS = ['K87899142388957', 'K88863647388957', 'K85868846888957', 'helloworld'];
  let currentApiKeyIndex = 0;

  function getNextApiKey() {
    const key = OCR_API_KEYS[currentApiKeyIndex];
    currentApiKeyIndex = (currentApiKeyIndex + 1) % OCR_API_KEYS.length;
    return key;
  }

  // Helper to query OCR.space with automatic key failover rotation
  async function fetchOcrLines(base64Image, lang, retryCount = 0) {
    const apiKey = getNextApiKey();
    const payload = new URLSearchParams({
      apikey: apiKey,
      isOverlayRequired: 'true',
      language: lang,
      OCREngine: '1',
      scale: 'false',
      detectOrientation: 'false',
      base64Image: base64Image.startsWith('data:')
        ? base64Image
        : `data:image/jpeg;base64,${base64Image}`
    });

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: payload,
        signal: controller.signal
      });
      clearTimeout(timeoutTimer);
      const data = await res.json();
      const errMsg = Array.isArray(data.ErrorMessage)
        ? data.ErrorMessage.join(' ')
        : String(data.ErrorMessage || data.error || '');

      if (
        (errMsg.includes('E551') ||
          errMsg.includes('overloaded') ||
          errMsg.includes('timed out') ||
          data.IsErroredOnProcessing) &&
        retryCount < OCR_API_KEYS.length - 1
      ) {
        return fetchOcrLines(base64Image, lang, retryCount + 1);
      }
      if (data.IsErroredOnProcessing || !data.ParsedResults?.[0]) {
        throw new Error(errMsg || 'OCR engine returned no text');
      }
      const overlay = data.ParsedResults[0].TextOverlay;
      return overlay?.Lines || [];
    } catch (err) {
      clearTimeout(timeoutTimer);
      if (retryCount < OCR_API_KEYS.length - 1) {
        return fetchOcrLines(base64Image, lang, retryCount + 1);
      }
      throw err;
    }
  }

  async function translateTextGtx(sourceText, targetLang, genre, lang) {
    const cacheKey = `${lang}:${targetLang}:${genre}:${sourceText.toLowerCase().trim()}`;
    if (comicTranslationCache.has(cacheKey)) {
      return comicTranslationCache.get(cacheKey);
    }

    let translated = sourceText;
    try {
      const tUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(sourceText)}`;
      const tRes = await fetch(tUrl);
      if (tRes.ok) {
        const tData = await tRes.json();
        if (tData && Array.isArray(tData[0])) {
          translated = tData[0]
            .map((seg) => (seg && seg[0] ? seg[0] : ''))
            .filter(Boolean)
            .join(' ');
        }
      }
    } catch (_) {}

    // Post-OCR hallucination cleaner: normalize whitespace and remove noise tokens
    if (lang === 'kor') {
      translated = translated.replace(/\bADALAH\s+TERMASUK\b/gi, '');
      translated = translated.replace(/\bJSa\s+Gyeonggi\b/gi, '');
      translated = translated.replace(/\b010-\d{3,4}-\d{4}\b/g, '');
      translated = translated.replace(/13\/-Lee\s+Myung-hee/gi, 'Lee Myung-hee');
      translated = translated.replace(/\bTuan\s+J\b/gi, 'Hasil Investigasi');
      translated = translated.replace(/\s{2,}/g, ' ').trim();
    }

    if (targetLang === 'id') {
      translated = applyScanlationFilter(translated, genre);
    }

    const finalResult = translated.trim();
    comicTranslationCache.set(cacheKey, finalResult);
    return finalResult;
  }

  // In handleMessage:
  // Handle OCR_AND_TRANSLATE_PANEL (Multi-tile OCR.space extraction + batch translation)
  if (actionType === 'OCR_AND_TRANSLATE_PANEL') {
    const lang = message.lang || 'kor'; // kor, eng, jpn, chs
    const targetLang = message.targetLang || 'id';
    const genre = message.genre || 'action';

    const tiles =
      message.tiles && Array.isArray(message.tiles) && message.tiles.length > 0
        ? message.tiles
        : message.base64Image
          ? [{ base64: message.base64Image, startY: 0 }]
          : null;

    if (!tiles) {
      sendResponse({ success: false, error: 'Missing image tiles or base64Image' });
      return false;
    }

    (async () => {
      try {
        const allParsedLines = [];

        // 1. Process each tile through OCR
        for (const tile of tiles) {
          const rawLines = await fetchOcrLines(tile.base64, lang);
          const yOffset = tile.startY || 0;

          for (const line of rawLines) {
            const lineText =
              line.LineText || (line.Words ? line.Words.map((w) => w.WordText).join(' ') : '');
            const clean = lineText.trim();
            if (!clean) continue;

            let minLeft = Infinity;
            let minTop = Infinity;
            let maxRight = -Infinity;
            let maxBottom = -Infinity;

            if (line.Words && line.Words.length > 0) {
              for (const w of line.Words) {
                minLeft = Math.min(minLeft, w.Left);
                minTop = Math.min(minTop, w.Top);
                maxRight = Math.max(maxRight, w.Left + w.Width);
                maxBottom = Math.max(maxBottom, w.Top + w.Height);
              }
            } else {
              minLeft = 0;
              minTop = line.MinTop || 0;
              maxRight = minLeft + 160;
              maxBottom = minTop + (line.MaxHeight || 30);
            }

            allParsedLines.push({
              text: clean,
              left: minLeft,
              top: minTop + yOffset,
              right: maxRight,
              bottom: maxBottom + yOffset,
              width: maxRight - minLeft,
              height: maxBottom - minTop
            });
          }
        }

        // 2. Deduplicate lines caught in overlap margins
        const dedupedLines = [];
        for (const line of allParsedLines) {
          const duplicate = dedupedLines.find(
            (d) =>
              Math.abs(d.top - line.top) < 18 &&
              Math.abs(d.left - line.left) < 30 &&
              d.text === line.text
          );
          if (!duplicate) {
            dedupedLines.push(line);
          }
        }

        // 3. Sort lines vertically (top to bottom)
        dedupedLines.sort((a, b) => a.top - b.top);

        // 4. Line Merging: Cluster vertically adjacent lines belonging strictly to same paragraph
        const clusters = [];
        for (const line of dedupedLines) {
          let matched = null;

          for (const cl of clusters) {
            const vDist = line.top - cl.bottom;
            const avgLineH = (cl.height / cl.lineCount + line.height) / 2;
            const hOverlap = Math.min(cl.right, line.right) - Math.max(cl.left, line.left);
            const minW = Math.min(cl.right - cl.left, line.width);

            const maxGap = Math.min(32, Math.max(12, avgLineH * 1.1));
            if (vDist >= -12 && vDist <= maxGap && hOverlap >= minW * 0.4) {
              matched = cl;
              break;
            }
          }

          if (matched) {
            matched.text += ' ' + line.text;
            matched.left = Math.min(matched.left, line.left);
            matched.top = Math.min(matched.top, line.top);
            matched.right = Math.max(matched.right, line.right);
            matched.bottom = Math.max(matched.bottom, line.bottom);
            matched.height = matched.bottom - matched.top;
            matched.lineCount += 1;
          } else {
            clusters.push({
              text: line.text,
              left: line.left,
              top: line.top,
              right: line.right,
              bottom: line.bottom,
              height: line.height,
              lineCount: 1
            });
          }
        }

        // 5. Batch translate merged clusters via caching layer
        const bubbles = [];
        for (const cl of clusters) {
          let sourceText = cl.text.trim();
          if (
            sourceText.length <= 1 &&
            !/[\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/.test(sourceText)
          ) {
            continue;
          }

          const padX = 6;
          const padY = 4;
          const bbox = {
            x: Math.max(0, Math.round(cl.left - padX)),
            y: Math.max(0, Math.round(cl.top - padY)),
            w: Math.round(cl.right - cl.left + padX * 2),
            h: Math.round(cl.bottom - cl.top + padY * 2)
          };

          const translated = await translateTextGtx(sourceText, targetLang, genre, lang);

          bubbles.push({
            bbox,
            originalText: sourceText,
            translatedText: translated
          });
        }

        sendResponse({ success: true, bubbles });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
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
    COSPLAYTELE_CDN_RULES,
    sanitizeCosplayteleTitle,
    formatCosplayteleFilename,
    decryptCossoraVideoUrl,
    extractCossoraStream,
    downloadCossoraHlsStream,
    ADBLOCK_DYNAMIC_RULES,
    syncShieldAdblockRules,
    PINTEREST_CDN_RULES,
    sanitizePinterestTitle,
    sanitizePinterestAuthor,
    formatPinterestFilename,
    ANOBOY_CDN_RULES,
    sanitizeAnoboyTitle,
    formatAnoboyFilename,
    extractStreamFromBloggerHtml,
    extractAnoBoyTokenFromHtml,
    resolveAnoboyStream,
    resolveViaWorker,
    WORKER_CONTROL_PLANE_URL,
    WORKER_CLIENT_HANDSHAKE,
    SHINIGAMI_CDN_RULES,
    sanitizeShinigamiTitle,
    formatShinigamiFilename,
    cleanAnoBoyToken,
    isValidAnoBoyToken,
    extractAnoBoyCandidateTokens,
    diagnosticTrackerInstance
  };
}
