/**
 * TikTok Direct Downloader - Content Script (ISOLATED World)
 * Injected on *://*.tiktok.com/*
 * 
 * Responsibilities:
 * 1. 250ms debounced MutationObserver scanning FYP feed and modal video cards.
 * 2. Duplicate injection prevention using data-tt-dl-ready="true" and self-healing cleanup.
 * 3. Circular native-styled action button injection matching TikTok UI.
 * 4. 4-state visual lifecycle: Idle -> Loading -> Success (2.5s) / Error (3.0s) -> Idle.
 * 5. Multi-tier stream extraction cascade:
 *    - Tier 1: Query MAIN-world bridge (1500ms timeout)
 *    - Tier 2: HTML5 <video> currentSrc & DOM regex fallback
 * 6. IPC dispatch to background service worker via DOWNLOAD_VIDEO.
 */

(function () {
  'use strict';

  // Robust DOM Selector Configuration
  const SELECTORS = {
    // Video Card Containers (Feed & Modal)
    videoCards: [
      '[data-e2e="recommend-list-item-container"]',
      'div[class*="DivItemContainer"]',
      'div[class*="DivVideoDetailContainer"]',
      'div[class*="DivBrowserModeContainer"]',
      '[data-e2e="browse-video"]',
      'div[role="dialog"] div[class*="DivVideoContainer"]',
      'article[class*="DivItemContainer"]'
    ].join(','),

    // Action Bar / Action Item Containers
    actionBars: [
      '[data-e2e="feed-action-item"]',
      'div[class*="DivActionItemContainer"]',
      'div[class*="DivFlexCenterRow-StyledWrapper"]',
      'div[class*="DivActionBarWrapper"]',
      'section[class*="DivActionItemContainer"]',
      '[data-e2e="browse-action-item"]',
      'div[class*="DivVideoActionContainer"]'
    ].join(','),

    // Sibling Action Anchors (Used to locate parent container if container class changes)
    actionAnchors: [
      'button[data-e2e="like-icon"]',
      'button[data-e2e="browse-like-icon"]',
      'button[data-e2e="comment-icon"]',
      'button[data-e2e="share-icon"]',
      'button[data-e2e="undefined-icon"]',
      'button[aria-label*="Like" i]'
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

    const iconBox = btn.querySelector('.tt-dl-icon-box');
    const labelEl = btn.parentElement ? btn.parentElement.querySelector('.tt-dl-label') : null;

    switch (state) {
      case 'loading':
        btn.disabled = true;
        if (iconBox) iconBox.innerHTML = ICONS.loading;
        if (labelEl) labelEl.textContent = customLabel || 'Fetching...';
        break;

      case 'success':
        btn.disabled = true;
        if (iconBox) iconBox.innerHTML = ICONS.success;
        if (labelEl) labelEl.textContent = customLabel || 'Saved!';
        // Revert to idle after 2.5 seconds
        btn._stateTimeout = setTimeout(() => {
          setButtonState(btn, 'idle');
        }, 2500);
        break;

      case 'error':
        btn.disabled = false;
        if (iconBox) iconBox.innerHTML = ICONS.error;
        if (labelEl) labelEl.textContent = customLabel || 'Failed';
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
    let videoId = String(Date.now());
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

    // 1. Check window location pathname: /@username/video/1234567890
    if (typeof window !== 'undefined' && window.location.pathname) {
      const urlMatch = window.location.pathname.match(/@([^/?#]+)\/video\/(\d+)/);
      if (urlMatch) {
        author = urlMatch[1];
        videoId = urlMatch[2];
      }
    }

    if (container) {
      // 2. Check container anchor links: a[href*="/video/"]
      const videoLink = container.querySelector('a[href*="/video/"]');
      if (videoLink && videoLink.href) {
        const linkMatch = videoLink.href.match(/@([^/?#]+)\/video\/(\d+)/);
        if (linkMatch) {
          author = linkMatch[1];
          videoId = linkMatch[2];
        }
      }

      // 3. Check author handle links if author still unresolved: a[href*="/@"]
      if (author === 'unknown') {
        const authorLink = container.querySelector('a[href*="/@"]');
        if (authorLink && authorLink.href) {
          const match = authorLink.href.match(/@([^/?#]+)/);
          if (match) author = match[1];
        }
      }

      // 4. Check data-e2e author element
      if (author === 'unknown') {
        const authorEl = container.querySelector('[data-e2e="video-author-uniqueid"], [data-e2e="browse-username"]');
        if (authorEl && authorEl.textContent) {
          author = authorEl.textContent.trim().replace(/^@+/, '');
        }
      }

      // 5. Check video element attributes
      const videoEl = container.querySelector('video');
      if (videoEl) {
        const vId = videoEl.getAttribute('data-id') || videoEl.getAttribute('id');
        if (vId && /^\d+$/.test(vId)) {
          videoId = vId;
        }
      }
    }

    return { author, videoId, url: currentUrl };
  }

  /**
   * Queries MAIN-world bridge script for video metadata via CustomEvent.
   *
   * @param {string} videoId
   * @param {string} url
   * @param {number} [timeoutMs=1500]
   * @returns {Promise<object|null>}
   */
  function queryBridge(videoId, url, timeoutMs = 1500) {
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
            url
          }
        })
      );
    });
  }

  /**
   * Fallback extraction directly from active HTML5 <video> element.
   *
   * @param {HTMLElement} container
   * @param {object} domInfo
   * @returns {{ url: string, author: string, videoId: string }|null}
   */
  function extractFromHtml5Video(container, domInfo) {
    if (!container && typeof document === 'undefined') return null;

    const video = (container && container.querySelector('video')) ||
                  (typeof document !== 'undefined' ? document.querySelector('video') : null);

    if (!video) return null;

    let streamUrl = video.currentSrc || video.src || '';
    if (!streamUrl) {
      const source = video.querySelector('source');
      if (source && source.src) streamUrl = source.src;
    }

    // Direct download does not support MSE blob: URLs
    if (!streamUrl || streamUrl.startsWith('blob:')) {
      return null;
    }

    return {
      url: streamUrl,
      author: domInfo.author,
      videoId: domInfo.videoId
    };
  }

  /**
   * Multi-tier stream extraction cascade.
   *
   * @param {HTMLElement} card
   * @returns {Promise<{ url: string, author: string, videoId: string, tier: string }>}
   */
  async function resolveStreamData(card) {
    const domInfo = parseDomVideoInfo(card);

    // Tier 1: MAIN-World Bridge extraction
    try {
      const bridgeResponse = await queryBridge(domInfo.videoId, domInfo.url, 1500);
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

    // Tier 2: HTML5 <video> & DOM fallback
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
    btn.setAttribute('title', 'Direct 1-Click Download (without watermark)');
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
   * Injects download action item into the card's action bar.
   *
   * @param {HTMLElement} card
   */
  function injectIntoCard(card) {
    if (!card) return;

    // Check if container was already processed
    if (card.querySelector('.tt-dl-action-item')) {
      return;
    }

    // Locate action bar within card
    let actionBar = card.querySelector(SELECTORS.actionBars);

    // If not found by primary actionBars selector, locate via sibling button anchor
    if (!actionBar) {
      const anchor = card.querySelector(SELECTORS.actionAnchors);
      if (anchor) {
        actionBar =
          anchor.closest('div[class*="DivActionItemContainer"]') ||
          anchor.closest('div[class*="Action"]') ||
          anchor.parentElement?.parentElement ||
          anchor.parentElement;
      }
    }

    if (!actionBar) return;

    // Duplicate check on action bar element itself
    if (actionBar.getAttribute('data-tt-dl-ready') === 'true' || actionBar.querySelector('.tt-dl-action-item')) {
      return;
    }

    const downloadItem = createDownloadActionItem(card);
    actionBar.appendChild(downloadItem);
    actionBar.setAttribute('data-tt-dl-ready', 'true');
    card.setAttribute('data-tt-dl-ready', 'true');
  }

  /**
   * Scans document for video cards and injects download button.
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

    const cards = document.querySelectorAll(SELECTORS.videoCards);
    cards.forEach((card) => {
      injectIntoCard(card);
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
