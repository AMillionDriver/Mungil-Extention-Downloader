/**
 * YouTube Direct Downloader - Content Platform Script (ISOLATED World)
 *
 * Handles:
 * 1. Polymer SPA navigation lifecycle (yt-navigate-finish, MutationObserver).
 * 2. Native button injection into YouTube watch metadata actions & Shorts overlay.
 * 3. Bidirectional IPC with youtube_bridge.js (MAIN world) to retrieve direct progressive MP4 stream.
 * 4. Background Service Worker IPC (DOWNLOAD_VIDEO) with NTFS sanitization.
 * 5. Popup status query handler (GET_ACTIVE_VIDEO_INFO).
 */

(function () {
  'use strict';

  // Prevent multiple executions in same frame
  if (window.__YT_DIRECT_PLATFORM_INITIALIZED__) return;
  window.__YT_DIRECT_PLATFORM_INITIALIZED__ = true;

  const LOG_PREFIX = '[YouTube Downloader]';

  // Standard SVG download icon
  const SVG_DOWNLOAD = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M17 18v1H7v-1h10zm-1-8l-4 4-4-4 1.4-1.4 1.6 1.6V4h2v6.2l1.6-1.6L16 10z"/>
    </svg>
  `;

  // Standard SVG checkmark icon
  const SVG_CHECK = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>
  `;

  let debounceTimer = null;
  let isRequestInProgress = false;

  /**
   * Retrieves active YouTube video identifier from URL or DOM.
   * @returns {string|null}
   */
  function getActiveVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    let v = urlParams.get('v');
    if (!v && window.location.pathname.startsWith('/shorts/')) {
      const parts = window.location.pathname.split('/shorts/')[1];
      v = parts ? parts.split(/[?#&]/)[0] : null;
    }
    return v || null;
  }

  /**
   * Retrieves video title from the page DOM.
   * @returns {string}
   */
  function getVideoTitle() {
    const titleEl = document.querySelector(
      'h1.ytd-watch-metadata yt-formatted-string, #title h1, h1.title'
    );
    return (
      titleEl?.textContent?.trim() ||
      document.title.replace(/ - YouTube$/, '').trim() ||
      'YouTube Video'
    );
  }

  /**
   * Retrieves channel / author name from the page DOM.
   * @returns {string}
   */
  function getVideoAuthor() {
    const authorEl = document.querySelector(
      'ytd-channel-name a, #channel-name a, #upload-info #channel-name'
    );
    return authorEl?.textContent?.trim() || 'Creator';
  }

  /**
   * Retrieves active video duration in seconds from the page DOM or video player element.
   * @returns {number}
   */
  function getVideoDurationSeconds() {
    try {
      const videoEl = document.querySelector('video.html5-main-video, video');
      if (
        videoEl &&
        typeof videoEl.duration === 'number' &&
        !isNaN(videoEl.duration) &&
        videoEl.duration > 0
      ) {
        return Math.round(videoEl.duration);
      }
      const timeEl = document.querySelector('.ytp-time-duration');
      if (timeEl && timeEl.textContent) {
        const parts = timeEl.textContent.trim().split(':').map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          return parts[0] * 60 + parts[1];
        } else if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
          return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
      }
    } catch (_) {}
    return 240; // Default: 4 minutes
  }

  /**
   * Supported YouTube download quality tiers.
   */
  const QUALITY_OPTIONS = [
    { id: '1080p', label: '1080p', desc: 'Full HD', height: 1080 },
    { id: '720p', label: '720p', desc: 'HD', height: 720 },
    { id: '480p', label: '480p', desc: 'Standar', height: 480 },
    { id: '360p', label: '360p', desc: 'Hemat Kuota', height: 360 }
  ];

  let currentSelectedQuality = '1080p';

  // Load persisted quality preference
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get(['ytSelectedQuality'], (data) => {
        if (data && data.ytSelectedQuality) {
          currentSelectedQuality = data.ytSelectedQuality;
          updateQualityButtonUI();
        }
      });
    } catch (_) {}
  }

  function saveQualityPreference(quality) {
    currentSelectedQuality = quality;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        chrome.storage.local.set({ ytSelectedQuality: quality });
      } catch (_) {}
    }
    updateQualityButtonUI();
  }

  /**
   * Calculates estimated file size strings for 1080p, 720p, 480p, and 360p based on duration.
   * @param {number} [durationSec]
   * @returns {{ '1080p': string, '720p': string, '480p': string, '360p': string }}
   */
  function getEstimatedSizes(durationSec) {
    const sec = durationSec || getVideoDurationSeconds();
    // Bitrates:
    // 1080p: ~3.8 Mbps video + 128 kbps audio = ~4.0 Mbps = ~0.50 MB/s
    // 720p:  ~1.8 Mbps video + 128 kbps audio = ~2.0 Mbps = ~0.25 MB/s
    // 480p:  ~850 kbps video + 128 kbps audio = ~1.0 Mbps = ~0.125 MB/s
    // 360p:  ~400 kbps video + 96 kbps audio  = ~0.5 Mbps = ~0.065 MB/s
    const mb1080 = Math.max(1, Math.round(sec * 0.5));
    const mb720 = Math.max(1, Math.round(sec * 0.25));
    const mb480 = Math.max(1, Math.round(sec * 0.125));
    const mb360 = Math.max(1, Math.round(sec * 0.065));

    const fmt = (mb) => (mb >= 1024 ? `~${(mb / 1024).toFixed(1)} GB` : `~${mb} MB`);

    return {
      '1080p': fmt(mb1080),
      '720p': fmt(mb720),
      '480p': fmt(mb480),
      '360p': fmt(mb360)
    };
  }

  /**
   * Updates quality button label and menu items in DOM.
   */
  function updateQualityButtonUI() {
    const labelEl = document.querySelector('#yt-dl-quality-btn .yt-dl-q-label-current');
    if (labelEl) {
      labelEl.textContent = currentSelectedQuality;
    }
    const menuEl = document.getElementById('yt-dl-quality-menu');
    if (menuEl) {
      renderQualityMenuItems(menuEl);
    }
  }

  /**
   * Populates the floating quality selection menu with estimated size badges.
   * @param {HTMLElement} menuEl
   */
  function renderQualityMenuItems(menuEl) {
    if (!menuEl) return;
    const sizes = getEstimatedSizes();
    menuEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'yt-dl-menu-header';
    header.innerHTML = `<span>Pilih Kualitas</span><span class="yt-dl-menu-sub">Estimasi Ukuran</span>`;
    menuEl.appendChild(header);

    for (const opt of QUALITY_OPTIONS) {
      const item = document.createElement('div');
      const isActive = opt.id === currentSelectedQuality;
      item.className = `yt-dl-quality-item ${isActive ? 'is-active' : ''}`;
      item.setAttribute('data-quality', opt.id);

      const checkmark = isActive ? '✓ ' : '';
      const sizeStr = sizes[opt.id] || '';

      item.innerHTML = `
        <div class="yt-dl-q-item-info">
          <span class="yt-dl-q-item-badge">${checkmark}${opt.label}</span>
          <span class="yt-dl-q-item-desc">${opt.desc}</span>
        </div>
        <span class="yt-dl-q-item-size">${sizeStr}</span>
      `;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        saveQualityPreference(opt.id);
        menuEl.style.display = 'none';
      });

      menuEl.appendChild(item);
    }
  }

  /**
   * Communicates with MAIN world bridge via custom DOM events to resolve direct media stream.
   * @param {string} preference
   * @returns {Promise<object>}
   */
  function _requestStreamFromBridge(preference = 'data_saver') {
    return new Promise((resolve, reject) => {
      const requestId = `yt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const timeout = setTimeout(() => {
        window.removeEventListener('__YT_EXT_STREAM_RESOLVED__', handler);
        reject(new Error('Timeout communicating with YouTube Player bridge'));
      }, 7000);

      function handler(event) {
        if (!event.detail || event.detail.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener('__YT_EXT_STREAM_RESOLVED__', handler);
        if (event.detail.success) {
          resolve(event.detail);
        } else {
          reject(new Error(event.detail.error || 'Failed to extract video stream from bridge'));
        }
      }

      window.addEventListener('__YT_EXT_STREAM_RESOLVED__', handler);

      window.dispatchEvent(
        new CustomEvent('__YT_EXT_GET_STREAM__', {
          detail: {
            requestId,
            codecPreference: preference
          }
        })
      );
    });
  }

  /**
   * Retrieves user's codec / data saver preference from chrome.storage.local.
   * @returns {Promise<string>}
   */
  async function _getStoredPreference() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['codecPreference'], (data) => {
          resolve(data?.codecPreference || 'data_saver');
        });
      } else {
        resolve('data_saver');
      }
    });
  }

  /**
   * Updates visual button state (idle, loading, success, error, downloaded).
   * @param {HTMLButtonElement} btn
   * @param {string} state - 'idle' | 'loading' | 'success' | 'error' | 'downloaded'
   * @param {string} [text]
   */
  function setButtonState(btn, state, text) {
    if (!btn) return;
    btn.classList.remove('is-loading', 'is-success', 'is-error', 'is-downloaded');

    if (state === 'loading') {
      btn.classList.add('is-loading');
      btn.disabled = true;
      if (typeof btn.setAttribute === 'function') btn.setAttribute('disabled', 'true');
      btn.title = text || 'Sedang memproses unduhan...';
      btn.innerHTML = `
        <span class="yt-dl-spinner"></span>
        <span class="yt-dl-label">${text || 'Mengekstrak...'}</span>
      `;
    } else if (state === 'success') {
      btn.classList.add('is-success');
      btn.disabled = false;
      if (typeof btn.removeAttribute === 'function') btn.removeAttribute('disabled');
      btn.title = text || 'Tersimpan di folder Downloads';
      btn.innerHTML = `
        <span class="yt-dl-icon">${SVG_CHECK}</span>
        <span class="yt-dl-label">${text || 'Tersimpan!'}</span>
      `;
      // Transition from green success flash to gray already-downloaded state ONLY if video hasn't changed
      const currentVid = btn.getAttribute('data-video-id');
      setTimeout(() => {
        if (
          btn &&
          btn.isConnected &&
          btn.getAttribute('data-video-id') === currentVid &&
          getActiveVideoId() === currentVid
        ) {
          setButtonState(btn, 'downloaded');
        }
      }, 3500);
    } else if (state === 'downloaded') {
      btn.classList.add('is-downloaded');
      btn.disabled = false;
      if (typeof btn.removeAttribute === 'function') btn.removeAttribute('disabled');
      btn.title = 'Kamu sudah mengunduh video ini tadi. Klik untuk mengunduh lagi.';
      btn.innerHTML = `
        <span class="yt-dl-icon">${SVG_CHECK}</span>
        <span class="yt-dl-label">${text || 'Sudah Diunduh'}</span>
      `;
    } else if (state === 'error') {
      btn.classList.add('is-error');
      btn.disabled = false;
      if (typeof btn.removeAttribute === 'function') btn.removeAttribute('disabled');
      btn.title = text || 'Gagal mengunduh';
      btn.innerHTML = `
        <span class="yt-dl-icon">${SVG_DOWNLOAD}</span>
        <span class="yt-dl-label">${text || 'Gagal'}</span>
      `;
      setTimeout(() => setButtonState(btn, 'idle'), 4000);
    } else {
      // Idle
      btn.disabled = false;
      if (typeof btn.removeAttribute === 'function') btn.removeAttribute('disabled');
      btn.title = 'Unduh video YouTube ini langsung ke format MP4';
      btn.innerHTML = `
        <span class="yt-dl-icon">${SVG_DOWNLOAD}</span>
        <span class="yt-dl-label">Download MP4</span>
      `;
    }
  }

  /**
   * Synchronizes button state with any ongoing background yt-dlp download for this video,
   * or checks download history to display the gray "Sudah Diunduh" button state.
   * Prevents duplicate clicks across SPA navigation, tab switches, or page reloads.
   * @param {HTMLButtonElement} btn
   * @param {string} videoId
   */
  function syncActiveDownloadState(btn, videoId) {
    if (!btn || !videoId) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
    try {
      chrome.runtime.sendMessage({ action: 'GET_ACTIVE_DOWNLOADS' }, (response) => {
        if (!chrome.runtime.lastError && response && response.activeDownloads) {
          const active = response.activeDownloads[videoId];
          if (active && (active.status === 'downloading' || active.status === 'merging')) {
            isRequestInProgress = true;
            if (active.status === 'merging') {
              setButtonState(btn, 'loading', 'Menggabungkan Audio+Video...');
            } else {
              const partText = active.part ? `${active.part}: ` : '';
              const pctText = active.percent !== undefined ? `${Math.round(active.percent)}%` : '';
              const spdText = active.speed ? ` (${active.speed})` : '';
              setButtonState(
                btn,
                'loading',
                `${partText}${pctText}${spdText}`.trim() || 'Sedang diunduh...'
              );
            }
            return;
          }
        }

        // If not actively downloading, check if already downloaded previously
        chrome.runtime.sendMessage({ action: 'CHECK_DOWNLOADED_STATUS', videoId }, (statusRes) => {
          if (chrome.runtime.lastError || !statusRes) return;
          // Verify that active video hasn't changed while awaiting message
          if (btn.getAttribute('data-video-id') !== videoId && getActiveVideoId() !== videoId) {
            return;
          }
          if (statusRes.downloaded) {
            setButtonState(btn, 'downloaded');
          } else {
            // Not downloaded: ensure state is cleanly idle (not stale gray)
            if (!isRequestInProgress) {
              setButtonState(btn, 'idle');
            }
          }
        });
      });
    } catch (_) {}
  }

  /**
   * Opens high-speed download gateway for videos where YouTube restricts progressive streams (SABR / UMP).
   * Ensures the user reliably downloads full HD MP4 with synchronized audio in 1 click.
   * @param {string} videoId
   * @param {HTMLButtonElement} btn
   */
  function _openGatewayDownload(videoId, btn) {
    if (!videoId) {
      setButtonState(btn, 'error', 'ID tidak valid');
      isRequestInProgress = false;
      return;
    }
    const gatewayUrl = `https://ssyoutube.com/watch?v=${encodeURIComponent(videoId)}`;
    setButtonState(btn, 'success', 'Membuka MP4...');

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'OPEN_TAB', url: gatewayUrl }, () => {
        if (chrome.runtime.lastError) {
          try {
            window.open(gatewayUrl, '_blank');
          } catch (_) {}
        }
      });
    } else if (typeof window !== 'undefined') {
      try {
        window.open(gatewayUrl, '_blank');
      } catch (_) {}
    }

    setTimeout(() => {
      isRequestInProgress = false;
      setButtonState(btn, 'idle');
    }, 2500);
  }

  /**
   * Displays an in-page modal dialog asking if the user wants to redownload the video.
   * Matches YouTube dark theme with smooth glassmorphism and clear action buttons.
   * Prompts: "Kamu udah download ini tadi, mau download lagi?"
   *
   * @param {HTMLButtonElement} btn
   * @param {string} [title]
   */
  function showRedownloadConfirmation(btn, title) {
    if (typeof document === 'undefined') return;
    const existingModal = document.getElementById('yt-dl-confirm-modal');
    if (existingModal) existingModal.remove();

    const overlay = document.createElement('div');
    overlay.id = 'yt-dl-confirm-modal';
    overlay.className = 'yt-dl-confirm-overlay';

    const safeTitle = (title || getVideoTitle() || 'YouTube Video')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const sizes = getEstimatedSizes();

    overlay.innerHTML = `
      <div class="yt-dl-confirm-card" role="dialog" aria-modal="true" aria-labelledby="yt-dl-confirm-title">
        <div class="yt-dl-confirm-title" id="yt-dl-confirm-title">
          <span>Sudah Pernah Diunduh</span>
          <span class="yt-dl-confirm-badge">Riwayat</span>
        </div>
        <div class="yt-dl-confirm-desc">
          Kamu udah download ini tadi, mau download lagi?
        </div>
        <div class="yt-dl-confirm-video-title" title="${safeTitle}">
          ${safeTitle}
        </div>
        <div class="yt-dl-confirm-quality-row">
          <span class="yt-dl-confirm-q-label">Kualitas:</span>
          <span class="yt-dl-confirm-q-badge">${currentSelectedQuality}</span>
          <span class="yt-dl-confirm-q-size">${sizes[currentSelectedQuality] || ''}</span>
        </div>
        <div class="yt-dl-confirm-actions">
          <button type="button" class="yt-dl-btn-cancel" id="yt-dl-confirm-cancel">Batal</button>
          <button type="button" class="yt-dl-btn-confirm" id="yt-dl-confirm-redownload">Download Lagi</button>
        </div>
      </div>
    `;

    const cleanup = () => {
      overlay.remove();
      if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', onKeyDown);
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') cleanup();
    };
    document.addEventListener('keydown', onKeyDown);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup();
    });

    const cancelBtn = overlay.querySelector('#yt-dl-confirm-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        cleanup();
      });
    }

    const confirmBtn = overlay.querySelector('#yt-dl-confirm-redownload');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        cleanup();
        handleDownloadClick(btn, true);
      });
    }

    document.body.appendChild(overlay);
  }

  /**
   * Handles user click on injected download button.
   * If video was already downloaded previously, prompts user with a redownload confirmation.
   *
   * @param {HTMLButtonElement} btn
   * @param {boolean} [force=false]
   * @param {string|null} [qualityOverride=null]
   */
  async function handleDownloadClick(btn, force = false, qualityOverride = null) {
    if (isRequestInProgress) return { success: false, inProgress: true };

    // Redownload confirmation guard: If video was already downloaded previously
    if (!force && btn && btn.classList && btn.classList.contains('is-downloaded')) {
      showRedownloadConfirmation(btn, getVideoTitle());
      return { success: false, prompted: true };
    }

    const activeQuality = qualityOverride || currentSelectedQuality || '1080p';

    isRequestInProgress = true;
    setButtonState(btn, 'loading', 'Menyiapkan...');

    // 120-second safety watchdog for full video downloads
    const safetyWatchdog = setTimeout(() => {
      if (isRequestInProgress) {
        console.warn(`${LOG_PREFIX} Request watchdog triggered after 120s, resetting UI state`);
        isRequestInProgress = false;
        setButtonState(btn, 'idle');
      }
    }, 120000);

    try {
      const activeVid = getActiveVideoId();
      const activeTitle = getVideoTitle();
      const activeAuthor = getVideoAuthor();

      if (!activeVid) {
        clearTimeout(safetyWatchdog);
        setButtonState(btn, 'error', 'ID tidak valid');
        isRequestInProgress = false;
        return;
      }

      setButtonState(btn, 'loading', 'Memulai unduhan...');

      const downloadPayload = {
        action: 'DOWNLOAD_VIDEO',
        platform: 'youtube',
        url: window.location.href,
        videoId: activeVid,
        title: activeTitle,
        author: activeAuthor,
        quality: activeQuality
      };

      return new Promise((resolve, _reject) => {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(downloadPayload, (response) => {
            clearTimeout(safetyWatchdog);
            if (chrome.runtime.lastError || !response || !response.success) {
              const errMsg = chrome.runtime.lastError?.message || response?.error || '';
              console.warn(`${LOG_PREFIX} Native yt-dlp download failed:`, errMsg);
              setButtonState(btn, 'error', 'Gagal');
              isRequestInProgress = false;
              resolve({ success: false, error: errMsg });
            } else if (response.alreadyActive) {
              // Video is already downloading in background
              isRequestInProgress = true;
              setButtonState(btn, 'loading', response.message || 'Sedang diunduh...');
              resolve({ success: true, alreadyActive: true });
            } else {
              setButtonState(btn, 'success', 'Tersimpan di Downloads!');
              isRequestInProgress = false;
              resolve({ success: true, filename: response.filename || activeTitle });
            }
          });
        } else {
          clearTimeout(safetyWatchdog);
          setButtonState(btn, 'error', 'Gagal');
          isRequestInProgress = false;
          resolve({ success: false });
        }
      });
    } catch (err) {
      clearTimeout(safetyWatchdog);
      console.error(`${LOG_PREFIX} Stream extraction error:`, err);
      setButtonState(btn, 'error', 'Gagal');
      isRequestInProgress = false;
      throw err;
    }
  }

  /**
   * In-page direct download fallback if Service Worker is momentarily unavailable.
   * Directly triggers native anchor download without fetch() to avoid CORS 403 restrictions.
   * @param {string} url
   * @param {object} payload
   */
  async function _fallbackDirectDownload(url, payload) {
    if (!url) throw new Error('Stream URL is missing');
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    const safeTitle = (payload.title || 'YouTube_Video').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `[YouTube]_${safeTitle}.mp4`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) document.body.removeChild(a);
    }, 500);
  }

  /**
   * Injects download button and quality selector into YouTube watch metadata container or Shorts action overlay.
   */
  function injectWatchButton() {
    const videoId = getActiveVideoId();
    if (!videoId) return;

    const isShorts = window.location.pathname.startsWith('/shorts/');

    // Check existing button or group
    const existingBtn = document.getElementById('yt-direct-dl-btn');
    if (existingBtn && existingBtn.isConnected) {
      // If active video has changed via SPA navigation, reset state to idle
      if (existingBtn.getAttribute('data-video-id') !== videoId) {
        existingBtn.setAttribute('data-video-id', videoId);
        isRequestInProgress = false;
        setButtonState(existingBtn, 'idle');
        updateQualityButtonUI();
      }
      syncActiveDownloadState(existingBtn, videoId);

      // If on Shorts, ensure the button is attached to the currently active reel
      if (isShorts) {
        const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
        if (activeReel && !activeReel.contains(existingBtn)) {
          const target =
            activeReel.querySelector('#actions #actions-inner') ||
            activeReel.querySelector('#actions') ||
            activeReel.querySelector('ytd-reel-player-overlay-renderer #actions');
          if (target) {
            target.appendChild(existingBtn);
            return;
          }
        }
      }
      return;
    }

    // Create main download button with explicit type="button" (Strict DOM Hygiene)
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'yt-direct-dl-btn';
    btn.className = 'yt-direct-dl-btn yt-dl-accent';
    btn.setAttribute('data-video-id', videoId);
    btn.title = `Unduh video YouTube ini langsung ke format MP4 (${currentSelectedQuality})`;
    btn.setAttribute('aria-label', 'Unduh Video YouTube');
    setButtonState(btn, 'idle');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleDownloadClick(btn);
    });

    // Synchronize active download state if download is already in progress
    syncActiveDownloadState(btn, videoId);

    // 4. Shorts Strategy: Circular button only on Shorts action rail
    if (isShorts) {
      const activeReel = document.querySelector('ytd-reel-video-renderer[is-active]');
      const shortsGroup = activeReel
        ? activeReel.querySelector('#actions #actions-inner') ||
          activeReel.querySelector('#actions') ||
          activeReel.querySelector('ytd-reel-player-overlay-renderer #actions')
        : document.querySelector('ytd-reel-video-renderer[is-active] #actions #actions-inner') ||
          document.querySelector('ytd-reel-player-overlay-renderer #actions') ||
          document.querySelector('ytd-shorts-player-controls');

      if (shortsGroup) {
        shortsGroup.appendChild(btn);
      }
      return;
    }

    // Regular Watch Page: Create Button Group with Quality Selector Dropdown
    const group = document.createElement('div');
    group.id = 'yt-dl-btn-group';
    group.className = 'yt-dl-btn-group';
    group.setAttribute('data-video-id', videoId);

    // Quality Selector Button
    const qualityBtn = document.createElement('button');
    qualityBtn.type = 'button';
    qualityBtn.id = 'yt-dl-quality-btn';
    qualityBtn.className = 'yt-dl-quality-btn';
    qualityBtn.title = 'Pilih Kualitas Video (1080p, 720p, 480p, 360p)';
    qualityBtn.setAttribute('aria-label', 'Pilih Kualitas Video');

    qualityBtn.innerHTML = `
      <span class="yt-dl-q-label-current">${currentSelectedQuality}</span>
      <span class="yt-dl-q-chevron">▾</span>
    `;

    // Floating Quality Dropdown Menu
    const qualityMenu = document.createElement('div');
    qualityMenu.id = 'yt-dl-quality-menu';
    qualityMenu.className = 'yt-dl-quality-menu';
    qualityMenu.style.display = 'none';

    renderQualityMenuItems(qualityMenu);

    qualityBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const isVisible = qualityMenu.style.display === 'flex';
      if (isVisible) {
        qualityMenu.style.display = 'none';
      } else {
        renderQualityMenuItems(qualityMenu);
        qualityMenu.style.display = 'flex';
      }
    });

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('click', (e) => {
        if (!group.contains(e.target)) {
          qualityMenu.style.display = 'none';
        }
      });
    }

    group.appendChild(btn);
    group.appendChild(qualityBtn);
    group.appendChild(qualityMenu);

    const injectionTarget = group;

    // 1. Primary Strategy: Right next to Subscribe button in channel metadata (#owner)
    // This container has ample free space, never collapses into the overflow menu, and is instantly visible
    const subscribeBtn = document.querySelector(
      'ytd-watch-metadata #subscribe-button, ytd-subscribe-button-renderer#subscribe-button, #owner #subscribe-button, #subscribe-button'
    );
    if (subscribeBtn && subscribeBtn.parentNode) {
      subscribeBtn.parentNode.insertBefore(injectionTarget, subscribeBtn.nextSibling);
      return;
    }

    // 2. Secondary Strategy: Right before Like/Dislike button in #actions-inner
    const likeButton = document.querySelector(
      'ytd-watch-metadata ytd-segmented-like-dislike-button-renderer, ytd-watch-metadata segmented-like-dislike-button-view-model, #top-level-buttons-computed ytd-segmented-like-dislike-button-renderer'
    );
    if (likeButton && likeButton.parentNode) {
      likeButton.parentNode.insertBefore(injectionTarget, likeButton);
      return;
    }

    // 3. Tertiary Strategy: Action buttons row (#top-level-buttons-computed or #actions-inner)
    const actionsGroup =
      document.querySelector('ytd-watch-metadata #top-level-buttons-computed') ||
      document.querySelector('#actions-inner #top-level-buttons-computed') ||
      document.querySelector('#top-level-buttons-computed') ||
      document.querySelector('#actions #actions-inner') ||
      document.querySelector('ytd-menu-renderer #top-level-buttons-computed');

    if (actionsGroup) {
      if (actionsGroup.firstChild) {
        actionsGroup.insertBefore(injectionTarget, actionsGroup.firstChild);
      } else {
        actionsGroup.appendChild(injectionTarget);
      }
      return;
    }
  }

  /**
   * Debounced scanning and injection trigger.
   */
  function scheduleInjection() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      injectWatchButton();
    }, 200);
  }

  /**
   * Cleans up loading state and schedules reinjection upon SPA navigation.
   */
  function handleNavigation() {
    isRequestInProgress = false;
    const existing = document.getElementById('yt-direct-dl-btn');
    const activeVid = getActiveVideoId();
    if (existing) {
      if (activeVid) {
        existing.setAttribute('data-video-id', activeVid);
      }
      setButtonState(existing, 'idle');
    }
    const modal = document.getElementById('yt-dl-confirm-modal');
    if (modal) {
      modal.remove();
    }
    updateQualityButtonUI();
    scheduleInjection();
  }

  // ==========================================================================
  // Navigation & Lifecycle Observers
  // ==========================================================================

  if (typeof window !== 'undefined') {
    const navEvents = [
      'yt-navigate-finish',
      'yt-navigate-start',
      'yt-page-data-updated',
      'spfdone',
      'popstate'
    ];
    navEvents.forEach((evt) => {
      if (typeof window.addEventListener === 'function') {
        window.addEventListener(evt, handleNavigation);
      }
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener(evt, handleNavigation);
      }
    });

    // Active URL Watcher: detects SPA video navigation even if Polymer events are delayed or suppressed
    if (typeof setInterval === 'function') {
      let lastKnownVideoId = getActiveVideoId();
      setInterval(() => {
        const currentVid = getActiveVideoId();
        if (currentVid && currentVid !== lastKnownVideoId) {
          lastKnownVideoId = currentVid;
          handleNavigation();
        }
      }, 350);
    }
  }

  // Fallback MutationObserver to catch asynchronous Polymer render and Shorts scrolling
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const observer = new MutationObserver(() => {
      scheduleInjection();
    });

    const targetNode = document.body || document.documentElement;
    if (targetNode) {
      observer.observe(targetNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['is-active']
      });
    }
  }

  // Initial trigger
  if (typeof document !== 'undefined') {
    scheduleInjection();
  }

  // ==========================================================================
  // Active Video IPC for Extension Popup
  // ==========================================================================

  /**
   * Resolves active video info for popup consumption.
   * @returns {object}
   */
  function getActiveVideoInfo() {
    const videoId = getActiveVideoId();
    if (!videoId) {
      return { success: false, reason: 'Not an active YouTube video' };
    }

    const duration = getVideoDurationSeconds();
    const estimatedSizes = getEstimatedSizes(duration);

    return {
      success: true,
      ready: true,
      platform: 'youtube',
      videoId,
      title: getVideoTitle(),
      author: getVideoAuthor(),
      duration,
      quality: currentSelectedQuality,
      estimatedSizes
    };
  }

  /**
   * Displays a floating desktop-style toast notification in the bottom-right corner.
   * Renders title, author, file size, timestamp, and success/error status.
   *
   * @param {object} options
   */
  function showInPageToast({ success, title, author, size, dateStr, timeStr, error, errorCode }) {
    if (typeof document === 'undefined') return;

    let container = document.getElementById('yt-dl-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'yt-dl-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `yt-dl-toast ${success ? 'is-success' : 'is-error'}`;

    const now = new Date();
    const dateDisplay =
      dateStr ||
      now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeDisplay =
      timeStr || now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

    const iconSymbol = success ? '✓' : '✕';
    const headingText = success ? 'Video Berhasil Didownload!' : 'Gagal Mendownload Video';
    const safeTitle = (title || 'YouTube Video').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeAuthor = (author || 'YouTube Creator').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let metaHtml = `<span>${dateDisplay}, ${timeDisplay}</span>`;
    if (size) {
      metaHtml += `<span class="yt-dl-toast-size">${size}</span>`;
    }

    let errorHtml = '';
    if (!success) {
      const errCodeStr = errorCode ? `[${errorCode}] ` : '';
      const safeErr = (error || 'Unknown error').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      errorHtml = `<div class="yt-dl-toast-error-box">${errCodeStr}${safeErr}</div>`;
    }

    toast.innerHTML = `
      <div class="yt-dl-toast-header">
        <div class="yt-dl-toast-title-group">
          <span class="yt-dl-toast-icon">${iconSymbol}</span>
          <span class="yt-dl-toast-heading">${headingText}</span>
        </div>
        <button type="button" class="yt-dl-toast-close" title="Tutup">✕</button>
      </div>
      <div class="yt-dl-toast-body">
        <div class="yt-dl-toast-video-title" title="${safeTitle}">${safeTitle}</div>
        <div class="yt-dl-toast-author">${safeAuthor}</div>
        <div class="yt-dl-toast-meta-row">
          ${metaHtml}
        </div>
        ${errorHtml}
      </div>
    `;

    const closeBtn = toast.querySelector('.yt-dl-toast-close');
    const dismissToast = () => {
      toast.classList.add('is-leaving');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    };

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissToast();
      });
    }

    // Auto-dismiss after 7 seconds
    setTimeout(dismissToast, 7000);

    container.appendChild(toast);
  }

  // Listen for popup messages
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        message &&
        (message.action === 'GET_ACTIVE_VIDEO_INFO' || message.type === 'GET_ACTIVE_VIDEO_INFO')
      ) {
        const info = getActiveVideoInfo();
        sendResponse(info);
        return true;
      }

      if (
        message &&
        (message.action === 'DOWNLOAD_ACTIVE_VIDEO' || message.type === 'DOWNLOAD_ACTIVE_VIDEO')
      ) {
        const existingBtn = document.getElementById('yt-direct-dl-btn');
        const targetBtn = existingBtn || document.createElement('button');
        targetBtn.type = 'button';
        handleDownloadClick(targetBtn, false, message.quality)
          .then((result) => {
            sendResponse({ success: true, filename: result?.filename || 'video.mp4' });
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: err.message || 'Gagal mengunduh stream YouTube'
            });
          });
        return true; // Keep message channel open for async response
      }

      if (message && message.type === 'YT_NATIVE_PROGRESS') {
        const activeVid = getActiveVideoId();
        if (message.videoId && message.videoId !== activeVid) return false;

        const btn = document.getElementById('yt-direct-dl-btn');
        if (btn) {
          isRequestInProgress = true;
          let label = '';
          if (message.status === 'merging') {
            label = 'Menggabungkan Audio+Video...';
          } else {
            const partStr = message.part ? `${message.part}: ` : '';
            const pctStr = message.percent !== undefined ? `${Math.round(message.percent)}%` : '';
            const spdStr = message.speed ? ` (${message.speed})` : '';
            label = `${partStr}${pctStr}${spdStr}`.trim() || 'Mengunduh...';
          }
          setButtonState(btn, 'loading', label);
        }
        return false;
      }

      if (message && message.type === 'YT_NATIVE_COMPLETE') {
        const activeVid = getActiveVideoId();
        if (message.videoId && message.videoId !== activeVid) return false;

        const btn = document.getElementById('yt-direct-dl-btn');
        if (btn) {
          isRequestInProgress = false;
          setButtonState(btn, 'success', 'Tersimpan di Downloads!');
        }

        showInPageToast({
          success: true,
          title: message.title || getVideoTitle(),
          author: message.author || getVideoAuthor(),
          size: message.size,
          dateStr: message.dateStr,
          timeStr: message.timeStr
        });
        return false;
      }

      if (message && message.type === 'YT_NATIVE_ERROR') {
        const activeVid = getActiveVideoId();
        if (message.videoId && message.videoId !== activeVid) return false;

        const btn = document.getElementById('yt-direct-dl-btn');
        if (btn) {
          isRequestInProgress = false;
          setButtonState(btn, 'error', 'Gagal');
        }

        showInPageToast({
          success: false,
          title: message.title || getVideoTitle(),
          author: message.author || getVideoAuthor(),
          error: message.error,
          errorCode: message.errorCode,
          dateStr: message.dateStr,
          timeStr: message.timeStr
        });
        return false;
      }
    });
  }

  // Export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      getActiveVideoId,
      getVideoTitle,
      getVideoAuthor,
      getActiveVideoInfo,
      injectWatchButton,
      setButtonState,
      showRedownloadConfirmation,
      handleDownloadClick,
      getVideoDurationSeconds,
      getEstimatedSizes,
      QUALITY_OPTIONS,
      saveQualityPreference
    };
  }
})();
