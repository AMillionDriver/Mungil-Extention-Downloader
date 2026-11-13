/**
 * TikTok Direct Downloader - Facebook Reels Platform Controller
 *
 * Runs in the ISOLATED world sandbox.
 * Detects Facebook Reel viewports (/reel/<id>) and Profile Reels tabs (/reels/ or ?sk=reels_tab).
 * Injects circular action button into Reel rail and batch modal for profile grids.
 */

(function () {
  'use strict';

  // SVG Icons conforming to Meta design guidelines
  const FB_ICONS = {
    download: `<svg viewBox="0 0 24 24"><path d="M12 15.5l-5-5h3V3h4v7.5h3l-5 5zM4 19h16v2H4v-2z"/></svg>`,
    loading: `<svg viewBox="0 0 24 24"><path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8zm0 16c4.41 0 8-3.59 8-8h2c0 5.52-4.48 10-10 10v-2z"/></svg>`,
    success: `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    error: `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`
  };

  /**
   * Cross-platform Windows NTFS filename sanitizer
   */
  function sanitizeWindowsFilename(name) {
    if (!name || typeof name !== 'string') return 'facebook_reel';
    return name
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[._ ]+$/, '')
      .slice(0, 100);
  }

  function getReelIdFromUrl(url = window.location.href) {
    const match = url.match(/\/reel\/(\d+)/i) || url.match(/\/videos\/(\d+)/i);
    return match ? match[1] : null;
  }

  function getAuthorFromDom() {
    // Look for heading or user link near author avatar
    const authorElem =
      document.querySelector('h2 a') ||
      document.querySelector('h3 a') ||
      document.querySelector('strong a') ||
      document.querySelector('a[role="link"][tabindex="0"]');
    if (authorElem && authorElem.textContent) {
      return authorElem.textContent.trim();
    }
    return 'facebook_creator';
  }

  function getCaptionFromDom() {
    // Look for caption span / container near author
    const captionElem =
      document.querySelector('div[data-ad-preview="message"]') ||
      document.querySelector('span[dir="auto"]');
    if (captionElem && captionElem.textContent) {
      const text = captionElem.textContent.trim();
      if (text.length > 5 && !text.includes('Ikuti') && !text.includes('Follow')) {
        return text.split('\n')[0].slice(0, 60);
      }
    }
    return 'Facebook_Reel';
  }

  /**
   * Request direct stream resolution via MAIN world bridge
   */
  function requestStreamFromBridge(reelId) {
    return new Promise((resolve) => {
      let isResolved = false;
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          window.removeEventListener('message', handleResponse);
          // Fallback to in-DOM video tag
          const vid = document.querySelector('video');
          if (vid && vid.src && vid.src.includes('fbcdn.net')) {
            resolve({ streamUrl: vid.src, quality: 'HD' });
          } else {
            resolve({ streamUrl: null, quality: 'HD' });
          }
        }
      }, 3500);

      function handleResponse(event) {
        if (event.source !== window || !event.data) return;
        if (
          event.data.type === 'MUNGIL_FB_STREAM_RESPONSE' ||
          event.data.type === 'MUNGIL_FB_STREAM_CAPTURED'
        ) {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            window.removeEventListener('message', handleResponse);
            resolve({
              streamUrl: event.data.streamUrl,
              quality: event.data.quality || 'HD'
            });
          }
        }
      }

      window.addEventListener('message', handleResponse);
      window.postMessage({ type: 'MUNGIL_FB_REQUEST_STREAM', reelId }, '*');
    });
  }

  function setButtonState(btn, state, customLabel) {
    if (!btn) return;
    const iconBox = btn.querySelector('.mungil-fb-btn-icon');
    const label = btn.parentElement ? btn.parentElement.querySelector('.mungil-fb-dl-label') : null;

    btn.classList.remove('is-loading', 'is-success', 'is-error');
    btn.disabled = false;

    if (state === 'loading') {
      btn.classList.add('is-loading');
      btn.disabled = true;
      if (iconBox) iconBox.innerHTML = FB_ICONS.loading;
      if (label) label.textContent = customLabel || 'Mengunduh...';
    } else if (state === 'success') {
      btn.classList.add('is-success');
      btn.disabled = true;
      if (iconBox) iconBox.innerHTML = FB_ICONS.success;
      if (label) label.textContent = customLabel || 'Tersimpan!';
      setTimeout(() => setButtonState(btn, 'idle'), 3000);
    } else if (state === 'error') {
      btn.classList.add('is-error');
      if (iconBox) iconBox.innerHTML = FB_ICONS.error;
      if (label) label.textContent = customLabel || 'Gagal';
      setTimeout(() => setButtonState(btn, 'idle'), 3500);
    } else {
      if (iconBox) iconBox.innerHTML = FB_ICONS.download;
      if (label) label.textContent = 'Unduh';
    }
  }

  /**
   * Injects download button into single Reel action rail (Screenshots 1 & 2)
   */
  function injectSingleReelButton() {
    const reelId = getReelIdFromUrl();
    if (!reelId) return;

    // Locate the Share button or right-hand action column
    // Semantic selectors matching Indonesian, English, and general Meta locales
    const shareBtn =
      document.querySelector('[aria-label="Bagikan"]') ||
      document.querySelector('[aria-label="Share"]') ||
      document.querySelector('[aria-label="Bagikan sekarang"]') ||
      document.querySelector('[aria-label="Compartir"]');

    if (!shareBtn) return;

    // Find parent container in rail
    const actionContainer = shareBtn.closest('div[role="complementary"]') || shareBtn.parentElement;
    if (!actionContainer) return;

    // Check if button already injected
    if (actionContainer.querySelector('.mungil-fb-action-btn-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'mungil-fb-action-btn-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mungil-fb-dl-btn';
    btn.title = 'Unduh Reel Facebook (Turbo Chunker)';
    btn.setAttribute('data-reel-id', reelId);

    const iconBox = document.createElement('div');
    iconBox.className = 'mungil-fb-btn-icon';
    iconBox.innerHTML = FB_ICONS.download;
    btn.appendChild(iconBox);

    const label = document.createElement('span');
    label.className = 'mungil-fb-dl-label';
    label.textContent = 'Unduh';

    wrap.appendChild(btn);
    wrap.appendChild(label);

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      setButtonState(btn, 'loading', 'Memeriksa...');
      const streamRes = await requestStreamFromBridge(reelId);

      const author = sanitizeWindowsFilename(getAuthorFromDom());
      const caption = sanitizeWindowsFilename(getCaptionFromDom());
      const filename = `facebook_${author}_${reelId}_${caption}.mp4`;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            action: 'DOWNLOAD_FACEBOOK_NATIVE',
            url: streamRes?.streamUrl || null,
            reelId,
            filename,
            title: `${author} - Reel ${reelId}`,
            author,
            quality: streamRes?.quality || 'HD',
            pageUrl: window.location.href
          },
          (res) => {
            if (res && res.success) {
              setButtonState(btn, 'success', 'Tersimpan!');
            } else {
              setButtonState(btn, 'error', res?.error || 'Gagal');
            }
          }
        );
      }
    });

    // Inject immediately adjacent to Share button's parent element
    if (shareBtn.parentElement && shareBtn.parentElement.parentElement) {
      shareBtn.parentElement.parentElement.insertBefore(wrap, shareBtn.parentElement.nextSibling);
    } else {
      actionContainer.appendChild(wrap);
    }
  }

  /**
   * Scans Profile Reels Grid and injects batch button & hover buttons (Screenshot 3)
   */
  function injectProfileGridFeatures() {
    const isProfileReels =
      window.location.href.includes('sk=reels_tab') ||
      window.location.href.includes('/reels/') ||
      window.location.pathname.endsWith('/reels');

    if (!isProfileReels) return;

    // 1. Header Batch Download Button
    const headerAnchor =
      document.querySelector('h1') ||
      document.querySelector('h2') ||
      document.querySelector('[role="main"] h3');

    if (headerAnchor && !document.querySelector('.mungil-fb-profile-batch-btn')) {
      const batchBtn = document.createElement('button');
      batchBtn.type = 'button';
      batchBtn.className = 'mungil-fb-profile-batch-btn';
      batchBtn.innerHTML = `📥 Unduh Semua Reels di Profil Ini`;
      batchBtn.addEventListener('click', openProfileBatchModal);
      headerAnchor.parentElement.appendChild(batchBtn);
    }

    // 2. Card Hover Buttons
    const reelLinks = document.querySelectorAll('a[href*="/reel/"]');
    reelLinks.forEach((link) => {
      if (link.querySelector('.mungil-fb-card-hover-btn')) return;
      const cardReelId = getReelIdFromUrl(link.href);
      if (!cardReelId) return;

      const hoverBtn = document.createElement('button');
      hoverBtn.type = 'button';
      hoverBtn.className = 'mungil-fb-card-hover-btn';
      hoverBtn.title = 'Unduh Reel ini langsung';
      hoverBtn.innerHTML = FB_ICONS.download;

      hoverBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hoverBtn.innerHTML = FB_ICONS.loading;

        const author = sanitizeWindowsFilename(getAuthorFromDom());
        const filename = `facebook_${author}_${cardReelId}.mp4`;

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage(
            {
              action: 'DOWNLOAD_FACEBOOK_NATIVE',
              reelId: cardReelId,
              filename,
              title: `${author} - Reel ${cardReelId}`,
              author,
              pageUrl: link.href
            },
            (res) => {
              if (res && res.success) {
                hoverBtn.innerHTML = FB_ICONS.success;
                setTimeout(() => (hoverBtn.innerHTML = FB_ICONS.download), 2500);
              } else {
                hoverBtn.innerHTML = FB_ICONS.error;
                setTimeout(() => (hoverBtn.innerHTML = FB_ICONS.download), 3000);
              }
            }
          );
        }
      });

      link.style.position = 'relative';
      link.appendChild(hoverBtn);
    });
  }

  function openProfileBatchModal() {
    const existing = document.querySelector('.mungil-fb-modal-backdrop');
    if (existing) existing.remove();

    const reelLinks = Array.from(document.querySelectorAll('a[href*="/reel/"]'));
    const uniqueReels = [];
    const seen = new Set();

    reelLinks.forEach((a) => {
      const id = getReelIdFromUrl(a.href);
      if (id && !seen.has(id)) {
        seen.add(id);
        const text = a.textContent ? a.textContent.trim().slice(0, 45) : `Reel ${id}`;
        uniqueReels.push({ id, url: a.href, title: text });
      }
    });

    const backdrop = document.createElement('div');
    backdrop.className = 'mungil-fb-modal-backdrop';

    const box = document.createElement('div');
    box.className = 'mungil-fb-modal-box';

    box.innerHTML = `
      <div class="mungil-fb-modal-header">
        <div class="mungil-fb-modal-title">📥 Unduh Batch Reels (${uniqueReels.length} ditemukan)</div>
        <button type="button" class="mungil-fb-modal-close">&times;</button>
      </div>
      <div class="mungil-fb-modal-body">
        ${uniqueReels
          .map(
            (r, idx) => `
          <label class="mungil-fb-modal-item">
            <input type="checkbox" class="mungil-fb-item-check" data-id="${r.id}" data-url="${r.url}" checked />
            <span style="font-weight: 600;">#${idx + 1}</span>
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.title}</span>
            <span style="font-size:11px; opacity:0.6;">${r.id}</span>
          </label>
        `
          )
          .join('')}
      </div>
      <div class="mungil-fb-modal-footer">
        <span style="font-size:12px; opacity:0.8;">Antrean paralel Concurrency 2 (Turbo Chunker)</span>
        <button type="button" class="mungil-fb-profile-batch-btn mungil-fb-start-batch-btn">
          Mulai Unduh Terpilih
        </button>
      </div>
    `;

    backdrop.appendChild(box);
    document.body.appendChild(backdrop);

    box.querySelector('.mungil-fb-modal-close').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    box.querySelector('.mungil-fb-start-batch-btn').addEventListener('click', async () => {
      const selected = Array.from(box.querySelectorAll('.mungil-fb-item-check:checked')).map(
        (chk) => ({
          reelId: chk.getAttribute('data-id'),
          url: chk.getAttribute('data-url'),
          author: sanitizeWindowsFilename(getAuthorFromDom())
        })
      );

      if (selected.length === 0) return;

      const startBtn = box.querySelector('.mungil-fb-start-batch-btn');
      startBtn.disabled = true;
      startBtn.textContent = `Memproses (${selected.length})...`;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            action: 'DOWNLOAD_FACEBOOK_BATCH',
            items: selected
          },
          (res) => {
            if (res && res.success) {
              startBtn.textContent = 'Batch Dimulai!';
              setTimeout(() => backdrop.remove(), 1200);
            }
          }
        );
      }
    });
  }

  // 250ms debouncer observer
  let debounceTimer = null;
  function scanAndInject() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      injectSingleReelButton();
      injectProfileGridFeatures();
    }, 250);
  }

  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const observer = new MutationObserver(scanAndInject);
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      scanAndInject();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
        scanAndInject();
      });
    }
  }

  // Export for Unit Testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      FB_ICONS,
      sanitizeWindowsFilename,
      getReelIdFromUrl,
      injectSingleReelButton,
      setButtonState
    };
  }
})();
