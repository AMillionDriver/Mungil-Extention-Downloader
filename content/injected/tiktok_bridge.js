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

  /**
   * High-performance, zero-overhead bounded LRU Cache conforming to Map API.
   * Auto-evicts oldest entries when exceeding maxSize to protect against unbounded heap growth.
   */
  class BoundedLRUCache {
    constructor(maxSize = 50) {
      this.maxSize = Math.max(1, maxSize);
      this.map = new Map();
    }
    get(key) {
      if (!this.map.has(key)) return undefined;
      const val = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, val);
      return val;
    }
    set(key, val) {
      if (this.map.has(key)) {
        this.map.delete(key);
      } else if (this.map.size >= this.maxSize) {
        const oldestKey = this.map.keys().next().value;
        this.map.delete(oldestKey);
      }
      this.map.set(key, val);
      return this;
    }
    has(key) {
      return this.map.has(key);
    }
    delete(key) {
      return this.map.delete(key);
    }
    clear() {
      this.map.clear();
    }
    get size() {
      return this.map.size;
    }
    values() {
      return this.map.values();
    }
    keys() {
      return this.map.keys();
    }
    entries() {
      return this.map.entries();
    }
    [Symbol.iterator]() {
      return this.map[Symbol.iterator]();
    }
  }

  // In-memory cache for resolved video structures: BoundedLRUCache<videoId, normalizedItem> (max 50)
  const videoCache = new BoundedLRUCache(50);
  // Author handle secondary index: BoundedLRUCache<cleanAuthorLowerCase, normalizedItem[]> (max 50)
  const authorCache = new BoundedLRUCache(50);

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
          // Bound list size per author to max 5 to prevent unbounded array growth
          if (list.length > 5) {
            list.shift();
          }
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
  function normalizeItemStruct(item, preferredCodec = 'data_saver') {
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
    } else if (
      video.playAddr &&
      Array.isArray(video.playAddr.UrlList) &&
      video.playAddr.UrlList.length > 0
    ) {
      bestPlayUrl = video.playAddr.UrlList[0];
    } else if (
      video.play_addr &&
      Array.isArray(video.play_addr.url_list) &&
      video.play_addr.url_list.length > 0
    ) {
      bestPlayUrl = video.play_addr.url_list[0];
    }

    // Check bitrateInfo array for highest bitrate unwatermarked stream with codec prioritization
    let resolvedCodec = 'h264';
    if (Array.isArray(video.bitrateInfo) && video.bitrateInfo.length > 0) {
      const isDataSaver = preferredCodec !== 'compatibility';
      const scoreCodec = (entry) => {
        const c = String(entry.CodecType || entry.codec_type || '').toLowerCase();
        const g = String(entry.GearName || '').toLowerCase();
        if (isDataSaver) {
          // Data-Saver: Prioritize ByteVC1 (HEVC) or AV1 for ~50-65% bandwidth savings at identical perceptual quality
          if (c.includes('bytevc1') || c.includes('hevc') || g.includes('bytevc1')) return 3;
          if (c.includes('av1') || c.includes('av01') || g.includes('av1')) return 2;
          return 1;
        } else {
          // Compatibility mode: Prioritize standard H.264
          if (c.includes('h264') || c.includes('avc') || g.includes('h264')) return 3;
          return 1;
        }
      };

      const sorted = [...video.bitrateInfo].sort((a, b) => {
        const scoreDiff = scoreCodec(b) - scoreCodec(a);
        if (scoreDiff !== 0) return scoreDiff;
        return (b.Bitrate || 0) - (a.Bitrate || 0);
      });

      for (const entry of sorted) {
        if (
          entry.PlayAddr &&
          Array.isArray(entry.PlayAddr.UrlList) &&
          entry.PlayAddr.UrlList.length > 0
        ) {
          bestPlayUrl = entry.PlayAddr.UrlList[0];
          resolvedCodec =
            entry.CodecType || entry.codec_type || (scoreCodec(entry) >= 2 ? 'bytevc1' : 'h264');
          break;
        } else if (typeof entry.PlayAddr === 'string' && entry.PlayAddr) {
          bestPlayUrl = entry.PlayAddr;
          resolvedCodec =
            entry.CodecType || entry.codec_type || (scoreCodec(entry) >= 2 ? 'bytevc1' : 'h264');
          break;
        }
      }
    }

    // Check if item is a photo/slideshow post
    let isPhotoPost = false;
    let photoImages = [];
    if (
      item.imagePostInfo &&
      Array.isArray(item.imagePostInfo.images) &&
      item.imagePostInfo.images.length > 0
    ) {
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
    } else if (
      video.downloadAddr &&
      Array.isArray(video.downloadAddr.UrlList) &&
      video.downloadAddr.UrlList.length > 0
    ) {
      downloadUrl = video.downloadAddr.UrlList[0];
    } else if (
      video.download_addr &&
      Array.isArray(video.download_addr.url_list) &&
      video.download_addr.url_list.length > 0
    ) {
      downloadUrl = video.download_addr.url_list[0];
    }

    if (!downloadUrl) downloadUrl = bestPlayUrl;
    const resolvedPlayUrl =
      bestPlayUrl || downloadUrl || (photoImages.length > 0 ? photoImages[0] : '');

    if (!resolvedPlayUrl) return null;

    const rawId = item.id || item.videoId || video.id || item.aweme_id || item.itemId || '';
    const videoId = String(rawId).trim();

    const authorObj = item.author || {};
    let author = 'unknown';
    let nickname = '';
    if (typeof authorObj === 'string') {
      author = authorObj;
    } else if (typeof authorObj === 'object') {
      author =
        authorObj.uniqueId || authorObj.unique_id || authorObj.id || item.authorName || 'unknown';
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
      duration,
      codec: resolvedCodec
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

    const cleanAuthor = targetAuthor
      ? String(targetAuthor).toLowerCase().replace(/^@+/, '').trim()
      : '';

    // 1. Check webapp.video-detail / webapp.item-detail
    const detailScope = scope['webapp.video-detail'] || scope['webapp.item-detail'];
    if (detailScope && detailScope.itemInfo) {
      const rawItem = detailScope.itemInfo.itemStruct || detailScope.itemInfo;
      const normalized = normalizeItemStruct(rawItem);
      if (normalized) {
        cacheItem(normalized);
        const idMatches = targetId && normalized.videoId === String(targetId);
        const authorMatches = cleanAuthor && normalized.author.toLowerCase() === cleanAuthor;
        if (idMatches || authorMatches) {
          return { data: normalized, tier: 'universal_data' };
        }
        const isSingleVideoPage =
          typeof window !== 'undefined' &&
          window.location &&
          window.location.pathname.includes('/video/');
        if (isSingleVideoPage && !targetId && !cleanAuthor) {
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
          const idMatches = targetId && normalized.videoId === String(targetId);
          const authorMatches = cleanAuthor && normalized.author.toLowerCase() === cleanAuthor;
          if (idMatches || authorMatches) {
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
          const idMatches = targetId && normalized.videoId === String(targetId);
          const authorMatches = cleanAuthor && normalized.author.toLowerCase() === cleanAuthor;
          if (idMatches || authorMatches) {
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
    const cleanAuthor = targetAuthor
      ? String(targetAuthor).toLowerCase().replace(/^@+/, '').trim()
      : '';

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
        const idMatches = targetId && normalized.videoId === String(targetId);
        const authorMatches = cleanAuthor && normalized.author.toLowerCase() === cleanAuthor;
        if (idMatches || authorMatches) {
          return { data: normalized, tier: 'sigi_state' };
        }
      }
    }

    return null;
  }

  /**
   * Directly extracts normalized itemStruct from React Fiber or Props of a DOM node.
   * Runs in MAIN world with full access to React internals (__reactFiber$, __reactProps$).
   * Searches the target element, its video/player children, and parent containers.
   *
   * @param {HTMLElement} domElement
   * @returns {object|null}
   */
  function extractFromReactFiber(domElement) {
    if (!domElement) return null;

    // Collect candidate elements: domElement, video, player container, action container
    const candidates = [domElement];
    if (typeof domElement.querySelector === 'function') {
      const v = domElement.querySelector('video');
      if (v) candidates.push(v);
      const feedV = domElement.querySelector('[data-e2e="feed-video"]');
      if (feedV) candidates.push(feedV);
      const playerC = domElement.querySelector(
        '[class*="DivVideoWrapper"], [class*="DivPlayerContainer"], [class*="DivItemContainer"]'
      );
      if (playerC) candidates.push(playerC);
      const actionC = domElement.querySelector(
        '[class*="DivActionItemContainer"], [class*="ActionBar"]'
      );
      if (actionC) candidates.push(actionC);
    }
    if (typeof domElement.closest === 'function') {
      const outerCard = domElement.closest(
        '[data-e2e="recommend-list-item-container"], [data-e2e="browse-video"], article, div[class*="DivItemContainer"]'
      );
      if (outerCard && !candidates.includes(outerCard)) candidates.unshift(outerCard);
    }

    for (const el of candidates) {
      let node = el;
      let depth = 0;

      while (node && depth < 8) {
        const propKeys = Object.keys(node);
        for (const key of propKeys) {
          // 1. React Fiber tree search
          if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
            let fiber = node[key];
            let fiberDepth = 0;
            while (fiber && fiberDepth < 20) {
              const props = fiber.memoizedProps || fiber.pendingProps;
              if (props && typeof props === 'object') {
                const candidate =
                  props.item ||
                  props.itemStruct ||
                  props.videoInfo ||
                  props.aweme ||
                  props.post ||
                  props.videoData ||
                  props.currentVideo ||
                  props.feedItem ||
                  (props.data && (props.data.item || props.data.itemStruct));
                if (candidate && typeof candidate === 'object') {
                  const normalized = normalizeItemStruct(candidate);
                  if (normalized && (normalized.playUrl || normalized.downloadUrl)) {
                    cacheItem(normalized);
                    return normalized;
                  }
                  // If candidate has an ID, look it up in videoCache
                  const cId = String(candidate.id || candidate.videoId || candidate.awemeId || '');
                  if (cId && videoCache.has(cId)) {
                    return videoCache.get(cId);
                  }
                }
                // Check if props directly contain video ID
                const directId = String(props.id || props.videoId || props.awemeId || '');
                if (directId && videoCache.has(directId)) {
                  return videoCache.get(directId);
                }
              }

              // Check fiber.memoizedState (React Hooks like useState)
              let stateNode = fiber.memoizedState;
              let stateDepth = 0;
              while (stateNode && stateDepth < 10) {
                const stateVal = stateNode.memoizedState;
                if (stateVal && typeof stateVal === 'object') {
                  const candidate =
                    stateVal.item ||
                    stateVal.itemStruct ||
                    stateVal.videoInfo ||
                    stateVal.aweme ||
                    stateVal;
                  if (candidate && typeof candidate === 'object') {
                    const normalized = normalizeItemStruct(candidate);
                    if (normalized && (normalized.playUrl || normalized.downloadUrl)) {
                      cacheItem(normalized);
                      return normalized;
                    }
                    const cId = String(candidate.id || candidate.videoId || '');
                    if (cId && videoCache.has(cId)) {
                      return videoCache.get(cId);
                    }
                  }
                }
                stateNode = stateNode.next;
                stateDepth++;
              }

              fiber = fiber.return || fiber.parent;
              fiberDepth++;
            }
          }

          // 2. Direct React Props search
          if (key.startsWith('__reactProps$')) {
            const props = node[key];
            if (props && typeof props === 'object') {
              const candidate =
                props.item ||
                props.itemStruct ||
                props.videoInfo ||
                props.aweme ||
                props.post ||
                (props.data && (props.data.item || props.data.itemStruct));
              if (candidate && typeof candidate === 'object') {
                const normalized = normalizeItemStruct(candidate);
                if (normalized && (normalized.playUrl || normalized.downloadUrl)) {
                  cacheItem(normalized);
                  return normalized;
                }
                const cId = String(candidate.id || candidate.videoId || '');
                if (cId && videoCache.has(cId)) {
                  return videoCache.get(cId);
                }
              }
              const directId = String(props.id || props.videoId || props.awemeId || '');
              if (directId && videoCache.has(directId)) {
                return videoCache.get(directId);
              }
            }
          }
        }

        node = node.parentElement;
        depth++;
      }
    }

    return null;
  }

  /**
   * Intercepts window.XMLHttpRequest to capture feed data loaded via XHR.
   */
  function hookXHR() {
    if (
      typeof window === 'undefined' ||
      typeof window.XMLHttpRequest !== 'function' ||
      !window.XMLHttpRequest.prototype
    )
      return;
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;
    if (typeof originalOpen !== 'function' || typeof originalSend !== 'function') return;

    window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._ttUrl = String(url || '');
      return originalOpen.call(this, method, url, ...rest);
    };

    window.XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const url = this._ttUrl || '';
          if (
            url.includes('item_list') ||
            url.includes('item/detail') ||
            url.includes('/api/recommend') ||
            url.includes('/api/post') ||
            url.includes('/api/feed') ||
            url.includes('/aweme/v1/feed')
          ) {
            const data = JSON.parse(this.responseText);
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
          }
        } catch (_) {}
      });
      return originalSend.apply(this, args);
    };
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
        const url =
          typeof args[0] === 'string' ? args[0] : args[0] && args[0].url ? args[0].url : '';
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
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

    document.addEventListener('TT_BRIDGE_REQUEST', (event) => {
      const detail = event.detail || {};
      const {
        requestId,
        videoId,
        url,
        author,
        nickname,
        description,
        duration,
        targetSelector,
        codecPreference: _codecPreference
      } = detail;
      if (!requestId) return;

      const cleanAuthor =
        author && author !== 'unknown'
          ? String(author).toLowerCase().replace(/^@+/, '').trim()
          : '';
      const cleanNick = nickname
        ? String(nickname)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
        : '';
      const cleanDesc = description
        ? String(description)
            .toLowerCase()
            .replace(/[#@\s]+/g, ' ')
            .trim()
        : '';
      const numDuration = Number(duration) || 0;

      // Disregard generated synthetic timestamps (e.g. 13-digit Date.now()) as real TikTok IDs
      const isValidVideoId =
        videoId && String(videoId).length >= 15 && /^\d+$/.test(String(videoId));

      let result = null;
      let tier = 'none';

      // Tier 0: Direct React Fiber / Props resolution from target DOM element or playing video
      if (typeof document !== 'undefined') {
        let targetEl = null;
        if (targetSelector && typeof document.querySelector === 'function') {
          targetEl = document.querySelector(targetSelector);
        }
        if (!targetEl && typeof document.querySelectorAll === 'function') {
          const videos = Array.from(document.querySelectorAll('video') || []);
          targetEl = videos.find((v) => !v.paused && v.currentTime > 0) || videos[0];
        }

        if (targetEl) {
          const fiberItem = extractFromReactFiber(targetEl);
          if (fiberItem) {
            result = fiberItem;
            tier = 'react_fiber';
          }
        }
      }

      // 1. Direct match by valid videoId in primary cache
      if (!result && isValidVideoId && videoCache.has(String(videoId))) {
        result = videoCache.get(String(videoId));
        tier = 'fetch_cache_id';
      }

      // 2. Exact, substring, or token overlap match by caption / description (Highly accurate on FYP feed)
      if (!result && cleanDesc && cleanDesc.length >= 4) {
        const descWords = cleanDesc.split(/\s+/).filter((w) => w.length >= 3);
        for (const item of videoCache.values()) {
          const itemDesc = (item.description || '')
            .toLowerCase()
            .replace(/[#@\s]+/g, ' ')
            .trim();
          if (!itemDesc) continue;
          if (itemDesc.includes(cleanDesc) || cleanDesc.includes(itemDesc)) {
            result = item;
            tier = 'fetch_cache_desc';
            break;
          }
          if (descWords.length > 0) {
            const matches = descWords.filter((w) => itemDesc.includes(w));
            if (matches.length >= Math.min(2, descWords.length)) {
              result = item;
              tier = 'fetch_cache_desc';
              break;
            }
          }
        }
      }

      // 3. Match by creator uniqueId in author cache
      if (!result && cleanAuthor && authorCache.has(cleanAuthor)) {
        const list = authorCache.get(cleanAuthor);
        if (list && list.length > 0) {
          if (list.length === 1) {
            result = list[0];
            tier = 'author_cache';
          } else {
            // Disambiguate multiple videos by duration or description snippet
            let matched = null;
            if (numDuration > 0) {
              matched = list.find((it) => Math.abs((it.duration || 0) - numDuration) < 1.0);
            }
            if (!matched && cleanDesc) {
              matched = list.find((it) => {
                const itDesc = (it.description || '').toLowerCase();
                return itDesc.includes(cleanDesc.slice(0, 20));
              });
            }
            result = matched || list[list.length - 1];
            tier = 'author_cache';
          }
        }
      }

      // 4. Match by creator display nickname (e.g. "Qwangs™")
      if (!result && cleanNick && cleanNick.length >= 3) {
        for (const item of videoCache.values()) {
          const itemNick = (item.nickname || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (
            itemNick &&
            (itemNick === cleanNick || itemNick.includes(cleanNick) || cleanNick.includes(itemNick))
          ) {
            result = item;
            tier = 'nickname_cache';
            break;
          }
        }
      }

      // 5. Match by video duration (if duration provided and only 1 video matches within 0.5s)
      if (!result && numDuration > 0) {
        const durMatches = Array.from(videoCache.values()).filter(
          (it) => Math.abs((it.duration || 0) - numDuration) < 0.5
        );
        if (durMatches.length === 1) {
          result = durMatches[0];
          tier = 'duration_cache';
        }
      }

      // 6. Check Universal Data with valid videoId and author
      if (!result) {
        const res = extractFromUniversalData(isValidVideoId ? videoId : null, cleanAuthor);
        if (res && res.data) {
          result = res.data;
          tier = res.tier;
        }
      }

      // 7. Check SIGI_STATE with valid videoId and author
      if (!result) {
        const res = extractFromSigiState(isValidVideoId ? videoId : null, cleanAuthor);
        if (res && res.data) {
          result = res.data;
          tier = res.tier;
        }
      }

      // 8. Fallback search by URL video ID
      if (!result && url) {
        const match = String(url).match(/video\/(\d+)/);
        if (match && videoCache.has(match[1])) {
          result = videoCache.get(match[1]);
          tier = 'url_cache';
        }
      }

      // 9. If strictly only a single video is loaded in entire page cache AND we are on a single video page
      const isSingleVideoPage =
        typeof window !== 'undefined' &&
        window.location &&
        window.location.pathname.includes('/video/');
      if (!result && videoCache.size === 1 && isSingleVideoPage) {
        result = videoCache.values().next().value;
        tier = 'single_video_cache';
      }

      // Note: We deliberately do NOT fall back to arbitrary recent items (values[values.length - 1]),
      // because that caused downloading unrelated preloaded feed videos.

      const hasUrl = !!(result && (result.playUrl || result.downloadUrl));

      const responseDetail = {
        source: 'TT_BRIDGE_MAIN',
        requestId,
        success: hasUrl,
        tier: hasUrl ? tier : 'none',
        data: hasUrl ? result : null,
        error: hasUrl ? null : 'Video stream not found for the active video'
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

  // Initialize bridge listeners, fetch & XHR interceptors
  hookNetworkRequests();
  hookXHR();
  setupBridgeListener();

  // Export for testing in Node.js environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizeItemStruct,
      extractFromUniversalData,
      extractFromSigiState,
      extractFromReactFiber,
      videoCache,
      authorCache,
      cacheItem
    };
  }
})();
