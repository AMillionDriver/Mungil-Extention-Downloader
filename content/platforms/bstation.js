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
        const stream =
          typeof task.resolveStream === 'function' ? await task.resolveStream() : task.stream;
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
      let fetchOptions = { method: 'GET' };
      try {
        const parsedUrl = new URL(cleanUrl);
        if (
          parsedUrl.hostname.endsWith('bilibili.tv') ||
          parsedUrl.hostname.endsWith('bstation.tv')
        ) {
          fetchOptions.credentials = 'include';
        }
      } catch (_) {}

      let response;
      try {
        response = await fetch(cleanUrl, fetchOptions);
      } catch (firstErr) {
        if (fetchOptions.credentials) {
          response = await fetch(cleanUrl, { method: 'GET' });
        } else {
          throw firstErr;
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers ? response.headers.get('content-type') || '' : '';
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
      }, 1500);

      // Record telemetry via background service worker
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: 'RECORD_DOWNLOAD',
            payload: {
              platform: 'bstation',
              title: streamInput.title || filename,
              filename: filename
            }
          },
          () => {}
        );
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
            chrome.runtime.sendMessage(
              {
                type: 'DOWNLOAD_VIDEO',
                payload: {
                  url: cleanUrl,
                  platform: 'bstation',
                  title: streamInput.title,
                  filename: filename
                }
              },
              (res) => {
                if (chrome.runtime.lastError)
                  return reject(new Error(chrome.runtime.lastError.message));
                if (res && res.success) resolve(res);
                else reject(new Error(res?.error || 'Background download failed'));
              }
            );
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

  function requestBridgeStream(options = {}, timeoutMs = 4000) {
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

      const sendEvent = (codecPref) => {
        document.dispatchEvent(
          new CustomEvent('BS_BRIDGE_REQUEST', {
            detail: {
              requestId,
              action: 'GET_PLAY_URL',
              ep_id: options.ep_id || options.epId,
              aid: options.aid,
              bvid: options.bvid,
              qn: options.qn || 64,
              codecPreference: options.codecPreference || codecPref
            }
          })
        );
      };

      if (
        !options.codecPreference &&
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local &&
        typeof chrome.storage.local.get === 'function'
      ) {
        try {
          chrome.storage.local.get(['codecPreference'], (st) => {
            sendEvent((st && st.codecPreference) || 'data_saver');
          });
          return;
        } catch (_) {}
      }
      sendEvent(options.codecPreference || 'data_saver');
    });
  }

  function requestBridgeSeriesInfo(options = {}, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        return reject(new Error('Document is not available'));
      }

      const requestId = `bs_series_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let timer = null;

      const responseHandler = (event) => {
        const detail = event.detail || {};
        if (detail.requestId === requestId) {
          document.removeEventListener('BS_BRIDGE_RESPONSE', responseHandler);
          if (timer) clearTimeout(timer);

          if (detail.success && detail.data) {
            resolve(detail.data);
          } else {
            reject(new Error(detail.error || 'Bstation series info not found'));
          }
        }
      };

      document.addEventListener('BS_BRIDGE_RESPONSE', responseHandler);

      timer = setTimeout(() => {
        document.removeEventListener('BS_BRIDGE_RESPONSE', responseHandler);
        reject(new Error('Timeout waiting for Bstation series bridge'));
      }, timeoutMs);

      document.dispatchEvent(
        new CustomEvent('BS_BRIDGE_REQUEST', {
          detail: {
            requestId,
            action: 'GET_SERIES_INFO',
            ep_id: options.ep_id || options.epId
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
  function checkDownloadedStatus(btn, episodeId) {
    if (!btn || !episodeId) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
    try {
      chrome.runtime.sendMessage(
        { action: 'CHECK_DOWNLOADED_STATUS', videoId: episodeId },
        (res) => {
          if (chrome.runtime.lastError || !res) return;
          if (btn.getAttribute('data-episode-id') !== String(episodeId)) return;
          if (res.downloaded) {
            setPlayerButtonState(btn, 'downloaded');
          } else {
            if (
              btn.getAttribute('data-state') === 'downloaded' ||
              btn.classList.contains('is-downloaded')
            ) {
              setPlayerButtonState(btn, 'idle');
            }
          }
        }
      );
    } catch (_) {}
  }

  function setPlayerButtonState(btn, state, customLabel) {
    if (!btn) return;
    const iconBox = btn.querySelector('.bs-dl-icon-box');
    const labelSpan = btn.querySelector('.bs-dl-btn-label');

    btn.classList.remove(
      'bs-dl-state-loading',
      'bs-dl-state-success',
      'bs-dl-state-error',
      'bs-dl-state-downloaded',
      'is-downloaded'
    );
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
        btn.disabled = false;
        btn.classList.add('bs-dl-state-success');
        if (iconBox) iconBox.innerHTML = SVG_ICONS.success;
        if (labelSpan) labelSpan.textContent = customLabel || 'Tersimpan!';
        btn._stateTimer = setTimeout(() => {
          setPlayerButtonState(btn, 'downloaded');
        }, 3000);
        break;

      case 'downloaded':
        btn.disabled = false;
        btn.classList.add('bs-dl-state-downloaded', 'is-downloaded');
        if (iconBox) iconBox.innerHTML = SVG_ICONS.download;
        if (labelSpan) labelSpan.textContent = customLabel || 'Sudah Diunduh (Download Lagi?)';
        btn.title = 'Kamu sudah mengunduh episode ini tadi. Klik untuk mengunduh lagi.';
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
        btn.title = 'Unduh episode aktif ini';
        break;
    }
  }

  function getCanonicalBstationUrl(info) {
    if (typeof window === 'undefined' || !window.location) return '';
    const href = window.location.href || '';
    const pathname = window.location.pathname || '';
    const playMatch = pathname.match(/\/play\/(\d+)(?:\/(\d+))?/);
    if (playMatch) {
      const seasonId = playMatch[1];
      const targetEpId = (info && info.episodeId) || playMatch[2];
      if (seasonId && targetEpId) {
        return `https://www.bilibili.tv/id/play/${seasonId}/${targetEpId}`;
      }
      return `https://www.bilibili.tv/id/play/${seasonId}`;
    }
    return href;
  }

  async function fallbackInPageDownload(btn, videoInfo, filename) {
    let stream = null;
    try {
      stream = await requestBridgeStream({ ep_id: videoInfo.episodeId, qn: 64 }, 4000);
    } catch (_) {}

    if (!stream || (!stream.playUrl && !stream.url)) {
      try {
        stream = await requestBridgeStream({ qn: 64 }, 3000);
      } catch (_) {}
    }

    if (!stream || (!stream.playUrl && !stream.url)) {
      const videoEl = document.querySelector('video');
      if (videoEl && videoEl.src && videoEl.src.startsWith('http')) {
        stream = { url: videoEl.src, quality: '720p' };
      }
    }

    if (!stream || (!stream.playUrl && !stream.url)) {
      throw new Error('Aliran video tidak ditemukan');
    }

    const streamUrl = stream.playUrl || stream.url;
    setPlayerButtonState(btn, 'loading', 'Mengunduh...');
    await downloadStreamInPage({
      url: streamUrl,
      filename: filename,
      title: videoInfo.animeTitle
    });
    setPlayerButtonState(btn, 'success', 'Tersimpan!');
  }

  // =========================================================================
  // 5.1 Bstation Quality Preference & Size Estimation Engine
  // =========================================================================

  const BSTATION_QUALITY_OPTIONS = [
    { id: '1080p', label: '1080p', desc: 'Full HD' },
    { id: '720p', label: '720p', desc: 'HD Jernih' },
    { id: '480p', label: '480p', desc: 'Standar' },
    { id: '360p', label: '360p', desc: 'Hemat Kuota' }
  ];
  let currentSelectedQuality = '720p';

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get(['bstationSelectedQuality'], (data) => {
        if (data?.bstationSelectedQuality) {
          currentSelectedQuality = data.bstationSelectedQuality;
          updateQualityButtonUI();
        }
      });
    } catch (_) {}
  }

  function getVideoDurationSeconds() {
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const video = document.querySelector('video');
      if (video && video.duration && !isNaN(video.duration) && video.duration > 0) {
        return video.duration;
      }
    }
    return 1440; // Default standard anime episode: ~24 minutes
  }

  function getEstimatedSizes(durationSec) {
    const sec = durationSec || getVideoDurationSeconds();
    const mb1080 = Math.max(1, Math.round(sec * 0.45));
    const mb720 = Math.max(1, Math.round(sec * 0.22));
    const mb480 = Math.max(1, Math.round(sec * 0.1));
    const mb360 = Math.max(1, Math.round(sec * 0.05));

    const fmt = (mb) => (mb >= 1024 ? `~${(mb / 1024).toFixed(1)} GB` : `~${mb} MB`);

    return {
      '1080p': fmt(mb1080),
      '720p': fmt(mb720),
      '480p': fmt(mb480),
      '360p': fmt(mb360)
    };
  }

  function saveQualityPreference(quality) {
    currentSelectedQuality = quality;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.set({ bstationSelectedQuality: quality });
      } catch (_) {}
    }
    updateQualityButtonUI();
  }

  function updateQualityButtonUI() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const labelEl = document.querySelector('#bs-dl-quality-btn .bs-dl-q-label-current');
    if (labelEl) {
      labelEl.textContent = currentSelectedQuality;
    }
    const menuEl =
      typeof document.getElementById === 'function'
        ? document.getElementById('bs-dl-quality-menu')
        : null;
    if (menuEl) {
      renderQualityMenuItems(menuEl);
    }
  }

  function openQualityMenu(menuEl) {
    if (!menuEl) return;
    renderQualityMenuItems(menuEl);
    menuEl.classList.add('is-open');
    menuEl.style.display = 'flex';
  }

  function closeQualityMenu(menuEl) {
    if (!menuEl) return;
    menuEl.classList.remove('is-open');
    menuEl.style.display = 'none';
  }

  function renderQualityMenuItems(menuEl) {
    if (!menuEl) return;
    const sizes = getEstimatedSizes();
    menuEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'bs-dl-menu-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'bs-dl-menu-title';
    titleSpan.textContent = 'Pilih Kualitas';

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'bs-dl-menu-actions';

    const subSpan = document.createElement('span');
    subSpan.className = 'bs-dl-menu-sub';
    subSpan.textContent = 'Estimasi Ukuran';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'bs-dl-menu-close-btn';
    closeBtn.title = 'Tutup menu';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      closeQualityMenu(menuEl);
    });

    actionsDiv.appendChild(subSpan);
    actionsDiv.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(actionsDiv);
    menuEl.appendChild(header);

    for (const opt of BSTATION_QUALITY_OPTIONS) {
      const item = document.createElement('div');
      item.className = 'bs-dl-q-item';
      const isActive = opt.id === currentSelectedQuality;
      if (isActive) item.classList.add('is-active');

      const checkmark = isActive ? '✓ ' : '';
      const sizeStr = sizes[opt.id] || '';

      item.innerHTML = `
        <div class="bs-dl-q-item-info">
          <span class="bs-dl-q-item-badge">${checkmark}${opt.label}</span>
          <span class="bs-dl-q-item-desc">${opt.desc}</span>
        </div>
        <span class="bs-dl-q-item-size">${sizeStr}</span>
      `;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        saveQualityPreference(opt.id);
        closeQualityMenu(menuEl);
      });

      menuEl.appendChild(item);
    }
  }

  /**
   * Injects 1-click download button and quality selector into player controls or action bar.
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

    const group = document.createElement('div');
    group.className = 'bs-dl-btn-group';

    const btn = document.createElement('button');
    btn.className = 'bs-dl-btn';
    btn.type = 'button';
    btn.innerHTML = `
      <span class="bs-dl-icon-box">${SVG_ICONS.download}</span>
      <span class="bs-dl-btn-label">Unduh Video</span>
    `;

    // Quality Selector Button
    const qualityBtn = document.createElement('button');
    qualityBtn.type = 'button';
    qualityBtn.id = 'bs-dl-quality-btn';
    qualityBtn.className = 'bs-dl-quality-btn';
    qualityBtn.title = 'Pilih Kualitas Video Bstation';
    qualityBtn.innerHTML = `
      <span class="bs-dl-q-label-current">${currentSelectedQuality}</span>
      <span class="bs-dl-q-chevron">▾</span>
    `;

    // Floating Quality Dropdown Menu
    const qualityMenu = document.createElement('div');
    qualityMenu.id = 'bs-dl-quality-menu';
    qualityMenu.className = 'bs-dl-quality-menu';
    qualityMenu.style.display = 'none';
    renderQualityMenuItems(qualityMenu);

    qualityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const isOpen =
        qualityMenu.classList.contains('is-open') || qualityMenu.style.display === 'flex';
      if (isOpen) {
        closeQualityMenu(qualityMenu);
      } else {
        openQualityMenu(qualityMenu);
      }
    });

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      const handleOutsideClose = (e) => {
        if (!group.contains(e.target)) {
          closeQualityMenu(qualityMenu);
        }
      };

      document.addEventListener('pointerdown', handleOutsideClose, true);
      document.addEventListener('click', handleOutsideClose, true);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closeQualityMenu(qualityMenu);
        }
      });
    }

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (btn.disabled) return;

      const videoInfo = getActiveVideoInfo();
      const canonicalUrl = getCanonicalBstationUrl(videoInfo);
      const reqQuality = currentSelectedQuality || '720p';
      const filename = formatBstationFilename({
        title: videoInfo.animeTitle || 'Bstation Video',
        episode: videoInfo.episodeTitle || 'E01',
        quality: reqQuality
      });

      setPlayerButtonState(btn, 'loading', 'Menyiapkan unduhan...');

      // Priority 1: Native Host (yt-dlp + FFmpeg muxing)
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            action: 'DOWNLOAD_VIDEO',
            platform: 'bstation',
            url: canonicalUrl,
            videoId: videoInfo.episodeId || String(Date.now()),
            title: `${videoInfo.animeTitle || 'Bstation Anime'} - ${videoInfo.episodeTitle || 'E01'}`,
            author: 'Bstation',
            quality: reqQuality,
            filename: filename
          },
          async (response) => {
            if (chrome.runtime.lastError || !response || !response.success) {
              console.warn(
                '[Bstation Downloader] Native download failed, attempting in-page stream fallback:',
                chrome.runtime.lastError?.message || response?.error
              );
              try {
                await fallbackInPageDownload(btn, videoInfo, filename);
              } catch (fallbackErr) {
                console.error('[Bstation Downloader] In-page fallback also failed:', fallbackErr);
                setPlayerButtonState(btn, 'error', fallbackErr.message || 'Gagal');
              }
            } else if (response.alreadyActive) {
              setPlayerButtonState(btn, 'loading', response.message || 'Sedang diunduh...');
            } else {
              setPlayerButtonState(btn, 'success', 'Tersimpan di Downloads!');
            }
          }
        );
        return;
      }

      // Priority 2: In-page fallback if runtime messaging is unavailable
      try {
        await fallbackInPageDownload(btn, videoInfo, filename);
      } catch (err) {
        console.error('[Bstation Downloader] Player download failed:', err);
        setPlayerButtonState(btn, 'error', err.message || 'Gagal');
      }
    });

    group.appendChild(btn);
    group.appendChild(qualityBtn);
    group.appendChild(qualityMenu);
    wrapper.appendChild(group);
    container.appendChild(wrapper);
    container.setAttribute('data-bs-dl-ready', 'true');

    const initialInfo = getActiveVideoInfo();
    if (initialInfo.episodeId) {
      btn.setAttribute('data-episode-id', initialInfo.episodeId);
      checkDownloadedStatus(btn, initialInfo.episodeId);
    }

    return btn;
  }

  /**
   * Injects [ 📥 Batch Download ] button beside "Semua episode" header.
   */
  function injectBatchButton(headerContainer) {
    if (!headerContainer || headerContainer.getAttribute('data-bs-batch-ready') === 'true')
      return null;

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
    if (
      titleNode &&
      titleNode !== headerContainer &&
      titleNode.parentElement === headerContainer &&
      typeof titleNode.insertAdjacentElement === 'function'
    ) {
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

  /**
   * Robustly extracts genuine numeric episode ID from an element, its children, or its href attribute.
   * On Bstation, episode links have pattern: /play/:seasonId/:episodeId (e.g. /id/play/2411889/30639810)
   * or query parameter: ?ep_id=30639810
   */
  function extractNumericEpId(element) {
    if (!element) return '';

    // 1. Check data-ep-id or data-id attribute if strictly numeric
    const dataEpId = element.getAttribute
      ? element.getAttribute('data-ep-id') || element.getAttribute('data-id')
      : null;
    if (dataEpId && /^\d+$/.test(String(dataEpId))) {
      return String(dataEpId);
    }

    // 2. Check href attribute on element, child <a> tag, or ancestor <a> tag
    let href = element.getAttribute ? element.getAttribute('href') || element.href || '' : '';
    if (!href) {
      const a =
        (element.querySelector && element.querySelector('a[href*="/play/"], a')) ||
        (element.closest && element.closest('a'));
      if (a) href = a.getAttribute('href') || a.href || '';
    }

    if (href && typeof href === 'string') {
      // Matches /play/:seasonId/:episodeId
      const match = href.match(/\/play\/\d+\/(\d+)/);
      if (match && match[1] && /^\d+$/.test(match[1])) {
        return match[1];
      }
      // Matches ?ep_id=:episodeId
      const epParam = href.match(/[?&]ep_id=(\d+)/);
      if (epParam && epParam[1] && /^\d+$/.test(epParam[1])) {
        return epParam[1];
      }
    }

    return '';
  }

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
          const rawId = ep.ep_id || ep.id;
          if (rawId && /^\d+$/.test(String(rawId))) {
            episodeId = String(rawId);
          }
          episodeTitle = ep.short_title ? `E${ep.short_title}` : ep.title || 'E01';
        }
      }
    }

    // 2. DOM Scrape Fallback for Title
    if (
      !animeTitle &&
      typeof document !== 'undefined' &&
      typeof document.querySelector === 'function'
    ) {
      const titleEl = document.querySelector(
        '.ogv-title, .bstar-video-title, h1[class*="title"], h1, .media-info-title'
      );
      if (titleEl) {
        animeTitle = titleEl.textContent.trim();
      }
    }

    if (!animeTitle && typeof document !== 'undefined' && document.title) {
      animeTitle = document.title.split('-')[0].split('|')[0].trim();
    }

    // 3. Extract episodeId from URL if available (/play/:seasonId/:episodeId or ?ep_id=...)
    if (!episodeId && typeof window !== 'undefined' && window.location) {
      try {
        const path = window.location.pathname || '';
        const playMatch = path.match(/\/play\/\d+\/(\d+)/);
        if (playMatch && /^\d+$/.test(playMatch[1])) {
          episodeId = playMatch[1];
        } else {
          const searchParams = new URLSearchParams(window.location.search || '');
          const epParam = searchParams.get('ep_id');
          if (epParam && /^\d+$/.test(epParam)) episodeId = epParam;
        }
      } catch (_) {}
    }

    // 4. Extract episodeId and episodeTitle from Active Episode Node in DOM
    if (typeof document !== 'undefined' && typeof document.querySelector === 'function') {
      const activeEpNode = document.querySelector(
        '.bstar-episode-item--active, [class*="ep-item--active"], .active-ep, [class*="item--active"], .bstar-episode-list .active'
      );
      if (activeEpNode) {
        const extractedId = extractNumericEpId(activeEpNode);
        if (extractedId) episodeId = extractedId;

        const numText =
          activeEpNode.querySelector('span, div')?.textContent || activeEpNode.textContent || '';
        const numMatch = numText.match(/\d+/);
        if (numMatch) episodeTitle = `E${numMatch[0]}`;
      } else if (!episodeId) {
        // If URL has only seasonId (/play/2411889) and active class is not set yet,
        // take the first episode item in the episode container!
        const firstEp = document.querySelector(
          '.bstar-episode-list a[href*="/play/"], .bstar-episode-item, [class*="ep-item"]'
        );
        if (firstEp) {
          const extractedId = extractNumericEpId(firstEp);
          if (extractedId) episodeId = extractedId;
        }
      }
    }

    // Check if VIP badge appears on active episode or user profile
    if (
      !isUserVip &&
      typeof document !== 'undefined' &&
      typeof document.querySelector === 'function'
    ) {
      const vipHeader = document.querySelector(
        '.vip-icon, .bstar-header-vip, [class*="badge--vip"]'
      );
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
    const videoInfo = getActiveVideoInfo();

    // 1. Check DOM bridge cache injected synchronously by bstation_bridge.js in MAIN world
    if (typeof document !== 'undefined') {
      try {
        const bridgeScript = document.getElementById('__BS_SERIES_INFO__');
        if (bridgeScript && bridgeScript.textContent) {
          const parsed = JSON.parse(bridgeScript.textContent);
          if (parsed && Array.isArray(parsed.episodes) && parsed.episodes.length > 0) {
            return {
              animeTitle: parsed.seriesTitle || videoInfo.animeTitle,
              isUserVip: parsed.isUserVip !== undefined ? parsed.isUserVip : videoInfo.isUserVip,
              episodes: parsed.episodes
            };
          }
        }
      } catch (_) {}
    }

    // 2. Check window.__INITIAL_STATE__ if accessible directly (e.g. Node tests or same-origin)
    if (typeof window !== 'undefined' && (window.__INITIAL_STATE__ || window.__initialState)) {
      const state = window.__INITIAL_STATE__ || window.__initialState;
      let rawList = state.epList;
      if (!rawList && state.sections && Array.isArray(state.sections)) {
        rawList = [];
        state.sections.forEach((sec) => {
          const list = sec.epList || sec.episodes || sec.episodeList || sec.list || sec.items;
          if (Array.isArray(list)) rawList.push(...list);
        });
      }
      if (!rawList && state.ogv && Array.isArray(state.ogv.sectionsList)) {
        rawList = [];
        state.ogv.sectionsList.forEach((sec) => {
          const list = sec.epList || sec.episodes || sec.episodeList || sec.list || sec.items;
          if (Array.isArray(list)) rawList.push(...list);
        });
      }
      if (!rawList && state.ogv && Array.isArray(state.ogv.episodes)) {
        rawList = state.ogv.episodes;
      }
      if (Array.isArray(rawList) && rawList.length > 0) {
        const media = state.mediaInfo || state.season || (state.ogv && state.ogv.season) || {};
        const title =
          media.title ||
          media.season_title ||
          (state.ogv &&
            state.ogv.season &&
            (state.ogv.season.title || state.ogv.season.season_title)) ||
          videoInfo.animeTitle;
        const user = state.user || state.userInfo || {};
        const vipInfo = user.vip_info || user.vip || {};
        const isVip = !!(
          vipInfo.is_vip ||
          vipInfo.status === 1 ||
          vipInfo.vip_type > 0 ||
          (user.vip && user.vip.status === 1)
        );

        const episodes = rawList.map((ep, idx) => {
          const epId = String(ep.ep_id || ep.id || ep.epid || ep.episode_id || `ep_${idx + 1}`);
          const rawTitle =
            ep.title || (ep.short_title ? `EP ${ep.short_title}` : `Episode ${idx + 1}`);
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

        return {
          animeTitle: title,
          isUserVip: isVip,
          episodes
        };
      }
    }

    // 3. Fallback: STRICTLY Scoped DOM Scrape
    const episodes = [];
    const episodeSection =
      typeof document !== 'undefined'
        ? document.querySelector(
            '.bstar-episode-list, .bstar-episodes, .bstar-episode-wrap, [class*="ep-wrap"], [class*="episode-list"]'
          )
        : null;
    const scope = episodeSection || (typeof document !== 'undefined' ? document : null);

    if (scope) {
      const candidateElements = Array.from(
        scope.querySelectorAll(
          '.bstar-episode-item, [class*="ep-item"]:not([class*="recommend"]), [class*="episode-item"]'
        ) || []
      );

      // Discard recommendation cards, sidebar links, or elements with long text (titles/descriptions)
      const epElements = candidateElements.filter((el) => {
        if (
          el.closest &&
          el.closest('.bstar-recommend, .bstar-aside, .recommend-list, aside, .right-container')
        ) {
          return false;
        }
        const txt = (el.textContent || '').trim();
        return txt.length <= 15 && /\d+/.test(txt);
      });

      const seenIds = new Set();
      epElements.forEach((el, index) => {
        const extractedNumeric = extractNumericEpId(el);
        const epId =
          extractedNumeric ||
          el.getAttribute('data-ep-id') ||
          el.getAttribute('data-id') ||
          `ep_${index + 1}`;
        if (seenIds.has(epId)) return;
        seenIds.add(epId);

        const titleText = el.textContent.trim();
        const digits = titleText.match(/\d+/);
        const epIndex = digits ? parseInt(digits[0], 10) : index + 1;

        // Detect VIP badge
        const hasVipBadge = !!(
          (el.querySelector &&
            el.querySelector(
              '.bstar-episode-item__badge, .bstar-vip-badge, .vip-badge, [class*="badge--vip"], svg[class*="diamond"]'
            )) ||
          titleText.toUpperCase().includes('VIP')
        );

        episodes.push({
          id: epId,
          epId: epId,
          index: epIndex,
          title: titleText || `Episode ${epIndex}`,
          short_title: epIndex < 10 ? `0${epIndex}` : `${epIndex}`,
          isVip: hasVipBadge,
          domElement: el
        });
      });
    }

    // 4. Fallback: If DOM items not found, generate standard 12 episodes (Ep 1-3 free, 4-12 VIP)
    if (episodes.length === 0) {
      for (let i = 1; i <= 12; i++) {
        episodes.push({
          id: `ep_${i}`,
          epId: `ep_${i}`,
          index: i,
          title: `Episode ${i}`,
          short_title: i < 10 ? `0${i}` : `${i}`,
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
    vipBadge.style.display = 'none'; // Hidden to remove VIP/Gratis labels per user request
    headerInfo.appendChild(vipBadge);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
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
    pillAll.type = 'button';
    pillAll.className = 'bs-pill-btn';
    pillAll.id = 'bs-pill-all';
    pillAll.textContent = 'Pilih Semua';
    pillGroup.appendChild(pillAll);

    const pillFree = document.createElement('button');
    pillFree.type = 'button';
    pillFree.className = 'bs-pill-btn';
    pillFree.id = 'bs-pill-free';
    pillFree.textContent = 'Pilih Semua';
    pillFree.style.display = 'none'; // Hidden to remove "Gratis" label, all episodes are downloadable
    pillGroup.appendChild(pillFree);

    const pillNone = document.createElement('button');
    pillNone.type = 'button';
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

    const opt1080 = document.createElement('option');
    opt1080.value = '1080p';
    opt1080.setAttribute('value', '1080p');
    opt1080.textContent = '1080p Full HD';
    qualitySelect.appendChild(opt1080);

    const opt720 = document.createElement('option');
    opt720.value = '720p';
    opt720.setAttribute('value', '720p');
    opt720.textContent = '720p HD';
    qualitySelect.appendChild(opt720);

    const opt480 = document.createElement('option');
    opt480.value = '480p';
    opt480.setAttribute('value', '480p');
    opt480.textContent = '480p SD';
    qualitySelect.appendChild(opt480);

    const opt360 = document.createElement('option');
    opt360.value = '360p';
    opt360.setAttribute('value', '360p');
    opt360.textContent = '360p Hemat Kuota';
    qualitySelect.appendChild(opt360);

    const initialQuality = currentSelectedQuality || '720p';
    qualitySelect.value = initialQuality;
    const matchingOpt = qualitySelect.querySelector(`option[value="${initialQuality}"]`);
    if (matchingOpt) matchingOpt.selected = true;

    qualityWrap.appendChild(qualitySelect);
    toolbar.appendChild(qualityWrap);
    dialog.appendChild(toolbar);

    // 3. Grid
    const grid = document.createElement('div');
    grid.className = 'bs-episode-grid';
    grid.id = 'bs-episode-grid';

    seriesData.episodes.forEach((ep) => {
      const card = document.createElement('div');
      card.className = 'bs-episode-card';
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
      if (ep.index <= 3) {
        checkbox.checked = true;
        card.classList.add('bs-episode-card--selected');
      }
      checkbox.disabled = false;
      cardHeader.appendChild(checkbox);
      card.appendChild(cardHeader);

      if (ep.title && ep.title !== `Episode ${ep.index}` && ep.title !== `EP ${ep.index}`) {
        const titleSpan = document.createElement('span');
        titleSpan.className = 'bs-episode-title-sub';
        titleSpan.textContent = ep.title;
        titleSpan.title = ep.title;
        card.appendChild(titleSpan);
      }

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
    cancelBtn.type = 'button';
    cancelBtn.className = 'bs-btn-secondary';
    cancelBtn.id = 'bs-btn-modal-cancel';
    cancelBtn.textContent = 'Tutup';
    footerActions.appendChild(cancelBtn);

    const startBatchBtn = document.createElement('button');
    startBatchBtn.type = 'button';
    startBatchBtn.className = 'bs-btn-primary';
    startBatchBtn.id = 'bs-btn-start-batch';

    const btnIcon = document.createElement('span');
    btnIcon.className = 'bs-btn-icon';
    btnIcon.innerHTML = SVG_ICONS.download;
    startBatchBtn.appendChild(btnIcon);

    const btnText = document.createElement('span');
    btnText.id = 'bs-start-batch-text';
    btnText.textContent = 'Mulai Unduh';
    startBatchBtn.appendChild(btnText);

    footerActions.appendChild(startBatchBtn);

    footer.appendChild(footerActions);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);

    function updateSelectedCount() {
      const checkboxes = Array.from(grid.querySelectorAll('.bs-episode-checkbox') || []).filter(
        (cb) => cb.checked
      );
      const count = checkboxes.length;
      if (countLabel) countLabel.textContent = `${count} episode dipilih`;
      if (startBatchBtn) {
        startBatchBtn.disabled = count === 0;
        const currentBtnText = overlay.querySelector('#bs-start-batch-text') || btnText;
        if (!activeQueue || activeQueue.activeWorkers === 0) {
          if (currentBtnText) {
            currentBtnText.textContent = count > 0 ? 'Mulai Unduh' : 'Pilih Episode';
          }
        }
      }
    }

    // Checkbox and card clicks
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.bs-episode-card');
      if (!card) return;

      const checkbox = card.querySelector('.bs-episode-checkbox');
      if (!checkbox || checkbox.disabled) return;
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
        if (!checkbox.disabled) {
          checkbox.checked = true;
          card.classList.add('bs-episode-card--selected');
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
          if (btnText) {
            if (res.failed > 0 && res.completed === 0) {
              btnText.textContent = 'Unduh Ulang';
            } else if (res.failed > 0) {
              btnText.textContent = 'Unduh Ulang yang Gagal';
            } else {
              btnText.textContent = 'Selesai!';
            }
          }
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
            // Priority 1: Direct Native yt-dlp download (fully synced with 1-by-1 button)
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
              return { native: true, epId, quality };
            }

            // Fallback for non-extension / mock test environments:
            // Tier 1: Try requested quality (e.g. 1080p or 720p)
            try {
              const res = await requestBridgeStream({ ep_id: epId, qn }, 4000);
              if (res && (res.playUrl || res.url)) return res;
            } catch (_) {}

            // Tier 2: Resilient fallback to 720p
            if (qn !== 64) {
              try {
                const res720 = await requestBridgeStream({ ep_id: epId, qn: 64 }, 3500);
                if (res720 && (res720.playUrl || res720.url)) return res720;
              } catch (_) {}
            }

            // Tier 3: Resilient fallback to 480p
            if (qn !== 32) {
              try {
                const res480 = await requestBridgeStream({ ep_id: epId, qn: 32 }, 3000);
                if (res480 && (res480.playUrl || res480.url)) return res480;
              } catch (_) {}
            }

            // NOTE: Never fall back to document.querySelector('video').src here
            // to eliminate trailer / preview hijacking!
            throw new Error(`Aliran video untuk Episode ${epIndex} tidak ditemukan`);
          },
          downloadStream: async (stream) => {
            const actualQuality = stream?.qualityLabel || quality;
            const filename = formatBstationFilename({
              title: seriesData.animeTitle,
              episode: epIndex,
              quality: actualQuality
            });

            const canonicalUrl = getCanonicalBstationUrl({ episodeId: epId });

            // Priority 1: Native yt-dlp host (exact match with 1-by-1 download button)
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
              await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                  {
                    action: 'DOWNLOAD_VIDEO',
                    platform: 'bstation',
                    url: canonicalUrl,
                    videoId: epId,
                    title: `${seriesData.animeTitle} - Episode ${epIndex}`,
                    author: 'Bstation',
                    quality: actualQuality,
                    filename: filename
                  },
                  async (res) => {
                    if (chrome.runtime.lastError || !res || !res.success) {
                      const nativeErr =
                        chrome.runtime.lastError?.message ||
                        res?.error ||
                        `Gagal mengunduh Episode ${epIndex}`;
                      console.warn(
                        `[Bstation Batch] Native download failed for Episode ${epIndex}, attempting stream fallback:`,
                        nativeErr
                      );

                      // In-page fallback if bridge stream is available
                      let fallbackStream = stream && (stream.playUrl || stream.url) ? stream : null;
                      if (!fallbackStream) {
                        try {
                          fallbackStream = await requestBridgeStream({ ep_id: epId, qn }, 3000);
                        } catch (_) {}
                      }

                      if (fallbackStream && (fallbackStream.playUrl || fallbackStream.url)) {
                        try {
                          await downloadStreamInPage({
                            url: fallbackStream.playUrl || fallbackStream.url,
                            filename: filename,
                            title: seriesData.animeTitle
                          });
                          resolve({ success: true, inPage: true });
                        } catch (inPageErr) {
                          reject(inPageErr);
                        }
                      } else {
                        reject(new Error(nativeErr));
                      }
                    } else {
                      resolve(res);
                    }
                  }
                );
              });
              return;
            }

            // In-page fallback for non-extension / mock environments
            if (stream && (stream.playUrl || stream.url)) {
              await downloadStreamInPage({
                url: stream.playUrl || stream.url,
                filename: filename,
                title: seriesData.animeTitle
              });
              return;
            }

            throw new Error(`Aliran video untuk Episode ${epIndex} tidak ditemukan`);
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
    const playerControl = document.querySelector(
      '.bpx-player-control-bottom-right, .bstar-video-action, .video-info-action, .bstar-danmaku-bar'
    );
    if (
      playerControl &&
      playerControl.getAttribute &&
      playerControl.getAttribute('data-bs-dl-ready') !== 'true'
    ) {
      injectPlayerButton(playerControl);
    } else {
      const existingBtn = document.querySelector('.bs-dl-btn');
      if (existingBtn) {
        const currentInfo = getActiveVideoInfo();
        const prevEpId = existingBtn.getAttribute('data-episode-id');
        if (currentInfo.episodeId && currentInfo.episodeId !== prevEpId) {
          existingBtn.setAttribute('data-episode-id', currentInfo.episodeId);
          checkDownloadedStatus(existingBtn, currentInfo.episodeId);
        }
      }
    }

    // 2. Batch Button Injection beside "Semua episode"
    if (typeof document.querySelectorAll !== 'function') return;
    const headers = Array.from(
      document.querySelectorAll(
        'h2, h3, .bstar-episode-list, .ogv-episodes-list, section[class*="episode"]'
      ) || []
    );
    for (const h of headers) {
      const text = (h.textContent || '').toLowerCase();
      if (
        text.includes('semua episode') ||
        text.includes('all episodes') ||
        text.includes('daftar episode') ||
        (h.classList && h.classList.contains && h.classList.contains('bstar-episode-list'))
      ) {
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
          quality: currentSelectedQuality || '720p',
          videoId: info.episodeId,
          estimatedSizes: getEstimatedSizes()
        });
        return false;
      }

      if (action === 'DOWNLOAD_ACTIVE_VIDEO') {
        const info = getActiveVideoInfo();
        const canonicalUrl = getCanonicalBstationUrl(info);
        const reqQuality = message.quality || currentSelectedQuality || '720p';
        const filename = formatBstationFilename({
          title: info.animeTitle || 'Bstation Video',
          episode: info.episodeTitle || 'E01',
          quality: reqQuality
        });

        const btn = document.querySelector('.bs-dl-btn');
        if (btn) setPlayerButtonState(btn, 'loading', 'Menyiapkan unduhan...');

        chrome.runtime.sendMessage(
          {
            action: 'DOWNLOAD_VIDEO',
            platform: 'bstation',
            url: canonicalUrl,
            videoId: info.episodeId || String(Date.now()),
            title: `${info.animeTitle || 'Bstation Anime'} - ${info.episodeTitle || 'E01'}`,
            author: 'Bstation',
            quality: reqQuality,
            filename: filename
          },
          async (res) => {
            if (chrome.runtime.lastError || !res || !res.success) {
              console.warn(
                '[Bstation Downloader] Native download failed, attempting in-page fallback:',
                chrome.runtime.lastError?.message || res?.error
              );
              try {
                await fallbackInPageDownload(btn, info, filename);
                sendResponse({ success: true, filename, platform: 'bstation' });
              } catch (err) {
                sendResponse({ success: false, error: err.message || 'Download failed' });
              }
            } else {
              sendResponse({ success: true, filename, platform: 'bstation' });
            }
          }
        );
        return true; // Keep channel open
      }

      if (action === 'NATIVE_DOWNLOAD_PROGRESS' || action === 'YT_NATIVE_PROGRESS') {
        const info = getActiveVideoInfo();
        if (
          message.videoId &&
          info.episodeId &&
          String(message.videoId) !== String(info.episodeId)
        ) {
          return false;
        }
        const btn = document.querySelector('.bs-dl-btn');
        if (btn) {
          let label = '';
          if (message.status === 'merging') {
            label = 'Menggabungkan Audio+Video...';
          } else {
            const partStr = message.part ? `${message.part}: ` : '';
            const pctStr = message.percent !== undefined ? `${Math.round(message.percent)}%` : '';
            const spdStr = message.speed ? ` (${message.speed})` : '';
            label = `${partStr}${pctStr}${spdStr}`.trim() || 'Mengunduh...';
          }
          setPlayerButtonState(btn, 'loading', label);
        }
        return false;
      }

      if (action === 'NATIVE_DOWNLOAD_COMPLETE' || action === 'YT_NATIVE_COMPLETE') {
        const info = getActiveVideoInfo();
        if (
          message.videoId &&
          info.episodeId &&
          String(message.videoId) !== String(info.episodeId)
        ) {
          return false;
        }
        const btn = document.querySelector('.bs-dl-btn');
        if (btn) {
          setPlayerButtonState(btn, 'success', 'Tersimpan di Downloads!');
        }
        return false;
      }

      return false;
    });
  }

  // Execute initialization (browser runtime only, not during Node module load)
  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof document.querySelector === 'function' &&
    !(typeof module !== 'undefined' && module.exports)
  ) {
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
      requestBridgeSeriesInfo,
      injectPlayerButton,
      injectBatchButton,
      openBatchModal,
      closeBatchModal,
      collectEpisodesList,
      getActiveVideoInfo,
      extractNumericEpId,
      setPlayerButtonState,
      scanAndInject,
      getCanonicalBstationUrl,
      getEstimatedSizes,
      saveQualityPreference,
      BSTATION_QUALITY_OPTIONS,
      openQualityMenu,
      closeQualityMenu,
      SVG_ICONS
    };
  }
})();
