/**
 * TikTok Direct Downloader - MAIN World Bridge Script
 * Runs at document_start in the MAIN world to access page JavaScript scope.
 * 
 * Features:
 * 1. Hydration extraction: window.__UNIVERSAL_DATA_FOR_REHYDRATION__ & window.SIGI_STATE
 * 2. Network interception: window.fetch hook caching dynamic itemStructs from /api/recommend/item_list
 * 3. Standardized metadata normalization prioritizing highest bitrate unwatermarked streams
 * 4. CustomEvent IPC listener ('TT_BRIDGE_REQUEST') responding with 'TT_BRIDGE_RESPONSE'
 */

(function () {
  'use strict';

  // In-memory cache for resolved video structures: Map<videoId, normalizedItem>
  const videoCache = new Map();

  /**
   * Normalizes raw TikTok itemStruct into standardized media payload.
   * Prioritizes highest bitrate PlayAddr over DownloadAddr (which may contain watermarks).
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

    const video = item.video || {};
    let bestPlayUrl = video.playAddr || '';

    // Check bitrateInfo array for highest bitrate unwatermarked stream
    if (Array.isArray(video.bitrateInfo) && video.bitrateInfo.length > 0) {
      const sorted = [...video.bitrateInfo].sort((a, b) => (b.Bitrate || 0) - (a.Bitrate || 0));
      for (const entry of sorted) {
        if (entry.PlayAddr && Array.isArray(entry.PlayAddr.UrlList) && entry.PlayAddr.UrlList.length > 0) {
          bestPlayUrl = entry.PlayAddr.UrlList[0];
          break;
        }
      }
    }

    const downloadUrl = video.downloadAddr || bestPlayUrl;
    const resolvedPlayUrl = bestPlayUrl || downloadUrl;

    if (!resolvedPlayUrl) return null;

    const rawId = item.id || item.videoId || video.id || '';
    const videoId = String(rawId).trim();

    const authorObj = item.author || {};
    const author = authorObj.uniqueId || item.authorName || 'unknown';
    const nickname = authorObj.nickname || '';
    const description = item.desc || item.title || '';
    const bitrate = video.bitrate || 0;
    const quality = video.ratio || video.definition || '';
    const duration = video.duration || 0;

    return {
      videoId,
      author,
      nickname,
      description,
      playUrl: resolvedPlayUrl,
      downloadUrl,
      bitrate,
      quality,
      duration
    };
  }

  /**
   * Extracts video item metadata from window.__UNIVERSAL_DATA_FOR_REHYDRATION__
   *
   * @param {string|null} targetId
   * @returns {{ data: object, tier: string }|null}
   */
  function extractFromUniversalData(targetId) {
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

    // 1. Check webapp.video-detail / webapp.item-detail
    const detailScope = scope['webapp.video-detail'] || scope['webapp.item-detail'];
    if (detailScope && detailScope.itemInfo) {
      const rawItem = detailScope.itemInfo.itemStruct || detailScope.itemInfo;
      const normalized = normalizeItemStruct(rawItem);
      if (normalized) {
        videoCache.set(normalized.videoId, normalized);
        if (!targetId || normalized.videoId === String(targetId)) {
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
          videoCache.set(normalized.videoId, normalized);
          if (targetId && normalized.videoId === String(targetId)) {
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
          videoCache.set(normalized.videoId, normalized);
          if (targetId && normalized.videoId === String(targetId)) {
            return { data: normalized, tier: 'universal_data' };
          }
        }
      }
    }

    return null;
  }

  /**
   * Extracts video item metadata from window.SIGI_STATE
   *
   * @param {string|null} targetId
   * @returns {{ data: object, tier: string }|null}
   */
  function extractFromSigiState(targetId) {
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

    if (targetId && itemModule[targetId]) {
      const normalized = normalizeItemStruct(itemModule[targetId]);
      if (normalized) {
        videoCache.set(normalized.videoId, normalized);
        return { data: normalized, tier: 'sigi_state' };
      }
    }

    for (const key of Object.keys(itemModule)) {
      const normalized = normalizeItemStruct(itemModule[key]);
      if (normalized) {
        videoCache.set(normalized.videoId, normalized);
        if (targetId && normalized.videoId === String(targetId)) {
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
          url.includes('/api/recommend/item_list') ||
          url.includes('/api/item/detail') ||
          url.includes('/api/post/item_list') ||
          url.includes('/item/detail')
        ) {
          response
            .clone()
            .json()
            .then((data) => {
              if (!data) return;
              const items = data.itemList || (data.itemInfo && [data.itemInfo.itemStruct]) || [];
              if (Array.isArray(items)) {
                for (const item of items) {
                  const normalized = normalizeItemStruct(item);
                  if (normalized && normalized.videoId) {
                    videoCache.set(normalized.videoId, normalized);
                  }
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
      const { requestId, videoId, url } = detail;
      if (!requestId) return;

      let result = null;
      let tier = 'none';

      // 1. Check in-memory cache
      if (videoId && videoCache.has(String(videoId))) {
        result = videoCache.get(String(videoId));
        tier = 'fetch_cache';
      }

      // 2. Check Universal Data
      if (!result) {
        const res = extractFromUniversalData(videoId);
        if (res && res.data) {
          result = res.data;
          tier = res.tier;
        }
      }

      // 3. Check SIGI_STATE
      if (!result) {
        const res = extractFromSigiState(videoId);
        if (res && res.data) {
          result = res.data;
          tier = res.tier;
        }
      }

      // 4. Fallback search by URL video ID
      if (!result && url) {
        const match = String(url).match(/video\/(\d+)/);
        if (match && videoCache.has(match[1])) {
          result = videoCache.get(match[1]);
          tier = 'fetch_cache';
        }
      }

      // 5. If single video loaded in cache and no ID requested
      if (!result && !videoId && videoCache.size === 1) {
        result = videoCache.values().next().value;
        tier = 'fetch_cache';
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

  // Initialize bridge
  hookNetworkRequests();
  setupBridgeListener();

  // Export for testing in Node.js environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizeItemStruct,
      extractFromUniversalData,
      extractFromSigiState,
      videoCache
    };
  }
})();
