/**
 * TikTok Direct Downloader - Content Script (ISOLATED World)
 * Injected on *://*.tiktok.com/*
 * 
 * Responsibilities:
 * 1. 250ms debounced MutationObserver scanning FYP feed, photo slideshows, and modal video cards.
 * 2. Multi-strategy injection: Action-bar docking + In-Player Floating Overlay Button (Fullscreen compatible).
 * 3. Duplicate injection prevention using data-tt-dl-ready="true" and self-healing cleanup.
 * 4. Circular native-styled action button injection matching TikTok UI.
 * 5. 4-state visual lifecycle: Idle -> Loading -> Success (2.5s) / Error (3.0s) -> Idle.
 * 6. Multi-tier stream extraction cascade:
 *    - Tier 1: Query MAIN-world bridge (1500ms timeout)
 *    - Tier 2: HTML5 <video> currentSrc & DOM photo/regex fallback
 * 7. Active tab listener for popup toolbar and context-menu 1-click downloads.
 * 8. IPC dispatch to background service worker via DOWNLOAD_VIDEO.
 */

(function () {
  'use strict';

  // Robust DOM Selector Configuration
  const SELECTORS = {
    // Video Card Containers (Feed, Photos, Search & Modal)
    videoCards: [
      '[data-e2e="recommend-list-item-container"]',
      '[data-e2e="feed-video"]',
      '[data-e2e="feed-photo"]',
      '[data-e2e*="feed-item"]',
      '[data-e2e*="video-item"]',
      '[data-e2e="browse-video"]',
      'div[class*="DivItemContainer"]',
      'div[class*="DivVideoDetailContainer"]',
      'div[class*="DivBrowserModeContainer"]',
      'div[class*="DivVideoWrapper"]',
      'div[class*="PhotoContainer"]',
      'div[class*="SlideItem"]',
      'div[role="dialog"] div[class*="DivVideoContainer"]',
      'article[class*="DivItemContainer"]',
      'article'
    ].join(','),

    // Action Bar / Action Item Containers
    actionBars: [
      '[data-e2e="feed-action-item"]',
      'div[class*="DivActionItemContainer"]',
      'div[class*="DivFlexCenterRow-StyledWrapper"]',
      'div[class*="DivActionBarWrapper"]',
      'section[class*="DivActionItemContainer"]',
      '[data-e2e="browse-action-item"]',
      'div[class*="DivVideoActionContainer"]',
      'div[class*="ActionBar"]'
    ].join(','),

    // Sibling Action Anchors (Used to locate parent container directly)
    actionAnchors: [
      '[data-e2e*="share"]',
      'button[aria-label*="Share" i]',
      'button[aria-label*="Bagikan" i]'
    ].join(','),

    // Specific Share Button Selectors (Single Injection Anchor directly above Share)
    shareButtons: [
      '[data-e2e="feed-share-icon"]',
      '[data-e2e*="share-icon"]',
      '[data-e2e*="share"]',
      'button[aria-label*="Share" i]',
      'button[aria-label*="Bagikan" i]'
    ].join(',')
  };

  // High-contrast SVG iconography matching TikTok web aesthetic
  const ICONS = {
    download: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v11m0 0l-4-4m4 4l4-4" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
    `.trim(),

    loading: `
      <svg class="tt-dl-spinner" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" stroke-opacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
    `.trim(),

    success: `
      <svg viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    `.trim(),

    error: `
      <svg viewBox="0 0 24 24" fill="none" stroke="#FE2C55" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    `.trim()
  };

  /**
   * Updates button visual state and manages duration timers.
   *
   * @param {HTMLButtonElement} btn
   * @param {'idle' | 'loading' | 'success' | 'error'} state
   * @param {string} [customLabel]
   */
  function setButtonState(btn, state, customLabel) {
    if (!btn) return;

    // Clear active timeout
    if (btn._stateTimeout) {
      clearTimeout(btn._stateTimeout);
      btn._stateTimeout = null;
    }

    btn.classList.remove(
      'tt-dl-state-idle',
      'tt-dl-state-loading',
      'tt-dl-state-success',
      'tt-dl-state-error'
    );
    btn.classList.add(`tt-dl-state-${state}`);
    btn.setAttribute('data-state', state);

    const iconBox = btn.querySelector('.tt-dl-icon-box') || btn.querySelector('.tt-dl-fab-icon');
    const labelEl = btn.parentElement ? btn.parentElement.querySelector('.tt-dl-label') : null;
    const fabText = btn.querySelector('.tt-dl-fab-text');

    switch (state) {
      case 'loading':
        btn.disabled = true;
        if (iconBox) iconBox.innerHTML = ICONS.loading;
        if (labelEl) labelEl.textContent = customLabel || 'Fetching...';
        if (fabText) fabText.textContent = customLabel || 'Unduh...';
        break;

      case 'success':
        btn.disabled = true;
        if (iconBox) iconBox.innerHTML = ICONS.success;
        if (labelEl) labelEl.textContent = customLabel || 'Saved!';
        if (fabText) fabText.textContent = 'Tersimpan!';
        // Revert to idle after 2.5 seconds
        btn._stateTimeout = setTimeout(() => {
          setButtonState(btn, 'idle');
        }, 2500);
        break;

      case 'error':
        btn.disabled = false;
        if (iconBox) iconBox.innerHTML = ICONS.error;
        if (labelEl) labelEl.textContent = customLabel || 'Failed';
        if (fabText) fabText.textContent = customLabel || 'Gagal';
        // Revert to idle after 3.0 seconds
        btn._stateTimeout = setTimeout(() => {
          setButtonState(btn, 'idle');
        }, 3000);
        break;

      case 'idle':
      default:
        btn.disabled = false;
        if (iconBox) iconBox.innerHTML = ICONS.download;
        if (labelEl) labelEl.textContent = 'Download';
        if (fabText) fabText.textContent = 'Unduh';
        break;
    }
  }

  /**
   * Parses author username and videoId from DOM elements or current URL.
   *
   * @param {HTMLElement} container
   * @returns {{ author: string, videoId: string, url: string }}
   */
  function parseDomVideoInfo(container) {
    let author = 'unknown';
    let videoId = '';
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

    // 1. Check window location pathname: /@username/video/1234567890 or /@username/photo/1234567890
    if (typeof window !== 'undefined' && window.location.pathname) {
      const urlMatch = window.location.pathname.match(/@([^/?#]+)\/(?:video|photo)\/(\d+)/);
      if (urlMatch) {
        author = urlMatch[1];
        videoId = urlMatch[2];
      }
    }

    if (container) {
      // 2. Check author elements first
      if (author === 'unknown') {
        const authorEl = container.querySelector(
          '[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"], a[data-e2e="video-author-avatar"], [data-e2e*="author-uniqueid"]'
        );
        if (authorEl) {
          const rawText = authorEl.textContent || authorEl.getAttribute('href') || '';
          const match = rawText.match(/@?([a-zA-Z0-9_.-]+)/);
          if (match && match[1] && match[1] !== 'video' && match[1] !== 'photo') {
            author = match[1];
          }
        }
      }

      // 3. Fallback author check via anchor links
      if (author === 'unknown') {
        const authorLink = container.querySelector('a[href*="/@"]');
        if (authorLink && authorLink.href) {
          const match = authorLink.href.match(/@([a-zA-Z0-9_.-]+)/);
          if (match && match[1]) author = match[1];
        }
      }

      // 4. Check container anchor links for videoId
      if (!videoId) {
        const postLink = container.querySelector('a[href*="/video/"], a[href*="/photo/"]');
        if (postLink && postLink.href) {
          const linkMatch = postLink.href.match(/@([^/?#]+)\/(?:video|photo)\/(\d+)/);
          if (linkMatch) {
            if (author === 'unknown') author = linkMatch[1];
            videoId = linkMatch[2];
          } else {
            const idOnly = postLink.href.match(/(?:video|photo)\/(\d+)/);
            if (idOnly) videoId = idOnly[1];
          }
        }
      }

      // 5. Check video element attributes (id, data-id) or xgwrapper IDs
      if (!videoId) {
        const videoEl = container.querySelector('video');
        if (videoEl) {
          const vId = videoEl.getAttribute('data-id') || videoEl.getAttribute('id') || '';
          const idMatch = vId.match(/(\d{15,22})/);
          if (idMatch) videoId = idMatch[1];
        }
      }

      // 6. Deep search in container id or data attributes for 19-digit snowflake ID
      if (!videoId) {
        const wrapperWithId = container.querySelector('[id*="xgwrapper"], [id*="player"], [data-id]');
        if (wrapperWithId) {
          const idAttr = wrapperWithId.getAttribute('id') || wrapperWithId.getAttribute('data-id') || '';
          const idMatch = idAttr.match(/(\d{15,22})/);
          if (idMatch) videoId = idMatch[1];
        }
      }
    }

    if (!videoId) {
      videoId = String(Date.now());
    }

    return { author, videoId, url: currentUrl };
  }

  /**
   * Queries MAIN-world bridge script for video metadata via CustomEvent.
   *
   * @param {string} videoId
   * @param {string} url
   * @param {string} [author]
   * @param {number} [timeoutMs=2000]
   * @returns {Promise<object|null>}
   */
  function queryBridge(videoId, url, author, timeoutMs = 2000) {
    return new Promise((resolve) => {
      if (typeof document === 'undefined') return resolve(null);

      const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      let timer = null;

      function onResponse(event) {
        const detail = event.detail || {};
        if (detail.requestId === requestId) {
          if (timer) clearTimeout(timer);
          document.removeEventListener('TT_BRIDGE_RESPONSE', onResponse);
          resolve(detail);
        }
      }

      timer = setTimeout(() => {
        document.removeEventListener('TT_BRIDGE_RESPONSE', onResponse);
        resolve(null);
      }, timeoutMs);

      document.addEventListener('TT_BRIDGE_RESPONSE', onResponse);

      document.dispatchEvent(
        new CustomEvent('TT_BRIDGE_REQUEST', {
          detail: {
            source: 'TT_CONTENT_ISOLATED',
            requestId,
            videoId,
            url,
            author: author || 'unknown'
          }
        })
      );
    });
  }

  /**
   * Fallback extraction directly from active HTML5 <video> element or photo slideshow.
   * NEVER extracts avatar profile pictures.
   *
   * @param {HTMLElement} container
   * @param {object} domInfo
   * @returns {{ url: string, author: string, videoId: string }|null}
   */
  function extractFromHtml5Video(container, domInfo) {
    if (!container && typeof document === 'undefined') return null;

    const video = (container && container.querySelector('video')) ||
                  (typeof document !== 'undefined' ? document.querySelector('video') : null);

    // If HTML5 video is present, try direct src (non-blob)
    if (video) {
      let streamUrl = video.currentSrc || video.src || '';
      if (!streamUrl) {
        const source = video.querySelector('source');
        if (source && source.src) streamUrl = source.src;
      }

      if (streamUrl && !streamUrl.startsWith('blob:')) {
        return {
          url: streamUrl,
          author: domInfo.author,
          videoId: domInfo.videoId
        };
      }

      // If video exists but is blob-based, do NOT fall back to images (avoids grabbing creator avatar)
      return null;
    }

    // Only if there is strictly NO video element, check for legitimate slideshow photo post
    if (container) {
      const slideImg = container.querySelector(
        'div[class*="SlideItem"] img, div[class*="PhotoContainer"] img, [data-e2e="feed-photo"] img:not([data-e2e*="avatar"]):not([class*="Avatar"])'
      );
      if (slideImg && slideImg.src && !slideImg.src.startsWith('data:') && !slideImg.src.includes('100x100')) {
        return {
          url: slideImg.src,
          author: domInfo.author,
          videoId: domInfo.videoId
        };
      }
    }

    return null;
  }

  /**
   * Multi-tier stream extraction cascade.
   *
   * @param {HTMLElement} card
   * @returns {Promise<{ url: string, author: string, videoId: string, tier: string }>}
   */
  async function resolveStreamData(card) {
    const domInfo = parseDomVideoInfo(card);

    // Tier 1: MAIN-World Bridge extraction (query with videoId + author handle)
    try {
      const bridgeResponse = await queryBridge(domInfo.videoId, domInfo.url, domInfo.author, 2000);
      if (bridgeResponse && bridgeResponse.success && bridgeResponse.data) {
        const streamUrl = bridgeResponse.data.playUrl || bridgeResponse.data.downloadUrl;
        if (streamUrl && !streamUrl.startsWith('blob:')) {
          return {
            url: streamUrl,
            author: bridgeResponse.data.author || domInfo.author,
            videoId: bridgeResponse.data.videoId || domInfo.videoId,
            tier: bridgeResponse.tier || 'primary_bridge'
          };
        }
      }
    } catch (err) {
      console.warn('[TikTok Downloader] Bridge extraction error:', err);
    }

    // Tier 2: HTML5 <video> & DOM slideshow fallback
    const fallbackResult = extractFromHtml5Video(card, domInfo);
    if (fallbackResult && fallbackResult.url) {
      return {
        url: fallbackResult.url,
        author: fallbackResult.author,
        videoId: fallbackResult.videoId,
        tier: 'fallback_html5'
      };
    }

    throw new Error('All video stream extraction tiers failed');
  }

  /**
   * Dispatches download request to background service worker.
   */
  async function handleDownloadClick(btn, card) {
    setButtonState(btn, 'loading', 'Extracting...');

    try {
      const stream = await resolveStreamData(card);

      setButtonState(btn, 'loading', 'Saving...');

      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('Chrome runtime messaging is not available');
      }

      chrome.runtime.sendMessage(
        {
          type: 'DOWNLOAD_VIDEO',
          payload: {
            url: stream.url,
            author: stream.author,
            videoId: stream.videoId
          }
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('[TikTok Downloader] Runtime error:', chrome.runtime.lastError);
            setButtonState(btn, 'error', 'Error');
            return;
          }

          if (response && response.success) {
            setButtonState(btn, 'success', 'Saved!');
          } else {
            console.error('[TikTok Downloader] Background returned failure:', response);
            setButtonState(btn, 'error', response?.error || 'Failed');
          }
        }
      );
    } catch (err) {
      console.error('[TikTok Downloader] Extraction failure:', err);
      setButtonState(btn, 'error', 'Failed');
    }
  }

  /**
   * Creates the circular action item element with button and label.
   *
   * @param {HTMLElement} card
   * @returns {HTMLElement}
   */
  function createDownloadActionItem(card) {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = 'tt-dl-action-item';
    itemWrapper.setAttribute('data-tt-dl-wrapper', 'true');

    const btn = document.createElement('button');
    btn.className = 'tt-dl-btn tt-dl-state-idle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Download TikTok Video');
    btn.setAttribute('title', 'Direct 1-Click Download');
    btn.setAttribute('data-state', 'idle');

    const iconBox = document.createElement('div');
    iconBox.className = 'tt-dl-icon-box';
    iconBox.innerHTML = ICONS.download;
    btn.appendChild(iconBox);

    const label = document.createElement('strong');
    label.className = 'tt-dl-label';
    label.textContent = 'Download';

    itemWrapper.appendChild(btn);
    itemWrapper.appendChild(label);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleDownloadClick(btn, card);
    });

    return itemWrapper;
  }

  /**
   * Injects download action item directly above the Share button container.
   *
   * @param {HTMLElement} card
   */
  function injectIntoCard(card) {
    if (!card) return;

    // Check if card was already injected
    if (card.querySelector('.tt-dl-action-item')) {
      return;
    }

    // 1. Primary Strategy: Locate the Share button directly
    const shareBtn = card.querySelector(SELECTORS.shareButtons);
    if (shareBtn) {
      const shareItem =
        shareBtn.closest('[data-e2e*="action-item"]') ||
        shareBtn.closest('div[class*="DivActionItemContainer"]') ||
        shareBtn.closest('button')?.parentElement ||
        shareBtn.parentElement;

      if (shareItem && shareItem.parentElement) {
        const actionBar = shareItem.parentElement;
        if (actionBar.querySelector('.tt-dl-action-item') || actionBar.getAttribute('data-tt-dl-ready') === 'true') {
          return;
        }

        const downloadItem = createDownloadActionItem(card);
        // Insert directly BEFORE the shareItem container (positions it directly ABOVE Share in the column)
        actionBar.insertBefore(downloadItem, shareItem);
        actionBar.setAttribute('data-tt-dl-ready', 'true');
        card.setAttribute('data-tt-dl-ready', 'true');
        return;
      }
    }

    // 2. Secondary Strategy: Locate action bar and append if Share button selector differed
    let actionBar = card.querySelector(SELECTORS.actionBars);
    if (actionBar && !actionBar.querySelector('.tt-dl-action-item') && actionBar.getAttribute('data-tt-dl-ready') !== 'true') {
      const downloadItem = createDownloadActionItem(card);
      actionBar.appendChild(downloadItem);
      actionBar.setAttribute('data-tt-dl-ready', 'true');
      card.setAttribute('data-tt-dl-ready', 'true');
    }
  }

  /**
   * Scans document for video cards and injects exactly 1 download button above Share.
   */
  function scanAndInject() {
    if (typeof document === 'undefined') return;

    // Self-healing: if an element has data-tt-dl-ready="true" but lost its button child, reset attribute
    const markedElements = document.querySelectorAll('[data-tt-dl-ready="true"]');
    markedElements.forEach((el) => {
      if (!el.classList.contains('tt-dl-action-item') && !el.querySelector('.tt-dl-action-item')) {
        el.removeAttribute('data-tt-dl-ready');
      }
    });

    // Strategy 1: Iterate known card containers
    const cards = document.querySelectorAll(SELECTORS.videoCards);
    cards.forEach((card) => {
      injectIntoCard(card);
    });

    // Strategy 2: Direct Share-Button Discovery (catches feeds where card container selector changed)
    const shareButtons = document.querySelectorAll(SELECTORS.shareButtons);
    shareButtons.forEach((shareBtn) => {
      const shareItem =
        shareBtn.closest('[data-e2e*="action-item"]') ||
        shareBtn.closest('div[class*="DivActionItemContainer"]') ||
        shareBtn.closest('button')?.parentElement ||
        shareBtn.parentElement;

      if (!shareItem || !shareItem.parentElement) return;
      const actionBar = shareItem.parentElement;

      // Strict Guard: ensure only 1 download button exists per action bar
      if (actionBar.querySelector('.tt-dl-action-item') || actionBar.getAttribute('data-tt-dl-ready') === 'true') {
        return;
      }

      const card =
        shareItem.closest('article, section, [data-e2e*="item"], [data-e2e*="feed"], [data-e2e*="video"], [data-e2e*="photo"], div[class*="Container"]') ||
        actionBar;

      const downloadItem = createDownloadActionItem(card);
      actionBar.insertBefore(downloadItem, shareItem);
      actionBar.setAttribute('data-tt-dl-ready', 'true');
      if (card && card.setAttribute) card.setAttribute('data-tt-dl-ready', 'true');
    });
  }

  /**
   * Handler for active video download triggered from extension popup or context menu.
   */
  async function handleActiveVideoDownload() {
    if (typeof document === 'undefined') return { success: false, error: 'Document not ready' };

    // 1. Find actively playing video
    let targetCard = null;
    const videos = Array.from(document.querySelectorAll('video'));
    const playingVideo = videos.find((v) => !v.paused && v.currentTime > 0);
    if (playingVideo) {
      targetCard = playingVideo.closest('article, section, [data-e2e*="item"], [data-e2e*="feed"], [data-e2e*="video"], div[class*="Container"]') || playingVideo.parentElement;
    }

    // 2. Find post closest to center of viewport
    if (!targetCard) {
      const candidates = Array.from(document.querySelectorAll(SELECTORS.videoCards));
      if (candidates.length > 0) {
        const centerY = window.innerHeight / 2;
        let closestDist = Infinity;
        for (const c of candidates) {
          const rect = c.getBoundingClientRect();
          if (rect.height > 0) {
            const center = rect.top + rect.height / 2;
            const dist = Math.abs(center - centerY);
            if (dist < closestDist) {
              closestDist = dist;
              targetCard = c;
            }
          }
        }
      }
    }

    // 3. Fallback to first video or document body
    if (!targetCard) {
      targetCard = document.querySelector('video') || document.body;
    }

    try {
      const stream = await resolveStreamData(targetCard);
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'DOWNLOAD_VIDEO',
            payload: {
              url: stream.url,
              author: stream.author,
              videoId: stream.videoId
            }
          },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else if (res && res.success) {
              resolve({ success: true, filename: res.filename });
            } else {
              resolve({ success: false, error: res?.error || 'Gagal memulai unduhan' });
            }
          }
        );
      });
    } catch (err) {
      return { success: false, error: err.message || 'Gagal mengekstrak video' };
    }
  }

  // Runtime message listener for active tab triggers
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && (message.type === 'DOWNLOAD_ACTIVE_VIDEO' || message.type === 'TRIGGER_ACTIVE_DOWNLOAD')) {
        handleActiveVideoDownload().then(sendResponse);
        return true; // asynchronous
      }
    });
  }

  /**
   * Throttled MutationObserver with 250ms debouncing.
   */
  class DOMObserverManager {
    constructor(scanFn, delay = 250) {
      this.scanFn = scanFn;
      this.delay = delay;
      this.timer = null;
      this.observer = null;
    }

    start() {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

      this.observer = new MutationObserver((mutations) => {
        let shouldSchedule = false;
        for (let i = 0; i < mutations.length; i++) {
          const mutation = mutations[i];
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (let j = 0; j < mutation.addedNodes.length; j++) {
              if (mutation.addedNodes[j].nodeType === 1) {
                // Element node added
                shouldSchedule = true;
                break;
              }
            }
          }
          if (shouldSchedule) break;
        }

        if (shouldSchedule) {
          this.scheduleScan();
        }
      });

      this.observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });

      // Execute initial scan immediately
      this.scanFn();
    }

    scheduleScan() {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.timer = setTimeout(() => {
        this.timer = null;
        this.scanFn();
      }, this.delay);
    }

    stop() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    }
  }

  // Start DOM observer if in browser context
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const observerManager = new DOMObserverManager(scanAndInject, 250);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => observerManager.start());
    } else {
      observerManager.start();
    }
  }

  // Export internal functions for Node.js unit testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SELECTORS,
      ICONS,
      setButtonState,
      parseDomVideoInfo,
      extractFromHtml5Video,
      resolveStreamData,
      DOMObserverManager
    };
  }
})();
