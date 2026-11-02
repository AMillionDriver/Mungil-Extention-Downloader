/**
 * Pinterest (pinterest.com / pin.it) Direct Downloader - Content Platform Script
 * Runs in ISOLATED world at document_idle.
 *
 * Capabilities:
 * 1. Automatic Pin ID identification and SPA route observation (/pin/:id/).
 * 2. Redux state extraction via #__PWS_DATA__ with multi-tier fallback (JSON-LD, OpenGraph, DOM).
 * 3. Lossless Image Resolution Escalator (elevates CDN paths to /originals/).
 * 4. Progressive MP4 Video Extraction (V_1080P, V_720P, V_480P) & HLS stream parsing.
 * 5. Carousel & Multi-page Idea/Story Pin extraction.
 * 6. Floating Action Bar (#mungil-pinterest-bar) & In-Page Closeup Download Button.
 * 7. Windows NTFS filename sanitization.
 * 8. Multi-platform Popup IPC handlers (GET_ACTIVE_VIDEO_INFO, DOWNLOAD_ACTIVE_VIDEO).
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (typeof window !== 'undefined') {
    if (window.__MUNGIL_PINTEREST_INITIALIZED__) return;
    window.__MUNGIL_PINTEREST_INITIALIZED__ = true;
  }

  const LOG_PREFIX = '[Pinterest Downloader]';

  // Standard SVG download icon
  const SVG_DOWNLOAD = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M17 18v1H7v-1h10zm-1-8l-4 4-4-4 1.4-1.4 1.6 1.6V4h2v6.2l1.6-1.6L16 10z"/>
    </svg>
  `;

  const SVG_CHECK = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>
  `;

  // =========================================================================
  // 1. Windows NTFS Filename Sanitization & Formatting
  // =========================================================================

  function sanitizePinterestTitle(title) {
    if (title === null || title === undefined) return 'Pin';
    let str = String(title).trim();
    if (!str) return 'Pin';

    str = str.replace(/&#8211;|&#8212;/g, '-');
    str = str.replace(/&#8220;|&#8221;|&quot;/g, '');
    str = str.replace(/&amp;/g, '&');
    str = str.replace(/&lt;/g, '<');
    str = str.replace(/&gt;/g, '>');

    str = str.replace(/[:：]/g, ' - ');
    str = str.replace(/[/\\|]/g, '-');
    str = str.replace(/[*?"<>|\x00-\x1f\x7f-\x9f]/g, '');
    str = str.replace(/\s+/g, ' ');
    str = str.replace(/-{2,}/g, '-');
    str = str.replace(/\s*-\s*/g, ' - ');
    str = str.replace(/^[.\s_-]+|[.\s_-]+$/g, '');
    str = str.slice(0, 120).trim();
    str = str.replace(/[.\s_-]+$/, '');

    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
    if (reserved.test(str)) {
      str = `Pin_${str}`;
    }

    return str || 'Pin';
  }

  function sanitizePinterestAuthor(author) {
    if (author === null || author === undefined) return 'pinner';
    let str = String(author).trim();
    if (!str) return 'pinner';

    str = str.replace(/^[@.\s]+/, '');
    str = str.replace(/[/\\:*?"<>|\x00-\x1f\x7f-\x9f]/g, '_');
    str = str.replace(/\s+/g, '_');
    str = str.replace(/[.\s_]+$/, '');
    str = str.slice(0, 50);

    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
    if (reserved.test(str)) {
      str = `user_${str}`;
    }

    return str || 'pinner';
  }

  function formatPinterestFilename(params = {}) {
    const p = params && typeof params === 'object' ? params : {};
    const safeAuthor = sanitizePinterestAuthor(p.author);
    const safeTitle = sanitizePinterestTitle(p.title);
    const safeId = p.pinId ? String(p.pinId).replace(/[^0-9a-zA-Z_-]/g, '') : '';
    const idx =
      p.index !== undefined && p.index !== null ? `_slide${String(p.index).padStart(2, '0')}` : '';
    const ext = p.ext ? String(p.ext).replace(/^\./, '') : 'jpg';

    const idSuffix = safeId ? ` (${safeId})` : '';
    return `[Pinterest] ${safeAuthor} - ${safeTitle}${idSuffix}${idx}.${ext}`;
  }

  // =========================================================================
  // 2. Pinterest ID & URL Identification
  // =========================================================================

  function getActivePinId() {
    const path = window.location.pathname || '';
    const match = path.match(/\/pin\/(\d+)/i);
    if (match && match[1]) {
      return match[1];
    }
    const searchParams = new URLSearchParams(window.location.search);
    const pinParam = searchParams.get('pin');
    if (pinParam && /^\d+$/.test(pinParam)) {
      return pinParam;
    }
    return null;
  }

  function elevateToOriginalImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    return url.replace(/\/(?:170x|236x|474x|564x|736x)\//, '/originals/');
  }

  // =========================================================================
  // 3. Multi-tier Metadata & Media Extraction
  // =========================================================================

  function extractPwsPinData(pinId) {
    if (!pinId) return null;
    try {
      const script = document.getElementById('__PWS_DATA__');
      if (!script || !script.textContent) return null;
      const data = JSON.parse(script.textContent);

      const pins = data?.props?.initialReduxState?.pins;
      if (pins && pins[pinId]) {
        return pins[pinId];
      }
      if (pins) {
        const found = Object.values(pins).find((p) => p && String(p.id) === String(pinId));
        if (found) return found;
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} Failed to parse #__PWS_DATA__:`, e);
    }
    return null;
  }

  function extractJsonLdData() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        if (!s.textContent) continue;
        const json = JSON.parse(s.textContent);
        if (
          json['@type'] === 'SocialMediaPosting' ||
          json['@type'] === 'VideoObject' ||
          json['@type'] === 'ImageObject'
        ) {
          return json;
        }
      }
    } catch (_) {}
    return null;
  }

  function extractActivePinMetadata() {
    const pinId = getActivePinId();
    const pwsData = pinId ? extractPwsPinData(pinId) : null;
    const jsonLd = extractJsonLdData();

    let title =
      pwsData?.title ||
      pwsData?.grid_title ||
      pwsData?.rich_metadata?.title ||
      jsonLd?.headline ||
      jsonLd?.name ||
      '';

    if (!title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) title = ogTitle.getAttribute('content') || '';
    }
    if (!title) {
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent) title = h1.textContent.trim();
    }
    if (!title) title = document.title || 'Pinterest Pin';

    // Author / Pinner
    let author =
      pwsData?.pinner?.username || pwsData?.pinner?.full_name || jsonLd?.author?.name || '';

    if (!author) {
      const authorMeta = document.querySelector(
        'meta[name="author"], meta[property="article:author"]'
      );
      if (authorMeta) author = authorMeta.getAttribute('content') || '';
    }
    if (!author) {
      const pinnerLink = document.querySelector(
        '[data-test-id="creator-profile-name"] a, [data-test-id="official-user-attribution"]'
      );
      if (pinnerLink && pinnerLink.textContent) author = pinnerLink.textContent.trim();
    }
    if (!author) author = 'pinner';

    // Media classification
    let mediaType = 'image';
    let videoUrl = null;
    let videoQuality = null;
    let originalImageUrl = null;
    const slides = [];

    // 1. Check for Video in PWS
    const videoList = pwsData?.videos?.video_list;
    if (videoList && typeof videoList === 'object') {
      mediaType = 'video';
      const qualities = ['V_1080P', 'V_720P', 'V_EXP7', 'V_480P', 'V_360P'];
      for (const q of qualities) {
        if (videoList[q] && videoList[q].url) {
          videoUrl = videoList[q].url;
          videoQuality = q.replace('V_', '');
          break;
        }
      }
      if (!videoUrl && videoList.V_HLSV4 && videoList.V_HLSV4.url) {
        videoUrl = videoList.V_HLSV4.url;
        videoQuality = 'HLS';
      }
    }

    // 2. Check for Video in DOM or Meta if not found yet
    if (!videoUrl) {
      const ogVideo = document.querySelector(
        'meta[property="og:video"], meta[property="og:video:secure_url"]'
      );
      if (ogVideo) {
        const vSrc = ogVideo.getAttribute('content');
        if (vSrc && (vSrc.includes('.mp4') || vSrc.includes('.m3u8'))) {
          videoUrl = vSrc;
          mediaType = 'video';
          videoQuality = '720p';
        }
      }
    }

    if (!videoUrl) {
      const videoEl = document.querySelector(
        'div[data-test-id="closeup"] video, video.html5-main-video, [data-test-id="pin-closeup-container"] video'
      );
      if (videoEl && videoEl.src && !videoEl.src.startsWith('blob:')) {
        videoUrl = videoEl.src;
        mediaType = 'video';
        videoQuality = 'Direct';
      }
    }

    // 3. Carousel / Story Pin multi-page extraction
    const storyPages = pwsData?.story_pin_data?.pages;
    if (Array.isArray(storyPages) && storyPages.length > 1) {
      mediaType = 'carousel';
      storyPages.forEach((page, i) => {
        let slideUrl = null;
        let slideType = 'image';
        if (page?.blocks && Array.isArray(page.blocks)) {
          for (const b of page.blocks) {
            if (b.video && b.video.video_list) {
              slideType = 'video';
              const vList = b.video.video_list;
              slideUrl =
                vList.V_720P?.url ||
                vList.V_1080P?.url ||
                vList.V_480P?.url ||
                vList.V_HLSV4?.url ||
                null;
              break;
            } else if (b.image && b.image.images) {
              slideUrl =
                b.image.images.originals?.url ||
                elevateToOriginalImageUrl(b.image.images['736x']?.url);
              break;
            }
          }
        }
        if (slideUrl) {
          slides.push({ index: i + 1, url: slideUrl, type: slideType });
        }
      });
    }

    // 4. Original Image Extraction
    if (pwsData?.images) {
      originalImageUrl =
        pwsData.images.orig?.url ||
        pwsData.images.originals?.url ||
        elevateToOriginalImageUrl(pwsData.images['736x']?.url);
    }

    if (!originalImageUrl) {
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) {
        originalImageUrl = elevateToOriginalImageUrl(ogImg.getAttribute('content'));
      }
    }

    if (!originalImageUrl) {
      const imgEl = document.querySelector(
        'div[data-test-id="closeup"] img, [data-test-id="pin-closeup-image"] img, [data-test-id="pin-closeup-container"] img'
      );
      if (imgEl && imgEl.src) {
        originalImageUrl = elevateToOriginalImageUrl(imgEl.src);
      }
    }

    return {
      pinId: pinId || 'unknown',
      title: title.trim(),
      author: author.trim(),
      mediaType,
      videoUrl,
      videoQuality,
      originalImageUrl,
      slides,
      isCarousel: slides.length > 1
    };
  }

  // =========================================================================
  // 4. In-Page UI Injection & Floating Bar
  // =========================================================================

  let floatingBarEl = null;
  let debounceScanTimer = null;

  function renderFloatingBar(metadata) {
    if (
      !metadata ||
      (!metadata.videoUrl && !metadata.originalImageUrl && metadata.slides.length === 0)
    ) {
      if (floatingBarEl) floatingBarEl.remove();
      floatingBarEl = null;
      return;
    }

    if (!floatingBarEl) {
      floatingBarEl = document.createElement('div');
      floatingBarEl.id = 'mungil-pinterest-bar';
      document.body.appendChild(floatingBarEl);
    }

    const isVideo = metadata.mediaType === 'video' && Boolean(metadata.videoUrl);
    const isCarousel = metadata.mediaType === 'carousel' && metadata.slides.length > 1;

    let badgeText = 'FOTO HD';
    let btnText = 'Unduh Gambar (HD)';
    if (isVideo) {
      badgeText = `VIDEO ${metadata.videoQuality || 'MP4'}`;
      btnText = 'Unduh Video (.mp4)';
    } else if (isCarousel) {
      badgeText = `CAROUSEL (${metadata.slides.length})`;
      btnText = `Unduh Semua (${metadata.slides.length})`;
    }

    floatingBarEl.innerHTML = `
      <div class="mungil-pt-content">
        <div class="mungil-pt-info">
          <span class="mungil-pt-badge">${badgeText}</span>
          <span class="mungil-pt-title" title="${metadata.title.replace(/"/g, '&quot;')}">${metadata.title}</span>
        </div>
        <div class="mungil-pt-actions">
          <button type="button" class="mungil-pt-btn mungil-pt-btn-primary" id="mungil-pt-download-btn">
            ${SVG_DOWNLOAD}
            <span>${btnText}</span>
          </button>
        </div>
      </div>
    `;

    const downloadBtn = floatingBarEl.querySelector('#mungil-pt-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        executeDownloadFromMetadata(metadata, downloadBtn);
      });
    }
  }

  function executeDownloadFromMetadata(metadata, btnEl) {
    if (!metadata) return;

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = `
        <span class="mungil-pt-spinner"></span>
        <span>Mengunduh...</span>
      `;
    }

    if (metadata.mediaType === 'carousel' && metadata.slides.length > 0) {
      // Sequential download for slides
      let completed = 0;
      metadata.slides.forEach((slide, idx) => {
        const ext = slide.type === 'video' ? 'mp4' : 'jpg';
        const filename = formatPinterestFilename({
          author: metadata.author,
          title: metadata.title,
          pinId: metadata.pinId,
          index: idx + 1,
          ext
        });

        chrome.runtime.sendMessage({ action: 'DOWNLOAD_VIDEO', url: slide.url, filename }, () => {
          completed += 1;
          if (completed === metadata.slides.length && btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = `${SVG_CHECK} <span>Selesai!</span>`;
            setTimeout(() => {
              if (btnEl) {
                btnEl.innerHTML = `${SVG_DOWNLOAD} <span>Unduh Semua (${metadata.slides.length})</span>`;
              }
            }, 3000);
          }
        });
      });
      return;
    }

    const downloadUrl = metadata.videoUrl || metadata.originalImageUrl;
    if (!downloadUrl) {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = 'Gagal';
      }
      return;
    }

    const ext = metadata.videoUrl ? 'mp4' : 'jpg';
    const filename = formatPinterestFilename({
      author: metadata.author,
      title: metadata.title,
      pinId: metadata.pinId,
      ext
    });

    chrome.runtime.sendMessage({ action: 'DOWNLOAD_VIDEO', url: downloadUrl, filename }, (res) => {
      if (btnEl) {
        btnEl.disabled = false;
        if (res && res.success) {
          btnEl.innerHTML = `${SVG_CHECK} <span>Tersimpan!</span>`;
        } else {
          btnEl.innerHTML = `${SVG_DOWNLOAD} <span>Coba Lagi</span>`;
        }
        setTimeout(() => {
          if (btnEl) {
            const label = metadata.videoUrl ? 'Unduh Video (.mp4)' : 'Unduh Gambar (HD)';
            btnEl.innerHTML = `${SVG_DOWNLOAD} <span>${label}</span>`;
          }
        }, 3000);
      }
    });
  }

  function scanAndInjectUI() {
    const pinId = getActivePinId();
    if (!pinId) {
      if (floatingBarEl) {
        floatingBarEl.remove();
        floatingBarEl = null;
      }
      return;
    }

    const metadata = extractActivePinMetadata();
    renderFloatingBar(metadata);
  }

  function scheduleScan(delay = 300) {
    if (debounceScanTimer) clearTimeout(debounceScanTimer);
    debounceScanTimer = setTimeout(scanAndInjectUI, delay);
  }

  // =========================================================================
  // 5. Lifecycle Observers & Route Watchers
  // =========================================================================

  function initObserver() {
    if (
      typeof window === 'undefined' ||
      typeof document === 'undefined' ||
      typeof MutationObserver === 'undefined'
    ) {
      return;
    }

    let lastUrl = window.location.href;
    const bodyObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        scheduleScan(250);
      }
    });

    if (document.body) {
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('popstate', () => scheduleScan(200));
      window.addEventListener('load', () => scheduleScan(300));
    }
    scheduleScan(400);
  }

  // =========================================================================
  // 6. Multi-Platform Popup IPC Handlers
  // =========================================================================

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== 'object') return false;

      if (message.action === 'GET_ACTIVE_VIDEO_INFO') {
        const meta = extractActivePinMetadata();
        if (meta && (meta.videoUrl || meta.originalImageUrl || meta.slides.length > 0)) {
          sendResponse({
            success: true,
            platform: 'pinterest',
            pinId: meta.pinId,
            title: meta.title,
            author: meta.author,
            mediaType: meta.mediaType,
            videoUrl: meta.videoUrl,
            videoQuality: meta.videoQuality,
            originalImageUrl: meta.originalImageUrl,
            slidesCount: meta.slides.length
          });
        } else {
          sendResponse({
            success: false,
            platform: 'pinterest',
            error: 'No active pin found'
          });
        }
        return true;
      }

      if (message.action === 'DOWNLOAD_ACTIVE_VIDEO') {
        const meta = extractActivePinMetadata();
        if (!meta || (!meta.videoUrl && !meta.originalImageUrl && meta.slides.length === 0)) {
          sendResponse({ success: false, error: 'No media available for active pin' });
          return true;
        }

        executeDownloadFromMetadata(meta, null);
        sendResponse({ success: true, platform: 'pinterest' });
        return true;
      }

      return false;
    });
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initObserver);
    } else {
      initObserver();
    }
  }

  // Export for Node.js unit tests
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      sanitizePinterestTitle,
      sanitizePinterestAuthor,
      formatPinterestFilename,
      getActivePinId,
      elevateToOriginalImageUrl,
      extractPwsPinData,
      extractActivePinMetadata,
      renderFloatingBar
    };
  }
})();
