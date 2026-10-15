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
    episode = titleOrParams.episode !== undefined ? titleOrParams.episode : (titleOrParams.epIndex !== undefined ? titleOrParams.epIndex : 'E01');
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
 * Fetches video stream from URL with authentic Referer & Origin headers,
 * returning a Blob object.
 *
 * @param {string} url
 * @param {object} [options]
 * @returns {Promise<Blob>}
 */
async function fetchVideoBlob(url, options = {}) {
  const cleanUrl = typeof url === 'string' ? url.trim() : '';
  const isBstation = cleanUrl.includes('bilivideo.com') ||
                     cleanUrl.includes('biliapi.net') ||
                     cleanUrl.includes('bilibili.tv') ||
                     cleanUrl.includes('bstation.tv') ||
                     cleanUrl.includes('akamaized.net') ||
                     (options && options.platform === 'bstation');

  const referer = (options && options.referer)
    ? options.referer
    : (isBstation ? 'https://www.bilibili.tv/' : 'https://www.tiktok.com/');
  const origin = (options && options.origin)
    ? options.origin
    : (isBstation ? 'https://www.bilibili.tv' : 'https://www.tiktok.com');

  const response = await fetch(cleanUrl, {
    method: 'GET',
    headers: {
      'Referer': referer,
      'Origin': origin
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
  if (blob && blob.type && (blob.type.includes('text/html') || blob.type.includes('application/xhtml+xml'))) {
    throw new Error('Received HTML error page instead of video stream');
  }
  if (blob && blob.type && blob.type.includes('application/json')) {
    throw new Error('Received JSON error response instead of video stream');
  }
  if (blob && blob.type && (blob.type.includes('text/xml') || blob.type.includes('application/xml'))) {
    throw new Error('Received XML error response instead of video stream');
  }
  if (!blob || (typeof blob.size === 'number' && blob.size === 0)) {
    throw new Error('Received empty video stream (0 bytes)');
  }

  return blob;
}

/**
 * Converts a Blob to a Base64 Data URL.
 * Required in environments like Chrome Manifest V3 Service Workers
 * where URL.createObjectURL is unavailable.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
async function blobToDataUrl(blob) {
  if (!blob) throw new Error('Blob is required');
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 16384;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(buffer).toString('base64');
  const mimeType = (blob.type && !blob.type.includes('text/html')) ? blob.type : 'video/mp4';
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
  const p = (params && typeof params === 'object') ? params : {};
  const safeAuthor = sanitizeAuthor(p.author);
  const videoId = p.videoId || p.id;
  const safeVideoId = sanitizeVideoId(videoId);
  const safeFilename = (typeof p.filename === 'string' && p.filename.trim())
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
      chrome.storage.local.get(['downloadCount', 'recentDownloads'], (data) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
          console.warn('[TikTok Downloader SW] Storage get error:', chrome.runtime.lastError);
        }

        const rawCount = Number(data && data.downloadCount);
        const count = (!isNaN(rawCount) && rawCount >= 0) ? Math.floor(rawCount) + 1 : 1;
        const recent = (data && Array.isArray(data.recentDownloads)) ? data.recentDownloads : [];

        recent.unshift({
          downloadId,
          filename: safeFilename,
          author: safeAuthor,
          videoId: safeVideoId,
          timestamp: Date.now()
        });

        chrome.storage.local.set(
          {
            downloadCount: count,
            recentDownloads: recent.slice(0, 50)
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

  const isBstation = params.platform === 'bstation' ||
                     cleanUrl.includes('bilivideo.com') ||
                     cleanUrl.includes('biliapi.net') ||
                     cleanUrl.includes('bilibili.tv') ||
                     cleanUrl.includes('bstation.tv');

  const videoId = params.videoId || params.id;
  const filename = params.filename || (
    isBstation
      ? formatBstationFilename({
          title: params.title,
          episode: params.episode || params.epIndex,
          quality: params.quality
        })
      : formatFilename(params.author, videoId)
  );

  if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.download) {
    throw new Error('chrome.downloads API is unavailable in this context');
  }

  // Fetch video stream directly to Blob to bypass direct CDN 403 Forbidden (.htm download bug)
  let downloadUrl = cleanUrl;
  let isBlobUrl = false;

  try {
    const blob = await fetchVideoBlob(cleanUrl);
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      downloadUrl = URL.createObjectURL(blob);
      isBlobUrl = true;
    } else {
      // In Chrome Manifest V3 Service Worker where URL.createObjectURL is undefined,
      // convert Blob to a Base64 Data URL so chrome.downloads.download receives
      // the downloaded stream payload rather than reverting to the CDN URL (which causes 403 Forbidden .htm)
      downloadUrl = await blobToDataUrl(blob);
    }
  } catch (fetchErr) {
    throw new Error(`Video stream fetch failed: ${fetchErr.message}`);
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
          if (isBlobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            try { URL.revokeObjectURL(downloadUrl); } catch (_) {}
          }
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!downloadId) {
          if (isBlobUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            try { URL.revokeObjectURL(downloadUrl); } catch (_) {}
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
              try { chrome.downloads.onChanged.removeListener(listener); } catch (_) {}
              listener = null;
            }
            try { URL.revokeObjectURL(downloadUrl); } catch (_) {}
          };

          if (chrome.downloads.onChanged) {
            listener = (delta) => {
              if (delta && delta.id === downloadId && (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')) {
                cleanup();
              }
            };
            chrome.downloads.onChanged.addListener(listener);
          }

          timer = setTimeout(cleanup, 60000);
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

// Register dynamic declarativeNetRequest rules on install/update/startup
async function ensureDnrRules() {
  try {
    if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1, 2, 3, 11, 12, 13],
        addRules: [...TIKTOK_CDN_RULES, ...BSTATION_CDN_RULES]
      });
      console.log('[Downloader SW] Dynamic DNR rules registered for ByteDance & Bstation CDNs');
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
}

// Primary IPC Listener
function handleMessage(message, sender, sendResponse) {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const actionType = message.type || message.action;

  // Handle RECORD_DOWNLOAD (Telemetry from in-page content script downloads)
  if (actionType === 'RECORD_DOWNLOAD') {
    const payload = (message.payload && typeof message.payload === 'object') ? message.payload : message;
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
    const payload = (message.payload && typeof message.payload === 'object') ? message.payload : message;
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
          recentDownloads: (data && Array.isArray(data.recentDownloads)) ? data.recentDownloads : []
        });
      });
    } else {
      sendResponse({ success: true, downloadCount: 0, recentDownloads: [] });
    }
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
        chrome.contextMenus.create({
          id: 'download-tiktok-active',
          title: '⬇ Download Video/Konten TikTok Ini',
          contexts: ['all'],
          documentUrlPatterns: ['*://*.tiktok.com/*']
        }, () => {
          if (chrome.runtime.lastError) {
            // Ignore duplicate menu warnings
          }
        });
      });
    } catch (_) {}
  }

  if (chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(setupContextMenu);
  } else {
    setupContextMenu();
  }

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'download-tiktok-active' && tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'DOWNLOAD_ACTIVE_VIDEO' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[TikTok Downloader] Tab messaging error:', chrome.runtime.lastError);
        }
      });
    }
  });
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
    sanitizeBstationTitle,
    formatBstationEpisode,
    formatBstationFilename
  };
}
