/**
 * Bstation (Bilibili.tv) Direct Downloader - MAIN World Bridge Script
 * Runs at document_start in the MAIN world to access page JavaScript scope.
 *
 * Features:
 * 1. Network Interception: Hooks window.fetch and XMLHttpRequest to capture playurl responses:
 *    - /intl/gateway/web/v2/ogv/playurl
 *    - /intl/gateway/web/v2/ugc/playurl
 *    - /intl/gateway/v2/ogv/playurl
 *    - /intl/gateway/web/playurl
 * 2. SSR Hydration Extraction: Parses window.__INITIAL_STATE__ / window.__initialState and window.__playinfo__
 * 3. Stream Normalization: Normalizes progressive MP4 (durl / video_resource) and DASH audio/video pairs,
 *    tracking quality levels (1080p, 720p, 480p, 360p) and CDN backup URLs.
 * 4. CustomEvent IPC: Listens for 'BS_BRIDGE_REQUEST' and responds with 'BS_BRIDGE_RESPONSE'.
 */

(function () {
  'use strict';

  // Primary stream cache by ep_id (Map<string, object>)
  const epCache = new Map();
  // Secondary stream cache by aid or bvid (Map<string, object>)
  const videoCache = new Map();
  // Last active intercepted stream
  let activeStream = null;

  // Reactive property hooks for window.__initialState and window.__INITIAL_STATE__ to capture hydration data as soon as Bstation sets it
  if (typeof window !== 'undefined') {
    let _state = window.__initialState || window.__INITIAL_STATE__;

    const setupHook = (propName) => {
      try {
        Object.defineProperty(window, propName, {
          get() { return _state; },
          set(val) {
            _state = val;
            try {
              if (typeof syncSeriesInfoToDOM === 'function') syncSeriesInfoToDOM();
            } catch (_) {}
          },
          configurable: true,
          enumerable: true
        });
      } catch (_) {}
    };

    setupHook('__initialState');
    setupHook('__INITIAL_STATE__');
  }

  /**
   * Helper to map numeric quality (qn) to human-readable label.
   */
  function mapQnToLabel(qn) {
    const num = Number(qn);
    switch (num) {
      case 112: return '1080p+';
      case 80:  return '1080p';
      case 64:  return '720p';
      case 32:  return '480p';
      case 16:  return '360p';
      default:  return num > 0 ? `${num}p` : '720p';
    }
  }

  /**
   * Normalizes raw PlayURL API responses or SSR playinfo objects into standardized stream payloads.
   * Handles:
   * 1. Standard OGV envelope: data.playurl.video / audio_resource / durl
   * 2. Direct DASH envelope: data.dash.video / dash.audio
   * 3. Flat envelope: playurl.video or direct video list
   *
   * @param {object} raw
   * @param {object} [extraMeta]
   * @returns {object|null}
   */
  function normalizePlayurlResponse(raw, extraMeta = {}) {
    if (!raw || typeof raw !== 'object') return null;

    // Unwrap common API envelopes: { code: 0, data: { ... } } or { result: { ... } }
    const root = raw.data || raw.result || raw;
    const playurl = root.playurl || root;

    let bestPlayUrl = '';
    const backupUrls = [];
    let audioUrl = '';
    let quality = playurl.quality || root.quality || 64;
    let format = playurl.format || root.format || 'HD 720P';
    const timelength = playurl.timelength || root.timelength || 0;
    const acceptQuality = playurl.accept_quality || root.accept_quality || [80, 64, 32, 16];
    const acceptDescription = playurl.accept_description || root.accept_description || ['1080P', '720P', '480P', '360P'];

    // 1. Check progressive durl array (single multiplexed MP4 stream)
    if (Array.isArray(playurl.durl) && playurl.durl.length > 0) {
      const first = playurl.durl[0];
      if (first.url) {
        bestPlayUrl = first.url;
      }
      if (Array.isArray(first.backup_url)) {
        backupUrls.push(...first.backup_url.filter(Boolean));
      }
    }

    // 2. Check playurl.video array (BPX player video resource)
    if (!bestPlayUrl && Array.isArray(playurl.video) && playurl.video.length > 0) {
      for (const videoEntry of playurl.video) {
        if (!videoEntry) continue;
        const res = videoEntry.video_resource || videoEntry;
        if (res && res.url) {
          bestPlayUrl = res.url;
          if (Array.isArray(res.backup_url)) {
            backupUrls.push(...res.backup_url.filter(Boolean));
          }
          if (videoEntry.stream_info && videoEntry.stream_info.qn) {
            quality = videoEntry.stream_info.qn;
          }
          break;
        }
      }
    }

    // 3. Check DASH streams (data.dash)
    const dash = root.dash || playurl.dash;
    if (dash && typeof dash === 'object') {
      if (Array.isArray(dash.video) && dash.video.length > 0) {
        for (const v of dash.video) {
          if (!v) continue;
          const vUrl = v.baseUrl || v.base_url || v.url;
          if (vUrl) {
            if (!bestPlayUrl) bestPlayUrl = vUrl;
            const bkp = v.backupUrl || v.backup_url;
            if (Array.isArray(bkp)) {
              backupUrls.push(...bkp.filter(Boolean));
            }
            if (v.id) quality = v.id;
            break;
          }
        }
      }
      if (Array.isArray(dash.audio) && dash.audio.length > 0) {
        for (const a of dash.audio) {
          if (!a) continue;
          const aUrl = a.baseUrl || a.base_url || a.url;
          if (aUrl) {
            audioUrl = aUrl;
            break;
          }
        }
      }
    }

    // 4. Check separate audio_resource
    if (!audioUrl && Array.isArray(playurl.audio_resource) && playurl.audio_resource.length > 0) {
      for (const a of playurl.audio_resource) {
        if (a && a.url) {
          audioUrl = a.url;
          break;
        }
      }
    }

    if (!bestPlayUrl) return null;

    const epId = extraMeta.ep_id ? String(extraMeta.ep_id) : (root.ep_id ? String(root.ep_id) : '');
    const aid = extraMeta.aid ? String(extraMeta.aid) : (root.aid ? String(root.aid) : '');
    const bvid = extraMeta.bvid ? String(extraMeta.bvid) : (root.bvid ? String(root.bvid) : '');
    const title = extraMeta.title || root.title || '';
    const isVip = !!(extraMeta.is_vip || root.is_vip || quality > 64);
    const qualityLabel = mapQnToLabel(quality);

    return {
      ep_id: epId,
      aid,
      bvid,
      title,
      playUrl: bestPlayUrl,
      url: bestPlayUrl,
      backup_urls: backupUrls,
      audio_url: audioUrl,
      quality,
      qualityLabel,
      format,
      timelength,
      duration: timelength,
      accept_quality: acceptQuality,
      accept_description: acceptDescription,
      is_vip: isVip
    };
  }

  /**
   * Caches normalized item into internal maps.
   */
  function cacheStreamItem(normalized) {
    if (!normalized || typeof normalized !== 'object') return;
    if (normalized.ep_id) {
      epCache.set(String(normalized.ep_id), normalized);
    }
    if (normalized.aid) {
      videoCache.set(String(normalized.aid), normalized);
    }
    if (normalized.bvid) {
      videoCache.set(String(normalized.bvid), normalized);
    }
    activeStream = normalized;
  }

  /**
   * Extracts series info and active episode metadata from window.__INITIAL_STATE__
   */
  function extractFromInitialState(targetEpId) {
    if (typeof window === 'undefined') return null;

    let state = window.__INITIAL_STATE__ || window.__initialState;
    if (!state && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
      const script = document.getElementById('__INITIAL_STATE__');
      if (script && script.textContent) {
        try {
          state = JSON.parse(script.textContent);
        } catch (_) {}
      }
    }

    if (!state || typeof state !== 'object') return null;

    const mediaInfo = state.mediaInfo || state.season || (state.ogv && state.ogv.season) || {};
    const seriesTitle = mediaInfo.title || mediaInfo.season_title || (state.ogv && state.ogv.season && (state.ogv.season.title || state.ogv.season.season_title)) || '';
    const user = state.user || state.userInfo || {};
    const vipInfo = user.vip_info || user.vip || {};
    const isVip = !!(vipInfo.is_vip || vipInfo.status === 1 || vipInfo.vip_type > 0 || (user.vip && user.vip.status === 1));

    const epInfo = state.epInfo || state.activeEp || (state.ogv && { ep_id: state.ogv.epId }) || {};
    let rawList = state.epList || state.episodes;
    if (!rawList && mediaInfo) {
      rawList = mediaInfo.episodes || mediaInfo.epList || mediaInfo.episodeList;
    }
    if (!rawList && state.sections && Array.isArray(state.sections)) {
      rawList = [];
      state.sections.forEach(sec => {
        const list = sec.episodes || sec.epList || sec.episodeList || sec.list || sec.items;
        if (Array.isArray(list)) rawList.push(...list);
      });
    }
    if (!rawList && state.ogv && Array.isArray(state.ogv.sectionsList)) {
      rawList = [];
      state.ogv.sectionsList.forEach(sec => {
        const list = sec.episodes || sec.epList || sec.episodeList || sec.list || sec.items;
        if (Array.isArray(list)) rawList.push(...list);
      });
    }
    if (!rawList && mediaInfo.sections && Array.isArray(mediaInfo.sections)) {
      rawList = [];
      mediaInfo.sections.forEach(sec => {
        const list = sec.episodes || sec.epList || sec.episodeList || sec.list || sec.items;
        if (Array.isArray(list)) rawList.push(...list);
      });
    }
    if (!rawList && state.ogv && Array.isArray(state.ogv.episodes)) {
      rawList = state.ogv.episodes;
    }
    const epList = Array.isArray(rawList) ? rawList : [];

    const normalizedEpisodes = epList.map((ep, idx) => {
      const epId = String(ep.ep_id || ep.id || ep.epid || ep.episode_id || `ep_${idx + 1}`);
      const rawTitle = ep.title || (ep.short_title ? `EP ${ep.short_title}` : `Episode ${idx + 1}`);
      let epIndex = idx + 1;
      if (ep.short_title && /^\d+$/.test(ep.short_title)) {
        epIndex = parseInt(ep.short_title, 10);
      } else if (rawTitle) {
        const m = rawTitle.match(/\d+/);
        if (m) epIndex = parseInt(m[0], 10);
      }

      const isEpVip = !!(
        ep.is_vip ||
        ep.vip_type > 0 ||
        ep.badge === 'VIP' ||
        (ep.badge_info && (ep.badge_info.text === 'VIP' || ep.badge_info.is_vip)) ||
        (ep.status && ep.status === 13)
      );

      return {
        id: epId,
        epId: epId,
        index: epIndex,
        title: rawTitle,
        short_title: ep.short_title || (epIndex < 10 ? `0${epIndex}` : `${epIndex}`),
        isVip: isEpVip
      };
    });

    // Find requested or active episode
    let targetEp = null;
    if (targetEpId) {
      targetEp = normalizedEpisodes.find((e) => String(e.ep_id || e.id) === String(targetEpId));
    }
    if (!targetEp) {
      targetEp = epInfo.ep_id ? normalizedEpisodes.find(e => String(e.ep_id) === String(epInfo.ep_id)) : (normalizedEpisodes[0] || null);
    }

    return {
      seriesTitle,
      isUserVip: isVip,
      episodes: normalizedEpisodes,
      activeEpisode: targetEp
    };
  }

  /**
   * Synchronously mirrors normalized series info into a DOM script tag (__BS_SERIES_INFO__)
   * so content scripts running in the ISOLATED world can access the true episode count without IPC lag.
   */
  function syncSeriesInfoToDOM() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function' || typeof document.createElement !== 'function') return;
    try {
      const info = extractFromInitialState(null);
      if (info && Array.isArray(info.episodes) && info.episodes.length > 0) {
        let script = document.getElementById('__BS_SERIES_INFO__');
        if (!script) {
          script = document.createElement('script');
          script.id = '__BS_SERIES_INFO__';
          script.type = 'application/json';
          const target = document.head || document.documentElement || document.body;
          if (target && target.appendChild) {
            target.appendChild(script);
          }
        }
        if (script) {
          script.textContent = JSON.stringify(info);
        }
      }
    } catch (_) {}
  }

  /**
   * Extracts pre-rendered stream information from window.__playinfo__
   */
  function extractFromPlayinfo() {
    if (typeof window === 'undefined') return null;

    let playinfo = window.__playinfo__;
    if (!playinfo && typeof document !== 'undefined' && typeof document.getElementById === 'function') {
      const script = document.getElementById('__playinfo__');
      if (script && script.textContent) {
        try {
          playinfo = JSON.parse(script.textContent);
        } catch (_) {}
      }
    }

    if (!playinfo) return null;
    const normalized = normalizePlayurlResponse(playinfo);
    if (normalized) {
      cacheStreamItem(normalized);
      return normalized;
    }
    return null;
  }

  /**
   * Intercepts window.XMLHttpRequest for Bstation gateway playurl APIs.
   */
  function hookXHR() {
    if (typeof window === 'undefined' || typeof window.XMLHttpRequest !== 'function' || !window.XMLHttpRequest.prototype) return;
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;
    if (typeof originalOpen !== 'function' || typeof originalSend !== 'function') return;

    window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._bsUrl = String(url || '');
      return originalOpen.call(this, method, url, ...rest);
    };

    window.XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener('load', function () {
        try {
          const url = this._bsUrl || '';
          if (url.includes('/playurl')) {
            const data = JSON.parse(this.responseText);
            if (!data) return;

            // Extract query parameters from url
            let epId = '';
            let aid = '';
            let bvid = '';
            try {
              const urlObj = new URL(url, 'https://www.bilibili.tv');
              epId = urlObj.searchParams.get('ep_id') || '';
              aid = urlObj.searchParams.get('aid') || '';
              bvid = urlObj.searchParams.get('bvid') || '';
            } catch (_) {}

            const normalized = normalizePlayurlResponse(data, { ep_id: epId, aid, bvid });
            if (normalized) {
              cacheStreamItem(normalized);
            }
          }
        } catch (_) {}
      });
      return originalSend.apply(this, args);
    };
  }

  /**
   * Intercepts window.fetch for Bstation gateway playurl APIs.
   */
  function hookNetworkRequests() {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        if (url.includes('/playurl')) {
          response
            .clone()
            .json()
            .then((data) => {
              if (!data) return;
              let epId = '';
              let aid = '';
              let bvid = '';
              try {
                const urlObj = new URL(url, 'https://www.bilibili.tv');
                epId = urlObj.searchParams.get('ep_id') || '';
                aid = urlObj.searchParams.get('aid') || '';
                bvid = urlObj.searchParams.get('bvid') || '';
              } catch (_) {}

              const normalized = normalizePlayurlResponse(data, { ep_id: epId, aid, bvid });
              if (normalized) {
                cacheStreamItem(normalized);
              }
            })
            .catch(() => {});
        }
      } catch (_) {}
      return response;
    };
  }

  /**
   * Resolves a stream from available caches and page state.
   */
  function resolveStream(epId, aid, bvid, qn) {
    if (epId && epCache.has(String(epId))) {
      return { data: epCache.get(String(epId)), tier: 'ep_cache' };
    }
    if (aid && videoCache.has(String(aid))) {
      return { data: videoCache.get(String(aid)), tier: 'aid_cache' };
    }
    if (bvid && videoCache.has(String(bvid))) {
      return { data: videoCache.get(String(bvid)), tier: 'bvid_cache' };
    }

    // Try SSR playinfo
    const playinfoStream = extractFromPlayinfo();
    if (playinfoStream) {
      if (!epId || !playinfoStream.ep_id || playinfoStream.ep_id === String(epId)) {
        return { data: playinfoStream, tier: 'playinfo_ssr' };
      }
    }

    // Fall back to activeStream if single video
    if (activeStream) {
      return { data: activeStream, tier: 'active_stream' };
    }

    return null;
  }

  /**
   * Actively fetches the stream playurl on demand from Bstation's official API
   * using the user's authentic session cookies/credentials.
   */
  async function fetchPlayurlOnDemand({ ep_id, aid, bvid, qn = 64 }) {
    if (typeof fetch !== 'function') return null;

    // Validate ep_id: Bstation OGV playurl strictly requires genuine numeric ep_id
    if (ep_id && !/^\d+$/.test(String(ep_id))) {
      const stateInfo = extractFromInitialState(null);
      let resolvedNumericId = '';
      if (stateInfo && Array.isArray(stateInfo.episodes)) {
        const numMatch = String(ep_id).match(/\d+/);
        const targetIndex = numMatch ? parseInt(numMatch[0], 10) : 1;
        const matched = stateInfo.episodes.find((e) => e.index === targetIndex || e.id === ep_id);
        if (matched && /^\d+$/.test(String(matched.epId))) {
          resolvedNumericId = String(matched.epId);
        } else if (stateInfo.activeEpisode && /^\d+$/.test(String(stateInfo.activeEpisode.epId))) {
          resolvedNumericId = String(stateInfo.activeEpisode.epId);
        }
      }
      if (resolvedNumericId) {
        ep_id = resolvedNumericId;
      } else {
        // Cannot resolve to numeric ID, prevent invalid request that results in 404
        return null;
      }
    }

    const tryFetch = async (targetQn) => {
      let apiUrl = '';
      if (ep_id) {
        apiUrl = `https://api.bilibili.tv/intl/gateway/web/v2/ogv/playurl?ep_id=${encodeURIComponent(ep_id)}&qn=${targetQn}`;
      } else if (aid || bvid) {
        apiUrl = `https://api.bilibili.tv/intl/gateway/web/v2/ugc/playurl?aid=${encodeURIComponent(aid || '')}&bvid=${encodeURIComponent(bvid || '')}&qn=${targetQn}`;
      } else {
        return null;
      }

      try {
        const res = await fetch(apiUrl, { credentials: 'include' });
        if (!res.ok) return null;
        const json = await res.json();
        const normalized = normalizePlayurlResponse(json, { ep_id, aid, bvid });
        if (normalized) {
          cacheStreamItem(normalized);
          return normalized;
        }
      } catch (_) {}
      return null;
    };

    let result = await tryFetch(qn);
    if (!result && Number(qn) !== 64) {
      result = await tryFetch(64);
    }
    if (!result && Number(qn) !== 32) {
      result = await tryFetch(32);
    }
    return result;
  }

  /**
   * Sets up CustomEvent IPC listener for 'BS_BRIDGE_REQUEST'
   */
  function setupBridgeListener() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;

    document.addEventListener('BS_BRIDGE_REQUEST', async (event) => {
      const detail = event.detail || {};
      const { requestId, ep_id, aid, bvid, qn, action } = detail;
      if (!requestId) return;

      // 1. Handle series and episode list query
      if (action === 'GET_SERIES_INFO') {
        const seriesInfo = extractFromInitialState(ep_id);
        const hasData = !!(seriesInfo && (Array.isArray(seriesInfo.episodes) && seriesInfo.episodes.length > 0 || seriesInfo.seriesTitle));
        document.dispatchEvent(
          new CustomEvent('BS_BRIDGE_RESPONSE', {
            detail: {
              source: 'BS_BRIDGE_MAIN',
              requestId,
              success: hasData,
              data: seriesInfo,
              tier: 'ssr_initial_state',
              error: hasData ? null : 'Bstation series info not found'
            }
          })
        );
        return;
      }

      // 2. Resolve stream from cache or pre-rendered playinfo
      let resolved = resolveStream(ep_id, aid, bvid, qn);
      let matched = resolved ? resolved.data : null;
      let tier = resolved ? resolved.tier : 'none';

      // 3. If not cached, attempt on-demand fetch using page credentials
      if (!matched) {
        let targetEpId = ep_id;
        if (!targetEpId) {
          const stateInfo = extractFromInitialState(null);
          if (stateInfo && stateInfo.activeEpisode && stateInfo.activeEpisode.epId) {
            targetEpId = stateInfo.activeEpisode.epId;
          }
        }
        if (targetEpId || aid || bvid) {
          try {
            matched = await fetchPlayurlOnDemand({ ep_id: targetEpId, aid, bvid, qn });
            if (matched) {
              tier = 'on_demand_fetch';
            }
          } catch (_) {}
        }
      }

      if (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
        document.dispatchEvent(
          new CustomEvent('BS_BRIDGE_RESPONSE', {
            detail: {
              source: 'BS_BRIDGE_MAIN',
              requestId,
              success: !!(matched && (matched.playUrl || matched.url)),
              data: matched,
              tier,
              error: matched ? null : 'Bstation video stream not found'
            }
          })
        );
      }
    });
  }

  // Pre-seed from SSR hydration on initialization
  try {
    extractFromPlayinfo();
    extractFromInitialState(null);
    syncSeriesInfoToDOM();
  } catch (_) {}

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncSeriesInfoToDOM);
    }
  }

  hookNetworkRequests();
  hookXHR();
  setupBridgeListener();

  // Export for unit tests in Node environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizePlayurlResponse,
      cacheStreamItem,
      extractFromInitialState,
      syncSeriesInfoToDOM,
      extractFromPlayinfo,
      resolveStream,
      fetchPlayurlOnDemand,
      mapQnToLabel,
      epCache,
      videoCache,
      getActiveStream: () => activeStream,
      resetCache: () => {
        epCache.clear();
        videoCache.clear();
        activeStream = null;
      }
    };
  }
})();
