/**
 * TeraBox Direct Downloader - Content Platform Script (ISOLATED World)
 *
 * Handles:
 * 1. IPC with terabox_bridge.js (MAIN world) to retrieve file list & dlink.
 * 2. In-Page UI Injection: Floating action bar, row buttons, and player actions.
 * 3. Batch Downloader Modal: Multi-file selection, total size calculation, queueing.
 * 4. Background Service Worker IPC (DOWNLOAD_VIDEO / DOWNLOAD_FILE).
 * 5. Popup status query handler (GET_ACTIVE_VIDEO_INFO / GET_TERABOX_FILE_INFO).
 */

(function () {
  'use strict';

  if (window.__TERABOX_PLATFORM_INITIALIZED__) return;
  window.__TERABOX_PLATFORM_INITIALIZED__ = true;

  const LOG_PREFIX = '[TeraBox Downloader]';

  // SVG Icons
  const SVG_DOWNLOAD = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M17 18v1H7v-1h10zm-1-8l-4 4-4-4 1.4-1.4 1.6 1.6V4h2v6.2l1.6-1.6L16 10z"/>
    </svg>
  `;

  const SVG_CHECK = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>
  `;

  const SVG_SPINNER = `
    <svg class="mungil-terabox-spinner" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  `;

  const SVG_FOLDER = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  `;

  // State
  let cachedFiles = [];
  let isBatchModalOpen = false;

  /**
   * Sanitizes TeraBox filename against Windows NTFS reserved characters & length constraints.
   * @param {string} raw
   * @returns {string}
   */
  function sanitizeTeraBoxFilename(raw) {
    if (!raw || typeof raw !== 'string') return 'TeraBox_File';

    let clean = raw
      // Replace Windows illegal chars \ / : * ? " < > | with safe dash or underscore
      .replace(/[\\/:*?"<>|]/g, '-')
      // Strip control chars (0x00-0x1F, 0x7F-0x9F)
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      // Collapse multiple dashes
      .replace(/-+/g, '-')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim();

    // Check Windows reserved names
    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
    if (reserved.test(clean)) {
      clean = `TeraBox_${clean}`;
    }

    // Collapse trailing dots or spaces
    clean = clean.replace(/[. ]+$/, '');

    // Max filename length safe boundary
    if (clean.length > 180) {
      const extMatch = clean.match(/\.[0-9a-z]{1,8}$/i);
      const ext = extMatch ? extMatch[0] : '';
      clean = clean.slice(0, 180 - ext.length) + ext;
    }

    return clean || 'TeraBox_File';
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i] || 'B'}`;
  }

  // --------------------------------------------------------------------------
  // IPC with terabox_bridge.js (MAIN World)
  // --------------------------------------------------------------------------
  function callBridge(action, payload = {}, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const requestId = `tb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      let timer = null;

      const onResponse = (e) => {
        if (!e || !e.detail || e.detail.requestId !== requestId) return;
        cleanup();
        if (e.detail.success) {
          resolve(e.detail);
        } else {
          reject(new Error(e.detail.error || 'Bridge call failed'));
        }
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        window.removeEventListener('TERABOX_BRIDGE_RESPONSE', onResponse);
        document.removeEventListener('TERABOX_BRIDGE_RESPONSE', onResponse);
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Bridge request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      window.addEventListener('TERABOX_BRIDGE_RESPONSE', onResponse);
      document.addEventListener('TERABOX_BRIDGE_RESPONSE', onResponse);

      const reqDetail = { requestId, action, ...payload };
      try {
        document.dispatchEvent(new CustomEvent('TERABOX_BRIDGE_REQUEST', { detail: reqDetail }));
      } catch (_) {}
      try {
        window.dispatchEvent(new CustomEvent('TERABOX_BRIDGE_REQUEST', { detail: reqDetail }));
      } catch (_) {}
    });
  }

  async function fetchTeraBoxFiles() {
    try {
      const res = await callBridge('GET_FILES');
      if (res && Array.isArray(res.files) && res.files.length > 0) {
        cachedFiles = res.files;
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to fetch files from bridge:`, err);
    }
    return cachedFiles;
  }

  async function resolveDlinkForFile(fsId, type = null) {
    try {
      const res = await callBridge('GET_DLINK', { fsId, type });
      if (res && res.dlink) {
        return res.dlink;
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to resolve dlink for ${fsId}:`, err);
    }
    return null;
  }

  /**
   * Classifies a list of TeraBox files into directories, videos, images, and others.
   * @param {Array<object>} files
   * @returns {{ folders: Array, videos: Array, images: Array, others: Array, nonDirs: Array }}
   */
  function classifyFiles(files = []) {
    const folders = [];
    const videos = [];
    const images = [];
    const others = [];

    for (const f of files) {
      if (!f) continue;
      if (f.isdir) {
        folders.push(f);
      } else if (f.isVideo) {
        videos.push(f);
      } else if (f.isImage) {
        images.push(f);
      } else {
        const name = (f.filename || '').toLowerCase();
        if (/\.(mp4|mkv|avi|mov|flv|webm|ts|m4v|wmv|3gp|m3u8)$/i.test(name)) {
          videos.push(f);
        } else if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)$/i.test(name)) {
          images.push(f);
        } else {
          others.push(f);
        }
      }
    }

    const nonDirs = [...videos, ...images, ...others];
    return { folders, videos, images, others, nonDirs };
  }

  /**
   * Downloads and concatenates HLS .ts chunks into a single valid .mp4 Blob file.
   * Prevents corrupted/unplayable .m3u8 text downloads with broken duration.
   * @param {string} m3u8Url
   * @param {string} filename
   * @param {HTMLElement|null} btnEl
   */
  async function downloadHlsStream(m3u8Url, filename, btnEl = null) {
    if (btnEl) {
      btnEl.classList.add('loading');
      btnEl.innerHTML = `${SVG_SPINNER}<span>Mengunduh stream (0%)...</span>`;
    }

    try {
      // 1. Fetch m3u8 playlist text
      const res = await fetch(m3u8Url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let text = await res.text();

      // Strict validation: must be an actual HLS playlist, not an HTML error page or JSON
      if (!text || !text.includes('#EXTM3U')) {
        let altUrl = '';
        if (m3u8Url.includes('M3U8_FLV_264_')) {
          altUrl = m3u8Url.replace('M3U8_FLV_264_', 'M3U8_AUTO_');
        } else if (m3u8Url.includes('M3U8_AUTO_')) {
          altUrl = m3u8Url.replace('M3U8_AUTO_', 'M3U8_FLV_264_');
        }
        if (altUrl) {
          try {
            const altRes = await fetch(altUrl, { credentials: 'include' });
            if (altRes.ok) {
              const altText = await altRes.text();
              if (altText && altText.includes('#EXTM3U')) {
                text = altText;
                m3u8Url = altUrl;
              }
            }
          } catch (_) {}
        }
      }

      if (!text || !text.includes('#EXTM3U')) {
        throw new Error('Server TeraBox tidak mengembalikan playlist M3U8 valid untuk stream ini');
      }

      // If master playlist with multiple variant streams, resolve first sub-stream
      if (text.includes('#EXT-X-STREAM-INF')) {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('#EXT-X-STREAM-INF') && i + 1 < lines.length) {
            const subUrl = lines[i + 1].trim();
            if (subUrl) {
              const resolvedSubUrl = new URL(subUrl, m3u8Url).href;
              const subRes = await fetch(resolvedSubUrl, { credentials: 'include' });
              if (subRes.ok) {
                text = await subRes.text();
                m3u8Url = resolvedSubUrl;
                break;
              }
            }
          }
        }
      }

      // 2. Extract all TS chunk segment URLs
      const lines = text.split('\n');
      const segmentUrls = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          segmentUrls.push(new URL(trimmed, m3u8Url).href);
        }
      }

      if (segmentUrls.length === 0) {
        throw new Error('Tidak ada segmen video dalam playlist');
      }

      // 3. Concurrently fetch all chunks with concurrency limit 3
      const chunks = new Array(segmentUrls.length);
      let downloadedCount = 0;
      const CONCURRENCY = 3;
      let queueIndex = 0;

      async function worker() {
        while (queueIndex < segmentUrls.length) {
          const idx = queueIndex++;
          const url = segmentUrls[idx];
          let attempt = 0;
          let success = false;
          while (attempt < 3 && !success) {
            try {
              const segRes = await fetch(url, { credentials: 'include' });
              if (!segRes.ok) throw new Error(`HTTP ${segRes.status}`);
              const buf = await segRes.arrayBuffer();
              chunks[idx] = new Uint8Array(buf);
              success = true;
              downloadedCount++;
              if (btnEl) {
                const pct = Math.round((downloadedCount / segmentUrls.length) * 100);
                btnEl.innerHTML = `${SVG_SPINNER}<span>Mengunduh (${pct}%)...</span>`;
              }
            } catch (e) {
              attempt++;
              if (attempt >= 3) throw e;
              await new Promise((r) => setTimeout(r, 400));
            }
          }
        }
      }

      const workers = [];
      for (let w = 0; w < Math.min(CONCURRENCY, segmentUrls.length); w++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      if (btnEl) {
        btnEl.innerHTML = `${SVG_SPINNER}<span>Menyimpan MP4...</span>`;
      }

      // 4. Merge all TS chunks into single continuous Blob
      const blob = new Blob(chunks, { type: 'video/mp4' });
      const objectUrl = URL.createObjectURL(blob);

      // 5. Trigger download of clean .mp4
      const safeName = filename.replace(/\.m3u8$/i, '').replace(/\.mp4$/i, '') + '.mp4';
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = safeName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(objectUrl);
      }, 30000);

      if (btnEl) {
        btnEl.classList.remove('loading');
        btnEl.classList.add('success');
        btnEl.innerHTML = `${SVG_CHECK}<span>Tersimpan!</span>`;
        setTimeout(() => {
          btnEl.classList.remove('success');
          btnEl.innerHTML = `${SVG_DOWNLOAD}<span>Unduh</span>`;
        }, 3000);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} downloadHlsStream error:`, err);
      if (btnEl) {
        btnEl.classList.remove('loading');
        btnEl.classList.add('error');
        btnEl.innerHTML = `<span>Gagal Stream</span>`;
        setTimeout(() => {
          btnEl.classList.remove('error');
          btnEl.innerHTML = `${SVG_DOWNLOAD}<span>Unduh</span>`;
        }, 3000);
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Direct Download Trigger
  // --------------------------------------------------------------------------
  async function triggerDownloadFile(file, btnEl = null, quality = 'original') {
    if (!file) return;

    if (btnEl) {
      btnEl.classList.add('loading');
      btnEl.innerHTML = `${SVG_SPINNER}<span>Menyiapkan...</span>`;
    }

    try {
      let dlink = '';
      if (quality && quality !== 'original') {
        const qCode = quality.replace('p', '');
        dlink = await resolveDlinkForFile(file.fs_id, `M3U8_AUTO_${qCode}`);
      } else {
        dlink = file.original_dlink || file.dlink;
        if (!dlink || dlink.includes('streaming')) {
          dlink = await resolveDlinkForFile(file.fs_id, null);
        }
      }

      // Fallback to active HTML5 video element if dlink is still missing
      if (!dlink && (file.isVideo || (file.filename && file.filename.endsWith('.mp4')))) {
        try {
          const domVideo = typeof document !== 'undefined' && document.querySelector('video');
          if (
            domVideo &&
            domVideo.src &&
            !domVideo.src.startsWith('blob:') &&
            domVideo.src.startsWith('http')
          ) {
            dlink = domVideo.src;
          }
        } catch (_) {}
      }

      if (!dlink) {
        throw new Error('Gagal mendapatkan link download langsung dari TeraBox');
      }

      const safeFilename = sanitizeTeraBoxFilename(file.filename);

      // If the link is an HLS m3u8 streaming link, download and merge segments into a clean MP4!
      if (dlink.includes('streaming') || dlink.includes('m3u8')) {
        await downloadHlsStream(dlink, safeFilename, btnEl);
        return;
      }

      // Route to background service worker for reliable resume & custom referer
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: 'DOWNLOAD_VIDEO',
            url: dlink,
            title: safeFilename,
            author: 'TeraBox',
            platform: 'terabox'
          },
          (resp) => {
            if (btnEl) {
              btnEl.classList.remove('loading');
              if (resp && resp.success) {
                btnEl.classList.add('success');
                btnEl.innerHTML = `${SVG_CHECK}<span>Mengunduh...</span>`;
                setTimeout(() => {
                  btnEl.classList.remove('success');
                  btnEl.innerHTML = `${SVG_DOWNLOAD}<span>Unduh</span>`;
                }, 3000);
              } else {
                btnEl.classList.add('error');
                btnEl.innerHTML = `<span>Gagal</span>`;
                setTimeout(() => {
                  btnEl.classList.remove('error');
                  btnEl.innerHTML = `${SVG_DOWNLOAD}<span>Unduh</span>`;
                }, 3000);
              }
            }
          }
        );
      } else {
        // Fallback to anchor click
        const a = document.createElement('a');
        a.href = dlink;
        a.download = safeFilename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 1000);
        if (btnEl) {
          btnEl.classList.remove('loading');
          btnEl.classList.add('success');
          btnEl.innerHTML = `${SVG_CHECK}<span>Mengunduh...</span>`;
        }
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} triggerDownloadFile error:`, err);
      if (btnEl) {
        btnEl.classList.remove('loading');
        btnEl.classList.add('error');
        btnEl.innerHTML = `<span>Error</span>`;
        setTimeout(() => {
          btnEl.classList.remove('error');
          btnEl.innerHTML = `${SVG_DOWNLOAD}<span>Unduh</span>`;
        }, 3000);
      }
    }
  }

  // --------------------------------------------------------------------------
  // In-Page Batch Download Modal
  // --------------------------------------------------------------------------
  function openBatchModal(files) {
    if (isBatchModalOpen) return;
    const downloadables = files.filter((f) => !f.isdir);
    if (downloadables.length === 0) {
      alert('Tidak ada file yang dapat diunduh pada halaman ini.');
      return;
    }

    isBatchModalOpen = true;
    const selectedIds = new Set(downloadables.map((f) => f.fs_id));

    const backdrop = document.createElement('div');
    backdrop.id = 'mungil-terabox-batch-modal';
    backdrop.className = 'mungil-tb-modal-backdrop';

    const renderModal = () => {
      const selectedFiles = downloadables.filter((f) => selectedIds.has(f.fs_id));
      const totalSelectedBytes = selectedFiles.reduce((acc, f) => acc + (f.size || 0), 0);

      backdrop.innerHTML = `
        <div class="mungil-tb-modal" role="dialog" aria-modal="true">
          <div class="mungil-tb-modal-header">
            <div class="mungil-tb-header-title">
              ${SVG_FOLDER}
              <span>TeraBox Batch Downloader</span>
            </div>
            <button type="button" class="mungil-tb-close-btn" id="mungil-tb-modal-close" aria-label="Tutup">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div class="mungil-tb-modal-toolbar">
            <div class="mungil-tb-toolbar-left">
              <span>Total File: <strong>${downloadables.length}</strong></span>
              <span>•</span>
              <button type="button" class="mungil-tb-link-action" id="mungil-tb-select-all">
                ${selectedIds.size === downloadables.length ? 'Batalkan Semua' : 'Pilih Semua'}
              </button>
            </div>
            <div>
              <span>Terpilih: <strong>${selectedIds.size}</strong></span>
            </div>
          </div>

          <div class="mungil-tb-file-list" id="mungil-tb-items-container">
            ${downloadables
              .map((f) => {
                const isSelected = selectedIds.has(f.fs_id);
                return `
                <div class="mungil-tb-file-item ${isSelected ? 'selected' : ''}" data-fsid="${f.fs_id}">
                  <div class="mungil-tb-item-left">
                    <input type="checkbox" class="mungil-tb-item-checkbox" data-fsid="${f.fs_id}" ${
                      isSelected ? 'checked' : ''
                    }/>
                    <span class="mungil-tb-item-name" title="${f.filename}">${f.filename}</span>
                  </div>
                  <span class="mungil-tb-item-size">${f.formatted_size}</span>
                </div>
              `;
              })
              .join('')}
          </div>

          <div class="mungil-tb-modal-footer">
            <div class="mungil-tb-footer-stats">
              <span>Ukuran Total: <strong>${formatBytes(totalSelectedBytes)}</strong></span>
            </div>
            <div class="mungil-tb-footer-actions">
              <button type="button" class="mungil-tb-cancel-btn" id="mungil-tb-btn-cancel">Batal</button>
              <button type="button" class="mungil-terabox-btn" id="mungil-tb-btn-start-batch" ${
                selectedIds.size === 0 ? 'disabled' : ''
              }>
                ${SVG_DOWNLOAD}
                <span>Download (${selectedIds.size} File)</span>
              </button>
            </div>
          </div>
        </div>
      `;

      // Listeners
      const closeBtn = backdrop.querySelector('#mungil-tb-modal-close');
      const cancelBtn = backdrop.querySelector('#mungil-tb-btn-cancel');
      const selectAllBtn = backdrop.querySelector('#mungil-tb-select-all');
      const startBatchBtn = backdrop.querySelector('#mungil-tb-btn-start-batch');

      const closeModal = () => {
        isBatchModalOpen = false;
        backdrop.remove();
      };

      if (closeBtn) closeBtn.onclick = closeModal;
      if (cancelBtn) cancelBtn.onclick = closeModal;

      if (selectAllBtn) {
        selectAllBtn.onclick = () => {
          if (selectedIds.size === downloadables.length) {
            selectedIds.clear();
          } else {
            downloadables.forEach((f) => selectedIds.add(f.fs_id));
          }
          renderModal();
        };
      }

      // Individual item clicks
      const itemRows = backdrop.querySelectorAll('.mungil-tb-file-item');
      itemRows.forEach((row) => {
        row.onclick = (e) => {
          if (e.target.tagName.toLowerCase() === 'input') return;
          const fsId = row.getAttribute('data-fsid');
          if (selectedIds.has(fsId)) {
            selectedIds.delete(fsId);
          } else {
            selectedIds.add(fsId);
          }
          renderModal();
        };
      });

      const checkboxes = backdrop.querySelectorAll('.mungil-tb-item-checkbox');
      checkboxes.forEach((cb) => {
        cb.onchange = () => {
          const fsId = cb.getAttribute('data-fsid');
          if (cb.checked) {
            selectedIds.add(fsId);
          } else {
            selectedIds.delete(fsId);
          }
          renderModal();
        };
      });

      if (startBatchBtn) {
        startBatchBtn.onclick = async () => {
          if (selectedIds.size === 0) return;
          startBatchBtn.classList.add('loading');
          startBatchBtn.innerHTML = `${SVG_SPINNER}<span>Mengantrekan...</span>`;

          const targets = downloadables.filter((f) => selectedIds.has(f.fs_id));
          for (let i = 0; i < targets.length; i++) {
            await triggerDownloadFile(targets[i]);
            // Tiny pacing delay between consecutive requests
            await new Promise((r) => setTimeout(r, 600));
          }

          startBatchBtn.classList.remove('loading');
          startBatchBtn.classList.add('success');
          startBatchBtn.innerHTML = `${SVG_CHECK}<span>Selesai!</span>`;
          setTimeout(() => {
            closeModal();
          }, 1500);
        };
      }
    };

    renderModal();
    document.body.appendChild(backdrop);
  }

  // --------------------------------------------------------------------------
  // DOM Fallback File Resolution
  // --------------------------------------------------------------------------
  function getDomFallbackFile() {
    let videoSrc = '';
    const video =
      (typeof document !== 'undefined' &&
        document.querySelector &&
        document.querySelector('video')) ||
      null;
    if (video && video.src && !video.src.startsWith('blob:')) {
      videoSrc = video.src;
    }

    const titleEl =
      (typeof document !== 'undefined' &&
        document.querySelector &&
        document.querySelector(
          '.file-item-name, .play-video-title, .title, .tip-title, h1, [class*="file-name"]'
        )) ||
      null;
    let title = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || '';

    if (!title && typeof document !== 'undefined' && document.title) {
      const cleanedDocTitle = document.title.split(' - ')[0] || '';
      const match = cleanedDocTitle.match(/^([^\s]+(?:_[^\s]+)*)/);
      title = (match && match[1]) || cleanedDocTitle || 'TeraBox_Video';
    }

    if (!title) title = 'TeraBox_Video';
    if (!title.includes('.')) {
      title = `${title}.mp4`;
    }

    return {
      fs_id: 'dom_active',
      filename: title,
      size: 0,
      formatted_size: '',
      isdir: false,
      dlink: videoSrc
    };
  }

  // --------------------------------------------------------------------------
  // In-Player Action Bar Injection
  // --------------------------------------------------------------------------
  async function injectPlayerButton() {
    if (document.getElementById('mungil-terabox-player-btn')) return;

    const videoWrap =
      document.querySelector('.video-wrap') ||
      document.querySelector('#videoplayer') ||
      document.querySelector('[class*="video-wrap"]') ||
      document.querySelector('.isplayer');

    if (!videoWrap) return;

    const files = await fetchTeraBoxFiles();
    const { videos, nonDirs } = classifyFiles(files);
    let activeVideo = videos.find((v) => v.isActive);
    if (!activeVideo && videos.length > 0) {
      const titleEl = document.querySelector(
        '.play-video-title, .title, .file-item-name, [class*="video-title"], .tip-title, h1, [class*="file-name"]'
      );
      const domTitle = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || '';
      if (domTitle) {
        activeVideo = videos.find(
          (v) =>
            v.filename &&
            (domTitle.includes(v.filename) ||
              v.filename.includes(domTitle) ||
              domTitle.toLowerCase().includes(v.filename.toLowerCase()))
        );
      }
    }
    const targetFile = activeVideo || videos[0] || nonDirs[0] || getDomFallbackFile();

    const baseSize = targetFile.size || 0;
    const est1080 = baseSize ? formatBytes(Math.round(baseSize * 0.95)) : '~400 MB';
    const est720 = baseSize ? formatBytes(Math.round(baseSize * 0.58)) : '~250 MB';
    const est480 = baseSize ? formatBytes(Math.round(baseSize * 0.35)) : '~140 MB';
    const est360 = baseSize ? formatBytes(Math.round(baseSize * 0.2)) : '~80 MB';

    const bar = document.createElement('div');
    bar.id = 'mungil-terabox-player-bar';
    bar.className = 'mungil-terabox-player-bar';
    bar.innerHTML = `
      <div class="mungil-terabox-player-content">
        <div class="mungil-tb-player-info">
          <span class="mungil-tb-player-title" title="${targetFile.filename}">${targetFile.filename}</span>
          ${
            targetFile.formatted_size && targetFile.formatted_size !== '0 B'
              ? `<span class="mungil-tb-player-badge">${targetFile.formatted_size}</span>`
              : ''
          }
        </div>
        <div class="mungil-tb-action-cluster">
          <select class="mungil-tb-quality-select" id="mungil-tb-quality-select" title="Pilih Kualitas Video">
            <option value="original" selected>Original (${targetFile.formatted_size || 'Full'})</option>
            <option value="1080p">1080p Full HD (${est1080})</option>
            <option value="720p">720p HD (${est720})</option>
            <option value="480p">480p SD (${est480})</option>
            <option value="360p">360p Hemat Kuota (${est360})</option>
          </select>
          <button type="button" class="mungil-terabox-btn mungil-terabox-btn-player" id="mungil-terabox-player-btn">
            ${SVG_DOWNLOAD}
            <span>Unduh Video</span>
          </button>
        </div>
      </div>
    `;

    const btn = bar.querySelector('#mungil-terabox-player-btn');
    const select = bar.querySelector('#mungil-tb-quality-select');
    if (select) {
      select.addEventListener('change', () => {
        const badge = bar.querySelector('.mungil-tb-player-badge');
        if (badge) {
          const map = {
            original: targetFile.formatted_size || 'Full',
            '1080p': est1080,
            '720p': est720,
            '480p': est480,
            '360p': est360
          };
          badge.textContent = map[select.value] || targetFile.formatted_size;
        }
      });
    }

    if (btn) {
      btn.onclick = () => {
        const chosenQuality = (select && select.value) || 'original';
        triggerDownloadFile(targetFile, btn, chosenQuality);
      };
    }

    if (videoWrap.nextSibling) {
      videoWrap.parentNode.insertBefore(bar, videoWrap.nextSibling);
    } else {
      videoWrap.parentNode.appendChild(bar);
    }
  }

  // --------------------------------------------------------------------------
  // Floating Action Bar Injection
  // --------------------------------------------------------------------------
  async function injectFloatingBar() {
    const files = await fetchTeraBoxFiles();
    const { videos, nonDirs } = classifyFiles(files);

    let downloadables = nonDirs;
    if (downloadables.length === 0) {
      const fallback = getDomFallbackFile();
      if (fallback) downloadables = [fallback];
    }

    if (downloadables.length === 0) return;

    let bar = document.getElementById('mungil-terabox-floating-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mungil-terabox-floating-bar';
      bar.className = 'mungil-terabox-floating-bar';
      document.body.appendChild(bar);
    }

    // Detect active playing video
    let activeVideo = videos.find((v) => v.isActive);
    if (!activeVideo && videos.length > 0) {
      const titleEl = document.querySelector(
        '.play-video-title, .title, .file-item-name, [class*="video-title"], .tip-title, h1, [class*="file-name"]'
      );
      const domTitle = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || '';
      if (domTitle) {
        activeVideo = videos.find(
          (v) =>
            v.filename &&
            (domTitle.includes(v.filename) ||
              v.filename.includes(domTitle) ||
              domTitle.toLowerCase().includes(v.filename.toLowerCase()))
        );
      }
    }
    if (!activeVideo && videos.length > 0 && document.querySelector('video')) {
      activeVideo = videos[0];
    }

    // Priority 1: If active/target video is detected
    const targetVideo =
      activeVideo ||
      (videos.length === 1 ? videos[0] : null) ||
      (videos.length === 0 &&
      downloadables.length === 1 &&
      (downloadables[0].isVideo || /\.(mp4|mkv|webm|mov|avi)$/i.test(downloadables[0].filename))
        ? downloadables[0]
        : null);

    if (targetVideo) {
      if (
        bar.getAttribute('data-loaded-fsid') === String(targetVideo.fs_id) &&
        bar.querySelector('#mungil-tb-floating-quality')
      ) {
        return;
      }
      bar.setAttribute('data-loaded-fsid', String(targetVideo.fs_id));

      const baseSize = targetVideo.size || 0;
      const est1080 = baseSize ? formatBytes(Math.round(baseSize * 0.95)) : '~400 MB';
      const est720 = baseSize ? formatBytes(Math.round(baseSize * 0.58)) : '~250 MB';
      const est480 = baseSize ? formatBytes(Math.round(baseSize * 0.35)) : '~140 MB';
      const est360 = baseSize ? formatBytes(Math.round(baseSize * 0.2)) : '~80 MB';

      bar.innerHTML = `
        ${
          targetVideo.formatted_size && targetVideo.formatted_size !== '0 B'
            ? `<span class="mungil-terabox-floating-badge">${targetVideo.formatted_size}</span>`
            : ''
        }
        <select class="mungil-tb-quality-select" id="mungil-tb-floating-quality" title="Pilih Kualitas Video">
          <option value="original" selected>Original (${targetVideo.formatted_size || 'Full'})</option>
          <option value="1080p">1080p Full HD (${est1080})</option>
          <option value="720p">720p HD (${est720})</option>
          <option value="480p">480p SD (${est480})</option>
          <option value="360p">360p Hemat (${est360})</option>
        </select>
        <button type="button" class="mungil-terabox-btn" id="mungil-tb-single-btn">
          ${SVG_DOWNLOAD}
          <span>Unduh Video</span>
        </button>
        ${
          videos.length > 1
            ? `<button type="button" class="mungil-terabox-btn-secondary" id="mungil-tb-batch-btn" title="Unduh Semua (${videos.length} Video)">
                ${SVG_FOLDER}
                <span>Batch (${videos.length})</span>
              </button>`
            : ''
        }
      `;
      const btn = bar.querySelector('#mungil-tb-single-btn');
      const select = bar.querySelector('#mungil-tb-floating-quality');
      const btnBatch = bar.querySelector('#mungil-tb-batch-btn');

      if (select) {
        select.addEventListener('change', () => {
          const badge = bar.querySelector('.mungil-terabox-floating-badge');
          if (badge) {
            const map = {
              original: targetVideo.formatted_size || 'Full',
              '1080p': est1080,
              '720p': est720,
              '480p': est480,
              '360p': est360
            };
            badge.textContent = map[select.value] || targetVideo.formatted_size;
          }
        });
      }
      if (btn) {
        btn.onclick = () => {
          const chosenQuality = (select && select.value) || 'original';
          triggerDownloadFile(targetVideo, btn, chosenQuality);
        };
      }
      if (btnBatch) {
        btnBatch.onclick = () => openBatchModal(videos);
      }
    } else if (videos.length > 1) {
      // Multiple videos detected without active video: offer batch download specifically for videos
      bar.innerHTML = `
        <span class="mungil-terabox-floating-badge">${videos.length} Video</span>
        <button type="button" class="mungil-terabox-btn" id="mungil-tb-batch-btn">
          ${SVG_FOLDER}
          <span>Download Batch (${videos.length})</span>
        </button>
      `;
      const btn = bar.querySelector('#mungil-tb-batch-btn');
      if (btn) {
        btn.onclick = () => openBatchModal(videos);
      }
    } else if (downloadables.length === 1) {
      // Single non-video file (e.g. 1 image or document)
      const singleFile = downloadables[0];
      const isImg = singleFile.isImage || /\.(jpg|jpeg|png|gif|webp)$/i.test(singleFile.filename);
      bar.innerHTML = `
        ${
          singleFile.formatted_size && singleFile.formatted_size !== '0 B'
            ? `<span class="mungil-terabox-floating-badge">${singleFile.formatted_size}</span>`
            : ''
        }
        <button type="button" class="mungil-terabox-btn" id="mungil-tb-single-btn">
          ${SVG_DOWNLOAD}
          <span>${isImg ? 'Unduh Gambar' : 'Unduh File'}</span>
        </button>
      `;
      const btn = bar.querySelector('#mungil-tb-single-btn');
      if (btn) {
        btn.onclick = () => triggerDownloadFile(singleFile, btn);
      }
    } else {
      // Multiple mixed non-video files
      bar.innerHTML = `
        <span class="mungil-terabox-floating-badge">${downloadables.length} File</span>
        <button type="button" class="mungil-terabox-btn" id="mungil-tb-batch-btn">
          ${SVG_FOLDER}
          <span>Download Batch (${downloadables.length})</span>
        </button>
      `;
      const btn = bar.querySelector('#mungil-tb-batch-btn');
      if (btn) {
        btn.onclick = () => openBatchModal(downloadables);
      }
    }
  }

  // Hook native download buttons to bypass forced desktop app install
  function hookNativeDownloadButtons() {
    const buttons = document.querySelectorAll(
      '.download-btn, [class*="download-btn"], .HIGH_SPEED_DOWNLOAD'
    );
    buttons.forEach((btn) => {
      if (btn.__mungil_hooked) return;
      btn.__mungil_hooked = true;
      btn.addEventListener(
        'click',
        async (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          const files = await fetchTeraBoxFiles();
          const { videos, nonDirs } = classifyFiles(files);
          const first = videos[0] || nonDirs[0] || getDomFallbackFile();
          if (first) {
            triggerDownloadFile(first);
          }
        },
        true
      );
    });
  }

  // --------------------------------------------------------------------------
  // Background & Popup Message Listener
  // --------------------------------------------------------------------------
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      if (
        message.type === 'GET_ACTIVE_VIDEO_INFO' ||
        message.type === 'GET_TERABOX_FILE_INFO' ||
        message.action === 'getVideoInfo'
      ) {
        fetchTeraBoxFiles().then((files) => {
          const { videos, images, nonDirs } = classifyFiles(files);

          // If there is exactly 1 video on the page, prioritize it as the active video
          if (videos.length === 1) {
            const v = videos[0];
            const baseSize = v.size || 0;
            const estimatedSizes = {
              original: v.formatted_size || 'Full',
              '1080p': baseSize ? formatBytes(Math.round(baseSize * 0.95)) : '~400 MB',
              '720p': baseSize ? formatBytes(Math.round(baseSize * 0.58)) : '~250 MB',
              '480p': baseSize ? formatBytes(Math.round(baseSize * 0.35)) : '~140 MB',
              '360p': baseSize ? formatBytes(Math.round(baseSize * 0.2)) : '~80 MB'
            };
            sendResponse({
              success: true,
              platform: 'terabox',
              videoId: v.fs_id,
              title: v.filename,
              author: 'TeraBox',
              duration: 0,
              sizeFormatted: v.formatted_size || '',
              sizeBytes: v.size || 0,
              fileCount: 1,
              videoCount: 1,
              imageCount: images.length,
              totalCount: nonDirs.length,
              isVideo: true,
              estimatedSizes,
              files: [v]
            });
            return;
          }

          if (videos.length > 1) {
            const v = videos[0];
            const baseSize = v.size || 0;
            const estimatedSizes = {
              original: v.formatted_size || 'Full',
              '1080p': baseSize ? formatBytes(Math.round(baseSize * 0.95)) : '~400 MB',
              '720p': baseSize ? formatBytes(Math.round(baseSize * 0.58)) : '~250 MB',
              '480p': baseSize ? formatBytes(Math.round(baseSize * 0.35)) : '~140 MB',
              '360p': baseSize ? formatBytes(Math.round(baseSize * 0.2)) : '~80 MB'
            };
            sendResponse({
              success: true,
              platform: 'terabox',
              videoId: videos[0].fs_id,
              title: videos[0].filename,
              author: 'TeraBox',
              duration: 0,
              sizeFormatted: videos[0].formatted_size || '',
              sizeBytes: videos[0].size || 0,
              fileCount: videos.length,
              videoCount: videos.length,
              imageCount: images.length,
              totalCount: nonDirs.length,
              isVideo: true,
              estimatedSizes,
              files: videos
            });
            return;
          }

          // Fallback to any non-directory files
          const downloadables = nonDirs.length > 0 ? nonDirs : [getDomFallbackFile()];
          const first = downloadables[0];

          if (first) {
            sendResponse({
              success: true,
              platform: 'terabox',
              videoId: first.fs_id,
              title: first.filename,
              author: 'TeraBox',
              duration: 0,
              sizeFormatted: first.formatted_size || '',
              sizeBytes: first.size || 0,
              fileCount: Math.max(1, downloadables.length),
              videoCount: 0,
              imageCount: images.length,
              totalCount: downloadables.length,
              isVideo: false,
              files: downloadables
            });
          } else {
            sendResponse({
              success: false,
              platform: 'terabox',
              error: 'File TeraBox belum termuat atau halaman kosong'
            });
          }
        });
        return true;
      }

      if (message.type === 'TRIGGER_DOWNLOAD') {
        fetchTeraBoxFiles().then((files) => {
          const { videos, nonDirs } = classifyFiles(files);
          const first = videos[0] || nonDirs[0] || getDomFallbackFile();
          if (first) {
            triggerDownloadFile(first, null, message.quality || 'original');
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Tidak ada file untuk diunduh' });
          }
        });
        return true;
      }

      if (message.type === 'TRIGGER_BATCH_DOWNLOAD') {
        fetchTeraBoxFiles().then((files) => {
          const { videos, nonDirs } = classifyFiles(files);
          const targets = videos.length > 1 ? videos : nonDirs;
          openBatchModal(targets);
          sendResponse({ success: true });
        });
        return true;
      }

      return false;
    });
  }

  // --------------------------------------------------------------------------
  // In-Row Download Buttons for File Lists (Folders are strictly ignored)
  // --------------------------------------------------------------------------
  function injectRowButtons() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    const rows = document.querySelectorAll(
      '.webmaster-file-item, .file-item-listmode, .file-item, .wp-s-pan-list__file-wrapper'
    );
    if (!rows || rows.length === 0) return;

    rows.forEach((row) => {
      // 1. If row or any ancestor is already processed, skip to avoid duplicate buttons
      if (row.classList.contains('mungil-row-done') || row.closest('.mungil-row-done')) {
        return;
      }

      // 2. If row has child elements that also match row selector, it's a parent wrapper! Let the leaf row handle it.
      if (row.querySelector('.webmaster-file-item, .file-item-listmode, .file-item')) {
        return;
      }

      // 3. Never inject download buttons on directories / folders
      const isFolderClass =
        row.classList.contains('folder-item') ||
        row.classList.contains('is-dir') ||
        row.classList.contains('webmaster-folder-item') ||
        Boolean(row.querySelector('.folder-icon, [class*="folder"], [data-type="folder"]'));

      const nameEl = row.querySelector('.file-item-name, [class*="file-name"]');
      const textName = (nameEl && nameEl.textContent && nameEl.textContent.trim()) || '';
      const titleName =
        (nameEl && (nameEl.getAttribute('title') || nameEl.getAttribute('aria-label'))) ||
        row.getAttribute('title') ||
        row.getAttribute('data-filename') ||
        '';
      const cleanPrefix = (titleName || textName).replace(/(\.{3}|…)$/, '').trim();

      // Robust matching:
      // 1. Exact match with titleName
      // 2. Exact match with textName
      // 3. Prefix match when filename in UI is truncated with ellipsis (...)
      // 4. Map directly if only 1 non-directory cached file exists
      const nonDirCached = cachedFiles.filter((f) => !f.isdir);
      const matchedFile =
        (titleName && cachedFiles.find((f) => f.filename === titleName)) ||
        (textName && cachedFiles.find((f) => f.filename === textName)) ||
        (cleanPrefix.length >= 3 &&
          cachedFiles.find((f) =>
            f.filename.toLowerCase().startsWith(cleanPrefix.toLowerCase())
          )) ||
        (nonDirCached.length === 1 ? nonDirCached[0] : null);

      if (isFolderClass || (matchedFile && matchedFile.isdir)) {
        row.classList.add('mungil-row-done');
        return; // Folders are strictly ignored
      }

      if (!nameEl) return;

      // Mark row as processed to prevent any duplicate insertion
      row.classList.add('mungil-row-done');

      if (row.querySelector('.mungil-terabox-row-btn')) return;

      const isImage =
        (matchedFile && matchedFile.isImage) ||
        /\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)$/i.test(titleName || textName);

      const targetFile = matchedFile || {
        fs_id: `row_${Date.now()}`,
        filename: titleName || textName || cleanPrefix || 'TeraBox_File',
        size: 0,
        formatted_size: '',
        isdir: false,
        isVideo: !isImage,
        isImage,
        dlink: ''
      };

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mungil-terabox-row-btn ${isImage ? 'mungil-tb-row-img' : 'mungil-tb-row-video'}`;
      btn.innerHTML = `${SVG_DOWNLOAD}<span>${isImage ? 'Unduh Gambar' : 'Unduh'}</span>`;
      btn.onclick = (e) => {
        e.stopPropagation();
        triggerDownloadFile(targetFile, btn);
      };

      row.appendChild(btn);
    });
  }

  // --------------------------------------------------------------------------
  // Lifecycle & Observer
  // --------------------------------------------------------------------------
  let initTimeout = null;
  function scheduleInit() {
    if (initTimeout) clearTimeout(initTimeout);
    initTimeout = setTimeout(() => {
      injectPlayerButton();
      injectFloatingBar();
      injectRowButtons();
      hookNativeDownloadButtons();
    }, 200);
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('TERABOX_FILES_UPDATED', (e) => {
      if (e.detail && Array.isArray(e.detail.files) && e.detail.files.length > 0) {
        cachedFiles = e.detail.files;
      }
      scheduleInit();
    });
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('TERABOX_FILES_UPDATED', (e) => {
      if (e.detail && Array.isArray(e.detail.files) && e.detail.files.length > 0) {
        cachedFiles = e.detail.files;
      }
      scheduleInit();
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleInit);
    } else {
      scheduleInit();
    }

    setTimeout(scheduleInit, 600);
    setTimeout(scheduleInit, 1500);
    setTimeout(scheduleInit, 3000);

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        scheduleInit();
      });
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
          }
        });
      }
    }
  }

  // Export for unit tests in Node environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      sanitizeTeraBoxFilename,
      formatBytes,
      fetchTeraBoxFiles,
      resolveDlinkForFile,
      triggerDownloadFile,
      openBatchModal,
      getDomFallbackFile,
      injectPlayerButton,
      injectFloatingBar,
      classifyFiles,
      downloadHlsStream
    };
  }

  console.log(`${LOG_PREFIX} TeraBox Content Platform successfully initialized.`);
})();
