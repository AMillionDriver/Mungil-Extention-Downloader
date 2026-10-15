/**
 * Bstation (Bilibili.tv) Direct Downloader - Content Platform Script
 * Runs in the ISOLATED world at document_idle.
 *
 * Features:
 * 1. Debounced MutationObserver (250ms) for responsive SPA DOM tracking.
 * 2. In-Page 1-Click Player Downloader with 4-state lifecycle (idle, loading, success, error).
 * 3. "Semua Episode" Batch Download Button & Responsive Modal UI.
 * 4. VIP Status Auto-Detection: disables VIP episodes for non-VIP users with [VIP Diperlukan].
 * 5. Direct Parallel Queue (Concurrency: 2) for non-blocking multi-episode downloads.
 * 6. In-Page Fetch-to-Blob Pipeline (Anti-403) preserving native session cookies and Referer.
 * 7. Multi-Platform Popup IPC listener for GET_ACTIVE_VIDEO_INFO and DOWNLOAD_ACTIVE_VIDEO.
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. Windows NTFS Filename Sanitization Utilities
  // =========================================================================

  function sanitizeBstationTitle(title) {
    if (title === null || title === undefined) return 'Anime';
    let str = String(title).trim();
    if (!str) return 'Anime';

    str = str.replace(/[:：]/g, ' - ');
    str = str.replace(/[/\\|]/g, '-');
    str = str.replace(/[*?"<>|\x00-\x1f\x7f-\x9f]/g, '');
    str = str.replace(/\s+/g, ' ');
    str = str.replace(/-{2,}/g, '-');
    str = str.replace(/\s*-\s*/g, ' - ');
    str = str.replace(/^[.\s_-]+|[.\s_-]+$/g, '');
    str = str.slice(0, 120).trim();
    str = str.replace(/[.\s_-]+$/, '');

    return str || 'Anime';
  }

  function formatBstationEpisode(ep) {
    if (ep === null || ep === undefined) return 'E01';
    const str = String(ep).trim();
    if (!str) return 'E01';

    const eMatch = str.match(/^E(\d+)$/i);
    if (eMatch) {
      const num = parseInt(eMatch[1], 10);
      return num < 10 ? `E0${num}` : `E${num}`;
    }

    const digits = str.match(/\d+/);
    if (digits) {
      const num = parseInt(digits[0], 10);
      return num < 10 ? `E0${num}` : `E${num}`;
    }

    return 'E01';
  }

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

  // =========================================================================
  // 2. Direct Parallel Queue Concurrency Engine (Concurrency: 2)
  // =========================================================================

  class DirectParallelQueue {
    constructor(options = {}) {
      this.concurrency = options.concurrency || 2;
      this.items = [];
      this.activeWorkers = 0;
      this.currentIndex = 0;
      this.completedCount = 0;
      this.failedCount = 0;
      this.cancelled = false;

      this.onProgress = options.onProgress || null;
      this.onItemComplete = options.onItemComplete || null;
      this.onItemFail = options.onItemFail || null;
      this.onAllComplete = options.onAllComplete || null;
    }

    add(task) {
      this.items.push({
        id: task.id || `task_${this.items.length}`,
        epTitle: task.epTitle || '',
        epIndex: task.epIndex || '',
        quality: task.quality || '720p',
        resolveStream: task.resolveStream,
        downloadStream: task.downloadStream,
        status: 'pending',
        error: null
      });
    }

    start() {
      this.cancelled = false;
      this.activeWorkers = 0;
      this.currentIndex = 0;
      this.completedCount = 0;
      this.failedCount = 0;
      this._notify();
      this._dispatchNext();
    }

    cancel() {
      this.cancelled = true;
      this.activeWorkers = 0;
    }

    _dispatchNext() {
      if (this.cancelled) return;

      while (this.activeWorkers < this.concurrency && this.currentIndex < this.items.length) {
        const task = this.items[this.currentIndex++];
        this._runTask(task);
      }
    }

    async _runTask(task) {
      this.activeWorkers++;
      task.status = 'downloading';
      this._notify();

      try {
        const stream = typeof task.resolveStream === 'function' ? await task.resolveStream() : task.stream;
        if (typeof task.downloadStream === 'function') {
          await task.downloadStream(stream, task);
        }
        task.status = 'completed';
        this.completedCount++;
        if (this.onItemComplete) this.onItemComplete(task);
      } catch (err) {
        task.status = 'failed';
        task.error = err.message || 'Gagal mengunduh episode';
        this.failedCount++;
        if (this.onItemFail) this.onItemFail(task, err);
      } finally {
        this.activeWorkers--;
        this._notify();

        if (this.completedCount + this.failedCount === this.items.length) {
          if (this.onAllComplete) {
            this.onAllComplete({
              total: this.items.length,
              completed: this.completedCount,
              failed: this.failedCount
            });
          }
        } else if (!this.cancelled) {
          this._dispatchNext();
        }
      }
    }

    _notify() {
      if (this.onProgress) {
        const total = this.items.length;
        const done = this.completedCount + this.failedCount;
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        this.onProgress({
          total,
          done,
          active: this.activeWorkers,
          completed: this.completedCount,
          failed: this.failedCount,
          percent
        });
      }
    }
  }

  // =========================================================================
  // 3. In-Page Stream Fetch-to-Blob Pipeline (Anti-403)
  // =========================================================================

  async function downloadStreamInPage(streamInput) {
    if (!streamInput || !streamInput.url) {
      throw new Error('Invalid or missing stream URL');
    }

    const cleanUrl = streamInput.url.trim();
    const filename = streamInput.filename || 'bstation_video.mp4';
    let blobUrl = null;

    try {
      const response = await fetch(cleanUrl, { method: 'GET', credentials: 'include' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers ? (response.headers.get('content-type') || '') : '';
      if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        throw new Error('Received HTML error page instead of video stream');
      }
      if (contentType.includes('application/json')) {
        throw new Error('Received JSON error response instead of video stream');
      }
      if (contentType.includes('text/xml') || contentType.includes('application/xml')) {
        throw new Error('Received XML error response instead of video stream');
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        throw new Error('Received empty video stream (0 bytes)');
      }

      blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = filename;

      document.body.appendChild(a);
      try {
        a.click();
      } finally {
        if (a.parentElement) {
          a.parentElement.removeChild(a);
        }
      }

      setTimeout(() => {
        try {
          if (URL.revokeObjectURL) URL.revokeObjectURL(blobUrl);
        } catch (_) {}
      }, 15000);

      // Record telemetry via background service worker
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'RECORD_DOWNLOAD',
          payload: {
            platform: 'bstation',
            title: streamInput.title || filename,
            filename: filename
          }
        }, () => {});
      }

      return { success: true, filename, source: 'in_page' };
    } catch (err) {
      if (blobUrl) {
        try {
          if (URL.revokeObjectURL) URL.revokeObjectURL(blobUrl);
        } catch (_) {}
      }

      // Fallback: Try downloading via background service worker
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          const swRes = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              type: 'DOWNLOAD_VIDEO',
              payload: {
                url: cleanUrl,
                platform: 'bstation',
                title: streamInput.title,
                filename: filename
              }
            }, (res) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              if (res && res.success) resolve(res);
              else reject(new Error(res?.error || 'Background download failed'));
            });
          });
          return { success: true, filename, source: 'background_fallback', details: swRes };
        } catch (_) {}
      }

      throw err;
    }
  }

  // =========================================================================
  // 4. MAIN World Bridge IPC Client
  // =========================================================================

  function requestBridgeStream(options = {}, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        return reject(new Error('Document is not available'));
      }

      const requestId = `bs_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let timer = null;

      const responseHandler = (event) => {
        const detail = event.detail || {};
        if (detail.requestId === requestId) {
          document.removeEventListener('BS_BRIDGE_RESPONSE', responseHandler);
          if (timer) clearTimeout(timer);

          if (detail.success && detail.data) {
            resolve(detail.data);
          } else {
            reject(new Error(detail.error || 'Video stream not found'));
          }
        }
      };

      document.addEventListener('BS_BRIDGE_RESPONSE', responseHandler);

      timer = setTimeout(() => {
        document.removeEventListener('BS_BRIDGE_RESPONSE', responseHandler);
        reject(new Error('Timeout waiting for Bstation stream bridge'));
      }, timeoutMs);

      document.dispatchEvent(
        new CustomEvent('BS_BRIDGE_REQUEST', {
          detail: {
            requestId,
            action: 'GET_PLAY_URL',
            ep_id: options.ep_id || options.epId,
            aid: options.aid,
            bvid: options.bvid,
            qn: options.qn || 64
          }
        })
      );
    });
  }

  // =========================================================================
  // 5. In-Page UI Components & Button Injection
  // =========================================================================

  const SVG_ICONS = {
    download: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 2.5v7m0 0l-2.5-2.5M8 9.5l2.5-2.5" />
      <path d="M3 12.5h10" />
    </svg>`,
    spinner: `<svg class="bs-dl-spinner" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="8" cy="8" r="6" stroke-opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" />
    </svg>`,
    success: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3.5 8.5l3 3 6-6" />
    </svg>`,
    error: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="8" cy="8" r="6" />
      <line x1="8" y1="5" x2="8" y2="9" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
    </svg>`,
    batch: `<svg class="bs-batch-trigger-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M2.5 5.5l5.5 3 5.5-3" />
      <path d="M2.5 8.5l5.5 3 5.5-3" />
      <path d="M8 2.5v6" />
      <path d="M2.5 13.5h11" />
    </svg>`,
    close: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>`
  };

  /**
   * Updates player button visual state machine: idle -> loading -> success / error -> idle.
   */
  function setPlayerButtonState(btn, state, customLabel) {
    if (!btn) return;
    const iconBox = btn.querySelector('.bs-dl-icon-box');
    const labelSpan = btn.querySelector('.bs-dl-btn-label');

    btn.classList.remove('bs-dl-state-loading', 'bs-dl-state-success', 'bs-dl-state-error');
    btn.setAttribute('data-state', state);

    if (btn._stateTimer) {
      clearTimeout(btn._stateTimer);
      btn._stateTimer = null;
    }

    switch (state) {
      case 'loading':
        btn.disabled = true;
        btn.classList.add('bs-dl-state-loading');
        if (iconBox) iconBox.innerHTML = SVG_ICONS.spinner;
        if (labelSpan) labelSpan.textContent = customLabel || 'Mengunduh...';
        break;

      case 'success':
        btn.disabled = true;
        btn.classList.add('bs-dl-state-success');
        if (iconBox) iconBox.innerHTML = SVG_ICONS.success;
        if (labelSpan) labelSpan.textContent = customLabel || 'Tersimpan!';
        btn._stateTimer = setTimeout(() => {
          setPlayerButtonState(btn, 'idle');
        }, 2500);
        break;

      case 'error':
        btn.disabled = false;
        btn.classList.add('bs-dl-state-error');
        if (iconBox) iconBox.innerHTML = SVG_ICONS.error;
        if (labelSpan) labelSpan.textContent = customLabel || 'Gagal';
        btn._stateTimer = setTimeout(() => {
          setPlayerButtonState(btn, 'idle');
        }, 3000);
        break;

      case 'idle':
      default:
        btn.disabled = false;
        btn.removeAttribute('data-state');
        if (iconBox) iconBox.innerHTML = SVG_ICONS.download;
        if (labelSpan) labelSpan.textContent = 'Unduh Video';
        break;
    }
  }

  /**
   * Injects 1-click download button into player controls or action bar.
   */
  function injectPlayerButton(container) {
    if (!container || container.getAttribute('data-bs-dl-ready') === 'true') return null;

    // Guard against duplicate injection
    if (container.querySelector('.bs-dl-btn')) {
      container.setAttribute('data-bs-dl-ready', 'true');
      return container.querySelector('.bs-dl-btn');
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'bs-dl-action-item';

    const btn = document.createElement('button');
    btn.className = 'bs-dl-btn';
    btn.type = 'button';
    btn.innerHTML = `
      <span class="bs-dl-icon-box">${SVG_ICONS.download}</span>
      <span class="bs-dl-btn-label">Unduh Video</span>
    `;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (btn.disabled) return;

      setPlayerButtonState(btn, 'loading', 'Mengekstrak...');
      try {
        const videoInfo = getActiveVideoInfo();
        let stream = null;

        try {
          stream = await requestBridgeStream({ ep_id: videoInfo.episodeId, qn: 64 }, 2000);
        } catch (_) {}

        if (!stream || (!stream.playUrl && !stream.url)) {
          // Check if active video has src on video element
          const videoEl = document.querySelector('video');
          if (videoEl && videoEl.src && videoEl.src.startsWith('http')) {
            stream = { url: videoEl.src, quality: '720p' };
          }
        }

        if (!stream || (!stream.playUrl && !stream.url)) {
          throw new Error('Aliran video tidak ditemukan');
        }

        const streamUrl = stream.playUrl || stream.url;
        const filename = formatBstationFilename({
          title: videoInfo.animeTitle || 'Bstation Video',
          episode: videoInfo.episodeTitle || 'E01',
          quality: stream.qualityLabel || '720p'
        });

        setPlayerButtonState(btn, 'loading', 'Mengunduh...');
        await downloadStreamInPage({
          url: streamUrl,
          filename: filename,
          title: videoInfo.animeTitle
        });

        setPlayerButtonState(btn, 'success', 'Tersimpan!');
      } catch (err) {
        console.error('[Bstation Downloader] Player download failed:', err);
        setPlayerButtonState(btn, 'error', err.message || 'Gagal');
      }
    });

    wrapper.appendChild(btn);
    container.appendChild(wrapper);
    container.setAttribute('data-bs-dl-ready', 'true');

    return btn;
  }

  /**
   * Injects [ 📥 Batch Download ] button beside "Semua episode" header.
   */
  function injectBatchButton(headerContainer) {
    if (!headerContainer || headerContainer.getAttribute('data-bs-batch-ready') === 'true') return null;

    if (headerContainer.querySelector('.bs-batch-trigger-btn')) {
      headerContainer.setAttribute('data-bs-batch-ready', 'true');
      return headerContainer.querySelector('.bs-batch-trigger-btn');
    }

    const batchBtn = document.createElement('button');
    batchBtn.className = 'bs-batch-trigger-btn';
    batchBtn.type = 'button';
    batchBtn.innerHTML = `
      ${SVG_ICONS.batch}
      <span>Batch Download</span>
    `;

    batchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openBatchModal();
    });

    // Append directly to header or beside title node
    const titleNode = headerContainer.querySelector('h2, h3, div, span') || headerContainer;
    if (titleNode && titleNode !== headerContainer && titleNode.parentElement === headerContainer && typeof titleNode.insertAdjacentElement === 'function') {
      titleNode.insertAdjacentElement('afterend', batchBtn);
    } else {
      headerContainer.appendChild(batchBtn);
    }

    headerContainer.setAttribute('data-bs-batch-ready', 'true');
    return batchBtn;
  }

  // =========================================================================
  // 6. Active Video & Page State Detection
  // =========================================================================

  function getActiveVideoInfo() {
    let animeTitle = '';
    let episodeTitle = 'E01';
    let episodeId = '';
    let isUserVip = false;

    // 1. Try window SSR state if accessible
    if (typeof window !== 'undefined') {
      const state = window.__INITIAL_STATE__ || window.__initialState;
      if (state && typeof state === 'object') {
        const media = state.mediaInfo || state.season || (state.ogv && state.ogv.season) || {};
        animeTitle = media.title || '';
        const user = state.user || state.userInfo || {};
        isUserVip = !!(user.vip && (user.vip.is_vip || user.vip.status === 1));

        const ep = state.epInfo || state.activeEp;
        if (ep) {
          episodeId = String(ep.ep_id || ep.id || '');
          episodeTitle = ep.short_title ? `E${ep.short_title}` : (ep.title || 'E01');
        }
      }
    }

    // 2. DOM Scrape Fallback
    if (!animeTitle && typeof document !== 'undefined') {
      const titleEl = document.querySelector('.ogv-title, .bstar-video-title, h1[class*="title"], h1, .media-info-title');
      if (titleEl) {
        animeTitle = titleEl.textContent.trim();
      }
    }

    if (!animeTitle && typeof document !== 'undefined' && document.title) {
      animeTitle = document.title.split('-')[0].split('|')[0].trim();
    }

    if (!episodeId && typeof document !== 'undefined') {
      const activeEpNode = document.querySelector('.bstar-episode-item--active, [class*="ep-item--active"], .active-ep');
      if (activeEpNode) {
        episodeId = activeEpNode.getAttribute('data-ep-id') || activeEpNode.getAttribute('data-id') || '';
        const numText = activeEpNode.querySelector('span, div')?.textContent || activeEpNode.textContent || '';
        const numMatch = numText.match(/\d+/);
        if (numMatch) episodeTitle = `E${numMatch[0]}`;
      }
    }

    // Check if VIP badge appears on active episode or user profile
    if (!isUserVip && typeof document !== 'undefined') {
      const vipHeader = document.querySelector('.vip-icon, .bstar-header-vip, [class*="badge--vip"]');
      if (vipHeader) isUserVip = true;
    }

    return {
      animeTitle: animeTitle || 'Anime',
      episodeTitle: episodeTitle || 'E01',
      episodeId: episodeId || '',
      isUserVip,
      ready: true,
      platform: 'bstation'
    };
  }

  // =========================================================================
  // 7. Batch Download Modal Controller
  // =========================================================================

  let activeQueue = null;

  function collectEpisodesList() {
    const episodes = [];
    const videoInfo = getActiveVideoInfo();

    // 1. Try DOM episode items
    const epElements = Array.from(document.querySelectorAll('.bstar-episode-item, a[class*="episode-item"], div[class*="ep-item"], a[href*="/play/"]') || []);

    if (epElements.length > 0) {
      epElements.forEach((el, index) => {
        const epId = el.getAttribute('data-ep-id') || el.getAttribute('data-id') || `ep_${index + 1}`;
        const titleText = el.textContent.trim();
        const digits = titleText.match(/\d+/);
        const epIndex = digits ? parseInt(digits[0], 10) : (index + 1);

        // Detect VIP badge
        const hasVipBadge = !!el.querySelector('.bstar-episode-item__badge, .bstar-vip-badge, .vip-badge, [class*="badge--vip"], svg[class*="diamond"]') ||
                            titleText.toUpperCase().includes('VIP');

        episodes.push({
          id: epId,
          epId: epId,
          index: epIndex,
          title: titleText || `Episode ${epIndex}`,
          isVip: hasVipBadge,
          domElement: el
        });
      });
    }

    // 2. If DOM items not found, generate dummy/SSR episodes
    if (episodes.length === 0) {
      for (let i = 1; i <= 12; i++) {
        episodes.push({
          id: `ep_${i}`,
          epId: `ep_${i}`,
          index: i,
          title: `Episode ${i}`,
          isVip: i > 3 // Ep 1-3 free, 4-12 VIP
        });
      }
    }

    return {
      animeTitle: videoInfo.animeTitle,
      isUserVip: videoInfo.isUserVip,
      episodes
    };
  }

  function openBatchModal() {
    let overlay = document.getElementById('bs-batch-modal-root');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'bs-batch-modal-root';
      overlay.className = 'bs-modal-overlay';
      document.body.appendChild(overlay);
    }

    const seriesData = collectEpisodesList();
    const isUserVip = seriesData.isUserVip;

    // Clear previous children
    while (overlay.children && overlay.children.length > 0) {
      overlay.removeChild(overlay.children[0]);
    }

    const dialog = document.createElement('div');
    dialog.className = 'bs-modal-dialog';

    // 1. Header
    const header = document.createElement('div');
    header.className = 'bs-modal-header';

    const headerInfo = document.createElement('div');
    headerInfo.className = 'bs-modal-header-info';

    const titleEl = document.createElement('h2');
    titleEl.className = 'bs-modal-title';
    titleEl.textContent = seriesData.animeTitle;
    titleEl.title = seriesData.animeTitle;
    headerInfo.appendChild(titleEl);

    const vipBadge = document.createElement('span');
    vipBadge.className = `bs-vip-status-badge ${isUserVip ? 'bs-is-vip' : 'bs-is-free'}`;
    vipBadge.textContent = isUserVip ? '👑 VIP Member' : '👤 Akun Gratis';
    headerInfo.appendChild(vipBadge);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-modal-close-btn';
    closeBtn.id = 'bs-modal-close';
    closeBtn.setAttribute('aria-label', 'Tutup');
    closeBtn.innerHTML = SVG_ICONS.close;

    header.appendChild(headerInfo);
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // 2. Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'bs-modal-toolbar';

    const pillGroup = document.createElement('div');
    pillGroup.className = 'bs-pill-group';

    const pillAll = document.createElement('button');
    pillAll.className = 'bs-pill-btn';
    pillAll.id = 'bs-pill-all';
    pillAll.textContent = 'Pilih Semua';
    pillGroup.appendChild(pillAll);

    const pillFree = document.createElement('button');
    pillFree.className = 'bs-pill-btn';
    pillFree.id = 'bs-pill-free';
    pillFree.textContent = 'Hanya Episode Gratis';
    pillGroup.appendChild(pillFree);

    const pillNone = document.createElement('button');
    pillNone.className = 'bs-pill-btn';
    pillNone.id = 'bs-pill-none';
    pillNone.textContent = 'Kosongkan';
    pillGroup.appendChild(pillNone);

    toolbar.appendChild(pillGroup);

    const qualityWrap = document.createElement('div');
    qualityWrap.className = 'bs-quality-selector-wrap';

    const qualityLabel = document.createElement('span');
    qualityLabel.className = 'bs-quality-label';
    qualityLabel.textContent = 'Kualitas:';
    qualityWrap.appendChild(qualityLabel);

    const qualitySelect = document.createElement('select');
    qualitySelect.className = 'bs-quality-select';
    qualitySelect.id = 'bs-quality-select';
    qualitySelect.value = '720p';

    const opt1080 = document.createElement('option');
    opt1080.value = '1080p';
    opt1080.textContent = '1080p Full HD (VIP)';
    qualitySelect.appendChild(opt1080);

    const opt720 = document.createElement('option');
    opt720.value = '720p';
    opt720.textContent = '720p HD';
    qualitySelect.appendChild(opt720);

    const opt480 = document.createElement('option');
    opt480.value = '480p';
    opt480.textContent = '480p SD';
    qualitySelect.appendChild(opt480);

    qualityWrap.appendChild(qualitySelect);
    toolbar.appendChild(qualityWrap);
    dialog.appendChild(toolbar);

    // 3. Grid
    const grid = document.createElement('div');
    grid.className = 'bs-episode-grid';
    grid.id = 'bs-episode-grid';

    seriesData.episodes.forEach((ep) => {
      const isLocked = ep.isVip && !isUserVip;
      const card = document.createElement('div');
      card.className = `bs-episode-card ${isLocked ? 'bs-episode-card--vip-locked' : ''}`;
      card.setAttribute('data-ep-id', ep.id);
      card.setAttribute('data-vip', String(ep.isVip));

      const cardHeader = document.createElement('div');
      cardHeader.className = 'bs-episode-card-header';

      const numSpan = document.createElement('span');
      numSpan.className = 'bs-episode-num';
      numSpan.textContent = `EP ${ep.index < 10 ? '0' + ep.index : ep.index}`;
      cardHeader.appendChild(numSpan);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'bs-episode-checkbox';
      if (!isLocked && ep.index <= 3) {
        checkbox.checked = true;
        card.classList.add('bs-episode-card--selected');
      }
      if (isLocked) {
        checkbox.disabled = true;
      }
      cardHeader.appendChild(checkbox);
      card.appendChild(cardHeader);

      const badge = document.createElement('span');
      if (ep.isVip) {
        badge.className = 'bs-episode-badge bs-episode-badge--vip';
        badge.textContent = isLocked ? '💎 [VIP Diperlukan]' : '💎 VIP';
      } else {
        badge.className = 'bs-episode-badge bs-episode-badge--free';
        badge.textContent = 'GRATIS';
      }
      card.appendChild(badge);
      grid.appendChild(card);
    });

    dialog.appendChild(grid);

    // 4. Footer
    const footer = document.createElement('div');
    footer.className = 'bs-modal-footer';

    const summary = document.createElement('div');
    summary.className = 'bs-footer-summary';

    const countLabel = document.createElement('span');
    countLabel.className = 'bs-selected-count-label';
    countLabel.id = 'bs-selected-count';
    countLabel.textContent = '0 episode dipilih';
    summary.appendChild(countLabel);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'bs-queue-progress-container';
    progressWrap.id = 'bs-queue-progress-wrap';
    progressWrap.style.display = 'none';

    const progressTrack = document.createElement('div');
    progressTrack.className = 'bs-progress-bar-track';

    const progressFill = document.createElement('div');
    progressFill.className = 'bs-progress-bar-fill';
    progressFill.id = 'bs-progress-fill';
    progressFill.style.width = '0%';
    progressTrack.appendChild(progressFill);
    progressWrap.appendChild(progressTrack);

    const statusText = document.createElement('span');
    statusText.className = 'bs-queue-status-text';
    statusText.id = 'bs-queue-status-text';
    statusText.textContent = 'Siap';
    progressWrap.appendChild(statusText);

    summary.appendChild(progressWrap);
    footer.appendChild(summary);

    const footerActions = document.createElement('div');
    footerActions.className = 'bs-footer-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'bs-btn-secondary';
    cancelBtn.id = 'bs-btn-modal-cancel';
    cancelBtn.textContent = 'Tutup';
    footerActions.appendChild(cancelBtn);

    const startBatchBtn = document.createElement('button');
    startBatchBtn.className = 'bs-btn-primary';
    startBatchBtn.id = 'bs-btn-start-batch';
    startBatchBtn.innerHTML = `${SVG_ICONS.download}<span id="bs-start-batch-text">Mulai Unduh</span>`;
    footerActions.appendChild(startBatchBtn);

    footer.appendChild(footerActions);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    function updateSelectedCount() {
      const checkboxes = Array.from(grid.querySelectorAll('.bs-episode-checkbox:checked'));
      const count = checkboxes.length;
      if (countLabel) countLabel.textContent = `${count} episode dipilih`;
      if (startBatchBtn) {
        startBatchBtn.disabled = count === 0;
      }
    }

    // Checkbox and card clicks
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.bs-episode-card');
      if (!card || card.classList.contains('bs-episode-card--vip-locked')) return;

      const checkbox = card.querySelector('.bs-episode-checkbox');
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
      }
      if (checkbox.checked) {
        card.classList.add('bs-episode-card--selected');
      } else {
        card.classList.remove('bs-episode-card--selected');
      }
      updateSelectedCount();
    });

    // Pills logic
    pillAll.addEventListener('click', () => {
      grid.querySelectorAll('.bs-episode-card').forEach((card) => {
        const checkbox = card.querySelector('.bs-episode-checkbox');
        if (!checkbox.disabled) {
          checkbox.checked = true;
          card.classList.add('bs-episode-card--selected');
        }
      });
      updateSelectedCount();
    });

    pillFree.addEventListener('click', () => {
      grid.querySelectorAll('.bs-episode-card').forEach((card) => {
        const checkbox = card.querySelector('.bs-episode-checkbox');
        const isVip = card.getAttribute('data-vip') === 'true';
        if (!isVip && !checkbox.disabled) {
          checkbox.checked = true;
          card.classList.add('bs-episode-card--selected');
        } else {
          checkbox.checked = false;
          card.classList.remove('bs-episode-card--selected');
        }
      });
      updateSelectedCount();
    });

    pillNone.addEventListener('click', () => {
      grid.querySelectorAll('.bs-episode-card').forEach((card) => {
        const checkbox = card.querySelector('.bs-episode-checkbox');
        checkbox.checked = false;
        card.classList.remove('bs-episode-card--selected');
      });
      updateSelectedCount();
    });

    // Close handlers
    closeBtn.addEventListener('click', closeBatchModal);
    cancelBtn.addEventListener('click', closeBatchModal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && (!activeQueue || activeQueue.activeWorkers === 0)) {
        closeBatchModal();
      }
    });

    // Escape key support
    const escListener = (e) => {
      if (e.key === 'Escape' && (!activeQueue || activeQueue.activeWorkers === 0)) {
        closeBatchModal();
        document.removeEventListener('keydown', escListener);
      }
    };
    document.addEventListener('keydown', escListener);

    // Mulai Unduh -> Launch Direct Parallel Queue (Concurrency 2)
    startBatchBtn.addEventListener('click', () => {
      const selectedCards = Array.from(grid.querySelectorAll('.bs-episode-card')).filter((c) => {
        const cb = c.querySelector('.bs-episode-checkbox');
        return cb && cb.checked && !cb.disabled;
      });

      if (selectedCards.length === 0) return;

      const quality = qualitySelect.value || '720p';
      const qnMap = { '1080p': 80, '720p': 64, '480p': 32 };
      const qn = qnMap[quality] || 64;

      const progressWrap = overlay.querySelector('#bs-queue-progress-wrap');
      const progressFill = overlay.querySelector('#bs-progress-fill');
      const statusText = overlay.querySelector('#bs-queue-status-text');
      const btnText = overlay.querySelector('#bs-start-batch-text');

      if (progressWrap) progressWrap.style.display = 'flex';
      startBatchBtn.disabled = true;
      if (btnText) btnText.textContent = 'Mengunduh...';

      const queue = new DirectParallelQueue({
        concurrency: 2,
        onProgress: (p) => {
          if (progressFill) progressFill.style.width = `${p.percent}%`;
          if (statusText) {
            statusText.textContent = `Mengunduh ${p.done}/${p.total} (Aktif: ${p.active})...`;
          }
        },
        onAllComplete: (res) => {
          if (statusText) {
            statusText.textContent = `Selesai: ${res.completed}, Gagal: ${res.failed}`;
          }
          if (btnText) btnText.textContent = 'Selesai!';
          startBatchBtn.disabled = false;
          activeQueue = null;
        }
      });

      selectedCards.forEach((c) => {
        const epId = c.getAttribute('data-ep-id');
        const epNumText = c.querySelector('.bs-episode-num')?.textContent || '01';
        const numMatch = epNumText.match(/\d+/);
        const epIndex = numMatch ? parseInt(numMatch[0], 10) : 1;

        queue.add({
          id: epId,
          epIndex: epIndex,
          quality: quality,
          resolveStream: async () => {
            try {
              return await requestBridgeStream({ ep_id: epId, qn }, 2000);
            } catch (_) {
              // Fallback stream resolution
              const videoEl = document.querySelector('video');
              if (videoEl && videoEl.src && videoEl.src.startsWith('http')) {
                return { url: videoEl.src, quality };
              }
              throw new Error(`Aliran video untuk Episode ${epIndex} tidak ditemukan`);
            }
          },
          downloadStream: async (stream) => {
            const streamUrl = stream.playUrl || stream.url;
            const filename = formatBstationFilename({
              title: seriesData.animeTitle,
              episode: epIndex,
              quality: quality
            });
            await downloadStreamInPage({
              url: streamUrl,
              filename: filename,
              title: seriesData.animeTitle
            });
          }
        });
      });

      activeQueue = queue;
      queue.start();
    });

    updateSelectedCount();
    overlay.classList.add('bs-modal-open');
  }

  function closeBatchModal() {
    const overlay = document.getElementById('bs-batch-modal-root');
    if (overlay) {
      overlay.classList.remove('bs-modal-open');
    }
  }

  // =========================================================================
  // 8. Resilient DOM Scanner & Debounced MutationObserver
  // =========================================================================

  function scanAndInject() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;

    // 1. Single Player Injection
    const playerControl = document.querySelector('.bpx-player-control-bottom-right, .bstar-video-action, .video-info-action, .bstar-danmaku-bar');
    if (playerControl && playerControl.getAttribute && playerControl.getAttribute('data-bs-dl-ready') !== 'true') {
      injectPlayerButton(playerControl);
    }

    // 2. Batch Button Injection beside "Semua episode"
    if (typeof document.querySelectorAll !== 'function') return;
    const headers = Array.from(document.querySelectorAll('h2, h3, .bstar-episode-list, .ogv-episodes-list, section[class*="episode"]') || []);
    for (const h of headers) {
      const text = (h.textContent || '').toLowerCase();
      if (text.includes('semua episode') || text.includes('all episodes') || text.includes('daftar episode') || (h.classList && h.classList.contains && h.classList.contains('bstar-episode-list'))) {
        if (h.getAttribute && h.getAttribute('data-bs-batch-ready') !== 'true') {
          injectBatchButton(h);
          break;
        }
      }
    }
  }

  let debounceTimer = null;
  function scheduleScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      scanAndInject();
      debounceTimer = null;
    }, 250);
  }

  function initObserver() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;

    // Initial scan
    scanAndInject();

    if (typeof MutationObserver !== 'undefined' && document.body) {
      const observer = new MutationObserver((mutations) => {
        let shouldScan = false;
        for (const m of mutations) {
          if (m.addedNodes && m.addedNodes.length > 0) {
            shouldScan = true;
            break;
          }
        }
        if (shouldScan) {
          scheduleScan();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  // =========================================================================
  // 9. Runtime IPC Listener (Multi-Platform Popup Support)
  // =========================================================================

  function setupRuntimeMessaging() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      const action = message.type || message.action;

      if (action === 'GET_BSTATION_ACTIVE_VIDEO_INFO' || action === 'GET_ACTIVE_VIDEO_INFO') {
        const info = getActiveVideoInfo();
        sendResponse({
          success: true,
          ready: true,
          platform: 'bstation',
          title: info.animeTitle,
          episode: info.episodeTitle,
          isVip: info.isUserVip,
          quality: '720p'
        });
        return false;
      }

      if (action === 'DOWNLOAD_ACTIVE_VIDEO') {
        const info = getActiveVideoInfo();
        (async () => {
          try {
            let stream = null;
            try {
              stream = await requestBridgeStream({ ep_id: info.episodeId, qn: 64 }, 2000);
            } catch (_) {}

            if (!stream || (!stream.playUrl && !stream.url)) {
              const v = document.querySelector('video');
              if (v && v.src && v.src.startsWith('http')) {
                stream = { url: v.src, quality: '720p' };
              }
            }

            if (!stream || (!stream.playUrl && !stream.url)) {
              throw new Error('Aliran video tidak ditemukan');
            }

            const streamUrl = stream.playUrl || stream.url;
            const filename = formatBstationFilename({
              title: info.animeTitle,
              episode: info.episodeTitle,
              quality: stream.qualityLabel || '720p'
            });

            await downloadStreamInPage({
              url: streamUrl,
              filename: filename,
              title: info.animeTitle
            });

            sendResponse({ success: true, filename, platform: 'bstation' });
          } catch (err) {
            sendResponse({ success: false, error: err.message || 'Download failed' });
          }
        })();
        return true; // Keep channel open
      }

      return false;
    });
  }

  // Execute initialization (browser runtime only, not during Node module load)
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof document.querySelector === 'function' && !(typeof module !== 'undefined' && module.exports)) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initObserver();
        setupRuntimeMessaging();
      });
    } else {
      initObserver();
      setupRuntimeMessaging();
    }
  }

  // =========================================================================
  // 10. Node.js Export for Automated Testing
  // =========================================================================

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      sanitizeBstationTitle,
      formatBstationEpisode,
      formatBstationFilename,
      DirectParallelQueue,
      downloadStreamInPage,
      requestBridgeStream,
      injectPlayerButton,
      injectBatchButton,
      openBatchModal,
      closeBatchModal,
      collectEpisodesList,
      getActiveVideoInfo,
      setPlayerButtonState,
      scanAndInject,
      SVG_ICONS
    };
  }
})();
