/**
 * TeraBox Direct Downloader - MAIN World Bridge Script
 * Runs at document_start in the MAIN world to access TeraBox's JavaScript scope.
 *
 * Features:
 * 1. Reactive Property Hook: Hooks window.yunData to extract FILEINFO, SHARE_ID, UK, SIGN, and TIMESTAMP.
 * 2. Network Interception: Hooks window.fetch and XMLHttpRequest to capture file listings and direct download links:
 *    - /share/list
 *    - /api/download
 *    - /share/download
 *    - /api/fileinfo
 * 3. In-Memory LRU Cache: Bounded cache mapping fs_id -> file metadata & dlink.
 * 4. CustomEvent IPC: Listens for 'TERABOX_BRIDGE_REQUEST' and responds with 'TERABOX_BRIDGE_RESPONSE'.
 */

(function () {
  'use strict';

  if (window.__TERABOX_BRIDGE_INITIALIZED__) return;
  window.__TERABOX_BRIDGE_INITIALIZED__ = true;

  // Defuse TeraBox's endless Google One-Tap SDK polling retry loop at document_start
  try {
    if (!window.google) window.google = {};
    if (!window.google.accounts) window.google.accounts = {};
    if (!window.google.accounts.id) {
      window.google.accounts.id = {
        initialize: function () {},
        prompt: function () {},
        renderButton: function () {},
        disableAutoSelect: function () {},
        storeCredential: function () {},
        cancel: function () {}
      };
    }
  } catch (_) {}

  const LOG_PREFIX = '[TeraBox Bridge]';

  /**
   * Bounded LRU Cache conforming to Map API.
   * Auto-evicts oldest entries when exceeding maxSize to protect against unbounded memory growth.
   */
  class BoundedLRUCache {
    constructor(maxSize = 100) {
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
  }

  // Cache: fs_id -> Normalized File Object
  const fileCache = new BoundedLRUCache(100);
  let activeShareInfo = {
    shareid: null,
    uk: null,
    sign: null,
    timestamp: null,
    bdstoken: null
  };

  /**
   * Normalizes a raw TeraBox file record into standard Mungil format.
   * @param {object} raw
   * @returns {object|null}
   */
  function normalizeTeraBoxFile(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const fsId = String(raw.fs_id || raw.fsId || raw.file_id || raw.id || '');
    if (!fsId) return null;

    const filename = String(
      raw.server_filename || raw.filename || raw.file_name || raw.name || 'TeraBox_File'
    );
    const size = Number(raw.size || raw.file_size || 0);
    const isDir = Boolean(
      raw.isdir === 1 ||
      raw.is_dir === 1 ||
      raw.is_directory ||
      (raw.category === 6 && !size && !filename.includes('.'))
    );
    const category = Number(raw.category || 0);
    const filenameLower = filename.toLowerCase();

    const isVideo =
      !isDir &&
      (category === 1 || /\.(mp4|mkv|avi|mov|flv|webm|ts|m4v|wmv|3gp|m3u8)$/i.test(filenameLower));

    const isImage =
      !isDir &&
      !isVideo &&
      (category === 3 || /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)$/i.test(filenameLower));

    const dlink = String(raw.dlink || raw.download_url || raw.direct_link || '');
    const md5 = String(raw.md5 || '');

    let thumb = '';
    if (raw.thumbs && typeof raw.thumbs === 'object') {
      thumb = raw.thumbs.url3 || raw.thumbs.url2 || raw.thumbs.url1 || '';
    } else if (typeof raw.thumb === 'string') {
      thumb = raw.thumb;
    }

    return {
      fs_id: fsId,
      filename,
      size,
      formatted_size: formatBytes(size),
      isdir: isDir,
      isVideo,
      isImage,
      dlink,
      category,
      md5,
      thumb,
      original_dlink: dlink && !dlink.includes('streaming') ? dlink : ''
    };
  }

  // Intercept TeraBox Vue Watcher console logs (e.g. console.log("[watch currentFile]", ne))
  if (typeof console !== 'undefined' && console.log) {
    const origConsoleLog = console.log;
    console.log = function (...args) {
      try {
        // Suppress TeraBox's endless Google SDK retry log loop
        if (args && typeof args[0] === 'string' && args[0].includes('google sdk init settimeout')) {
          return;
        }

        if (
          args &&
          args.length >= 2 &&
          args[0] === '[watch currentFile]' &&
          args[1] &&
          typeof args[1] === 'object'
        ) {
          for (const item of fileCache.values()) {
            item.isActive = false;
          }
          let norm = normalizeTeraBoxFile(args[1]);
          if (norm) {
            norm.isActive = true;
            fileCache.set(norm.fs_id, norm);
          } else {
            const rawName = String(
              args[1].server_filename || args[1].filename || args[1].name || ''
            );
            if (rawName) {
              for (const item of fileCache.values()) {
                if (item.filename === rawName) {
                  item.isActive = true;
                  fileCache.set(item.fs_id, item);
                  break;
                }
              }
            }
          }
          notifyFilesUpdated();
        }
      } catch (_) {}
      return origConsoleLog.apply(this, args);
    };
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i] || 'B'}`;
  }

  function getCookie(name) {
    try {
      if (typeof document === 'undefined' || !document.cookie) return '';
      const parts = document.cookie.split(';');
      for (const part of parts) {
        const trimmed = part.trim();
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const k = trimmed.slice(0, eqIdx);
          const v = trimmed.slice(eqIdx + 1);
          if (k === name) return decodeURIComponent(v);
        }
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  /**
   * Pure JS RFC 2104 HMAC-SHA1 calculation for signing TeraBox /share/streaming URLs.
   * Matches TeraBox internal crypto-vendor exactly.
   * @param {string} message
   * @param {string} key
   * @returns {string} hex digest
   */
  function hmacSha1PureJs(message, key) {
    function sha1(bytes) {
      let h0 = 0x67452301,
        h1 = 0xefcdab89,
        h2 = 0x98badcfe,
        h3 = 0x10325476,
        h4 = 0xc3d2e1f0;
      const n = bytes.length;
      const bitLen = n * 8;
      const withPadding = new Uint8Array((((n + 8) >> 6) << 6) + 64);
      withPadding.set(bytes);
      withPadding[n] = 0x80;
      const view = new DataView(withPadding.buffer);
      view.setUint32(withPadding.length - 4, bitLen, false);

      const w = new Uint32Array(80);
      for (let i = 0; i < withPadding.length; i += 64) {
        for (let j = 0; j < 16; j++) {
          w[j] = view.getUint32(i + j * 4, false);
        }
        for (let j = 16; j < 80; j++) {
          const val = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
          w[j] = (val << 1) | (val >>> 31);
        }

        let a = h0,
          b = h1,
          c = h2,
          d = h3,
          e = h4;
        for (let j = 0; j < 80; j++) {
          let f, k;
          if (j < 20) {
            f = (b & c) | (~b & d);
            k = 0x5a827999;
          } else if (j < 40) {
            f = b ^ c ^ d;
            k = 0x6ed9eba1;
          } else if (j < 60) {
            f = (b & c) | (b & d) | (c & d);
            k = 0x8f1bbcdc;
          } else {
            f = b ^ c ^ d;
            k = 0xca62c1d6;
          }
          const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0;
          e = d;
          d = c;
          c = ((b << 30) | (b >>> 2)) >>> 0;
          b = a;
          a = temp;
        }
        h0 = (h0 + a) >>> 0;
        h1 = (h1 + b) >>> 0;
        h2 = (h2 + c) >>> 0;
        h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0;
      }

      const res = new Uint8Array(20);
      const resView = new DataView(res.buffer);
      resView.setUint32(0, h0, false);
      resView.setUint32(4, h1, false);
      resView.setUint32(8, h2, false);
      resView.setUint32(12, h3, false);
      resView.setUint32(16, h4, false);
      return res;
    }

    const keyBytes = new TextEncoder().encode(key);
    const msgBytes = new TextEncoder().encode(message);
    const blockSize = 64;
    let keyPadded = new Uint8Array(blockSize);
    if (keyBytes.length > blockSize) {
      const hashedKey = sha1(keyBytes);
      keyPadded.set(hashedKey);
    } else {
      keyPadded.set(keyBytes);
    }

    const oKeyPad = new Uint8Array(blockSize);
    const iKeyPad = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      oKeyPad[i] = keyPadded[i] ^ 0x5c;
      iKeyPad[i] = keyPadded[i] ^ 0x36;
    }

    const innerMsg = new Uint8Array(blockSize + msgBytes.length);
    innerMsg.set(iKeyPad, 0);
    innerMsg.set(msgBytes, blockSize);
    const innerHash = sha1(innerMsg);

    const outerMsg = new Uint8Array(blockSize + innerHash.length);
    outerMsg.set(oKeyPad, 0);
    outerMsg.set(innerHash, blockSize);
    const outerHash = sha1(outerMsg);

    return Array.from(outerHash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Ingests a list of file records into the cache.
   * @param {Array<object>} list
   */
  function ingestFileList(list) {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const normalized = normalizeTeraBoxFile(item);
      if (normalized) {
        fileCache.set(normalized.fs_id, normalized);
      }
    }
  }

  /**
   * Synchronizes metadata from window.yunData.
   */
  /**
   * Synchronizes metadata from window.yunData or window.templateData.
   */
  function syncYunData() {
    try {
      const data =
        (typeof window !== 'undefined' && (window.yunData || window.templateData)) || null;
      if (!data || typeof data !== 'object') return;

      activeShareInfo = {
        shareid: data.SHARE_ID || data.shareid || activeShareInfo.shareid,
        uk: data.UK || data.uk || data.uk_str || activeShareInfo.uk,
        sign: data.SIGN || data.sign || activeShareInfo.sign,
        timestamp: data.TIMESTAMP || data.timestamp || activeShareInfo.timestamp,
        bdstoken: data.BDSTOKEN || data.bdstoken || activeShareInfo.bdstoken
      };

      if (Array.isArray(data.FILEINFO)) {
        ingestFileList(data.FILEINFO);
      } else if (data.FILEINFO && typeof data.FILEINFO === 'object') {
        const norm = normalizeTeraBoxFile(data.FILEINFO);
        if (norm) fileCache.set(norm.fs_id, norm);
      }

      if (Array.isArray(data.list)) {
        ingestFileList(data.list);
      } else if (data.fileInfo && typeof data.fileInfo === 'object') {
        const norm = normalizeTeraBoxFile(data.fileInfo);
        if (norm) fileCache.set(norm.fs_id, norm);
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Error syncing yunData/templateData:`, err);
    }
  }

  function notifyFilesUpdated() {
    try {
      const files = Array.from(fileCache.values());
      const detail = { files, shareInfo: activeShareInfo };
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('TERABOX_FILES_UPDATED', { detail }));
      }
      if (typeof document !== 'undefined' && document.dispatchEvent) {
        document.dispatchEvent(new CustomEvent('TERABOX_FILES_UPDATED', { detail }));
      }
    } catch (_) {}
  }

  /**
   * Unified processor for intercepted network responses.
   * @param {string} url
   * @param {object} data
   */
  function handleApiResponse(url, data) {
    if (!data || typeof data !== 'object') return;

    // 1. /api/shorturlinfo or /shorturlinfo
    if (url.includes('shorturlinfo')) {
      activeShareInfo = {
        shareid: data.shareid || activeShareInfo.shareid,
        uk: data.uk_str || data.uk || activeShareInfo.uk,
        sign: data.sign || activeShareInfo.sign,
        timestamp: data.timestamp || activeShareInfo.timestamp,
        bdstoken: data.bdstoken || activeShareInfo.bdstoken,
        shorturl: data.shorturl || activeShareInfo.shorturl
      };

      if (Array.isArray(data.list)) {
        ingestFileList(data.list);
      }
      if (data.fileInfo && typeof data.fileInfo === 'object') {
        const norm = normalizeTeraBoxFile(data.fileInfo);
        if (norm) fileCache.set(norm.fs_id, norm);
      }
      notifyFilesUpdated();
    }

    // 2. /share/list
    if (url.includes('/share/list')) {
      if (Array.isArray(data.list)) {
        ingestFileList(data.list);
      }
      notifyFilesUpdated();
    }

    // 3. /api/download, /share/download, or dlink payloads
    if (url.includes('download')) {
      if (Array.isArray(data.dlink)) {
        for (const dl of data.dlink) {
          const fsId = String(dl.fs_id || '');
          if (fsId && fileCache.has(fsId)) {
            const item = fileCache.get(fsId);
            item.dlink = dl.dlink || item.dlink;
            fileCache.set(fsId, item);
          }
        }
      } else if (typeof data.dlink === 'string' && data.dlink) {
        for (const item of fileCache.values()) {
          item.dlink = data.dlink;
          break;
        }
      }
      notifyFilesUpdated();
    }

    // 4. /share/streaming or video stream
    if (url.includes('streaming')) {
      try {
        const parsed = new URL(url, window.location.origin);
        const fid = parsed.searchParams.get('fid');
        const type = parsed.searchParams.get('type') || '';
        if (fid) {
          const item = fileCache.get(fid) || { fs_id: fid };
          if (!item.streamUrls) item.streamUrls = {};
          item.streamUrls[type] = url;
          if (type.includes('360')) item.streamUrls['360'] = url;
          if (type.includes('480')) item.streamUrls['480'] = url;
          if (type.includes('720')) item.streamUrls['720'] = url;
          if (type.includes('1080')) item.streamUrls['1080'] = url;
          item.lastStreamUrl = url;
          fileCache.set(fid, item);
          notifyFilesUpdated();
        }
      } catch (_) {}
    }
  }

  // Reactive Property Hook for window.yunData
  if (typeof window !== 'undefined') {
    let _yunData = window.yunData;

    try {
      Object.defineProperty(window, 'yunData', {
        get() {
          return _yunData;
        },
        set(val) {
          _yunData = val;
          try {
            syncYunData();
            notifyFilesUpdated();
          } catch (_) {}
        },
        configurable: true,
        enumerable: true
      });
    } catch (_) {}

    // Initial check
    syncYunData();
  }

  // --------------------------------------------------------------------------
  // Network Interception: Hook fetch and XMLHttpRequest
  // --------------------------------------------------------------------------
  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (...args) {
      const resp = await originalFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        if (url.includes('streaming')) {
          handleApiResponse(url, {});
        } else if (
          url.includes('shorturlinfo') ||
          url.includes('/share/list') ||
          url.includes('download') ||
          url.includes('/api/fileinfo')
        ) {
          resp
            .clone()
            .json()
            .then((data) => {
              handleApiResponse(url, data);
            })
            .catch(() => {});
        }
      } catch (_) {}
      return resp;
    };
  }

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (_method, url) {
    this.__mungil_url = url;
    return originalXhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      try {
        const url = String(this.__mungil_url || '');
        if (url.includes('streaming')) {
          handleApiResponse(url, {});
        } else if (
          url.includes('shorturlinfo') ||
          url.includes('/share/list') ||
          url.includes('download') ||
          url.includes('/api/fileinfo')
        ) {
          let data = null;
          if (this.responseType === 'json' && this.response) {
            data = this.response;
          } else if (this.responseType === '' || this.responseType === 'text') {
            data = JSON.parse(this.responseText);
          }
          if (data) {
            handleApiResponse(url, data);
          }
        }
      } catch (_) {}
    });
    return originalXhrSend.apply(this, arguments);
  };

  // --------------------------------------------------------------------------
  // Direct Download Link API Resolver
  // --------------------------------------------------------------------------
  async function resolveDlink(fsId, preferredType = null) {
    syncYunData();
    const cached = fileCache.get(fsId);
    if (!preferredType && cached) {
      if (cached.original_dlink) return cached.original_dlink;
      if (cached.dlink && !cached.dlink.includes('streaming')) return cached.dlink;
    }

    const shareid = activeShareInfo.shareid;
    const uk = activeShareInfo.uk;
    const sign = activeShareInfo.sign;
    const timestamp = activeShareInfo.timestamp;
    const token =
      (typeof window !== 'undefined' && window.jsToken) || activeShareInfo.bdstoken || '';

    // If an alternative HLS stream resolution (e.g. M3U8_AUTO_1080, M3U8_AUTO_720, M3U8_AUTO_480, M3U8_AUTO_360) is requested
    if (preferredType && shareid && uk) {
      const qNum = parseInt(String(preferredType).replace(/[^0-9]/g, ''), 10) || 360;
      if (cached && cached.streamUrls && cached.streamUrls[qNum]) {
        return cached.streamUrls[qNum];
      }

      // Check active VideoJS in DOM
      try {
        const vEl = typeof document !== 'undefined' && document.getElementById('videoplayer');
        if (vEl && vEl.player && typeof vEl.player.currentSrc === 'function') {
          const curSrc = vEl.player.currentSrc();
          if (
            curSrc &&
            curSrc.includes('streaming') &&
            (curSrc.includes(String(qNum)) || qNum === 360)
          ) {
            return curSrc;
          }
        }
      } catch (_) {}

      // Calculate signed streaming URL with official TeraBox algorithm
      const isSafari =
        typeof navigator !== 'undefined' &&
        navigator.userAgent.includes('Safari') &&
        !navigator.userAgent.includes('Chrome');
      let streamType = '';
      if (qNum === 360) {
        streamType = isSafari ? 'M3U8_AUTO_360' : 'M3U8_FLV_264_360';
      } else if (qNum === 480) {
        streamType = isSafari ? 'M3U8_AUTO_480' : 'M3U8_FLV_264_480';
      } else if (qNum === 1080) {
        streamType = 'M3U8_AUTO_1080';
      } else if (qNum === 2160) {
        streamType = 'M3U8_AUTO_4K';
      } else {
        streamType = 'M3U8_AUTO_' + qNum;
      }

      const clienttype = 0;
      const channel = 'dubox';
      const appId = 250528;
      const web = 1;
      const ts = Math.floor(Date.now() / 1000);
      const browserid = getCookie('browserid') || '';
      const streamSign = hmacSha1PureJs(
        `${clienttype}${channel}${browserid}${ts}`,
        'iuuPc64E4Fhn0rTXEzrnbLph0o5qyEEa'
      );
      const origin =
        (typeof window !== 'undefined' && window.location.origin) || 'https://www.terabox.app';
      const streamUrl = `${origin}/share/streaming?uk=${encodeURIComponent(
        uk
      )}&shareid=${encodeURIComponent(shareid)}&type=${encodeURIComponent(
        streamType
      )}&fid=${encodeURIComponent(fsId)}&sign=${encodeURIComponent(
        streamSign
      )}&timestamp=${ts}&jsToken=${encodeURIComponent(
        token
      )}&esl=1&isplayer=1&ehps=1&clienttype=${clienttype}&app_id=${appId}&web=${web}&channel=${channel}`;

      if (cached) {
        if (!cached.streamUrls) cached.streamUrls = {};
        cached.streamUrls[qNum] = streamUrl;
        cached.dlink = streamUrl;
        fileCache.set(fsId, cached);
      }
      return streamUrl;
    }

    // Strategy 1: Native TeraBox POST /share/download with fid_list
    if (shareid && uk && sign && timestamp) {
      try {
        const postUrl = `/share/download?app_id=250528&web=1&channel=dubox&clienttype=0&jsToken=${encodeURIComponent(
          token
        )}&dp-logid=${Date.now()}&shareid=${encodeURIComponent(shareid)}&sign=${encodeURIComponent(
          sign
        )}&timestamp=${encodeURIComponent(timestamp)}&primaryid=${encodeURIComponent(
          shareid
        )}&scene=purchased_list`;

        const formBody = new URLSearchParams({
          product: 'share',
          nozip: '0',
          uk: String(uk),
          primaryid: String(shareid),
          fid_list: JSON.stringify([String(fsId)])
        });

        const res = await originalFetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json, text/plain, */*'
          },
          body: formBody.toString()
        });

        if (res.ok) {
          const json = await res.json();
          let directUrl = '';
          if (json && json.errno === 0) {
            if (Array.isArray(json.dlink) && json.dlink[0] && json.dlink[0].dlink) {
              directUrl = json.dlink[0].dlink;
            } else if (typeof json.dlink === 'string' && json.dlink) {
              directUrl = json.dlink;
            } else if (Array.isArray(json.list) && json.list[0] && json.list[0].dlink) {
              directUrl = json.list[0].dlink;
            }
          }

          if (directUrl) {
            if (cached) {
              cached.dlink = directUrl;
              cached.original_dlink = directUrl;
              fileCache.set(fsId, cached);
            }
            return directUrl;
          }
        }
      } catch (err) {
        console.warn(`${LOG_PREFIX} resolveDlink POST failed, trying GET fallback:`, err);
      }

      // Strategy 2: GET /share/download fallback
      try {
        const getUrl = `/share/download?app_id=250528&web=1&channel=dubox&clienttype=0&jsToken=${encodeURIComponent(
          token
        )}&dp-logid=${Date.now()}&shareid=${encodeURIComponent(shareid)}&uk=${encodeURIComponent(
          uk
        )}&sign=${encodeURIComponent(sign)}&timestamp=${encodeURIComponent(
          timestamp
        )}&primaryid=${encodeURIComponent(shareid)}&fs_ids=[${encodeURIComponent(fsId)}]`;

        const res = await originalFetch(getUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json, text/plain, */*'
          }
        });
        if (res.ok) {
          const json = await res.json();
          let directUrl = '';
          if (json && Array.isArray(json.dlink) && json.dlink[0] && json.dlink[0].dlink) {
            directUrl = json.dlink[0].dlink;
          } else if (typeof json.dlink === 'string' && json.dlink) {
            directUrl = json.dlink;
          }
          if (directUrl) {
            if (cached) {
              cached.dlink = directUrl;
              cached.original_dlink = directUrl;
              fileCache.set(fsId, cached);
            }
            return directUrl;
          }
        }
      } catch (err) {
        console.warn(`${LOG_PREFIX} resolveDlink GET fallback failed:`, err);
      }
    }

    // Strategy 3: Inspect active HTML5 <video> element if this is an active video file
    try {
      if (typeof document !== 'undefined') {
        const video = document.querySelector('video');
        if (video && video.src && !video.src.startsWith('blob:') && video.src.startsWith('http')) {
          if (cached) {
            cached.dlink = video.src;
            fileCache.set(fsId, cached);
          }
          return video.src;
        }
      }
    } catch (_) {}

    // Strategy 4: For any video file, construct the authorized /share/streaming HLS URL
    if (shareid && uk && sign && timestamp) {
      const isVideo = cached ? cached.isVideo : true;
      if (isVideo) {
        const origin =
          (typeof window !== 'undefined' && window.location.origin) || 'https://www.terabox.app';
        const streamUrl = `${origin}/share/streaming?app_id=250528&web=1&channel=dubox&clienttype=0&jsToken=${encodeURIComponent(
          token
        )}&dp-logid=${Date.now()}&shareid=${encodeURIComponent(shareid)}&uk=${encodeURIComponent(
          uk
        )}&sign=${encodeURIComponent(sign)}&timestamp=${encodeURIComponent(
          timestamp
        )}&primaryid=${encodeURIComponent(shareid)}&fid=${encodeURIComponent(fsId)}&type=${encodeURIComponent(
          preferredType || 'M3U8_AUTO_720'
        )}`;

        if (cached) {
          cached.dlink = streamUrl;
          fileCache.set(fsId, cached);
        }
        return streamUrl;
      }
    }

    return (cached && cached.dlink) || null;
  }

  // --------------------------------------------------------------------------
  // CustomEvent IPC: Listen for TERABOX_BRIDGE_REQUEST
  // --------------------------------------------------------------------------
  async function handleBridgeRequest(e) {
    if (!e || !e.detail) return;
    const { requestId, action, fsId, type } = e.detail;

    const sendResponse = (payload) => {
      const detail = { requestId, ...payload };
      try {
        if (typeof document !== 'undefined' && document.dispatchEvent) {
          document.dispatchEvent(new CustomEvent('TERABOX_BRIDGE_RESPONSE', { detail }));
        }
      } catch (_) {}
      try {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('TERABOX_BRIDGE_RESPONSE', { detail }));
        }
      } catch (_) {}
    };

    try {
      syncYunData();

      if (action === 'GET_FILES') {
        const files = Array.from(fileCache.values());
        sendResponse({
          success: true,
          files,
          shareInfo: activeShareInfo
        });
      } else if (action === 'GET_DLINK') {
        const dlink = await resolveDlink(fsId, type);
        sendResponse({
          success: Boolean(dlink),
          fsId,
          dlink,
          file: fileCache.get(fsId) || null
        });
      } else {
        sendResponse({
          success: false,
          error: `Unknown action: ${action}`
        });
      }
    } catch (err) {
      sendResponse({
        success: false,
        error: err.message || 'Bridge request failure'
      });
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('TERABOX_BRIDGE_REQUEST', handleBridgeRequest);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('TERABOX_BRIDGE_REQUEST', handleBridgeRequest);
  }

  console.log(`${LOG_PREFIX} TeraBox MAIN World Bridge successfully initialized.`);
})();
