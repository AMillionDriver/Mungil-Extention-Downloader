/**
 * JWPlyr (jwplyr.com) Direct Downloader - Content Platform Script
 * Runs in the ISOLATED world at document_idle.
 *
 * Features:
 * 1. Debounced MutationObserver (250ms) for dynamic folder and video page DOM tracking.
 * 2. 1-Click Card Downloader on Folder View (/f/) with 4-state lifecycle (idle, loading, success, error).
 * 3. In-Player 1-Click Downloader on Video View (/d/ and /e/).
 * 4. "Unduh Semua Video" Batch Download Button & Responsive Glassmorphism Modal.
 * 5. Direct Parallel Queue (Concurrency: 2) for non-blocking multi-video downloads.
 * 6. High-Reliability 3-Tier Stream Extraction (DOM -> Iframe /ip129jk -> stream.php -> overfetch MP4).
 * 7. Multi-Platform Popup IPC listener for GET_ACTIVE_VIDEO_INFO and DOWNLOAD_ACTIVE_VIDEO.
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. Windows NTFS Filename Sanitization Utilities
  // =========================================================================

  function sanitizeJwplyrTitle(title) {
    if (title === null || title === undefined) return 'JWPlyr_Video';
    let str = String(title).trim();
    if (!str) return 'JWPlyr_Video';

    // Normalize colons and slashes to dashes/spaces
    str = str.replace(/[:：]/g, ' - ');
    str = str.replace(/[/\\|]/g, '-');

    // Strip remaining Win32 forbidden characters (* ? " < >) and control codes
    str = str.replace(/[*?"<>|\x00-\x1f\x7f-\x9f]/g, '');

    // Collapse consecutive whitespace and dashes
    str = str.replace(/\s+/g, ' ');
    str = str.replace(/-{2,}/g, '-');
    str = str.replace(/\s*-\s*/g, ' - ');

    // Trim leading/trailing dots, spaces, underscores, and hyphens
    str = str.replace(/^[.\s_-]+|[.\s_-]+$/g, '');

    // Truncate to safe length (120 chars)
    str = str.slice(0, 120).trim();
    str = str.replace(/[.\s_-]+$/, '');

    return str || 'JWPlyr_Video';
  }

  function formatJwplyrFilename(title, id) {
    const rawTitle = title !== null && title !== undefined ? String(title).trim() : '';
    const safeTitle = sanitizeJwplyrTitle(rawTitle || (id ? `jwplyr_${id}` : 'JWPlyr_Video'));

    if (safeTitle.toLowerCase().endsWith('.mp4')) {
      return safeTitle;
    }
    return `${safeTitle}.mp4`;
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

    add(item) {
      if (!item) return;
      this.items.push(item);
    }

    start() {
      if (this.cancelled) return;
      if (this.items.length === 0) {
        if (typeof this.onAllComplete === 'function') {
          this.onAllComplete({ total: 0, completed: 0, failed: 0 });
        }
        return;
      }

      const slots = Math.min(this.concurrency, this.items.length);
      for (let i = 0; i < slots; i++) {
        this._spawnWorker();
      }
    }

    cancel() {
      this.cancelled = true;
      this.items = [];
    }

    _spawnWorker() {
      if (this.cancelled || this.currentIndex >= this.items.length) {
        if (this.activeWorkers === 0 && typeof this.onAllComplete === 'function') {
          this.onAllComplete({
            total: this.items.length,
            completed: this.completedCount,
            failed: this.failedCount
          });
        }
        return;
      }

      const index = this.currentIndex++;
      const item = this.items[index];
      this.activeWorkers++;

      if (typeof this.onProgress === 'function') {
        this.onProgress({
          index,
          item,
          total: this.items.length,
          completed: this.completedCount,
          failed: this.failedCount,
          active: this.activeWorkers
        });
      }

      Promise.resolve()
        .then(() => (typeof item.task === 'function' ? item.task() : Promise.resolve()))
        .then((result) => {
          this.completedCount++;
          if (typeof this.onItemComplete === 'function') {
            this.onItemComplete({ index, item, result });
          }
        })
        .catch((err) => {
          this.failedCount++;
          if (typeof this.onItemFail === 'function') {
            this.onItemFail({ index, item, error: err });
          }
        })
        .finally(() => {
          // Immediately nullify task reference to enable rapid GC of closures and buffers
          item.task = null;
          this.activeWorkers--;
          if (!this.cancelled) {
            this._spawnWorker();
          }
        });
    }
  }

  // =========================================================================
  // 3. High-Reliability Stream Extraction Engine
  // =========================================================================

  /**
   * Resolves the direct overfetch.video MP4 URL from a JWPlyr video ID or URL.
   *
   * Flow:
   * 1. Inspects DOM if on video watch page, or fetches /d/{videoId}.
   * 2. Extracts `var SRC = '...'` pointing to the iframe endpoint (/ip129jk?...).
   * 3. Fetches the iframe endpoint with Referer header.
   * 4. Extracts stream.php URL from <link rel="prefetch"> or playerPath.
   * 5. Fetches stream.php with Referer header.
   * 6. Extracts direct <source src="https://mp4-*.overfetch.video/...mp4">.
   *
   * @param {string} videoId
   * @param {string} [pageUrl]
   * @returns {Promise<{ mp4Url: string, title: string, videoId: string }>}
   */
  async function extractDirectMp4(videoId, pageUrl) {
    if (!videoId) {
      throw new Error('Video ID is required for stream extraction');
    }

    const cleanId = String(videoId).trim();
    const targetPageUrl = pageUrl || `https://jwplyr.com/d/${cleanId}`;

    let iframeUrl = null;
    let pageTitle = '';

    // Check if current document is already the video page for this video
    const isCurrentPage =
      typeof window !== 'undefined' &&
      window.location &&
      (window.location.pathname.includes(`/d/${cleanId}`) ||
        window.location.pathname.includes(`/e/${cleanId}`));

    if (isCurrentPage && typeof document !== 'undefined') {
      pageTitle = document.title ? document.title.trim() : '';

      // Check if player iframe already has src
      const iframeEl = document.getElementById('videq_iframe');
      if (iframeEl && iframeEl.getAttribute('src')) {
        const srcAttr = iframeEl.getAttribute('src');
        iframeUrl = srcAttr.startsWith('http') ? srcAttr : `https://jwplyr.com${srcAttr}`;
      }

      // Check scripts in current DOM for `var SRC = '...'`
      if (!iframeUrl) {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
          const text = s.textContent || '';
          const match = text.match(/var\s+SRC\s*=\s*['"]([^'"]+)['"]/);
          if (match) {
            const p = match[1];
            iframeUrl = p.startsWith('http') ? p : `https://jwplyr.com${p}`;
            break;
          }
        }
      }
    }

    // If iframeUrl not found from current DOM, fetch targetPageUrl
    if (!iframeUrl) {
      const pageRes = await fetch(targetPageUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': navigator.userAgent || 'Mozilla/5.0'
        }
      });
      if (!pageRes.ok) {
        throw new Error(`Failed to load video page: HTTP ${pageRes.status}`);
      }
      const pageHtml = await pageRes.text();

      // Extract title if missing
      const titleMatch = pageHtml.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch && !pageTitle) {
        pageTitle = titleMatch[1].trim();
      }

      const srcMatch = pageHtml.match(/var\s+SRC\s*=\s*['"]([^'"]+)['"]/);
      if (!srcMatch) {
        throw new Error('Iframe source configuration not found in video page');
      }
      const p = srcMatch[1];
      iframeUrl = p.startsWith('http') ? p : `https://jwplyr.com${p}`;
    }

    // Step 2: Fetch iframe endpoint
    const iframeRes = await fetch(iframeUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: targetPageUrl
      }
    });
    if (!iframeRes.ok) {
      throw new Error(`Failed to load player iframe: HTTP ${iframeRes.status}`);
    }
    const iframeHtml = await iframeRes.text();

    // Extract stream.php URL
    const streamMatch =
      iframeHtml.match(/href=["'](https:\/\/jwplyr\.com\/stream\.php\?[^"']+)["']/) ||
      iframeHtml.match(/playerPath\s*=\s*["'](https:\/\/jwplyr\.com\/stream\.php\?[^"']+)["']/);
    if (!streamMatch) {
      throw new Error('stream.php endpoint not found in player iframe');
    }
    const streamUrl = streamMatch[1].replace(/&amp;/g, '&');

    // Step 3: Fetch stream.php
    const streamRes = await fetch(streamUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: iframeUrl
      }
    });
    if (!streamRes.ok) {
      throw new Error(`Failed to load stream player: HTTP ${streamRes.status}`);
    }
    const streamHtml = await streamRes.text();

    // Extract direct MP4 source
    const mp4Match =
      streamHtml.match(/<source\s+src=["']([^"']+\.mp4[^"']*)["']/i) ||
      streamHtml.match(/src=["'](https:\/\/[^"']*overfetch\.video\/[^"']+)["']/i);
    if (!mp4Match) {
      throw new Error('Direct MP4 video source not found in stream data');
    }
    const mp4Url = mp4Match[1].replace(/&amp;/g, '&');

    return {
      mp4Url,
      title: pageTitle || cleanId,
      videoId: cleanId
    };
  }

  /**
   * Downloads video payload with in-page direct streaming (Object URL) to avoid
   * background heap spikes, with seamless Service Worker fallback.
   */
  async function downloadVideoPayload(params) {
    if (!params || !params.url) {
      throw new Error('Missing download URL');
    }

    const filename = formatJwplyrFilename(params.title, params.videoId);
    let blobUrl = null;

    // Fast path: In-page direct blob streaming with instant revocation (saves 100% SW memory)
    if (
      typeof fetch === 'function' &&
      typeof document !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      try {
        const response = await fetch(params.url);
        if (response.ok) {
          const blob = await response.blob();
          if (blob && blob.size > 0 && !blob.type.includes('text/html')) {
            blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
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

            // Record telemetry in background service worker
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
              chrome.runtime.sendMessage(
                {
                  type: 'RECORD_DOWNLOAD',
                  payload: {
                    platform: 'jwplyr',
                    title: params.title || filename,
                    filename: filename
                  }
                },
                () => {}
              );
            }

            return { success: true, filename, source: 'in_page' };
          }
        }
      } catch (inPageErr) {
        if (blobUrl) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch (_) {}
        }
        console.warn(
          '[JWPlyr Downloader] In-page direct fetch failed, falling back to background service worker:',
          inPageErr
        );
      }
    }

    // Fallback: Dispatches download request to background service worker
    return new Promise((resolve, reject) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: 'DOWNLOAD_VIDEO',
            payload: {
              url: params.url,
              title: params.title,
              videoId: params.videoId,
              filename: filename,
              platform: 'jwplyr',
              referer: 'https://jwplyr.com/',
              origin: 'https://jwplyr.com'
            }
          },
          (response) => {
            if (chrome.runtime.lastError) {
              return reject(new Error(chrome.runtime.lastError.message));
            }
            if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error(response?.error || 'Download request failed'));
            }
          }
        );
      } else {
        // Fallback in-page anchor download
        try {
          const a = document.createElement('a');
          a.href = params.url;
          a.download = filename;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          resolve({ success: true, filename });
        } catch (err) {
          reject(err);
        }
      }
    });
  }

  // =========================================================================
  // 4. In-Page UI Injection on Folder View (/f/)
  // =========================================================================

  const SVG_DOWNLOAD = `
    <svg viewBox="0 0 24 24">
      <path d="M12 3v12m0 0l-4-4m4 4l4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  `;

  const SVG_CHECK = `
    <svg viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  `;

  const SVG_WARN = `
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  `;

  // WeakSet for O(1) card deduplication without DOM churn
  const injectedCardsSet = new WeakSet();

  /**
   * Injects download buttons into each video card in .file-grid
   */
  function injectCardButtons() {
    const cards = document.querySelectorAll('.drive-file-card:not([data-jwplyr-ready="true"])');
    if (!cards || cards.length === 0) return;

    cards.forEach((card) => {
      if (injectedCardsSet.has(card)) return;
      injectedCardsSet.add(card);
      card.setAttribute('data-jwplyr-ready', 'true');

      // Extract video link
      const linkEl = card.querySelector('a[href*="/d/"]');
      if (!linkEl) return;

      const href = linkEl.getAttribute('href') || '';
      const vMatch = href.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (!vMatch) return;

      const videoId = vMatch[1];
      const title =
        card.querySelector('.file-name')?.getAttribute('title') ||
        card.querySelector('.file-name')?.textContent?.trim() ||
        linkEl.getAttribute('aria-label') ||
        videoId;

      // Create action button
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jwplyr-card-dl-btn';
      btn.title = `Unduh "${title}"`;
      btn.setAttribute('aria-label', `Unduh ${title}`);
      btn.innerHTML = SVG_DOWNLOAD;

      // Handle button click
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (btn.classList.contains('is-loading')) return;

        // State: Loading
        btn.className = 'jwplyr-card-dl-btn is-loading';
        btn.innerHTML = '<div class="jwplyr-spinner"></div>';

        try {
          const stream = await extractDirectMp4(videoId, `https://jwplyr.com/d/${videoId}`);
          await downloadVideoPayload({
            url: stream.mp4Url,
            title: title || stream.title,
            videoId: videoId
          });

          // State: Success
          btn.className = 'jwplyr-card-dl-btn is-success';
          btn.innerHTML = SVG_CHECK;

          setTimeout(() => {
            btn.className = 'jwplyr-card-dl-btn';
            btn.innerHTML = SVG_DOWNLOAD;
          }, 2500);
        } catch (err) {
          console.error('[JWPlyr Downloader] Card download error:', err);
          // State: Error
          btn.className = 'jwplyr-card-dl-btn is-error';
          btn.innerHTML = SVG_WARN;
          btn.title = `Gagal mengunduh: ${err.message}`;

          setTimeout(() => {
            btn.className = 'jwplyr-card-dl-btn';
            btn.innerHTML = SVG_DOWNLOAD;
            btn.title = `Unduh "${title}"`;
          }, 3000);
        }
      });

      // Insert button into card
      const thumbWrap = card.querySelector('.thumb-link') || card;
      if (thumbWrap.style) {
        thumbWrap.style.position = 'relative';
      }
      thumbWrap.appendChild(btn);
    });
  }

  /**
   * Injects "Unduh Semua Video" (Batch Download) button into topbar or section title
   */
  function injectBatchButton() {
    if (document.querySelector('.jwplyr-batch-btn')) return;

    const topbar = document.querySelector('.drive-topbar');
    const sectionTitle = document.querySelector('.section-title');
    const targetParent = topbar || sectionTitle;
    if (!targetParent) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jwplyr-batch-btn';
    btn.innerHTML = `
      ${SVG_DOWNLOAD}
      <span>Unduh Semua Video</span>
    `;

    btn.addEventListener('click', () => {
      openBatchModal();
    });

    targetParent.appendChild(btn);
  }

  /**
   * Opens the Batch Download Modal on Folder page
   */
  function openBatchModal() {
    if (document.querySelector('.jwplyr-modal-overlay')) return;

    const folderTitle =
      document.querySelector('.drive-title')?.textContent?.trim() || 'Folder Video';
    const cards = document.querySelectorAll('.drive-file-card');

    const videoItems = [];
    cards.forEach((card, idx) => {
      const linkEl = card.querySelector('a[href*="/d/"]');
      if (!linkEl) return;
      const href = linkEl.getAttribute('href') || '';
      const vMatch = href.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (!vMatch) return;

      const videoId = vMatch[1];
      const title =
        card.querySelector('.file-name')?.getAttribute('title') ||
        card.querySelector('.file-name')?.textContent?.trim() ||
        `Video ${idx + 1}`;
      const thumb = card.querySelector('img')?.getAttribute('src') || '';

      videoItems.push({
        id: videoId,
        title,
        thumb,
        selected: true
      });
    });

    if (videoItems.length === 0) {
      alert('Tidak ada video yang ditemukan di folder ini.');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'jwplyr-modal-overlay';

    overlay.innerHTML = `
      <div class="jwplyr-modal">
        <div class="jwplyr-modal-header">
          <div class="jwplyr-modal-title-group">
            <div class="jwplyr-modal-badge">Batch Downloader</div>
            <h2 class="jwplyr-modal-title">${folderTitle}</h2>
          </div>
          <button type="button" class="jwplyr-modal-close" id="jwplyr-modal-close" aria-label="Tutup">
            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="jwplyr-modal-toolbar">
          <div class="jwplyr-pills-group">
            <button type="button" class="jwplyr-pill" id="jwplyr-select-all">Pilih Semua</button>
            <button type="button" class="jwplyr-pill" id="jwplyr-clear-all">Kosongkan</button>
          </div>
          <div class="jwplyr-selection-count" id="jwplyr-selected-count">
            ${videoItems.length} dari ${videoItems.length} dipilih
          </div>
        </div>

        <div class="jwplyr-modal-body" id="jwplyr-modal-list">
          ${videoItems
            .map(
              (item, idx) => `
            <div class="jwplyr-item-row is-selected" data-idx="${idx}">
              <input type="checkbox" class="jwplyr-item-checkbox" checked data-idx="${idx}">
              ${item.thumb ? `<img class="jwplyr-item-thumb" src="${item.thumb}" alt="">` : ''}
              <div class="jwplyr-item-info">
                <div class="jwplyr-item-title" title="${item.title}">${item.title}</div>
                <div class="jwplyr-item-status" id="jwplyr-status-${idx}">Siap diunduh</div>
              </div>
            </div>
          `
            )
            .join('')}
        </div>

        <div class="jwplyr-modal-footer">
          <div style="flex: 1;">
            <div class="jwplyr-progress-wrap" id="jwplyr-progress-wrap" style="display: none;">
              <div class="jwplyr-progress-bar" id="jwplyr-progress-bar"></div>
            </div>
          </div>
          <button type="button" class="jwplyr-modal-btn btn-cancel" id="jwplyr-modal-cancel">Batal</button>
          <button type="button" class="jwplyr-modal-btn btn-start" id="jwplyr-modal-start">
            Mulai Unduh (${videoItems.length} Video)
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('#jwplyr-modal-close');
    const cancelBtn = overlay.querySelector('#jwplyr-modal-cancel');
    const startBtn = overlay.querySelector('#jwplyr-modal-start');
    const selectAllBtn = overlay.querySelector('#jwplyr-select-all');
    const clearAllBtn = overlay.querySelector('#jwplyr-clear-all');
    const countLabel = overlay.querySelector('#jwplyr-selected-count');
    const listBody = overlay.querySelector('#jwplyr-modal-list');
    const progressWrap = overlay.querySelector('#jwplyr-progress-wrap');
    const progressBar = overlay.querySelector('#jwplyr-progress-bar');

    let activeQueue = null;

    function updateSelectionUI() {
      const selected = videoItems.filter((v) => v.selected).length;
      countLabel.textContent = `${selected} dari ${videoItems.length} dipilih`;
      startBtn.textContent = `Mulai Unduh (${selected} Video)`;
      startBtn.disabled = selected === 0;

      const rows = listBody.querySelectorAll('.jwplyr-item-row');
      rows.forEach((row, i) => {
        const cb = row.querySelector('.jwplyr-item-checkbox');
        if (cb) cb.checked = videoItems[i].selected;
        row.classList.toggle('is-selected', videoItems[i].selected);
      });
    }

    selectAllBtn.addEventListener('click', () => {
      videoItems.forEach((v) => (v.selected = true));
      updateSelectionUI();
    });

    clearAllBtn.addEventListener('click', () => {
      videoItems.forEach((v) => (v.selected = false));
      updateSelectionUI();
    });

    listBody.addEventListener('click', (e) => {
      const row = e.target.closest('.jwplyr-item-row');
      if (!row) return;
      const idx = parseInt(row.getAttribute('data-idx'), 10);
      if (isNaN(idx) || !videoItems[idx]) return;

      if (e.target.tagName !== 'INPUT') {
        videoItems[idx].selected = !videoItems[idx].selected;
      } else {
        videoItems[idx].selected = e.target.checked;
      }
      updateSelectionUI();
    });

    function closeModal() {
      if (activeQueue) {
        activeQueue.cancel();
      }
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Start Batch Download
    startBtn.addEventListener('click', () => {
      const selectedItems = videoItems.filter((v) => v.selected);
      if (selectedItems.length === 0) return;

      startBtn.disabled = true;
      selectAllBtn.disabled = true;
      clearAllBtn.disabled = true;
      cancelBtn.textContent = 'Hentikan';
      progressWrap.style.display = 'block';

      activeQueue = new DirectParallelQueue({
        concurrency: 2,
        onProgress: ({ completed, failed, total }) => {
          const progress = Math.round(((completed + failed) / total) * 100);
          progressBar.style.width = `${progress}%`;
          startBtn.textContent = `Mengunduh... (${completed}/${total})`;
        },
        onItemComplete: ({ item }) => {
          const statusEl = overlay.querySelector(`#jwplyr-status-${item.idx}`);
          if (statusEl) {
            statusEl.className = 'jwplyr-item-status status-complete';
            statusEl.textContent = '✓ Selesai';
          }
        },
        onItemFail: ({ item, error }) => {
          const statusEl = overlay.querySelector(`#jwplyr-status-${item.idx}`);
          if (statusEl) {
            statusEl.className = 'jwplyr-item-status status-error';
            statusEl.textContent = `✗ Gagal (${error.message || 'Error'})`;
          }
        },
        onAllComplete: ({ completed, total }) => {
          progressBar.style.width = '100%';
          startBtn.textContent = `Selesai (${completed}/${total} Berhasil)`;
          cancelBtn.textContent = 'Tutup';
          setTimeout(() => {
            startBtn.disabled = false;
          }, 2000);
        }
      });

      selectedItems.forEach((item) => {
        const itemIdx = videoItems.indexOf(item);
        activeQueue.add({
          idx: itemIdx,
          task: async () => {
            const statusEl = overlay.querySelector(`#jwplyr-status-${itemIdx}`);
            if (statusEl) {
              statusEl.className = 'jwplyr-item-status status-downloading';
              statusEl.textContent = 'Sedang mengekstrak stream...';
            }

            const stream = await extractDirectMp4(item.id, `https://jwplyr.com/d/${item.id}`);

            if (statusEl) {
              statusEl.textContent = 'Mengunduh file video...';
            }

            await downloadVideoPayload({
              url: stream.mp4Url,
              title: item.title || stream.title,
              videoId: item.id
            });
          }
        });
      });

      activeQueue.start();
    });
  }

  // =========================================================================
  // 5. In-Page UI Injection on Video View (/d/ or /e/)
  // =========================================================================

  function injectPlayerButton() {
    if (document.querySelector('.jwplyr-player-dl-btn')) return;

    const isVideoPage =
      window.location.pathname.includes('/d/') || window.location.pathname.includes('/e/');
    if (!isVideoPage) return;

    const vMatch = window.location.pathname.match(/\/(d|e)\/([a-zA-Z0-9_-]+)/);
    const videoId = vMatch ? vMatch[2] : null;
    if (!videoId) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jwplyr-player-dl-btn';
    btn.innerHTML = `
      ${SVG_DOWNLOAD}
      <span class="jwplyr-btn-label">Download Video</span>
    `;

    btn.addEventListener('click', async () => {
      if (btn.classList.contains('is-loading')) return;

      const labelEl = btn.querySelector('.jwplyr-btn-label');
      btn.className = 'jwplyr-player-dl-btn is-loading';
      btn.innerHTML = '<div class="jwplyr-spinner"></div><span>Mengambil stream...</span>';

      try {
        const stream = await extractDirectMp4(videoId, window.location.href);
        const title = document.title ? document.title.trim() : stream.title;

        if (labelEl) labelEl.textContent = 'Menyimpan video...';

        await downloadVideoPayload({
          url: stream.mp4Url,
          title: title,
          videoId: videoId
        });

        btn.className = 'jwplyr-player-dl-btn is-success';
        btn.innerHTML = `${SVG_CHECK}<span>Tersimpan!</span>`;

        setTimeout(() => {
          btn.className = 'jwplyr-player-dl-btn';
          btn.innerHTML = `${SVG_DOWNLOAD}<span class="jwplyr-btn-label">Download Video</span>`;
        }, 2500);
      } catch (err) {
        console.error('[JWPlyr Downloader] Player download error:', err);
        btn.className = 'jwplyr-player-dl-btn is-error';
        btn.innerHTML = `${SVG_WARN}<span>Gagal (${err.message})</span>`;

        setTimeout(() => {
          btn.className = 'jwplyr-player-dl-btn';
          btn.innerHTML = `${SVG_DOWNLOAD}<span class="jwplyr-btn-label">Download Video</span>`;
        }, 3500);
      }
    });

    document.body.appendChild(btn);
  }

  // =========================================================================
  // 6. DOM MutationObserver & Initialization
  // =========================================================================

  let debounceTimer = null;
  function onDomMutated() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const isFolder = window.location.pathname.includes('/f/');
      if (isFolder) {
        injectCardButtons();
        injectBatchButton();
      } else {
        injectPlayerButton();
      }
    }, 250);
  }

  function init() {
    onDomMutated();

    if (typeof MutationObserver !== 'undefined' && document.body) {
      const observer = new MutationObserver(onDomMutated);
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  // Sync Mungil Shield configuration from storage to MAIN world
  function syncShieldConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['shield_clickjack', 'shield_adblock'], (data) => {
        const clickjack = Boolean(data?.shield_clickjack);
        const adblock = Boolean(data?.shield_adblock);
        if (typeof document !== 'undefined' && document && document.documentElement) {
          try {
            if (!document.documentElement.dataset) {
              document.documentElement.dataset = {};
            }
            document.documentElement.dataset.shieldClickjack = clickjack ? 'true' : 'false';
            document.documentElement.dataset.shieldAdblock = adblock ? 'true' : 'false';
          } catch (_) {}
        }
        if (
          typeof window !== 'undefined' &&
          window &&
          window.dispatchEvent &&
          typeof CustomEvent !== 'undefined'
        ) {
          try {
            window.dispatchEvent(
              new CustomEvent('MUNGIL_SHIELD_CONFIG', {
                detail: { clickjack, adblock }
              })
            );
          } catch (_) {}
        }
      });
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.shield_clickjack || changes.shield_adblock)) {
        syncShieldConfig();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      syncShieldConfig();
    });
  } else {
    init();
    syncShieldConfig();
  }

  // =========================================================================
  // 7. Multi-Platform Popup IPC Handlers
  // =========================================================================

  function getActiveVideoInfo() {
    const isFolder = window.location.pathname.includes('/f/');
    const isVideo =
      window.location.pathname.includes('/d/') || window.location.pathname.includes('/e/');

    if (isFolder) {
      const folderTitle =
        document.querySelector('.drive-title')?.textContent?.trim() || 'Folder Video';
      const cards = document.querySelectorAll('.drive-file-card');
      const fMatch = window.location.pathname.match(/\/f\/([a-zA-Z0-9_-]+)/);
      const folderId = fMatch ? fMatch[1] : '';

      return {
        ready: true,
        platform: 'jwplyr',
        isFolder: true,
        title: folderTitle,
        count: cards.length,
        folderId
      };
    }

    if (isVideo) {
      const vMatch = window.location.pathname.match(/\/(d|e)\/([a-zA-Z0-9_-]+)/);
      const videoId = vMatch ? vMatch[2] : '';
      const title = document.title
        ? document.title.trim()
        : videoId
          ? `JWPlyr Video ${videoId}`
          : 'Video';

      return {
        ready: true,
        platform: 'jwplyr',
        isFolder: false,
        title: title,
        videoId
      };
    }

    return {
      ready: false,
      platform: 'jwplyr',
      title: 'JWPlyr',
      desc: 'Buka folder atau tonton video untuk mengunduh'
    };
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      const type = message.type || message.action;

      if (type === 'GET_ACTIVE_VIDEO_INFO' || type === 'GET_JWPLYR_ACTIVE_VIDEO_INFO') {
        const info = getActiveVideoInfo();
        sendResponse({ success: true, ...info });
        return false;
      }

      if (type === 'DOWNLOAD_ACTIVE_VIDEO') {
        const isFolder = window.location.pathname.includes('/f/');
        if (isFolder) {
          openBatchModal();
          sendResponse({ success: true, message: 'Batch modal opened' });
          return false;
        }

        const vMatch = window.location.pathname.match(/\/(d|e)\/([a-zA-Z0-9_-]+)/);
        const videoId = vMatch ? vMatch[2] : null;

        if (!videoId) {
          sendResponse({ success: false, error: 'Tidak ada video aktif yang ditemukan' });
          return false;
        }

        extractDirectMp4(videoId, window.location.href)
          .then((stream) => {
            const title = document.title ? document.title.trim() : stream.title;
            return downloadVideoPayload({
              url: stream.mp4Url,
              title: title,
              videoId: videoId
            });
          })
          .then((res) => {
            sendResponse({ success: true, filename: res.filename });
          })
          .catch((err) => {
            sendResponse({ success: false, error: err.message });
          });

        return true; // Keep IPC channel open for async response
      }

      return false;
    });
  }

  // =========================================================================
  // 8. Module Exports for Automated Testing
  // =========================================================================

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      sanitizeJwplyrTitle,
      formatJwplyrFilename,
      DirectParallelQueue,
      extractDirectMp4,
      downloadVideoPayload,
      getActiveVideoInfo,
      injectCardButtons,
      injectBatchButton,
      injectPlayerButton,
      openBatchModal
    };
  }
})();
