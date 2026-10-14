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
 * Executes file download via chrome.downloads.download and updates telemetry in storage.
 *
 * @param {object} params
 * @param {string} params.url
 * @param {string} [params.author]
 * @param {string|number} [params.videoId]
 * @returns {Promise<object>}
 */
function executeDownload(params) {
  return new Promise((resolve, reject) => {
    if (!params || !params.url || typeof params.url !== 'string') {
      return reject(new Error('Invalid or missing video download URL'));
    }

    if (!params.url.startsWith('http://') && !params.url.startsWith('https://')) {
      return reject(new Error('URL must be an HTTP or HTTPS stream'));
    }

    const filename = formatFilename(params.author, params.videoId);

    if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.download) {
      return reject(new Error('chrome.downloads API is unavailable in this context'));
    }

    chrome.downloads.download(
      {
        url: params.url,
        filename: filename,
        conflictAction: 'uniquify',
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!downloadId) {
          return reject(new Error('Download failed to start'));
        }

        // Persist download statistics in chrome.storage.local
        if (chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(['downloadCount', 'recentDownloads'], (data) => {
            const count = (data.downloadCount || 0) + 1;
            const recent = Array.isArray(data.recentDownloads) ? data.recentDownloads : [];
            recent.unshift({
              downloadId,
              filename,
              author: sanitizeAuthor(params.author),
              videoId: sanitizeVideoId(params.videoId),
              timestamp: Date.now()
            });

            chrome.storage.local.set({
              downloadCount: count,
              recentDownloads: recent.slice(0, 50)
            });
          });
        }

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

// Register dynamic declarativeNetRequest rules on install/update
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(async () => {
    try {
      if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [1, 2, 3],
          addRules: TIKTOK_CDN_RULES
        });
        console.log('[TikTok Downloader SW] Dynamic DNR rules registered for ByteDance CDNs');
      }
    } catch (err) {
      console.warn('[TikTok Downloader SW] Failed to update dynamic DNR rules:', err);
    }
  });
}

// Primary IPC Listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') {
      return false;
    }

    const actionType = message.type || message.action;

    // Handle DOWNLOAD_VIDEO
    if (actionType === 'DOWNLOAD_VIDEO') {
      const payload = message.payload || message;
      executeDownload({
        url: payload.url,
        author: payload.author,
        videoId: payload.videoId || payload.id,
        title: payload.title || payload.desc
      })
        .then((result) => {
          sendResponse(result);
        })
        .catch((err) => {
          sendResponse({
            success: false,
            error: err.message || 'Download failed'
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
            downloadCount: data.downloadCount || 0,
            recentDownloads: data.recentDownloads || []
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
  });
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
    executeDownload,
    TIKTOK_CDN_RULES
  };
}
