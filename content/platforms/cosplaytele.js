/**
 * CosplayTele (cosplaytele.com) Direct Downloader - Content Platform Script
 * Runs in the ISOLATED world at document_idle.
 *
 * Features:
 * 1. Automatic article metadata and image extraction (full resolution wp-content/uploads).
 * 2. Cossora stream iframe / video player detection.
 * 3. Floating Action Bar (#mungil-cosplaytele-bar) with 1-click batch download and modal preview.
 * 4. Batch Selection Modal (#mungil-cosplaytele-modal) with individual checkboxes and live progress.
 * 5. Paced Sequential Queue (Concurrency: 2, delay: 350ms) to avoid browser socket choke.
 * 6. Windows NTFS filename sanitization.
 * 7. Multi-Platform Popup IPC listeners for GET_ACTIVE_VIDEO_INFO and DOWNLOAD_ACTIVE_VIDEO.
 */

(function () {
  'use strict';

  // Prevent multiple executions in same frame
  if (typeof window !== 'undefined') {
    if (window.__MUNGIL_COSPLAYTELE_INITIALIZED__) return;
    window.__MUNGIL_COSPLAYTELE_INITIALIZED__ = true;
  }

  // =========================================================================
  // 1. Windows NTFS Sanitization & Utilities
  // =========================================================================

  function sanitizeCosplayteleTitle(title) {
    if (title === null || title === undefined) return 'CosplayTele_Photo';
    let str = String(title).trim();
    if (!str) return 'CosplayTele_Photo';

    // Decode basic HTML entities
    str = str.replace(/&#8211;|&#8212;/g, '-');
    str = str.replace(/&#8220;|&#8221;|&quot;/g, '');
    str = str.replace(/&amp;/g, '&');
    str = str.replace(/&lt;/g, '<');
    str = str.replace(/&gt;/g, '>');

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

    return str || 'CosplayTele_Photo';
  }

  function formatCosplayteleFilename(params = {}) {
    const p = params && typeof params === 'object' ? params : {};
    const safeTitle = sanitizeCosplayteleTitle(p.title);
    const idx = p.index !== undefined && p.index !== null ? String(p.index).padStart(2, '0') : '';
    const ext = p.ext ? String(p.ext).replace(/^\./, '') : 'webp';

    if (idx) {
      return `${safeTitle} - ${idx}.${ext}`;
    }
    return `${safeTitle}.${ext}`;
  }

  function getUrlExtension(url, fallback = 'webp') {
    if (!url || typeof url !== 'string') return fallback;
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
      return match ? match[1].toLowerCase() : fallback;
    } catch {
      return fallback;
    }
  }

  // =========================================================================
  // 2. Direct Parallel Queue Concurrency Engine (Concurrency: 2)
  // =========================================================================

  class CosplayteleQueue {
    constructor(options = {}) {
      this.concurrency = options.concurrency || 2;
      this.delayMs = options.delayMs || 350;
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
      if (this.cancelled || this.items.length === 0) return;
      const slots = Math.min(
        this.concurrency - this.activeWorkers,
        this.items.length - this.currentIndex
      );
      for (let i = 0; i < slots; i++) {
        this.next();
      }
    }

    cancel() {
      this.cancelled = true;
      this.items = [];
    }

    next() {
      if (this.cancelled) return;
      if (this.currentIndex >= this.items.length) {
        if (this.activeWorkers === 0 && typeof this.onAllComplete === 'function') {
          this.onAllComplete({
            total: this.items.length,
            completed: this.completedCount,
            failed: this.failedCount
          });
        }
        return;
      }

      const item = this.items[this.currentIndex];
      const taskIndex = this.currentIndex;
      this.currentIndex++;
      this.activeWorkers++;

      const runTask = async () => {
        try {
          if (typeof item.task === 'function') {
            await item.task();
          }
          this.completedCount++;
          if (typeof this.onItemComplete === 'function') {
            this.onItemComplete(item, taskIndex);
          }
        } catch (err) {
          console.error('[CosplayTele Downloader] Task failed:', err);
          this.failedCount++;
          if (typeof this.onItemFail === 'function') {
            this.onItemFail(item, taskIndex, err);
          }
        } finally {
          this.activeWorkers--;
          if (typeof this.onProgress === 'function') {
            this.onProgress({
              total: this.items.length,
              completed: this.completedCount,
              failed: this.failedCount,
              percent: Math.round(
                ((this.completedCount + this.failedCount) / this.items.length) * 100
              )
            });
          }

          if (!this.cancelled) {
            setTimeout(() => this.next(), this.delayMs);
          }
        }
      };

      runTask();
    }
  }

  // =========================================================================
  // 3. Metadata & Image DOM Extractor
  // =========================================================================

  function extractCosplayteleData() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
      return { title: 'CosplayTele', photos: [], videoIframe: null, mirrors: [] };
    }

    // 1. Post Title
    const titleEl = document.querySelector('h1.entry-title');
    let title = titleEl ? titleEl.textContent.trim() : document.title || 'CosplayTele';
    title = title.replace(/\s*-\s*Cosplay Tele.*$/i, '').trim();

    // 2. High-res Photo Links
    const entry = document.querySelector('.entry-content') || document.body;
    if (!entry) {
      return { title, photos: [], videoIframe: null, mirrors: [] };
    }
    const photoUrls = [];
    const seen = new Set();

    // Strategy A: Anchors linking to wp-content/uploads images
    const anchors = entry.querySelectorAll('a[href*="wp-content/uploads"]');
    anchors.forEach((a) => {
      const href = a.getAttribute('href');
      if (href && /\.(webp|jpg|jpeg|png)$/i.test(href)) {
        // Exclude site logos or avatars
        if (!href.includes('cropped-icon') && !href.includes('avatar') && !seen.has(href)) {
          seen.add(href);
          photoUrls.push(href);
        }
      }
    });

    // Strategy B: If no anchors, inspect img elements directly
    if (photoUrls.length === 0) {
      const imgs = entry.querySelectorAll('img[src*="wp-content/uploads"]');
      imgs.forEach((img) => {
        const src = img.getAttribute('src');
        if (src && /\.(webp|jpg|jpeg|png)$/i.test(src)) {
          if (!src.includes('cropped-icon') && !src.includes('avatar') && !seen.has(src)) {
            seen.add(src);
            photoUrls.push(src);
          }
        }
      });
    }

    // 3. Embedded Video / Iframe
    let videoIframe = null;
    const iframes = entry.querySelectorAll('iframe');
    for (const ifr of iframes) {
      const src = ifr.getAttribute('src') || '';
      if (src.includes('cossora.stream') || src.includes('embed') || src.includes('player')) {
        videoIframe = src;
        break;
      }
    }

    // 4. Mirror Links
    const mirrors = [];
    const mirrorLinks = entry.querySelectorAll('a[href]');
    mirrorLinks.forEach((a) => {
      const txt = a.textContent.trim();
      const href = a.getAttribute('href');
      if (txt.toLowerCase().includes('download') && href && !href.startsWith('#')) {
        mirrors.push({
          label: txt.replace(/^download\s*/i, '').trim() || 'Mirror',
          url: href
        });
      }
    });

    return {
      title,
      photos: photoUrls,
      videoIframe,
      mirrors
    };
  }

  // =========================================================================
  // 4. Download Dispatcher via Chrome Extension Runtime
  // =========================================================================

  function dispatchDownload({ url, title, index, ext }) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Chrome extension runtime not available'));
        return;
      }

      const filename = formatCosplayteleFilename({ title, index, ext });

      chrome.runtime.sendMessage(
        {
          action: 'DOWNLOAD_VIDEO',
          url: url,
          title: title,
          index: index,
          ext: ext,
          filename: filename,
          platform: 'cosplaytele',
          referer: 'https://cosplaytele.com/',
          origin: 'https://cosplaytele.com'
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error(response ? response.error : 'Download failed'));
          }
        }
      );
    });
  }

  // Toast notification
  function showToast(message, duration = 3000) {
    const existing = document.querySelector('.ct-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'ct-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // =========================================================================
  // 5. Cossora HLS Stream Downloader (Background Dispatched / Zero CORS)
  // =========================================================================

  async function downloadCosplayteleVideo(title, videoIframe, onProgress) {
    if (!videoIframe) {
      showToast('Tidak ada video yang ditemukan');
      return;
    }

    showToast('Mengekstrak stream video Cossora...');

    // Progress listener for IPC events broadcasted by background service worker
    const progressListener = (msg) => {
      if (!msg || msg.type !== 'COSSORA_DOWNLOAD_PROGRESS') return;
      if (typeof onProgress === 'function') {
        onProgress(msg);
      }
      if (msg.completed % 5 === 0 || msg.completed === msg.total) {
        showToast(`Mengunduh video: ${msg.completed}/${msg.total} (${msg.percent}%)`);
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(progressListener);
    }

    try {
      const res = await new Promise((resolve, reject) => {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          reject(new Error('Chrome extension runtime tidak tersedia'));
          return;
        }
        chrome.runtime.sendMessage(
          {
            action: 'DOWNLOAD_COSSORA_VIDEO',
            embedUrl: videoIframe,
            title: title
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error(response ? response.error : 'Gagal mengunduh video'));
            }
          }
        );
      });

      showToast(`✓ Video berhasil diunduh: ${res.filename || 'MP4'}`);
      return res;
    } finally {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.removeListener(progressListener);
      }
    }
  }

  // =========================================================================
  // 6. Floating Action Bar & Batch Selection Modal UI (Bento Grid)
  // =========================================================================

  let activeQueue = null;

  function renderFloatingBar(data) {
    const hasPhotos = Array.isArray(data.photos) && data.photos.length > 0;
    const hasVideo = Boolean(data.videoIframe);
    if (!hasPhotos && !hasVideo) return;
    if (document.getElementById('mungil-cosplaytele-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'mungil-cosplaytele-bar';

    let metaText = '';
    if (hasPhotos && hasVideo) {
      metaText = `${data.photos.length} Foto • 1 Video`;
    } else if (hasPhotos) {
      metaText = `${data.photos.length} Foto`;
    } else {
      metaText = '1 Video';
    }

    let buttonsHtml = '';
    if (hasPhotos && hasVideo) {
      buttonsHtml = `
        <button type="button" class="ct-bar-btn" id="ct-btn-download-all" title="Unduh semua foto dan video">
          Unduh Semua (${data.photos.length + 1})
        </button>
        <button type="button" class="ct-bar-btn secondary" id="ct-btn-select-modal" title="Buka pemilihan foto Bento Grid">
          Pilih Foto
        </button>
        <button type="button" class="ct-bar-btn secondary" id="ct-btn-download-video" title="Unduh file video MP4 Cossora">
          Unduh Video Saja
        </button>
      `;
    } else if (hasPhotos) {
      buttonsHtml = `
        <button type="button" class="ct-bar-btn" id="ct-btn-download-all" title="Unduh semua foto">
          Unduh Semua (${data.photos.length})
        </button>
        <button type="button" class="ct-bar-btn secondary" id="ct-btn-select-modal" title="Buka pemilihan foto Bento Grid">
          Pilih Foto
        </button>
      `;
    } else if (hasVideo) {
      buttonsHtml = `
        <button type="button" class="ct-bar-btn" id="ct-btn-download-video" title="Unduh file video MP4 Cossora">
          Unduh Video Saja
        </button>
      `;
    }

    bar.innerHTML = `
      <div class="ct-bar-badge">
        <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        CosplayTele
      </div>
      <div class="ct-bar-info">
        <div class="ct-bar-title" title="${data.title}">${data.title}</div>
        <div class="ct-bar-meta">${metaText}</div>
      </div>
      ${buttonsHtml}
    `;

    document.body.appendChild(bar);

    // Event Listeners
    const btnAll = bar.querySelector('#ct-btn-download-all');
    if (btnAll) {
      btnAll.addEventListener('click', () => {
        if (hasPhotos && hasVideo) {
          downloadPhotoBatch(data.title, data.photos);
          downloadCosplayteleVideo(data.title, data.videoIframe).catch((err) => {
            console.error('[CosplayTele] Video download error:', err);
            showToast(`Gagal mengunduh video: ${err.message}`);
          });
        } else if (hasPhotos) {
          downloadPhotoBatch(data.title, data.photos);
        }
      });
    }

    const btnSelect = bar.querySelector('#ct-btn-select-modal');
    if (btnSelect) {
      btnSelect.addEventListener('click', () => {
        openBatchModal(data);
      });
    }

    const btnVideo = bar.querySelector('#ct-btn-download-video');
    if (btnVideo) {
      btnVideo.addEventListener('click', () => {
        downloadCosplayteleVideo(data.title, data.videoIframe).catch((err) => {
          console.error('[CosplayTele] Video download error:', err);
          showToast(`Gagal mengunduh video: ${err.message}`);
        });
      });
    }
  }

  function downloadPhotoBatch(title, photoUrls) {
    if (!photoUrls || photoUrls.length === 0) {
      showToast('Tidak ada foto untuk diunduh');
      return;
    }

    if (activeQueue) {
      activeQueue.cancel();
      activeQueue = null;
    }

    showToast(`Memulai unduhan ${photoUrls.length} foto...`);

    const queue = new CosplayteleQueue({
      concurrency: 2,
      delayMs: 350,
      onProgress: (p) => {
        showToast(`Mengunduh (${p.completed}/${p.total})...`);
      },
      onAllComplete: (res) => {
        showToast(`Selesai! Berhasil: ${res.completed}, Gagal: ${res.failed}`);
        activeQueue = null;
      }
    });

    photoUrls.forEach((url, i) => {
      const ext = getUrlExtension(url, 'webp');
      queue.add({
        url,
        task: () => dispatchDownload({ url, title, index: i + 1, ext })
      });
    });

    activeQueue = queue;
    queue.start();
  }

  function openBatchModal(data) {
    const existing = document.getElementById('mungil-cosplaytele-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mungil-cosplaytele-modal-overlay';

    const hasVideo = Boolean(data.videoIframe);

    overlay.innerHTML = `
      <div id="mungil-cosplaytele-modal">
        <div class="ct-modal-header">
          <div class="ct-modal-title">
            <span>Pilih Foto CosplayTele</span>
            <span style="font-size:12px;font-weight:400;color:var(--ct-text-muted)">(${data.photos.length} total)</span>
          </div>
          <button type="button" class="ct-modal-close" id="ct-modal-btn-close">&times;</button>
        </div>
        <div class="ct-modal-toolbar">
          <div>
            <span id="ct-selected-count">${data.photos.length}</span> dipilih
          </div>
          <div class="ct-modal-toolbar-actions">
            ${
              hasVideo
                ? `<label class="ct-video-toggle-label" title="Sertakan unduhan video Cossora saat batch download">
                    <input type="checkbox" id="ct-modal-include-video" checked />
                    <span>Sertakan Video (1)</span>
                  </label>`
                : ''
            }
            <button type="button" class="ct-bar-btn secondary" id="ct-btn-select-all" style="padding:4px 10px;font-size:11px;">Pilih Semua</button>
            <button type="button" class="ct-bar-btn secondary" id="ct-btn-deselect-all" style="padding:4px 10px;font-size:11px;">Hapus Pilihan</button>
          </div>
        </div>
        <div class="ct-modal-body" id="ct-modal-grid">
          ${data.photos
            .map(
              (url, i) => `
            <div class="ct-bento-card selected" data-url="${url}" data-idx="${i + 1}">
              <img src="${url}" loading="lazy" alt="Photo ${i + 1}" />
              <div class="ct-bento-gradient-overlay"></div>
              <div class="ct-photo-checkbox">✓</div>
              <div class="ct-photo-idx">#${i + 1}</div>
            </div>
          `
            )
            .join('')}
        </div>
        <div class="ct-modal-footer">
          <div class="ct-progress-wrap" id="ct-modal-progress">
            <div style="font-size:11px;color:var(--ct-text-muted);display:flex;justify-content:space-between">
              <span id="ct-progress-text">Mengunduh...</span>
              <span id="ct-progress-pct">0%</span>
            </div>
            <div class="ct-progress-bar"><div class="ct-progress-fill" id="ct-progress-fill"></div></div>
          </div>
          <div style="display:flex;gap:10px;margin-left:auto;">
            <button type="button" class="ct-bar-btn secondary" id="ct-modal-cancel">Tutup</button>
            <button type="button" class="ct-bar-btn" id="ct-modal-download">Unduh Terpilih</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cards = overlay.querySelectorAll('.ct-bento-card');
    const countEl = overlay.querySelector('#ct-selected-count');
    const updateCount = () => {
      const selected = overlay.querySelectorAll('.ct-bento-card.selected').length;
      countEl.textContent = selected;
    };

    cards.forEach((card) => {
      card.addEventListener('click', () => {
        card.classList.toggle('selected');
        updateCount();
      });
    });

    overlay.querySelector('#ct-btn-select-all').addEventListener('click', () => {
      cards.forEach((c) => c.classList.add('selected'));
      updateCount();
    });

    overlay.querySelector('#ct-btn-deselect-all').addEventListener('click', () => {
      cards.forEach((c) => c.classList.remove('selected'));
      updateCount();
    });

    const closeModal = () => overlay.remove();
    overlay.querySelector('#ct-modal-btn-close').addEventListener('click', closeModal);
    overlay.querySelector('#ct-modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    overlay.querySelector('#ct-modal-download').addEventListener('click', () => {
      const selectedCards = overlay.querySelectorAll('.ct-bento-card.selected');
      const includeVideoCheckbox = overlay.querySelector('#ct-modal-include-video');
      const shouldDownloadVideo = Boolean(
        includeVideoCheckbox && includeVideoCheckbox.checked && hasVideo
      );

      if (selectedCards.length === 0 && !shouldDownloadVideo) {
        showToast('Pilih minimal satu foto atau centang video!');
        return;
      }

      const selectedPhotos = Array.from(selectedCards).map((c) => ({
        url: c.getAttribute('data-url'),
        index: c.getAttribute('data-idx')
      }));

      const progressWrap = overlay.querySelector('#ct-modal-progress');
      const progressText = overlay.querySelector('#ct-progress-text');
      const progressPct = overlay.querySelector('#ct-progress-pct');
      const progressFill = overlay.querySelector('#ct-progress-fill');
      const downloadBtn = overlay.querySelector('#ct-modal-download');

      progressWrap.style.display = 'block';
      downloadBtn.disabled = true;

      if (shouldDownloadVideo) {
        downloadCosplayteleVideo(data.title, data.videoIframe, (vp) => {
          progressText.textContent = `Mengunduh video: ${vp.completed}/${vp.total} (${vp.percent}%)`;
          progressPct.textContent = `${vp.percent}%`;
          progressFill.style.width = `${vp.percent}%`;
        }).catch((err) => {
          console.error('[CosplayTele] Video download failed:', err);
          showToast(`Gagal mengunduh video: ${err.message}`);
        });
      }

      if (selectedPhotos.length === 0) {
        downloadBtn.disabled = false;
        setTimeout(closeModal, 1500);
        return;
      }

      const queue = new CosplayteleQueue({
        concurrency: 2,
        delayMs: 350,
        onProgress: (p) => {
          progressText.textContent = `Mengunduh (${p.completed}/${p.total})...`;
          progressPct.textContent = `${p.percent}%`;
          progressFill.style.width = `${p.percent}%`;
        },
        onAllComplete: (res) => {
          progressText.textContent = `Selesai (${res.completed} sukses)`;
          downloadBtn.disabled = false;
          showToast(`Berhasil mengunduh ${res.completed} foto!`);
          setTimeout(closeModal, 1200);
        }
      });

      selectedPhotos.forEach((p) => {
        const ext = getUrlExtension(p.url, 'webp');
        queue.add({
          url: p.url,
          task: () => dispatchDownload({ url: p.url, title: data.title, index: p.index, ext })
        });
      });

      queue.start();
    });
  }

  // =========================================================================
  // 7. Multi-Platform Popup IPC Listeners
  // =========================================================================

  function setupIpcListeners(data) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      const hasPhotos = Array.isArray(data.photos) && data.photos.length > 0;
      const hasVideo = Boolean(data.videoIframe);

      if (message.action === 'GET_ACTIVE_VIDEO_INFO') {
        sendResponse({
          platform: 'cosplaytele',
          found: hasPhotos || hasVideo,
          hasPhotos: hasPhotos,
          hasVideo: hasVideo,
          title: data.title,
          photoCount: data.photos ? data.photos.length : 0,
          photos: data.photos || [],
          videoIframe: data.videoIframe,
          mirrors: data.mirrors || []
        });
        return true;
      }

      if (message.action === 'DOWNLOAD_ACTIVE_VIDEO') {
        const target = message.target || 'all';
        if (target === 'video' && hasVideo) {
          downloadCosplayteleVideo(data.title, data.videoIframe).catch((err) => {
            console.error('[CosplayTele] Video download error:', err);
          });
          sendResponse({ success: true, message: 'Memulai unduhan video cosplaytele' });
          return true;
        }

        if (target === 'photos' && hasPhotos) {
          downloadPhotoBatch(data.title, data.photos);
          sendResponse({ success: true, message: 'Memulai unduhan batch foto cosplaytele' });
          return true;
        }

        // Default: download photos and video if available
        if (hasPhotos) {
          downloadPhotoBatch(data.title, data.photos);
        }
        if (hasVideo) {
          downloadCosplayteleVideo(data.title, data.videoIframe).catch((err) => {
            console.error('[CosplayTele] Video download error:', err);
          });
        }
        sendResponse({ success: true, message: 'Memulai unduhan cosplaytele' });
        return true;
      }

      return false;
    });
  }

  // =========================================================================
  // 8. Initialization Lifecycle
  // =========================================================================

  function init() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const data = extractCosplayteleData();
    console.log('[CosplayTele Downloader] Initialized. Photos found:', data.photos.length);
    renderFloatingBar(data);
    setupIpcListeners(data);
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // Export for testing in Node environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      sanitizeCosplayteleTitle,
      formatCosplayteleFilename,
      getUrlExtension,
      CosplayteleQueue,
      extractCosplayteleData,
      renderFloatingBar,
      openBatchModal,
      downloadPhotoBatch,
      downloadCosplayteleVideo
    };
  }
})();
