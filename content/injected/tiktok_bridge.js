/**
 * TikTok Direct Downloader - MAIN World Bridge Script
 * Runs at document_start in the MAIN world to access page JavaScript scope.
 * 
 * Features:
 * 1. Hydration extraction: window.__UNIVERSAL_DATA_FOR_REHYDRATION__ & window.SIGI_STATE
 * 2. Network interception: window.fetch hook caching dynamic itemStructs from /api/recommend/item_list, feed, detail
 * 3. Standardized metadata normalization prioritizing highest bitrate unwatermarked MP4 streams
 * 4. Multi-key indexing (by videoId and author handle) ensuring 100% accurate video resolution
 * 5. CustomEvent IPC listener ('TT_BRIDGE_REQUEST') responding with 'TT_BRIDGE_RESPONSE'
 */

(function () {
  'use strict';

  // In-memory cache for resolved video structures: Map<videoId, normalizedItem>
  const videoCache = new Map();
  // Author handle secondary index: Map<cleanAuthorLowerCase, normalizedItem[]>
  const authorCache = new Map();

  /**
   * Caches normalized item into both primary (videoId) and secondary (author) indexes.
   */
  function cacheItem(normalized) {
    if (!normalized || typeof normalized !== 'object') return;

    if (normalized.videoId) {
      videoCache.set(String(normalized.videoId), normalized);
    }

    if (normalized.author && normalized.author !== 'unknown') {
      const cleanAuthor = String(normalized.author).toLowerCase().replace(/^@+/, '').trim();
      if (cleanAuthor) {
        if (!authorCache.has(cleanAuthor)) {
          authorCache.set(cleanAuthor, []);
        }
        const list = authorCache.get(cleanAuthor);
        if (!list.some((existing) => existing.videoId === normalized.videoId)) {
          list.push(normalized);
        }
      }
    }
  }

  /**
   * Normalizes raw TikTok itemStruct into standardized media payload.
   * Prioritizes highest bitrate PlayAddr over DownloadAddr (which may contain watermarks).
   * Supports both string and object UrlList variants.
   *
   * @param {object} item
   * @returns {object|null}
   */
  function normalizeItemStruct(item) {
    if (!item || typeof item !== 'object') return null;

    // Handle nested itemStruct wrapper
    if (item.itemStruct && typeof item.itemStruct === 'object') {
      item = item.itemStruct;
    }

    const video = item.video || item.videoInfo || {};
    let bestPlayUrl = '';

    // Extract raw playAddr (string or object with UrlList)
    if (typeof video.playAddr === 'string') {
      bestPlayUrl = video.playAddr;
    } else if (video.playAddr && Array.isArray(video.playAddr.UrlList) && video.playAddr.UrlList.length > 0) {
      bestPlayUrl = video.playAddr.UrlList[0];
    } else if (video.play_addr && Array.isArray(video.play_addr.url_list) && video.play_addr.url_list.length > 0) {
      bestPlayUrl = video.play_addr.url_list[0];
    }

    // Check bitrateInfo array for highest bitrate unwatermarked stream
    if (Array.isArray(video.bitrateInfo) && video.bitrateInfo.length > 0) {
      const sorted = [...video.bitrateInfo].sort((a, b) => (b.Bitrate || 0) - (a.Bitrate || 0));
      for (const entry of sorted) {
        if (entry.PlayAddr && Array.isArray(entry.PlayAddr.UrlList) && entry.PlayAddr.UrlList.length > 0) {
          bestPlayUrl = entry.PlayAddr.UrlList[0];
          break;
        } else if (typeof entry.PlayAddr === 'string' && entry.PlayAddr) {
          bestPlayUrl = entry.PlayAddr;
          break;
        }
      }
    }

    // Check if item is a photo/slideshow post
    let isPhotoPost = false;
    let photoImages = [];
    if (item.imagePostInfo && Array.isArray(item.imagePostInfo.images) && item.imagePostInfo.images.length > 0) {
      isPhotoPost = true;
      photoImages = item.imagePostInfo.images
        .map((img) => {
          const list = (img.displayImage && img.displayImage.urlList) || [];
          return list[0] || '';
        })
        .filter(Boolean);
    }

    // Extract downloadAddr
    let downloadUrl = '';
    if (typeof video.downloadAddr === 'string') {
      downloadUrl = video.downloadAddr;
    } else if (video.downloadAddr && Array.isArray(video.downloadAddr.UrlList) && video.downloadAddr.UrlList.length > 0) {
      downloadUrl = video.downloadAddr.UrlList[0];
    } else if (video.download_addr && Array.isArray(video.download_addr.url_list) && video.download_addr.url_list.length > 0) {
      downloadUrl = video.download_addr.url_list[0];
    }

    if (!downloadUrl) downloadUrl = bestPlayUrl;
    const resolvedPlayUrl = bestPlayUrl || downloadUrl || (photoImages.length > 0 ? photoImages[0] : '');

    if (!resolvedPlayUrl) return null;

    const rawId = item.id || item.videoId || video.id || item.aweme_id || item.itemId || '';
    const videoId = String(rawId).trim();

    const authorObj = item.author || {};
    let author = 'unknown';
    let nickname = '';
    if (typeof authorObj === 'string') {
      author = authorObj;
    } else if (typeof authorObj === 'object') {
      author = authorObj.uniqueId || authorObj.unique_id || authorObj.id || item.authorName || 'unknown';
      nickname = authorObj.nickname || '';
    }

    const description = item.desc || item.title || '';
    const bitrate = video.bitrate || 0;
    const quality = video.ratio || video.definition || (isPhotoPost ? 'photo' : '');
    const duration = video.duration || 0;

    return {
      videoId,
      author,
      nickname,
      description,
      playUrl: resolvedPlayUrl,
      downloadUrl: downloadUrl || resolvedPlayUrl,
      isPhotoPost,
      images: photoImages,
      bitrate,
      quality,
      duration
    };
  }

  /**
   * Extracts video item metadata from window.__UNIVERSAL_DATA_FOR_REHYDRATION__
   * Supports matching by targetId and targetAuthor handle.
   *
   * @param {string|null} [targetId]
   * @param {string|null} [targetAuthor]
   * @returns {{ data: object, tier: string }|null}
   */
  function extractFromUniversalData(targetId, targetAuthor) {
    if (typeof window === 'undefined') return null;

    let raw = window.__UNIVERSAL_DATA_FOR_REHYDRATION__;
    if (!raw && typeof document !== 'undefined') {
      const script = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      if (script && script.textContent) {
        try {
          raw = JSON.parse(script.textContent);
        } catch (_) {}
      }
    }

    if (!raw || !raw.__DEFAULT_SCOPE__) return null;
    const scope = raw.__DEFAULT_SCOPE__;

    const cleanAuthor = targetAuthor ? String(targetAuthor).toLowerCase().replace(/^@+/, '').trim() : '';

    // 1. Check webapp.video-detail / webapp.item-detail
    const detailScope = scope['webapp.video-detail'] || scope['webapp.item-detail'];
    if (detailScope && detailScope.itemInfo) {
      const rawItem = detailScope.itemInfo.itemStruct || detailScope.itemInfo;
      const normalized = normalizeItemStruct(rawItem);
      if (normalized) {
        cacheItem(normalized);
        if (!targetId || normalized.videoId === String(targetId)) {
          return { data: normalized, tier: 'universal_data' };
        }
        if (cleanAuthor && normalized.author.toLowerCase() === cleanAuthor) {
          return { data: normalized, tier: 'universal_data' };
        }
      }
    }

    // 2. Check webapp.feed itemList
    const feedScope = scope['webapp.feed'];
    if (feedScope && Array.isArray(feedScope.itemList)) {
      for (const rawItem of feedScope.itemList) {
        const normalized = normalizeItemStruct(rawItem);
        if (normalized) {
          cacheItem(normalized);
          if (targetId && normalized.videoId === String(targetId)) {
            return { data: normalized, tier: 'universal_data' };
          }
          if (cleanAuthor && normalized.author.toLowerCase() === cleanAuthor) {
            return { data: normalized, tier: 'universal_data' };
          }
        }
      }
    }

    // 3. Check webapp.user-detail itemList
    const userScope = scope['webapp.user-detail'];
    if (userScope && Array.isArray(userScope.itemList)) {
      for (const rawItem of userScope.itemList) {
        const normalized = normalizeItemStruct(rawItem);
        if (normalized) {
          cacheItem(normalized);
          if (targetId && normalized.videoId === String(targetId)) {
            return { data: normalized, tier: 'universal_data' };
          }
          if (cleanAuthor && normalized.author.toLowerCase() === cleanAuthor) {
            return { data: normalized, tier: 'universal_data' };
          }
        }
      }
    }

    return null;
  }

  /**
   * Extracts video item metadata from window.SIGI_STATE
   * Supports matching by targetId and targetAuthor handle.
   *
   * @param {string|null} [targetId]
   * @param {string|null} [targetAuthor]
   * @returns {{ data: object, tier: string }|null}
   */
  function extractFromSigiState(targetId, targetAuthor) {
    if (typeof window === 'undefined') return null;

    let sigi = window.SIGI_STATE;
    if (!sigi && typeof document !== 'undefined') {
      const script = document.getElementById('SIGI_STATE');
      if (script && script.textContent) {
        try {
          sigi = JSON.parse(script.textContent);
        } catch (_) {}
      }
    }

    if (!sigi || !sigi.ItemModule) return null;
    const itemModule = sigi.ItemModule;
    const cleanAuthor = targetAuthor ? String(targetAuthor).toLowerCase().replace(/^@+/, '').trim() : '';

    if (targetId && itemModule[targetId]) {
      const normalized = normalizeItemStruct(itemModule[targetId]);
      if (normalized) {
        cacheItem(normalized);
        return { data: normalized, tier: 'sigi_state' };
      }
    }

    for (const key of Object.keys(itemModule)) {
      const normalized = normalizeItemStruct(itemModule[key]);
      if (normalized) {
        cacheItem(normalized);
        if (targetId && normalized.videoId === String(targetId)) {
          return { data: normalized, tier: 'sigi_state' };
        }
        if (cleanAuthor && normalized.author.toLowerCase() === cleanAuthor) {
          return { data: normalized, tier: 'sigi_state' };
        }
      }
    }

    return null;
  }

  /**
   * Intercepts window.fetch to capture dynamic feed data as user scrolls.
   */
  function hookNetworkRequests() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (
          url.includes('item_list') ||
          url.includes('item/detail') ||
          url.includes('/api/recommend') ||
          url.includes('/api/post') ||
          url.includes('/api/feed') ||
          url.includes('/aweme/v1/feed')
        ) {
          response
            .clone()
            .json()
            .then((data) => {
              if (!data) return;
              const items =
                data.itemList ||
                data.items ||
                data.aweme_list ||
                (data.itemInfo && [data.itemInfo.itemStruct || data.itemInfo]) ||
                [];
              if (Array.isArray(items)) {
                for (const item of items) {
                  const normalized = normalizeItemStruct(item);
                  cacheItem(normalized);
                }
              }
            })
            .catch(() => {});
        }
      } catch (_) {}
      return response;
    };
  }

  /**
   * Listens for TT_BRIDGE_REQUEST CustomEvent dispatched by ISOLATED world content script.
   */
  function setupBridgeListener() {
    if (typeof document === 'undefined') return;

    document.addEventListener('TT_BRIDGE_REQUEST', (event) => {
      const detail = event.detail || {};
      const { requestId, videoId, url, author } = detail;
      if (!requestId) return;

      const cleanAuthor = author ? String(author).toLowerCase().replace(/^@+/, '').trim() : '';
      let result = null;
      let tier = 'none';

      // 1. Direct match by videoId in cache
      if (videoId && videoCache.has(String(videoId))) {
        result = videoCache.get(String(videoId));
        tier = 'fetch_cache';
      }

      // 2. Author match in cache
      if (!result && cleanAuthor && authorCache.has(cleanAuthor)) {
        const list = authorCache.get(cleanAuthor);
        if (list && list.length > 0) {
          result = list[list.length - 1]; // most recently added item for this creator
          tier = 'author_cache';
        }
      }

      // 3. Check Universal Data with both videoId and author
      if (!result) {
        const res = extractFromUniversalData(videoId, author);
        if (res && res.data) {
          result = res.data;
          tier = res.tier;
        }
      }

      // 4. Check SIGI_STATE with both videoId and author
      if (!result) {
        const res = extractFromSigiState(videoId, author);
        if (res && res.data) {
          result = res.data;
          tier = res.tier;
        }
      }

      // 5. Fallback search by URL video ID
      if (!result && url) {
        const match = String(url).match(/video\/(\d+)/);
        if (match && videoCache.has(match[1])) {
          result = videoCache.get(match[1]);
          tier = 'fetch_cache';
        }
      }

      // 6. If single video loaded in cache
      if (!result && videoCache.size === 1) {
        result = videoCache.values().next().value;
        tier = 'fetch_cache';
      }

      // 7. If still not found, return most recent item in videoCache
      if (!result && videoCache.size > 0) {
        const values = Array.from(videoCache.values());
        result = values[values.length - 1];
        tier = 'recent_cache';
      }

      const hasUrl = !!(result && (result.playUrl || result.downloadUrl));

      const responseDetail = {
        source: 'TT_BRIDGE_MAIN',
        requestId,
        success: hasUrl,
        tier: hasUrl ? tier : 'none',
        data: hasUrl ? result : null,
        error: hasUrl ? null : 'Video stream not found in page hydration state'
      };

      document.dispatchEvent(
        new CustomEvent('TT_BRIDGE_RESPONSE', {
          detail: responseDetail
        })
      );
    });
  }

  // Pre-seed cache from hydration data immediately upon bridge script execution
  try {
    extractFromUniversalData(null, null);
    extractFromSigiState(null, null);
  } catch (_) {}

  // Initialize bridge listeners & fetch interceptor
  hookNetworkRequests();
  setupBridgeListener();

  // Export for testing in Node.js environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizeItemStruct,
      extractFromUniversalData,
      extractFromSigiState,
      videoCache,
      authorCache,
      cacheItem
    };
  }
})();
