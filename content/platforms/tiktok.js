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
      'div[class*="DivActionItemContainer"]',
      'div[class*="DivFlexCenterRow-StyledWrapper"]',
      'div[class*="DivActionBarWrapper"]',
      'section[class*="DivActionItemContainer"]',
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
        const displayErrorLabel = customLabel && customLabel.length <= 15 ? customLabel : 'Failed';
        if (labelEl) labelEl.textContent = displayErrorLabel;
        if (fabText) fabText.textContent = customLabel && customLabel.length <= 15 ? customLabel : 'Gagal';
        if (customLabel) btn.setAttribute('title', customLabel);
        // Revert to idle after 3.0 seconds
        btn._stateTimeout = setTimeout(() => {
          setButtonState(btn, 'idle');
        }, 3000);
        break;

      case 'idle':
      default:
        btn.disabled = false;
        btn.setAttribute('title', 'Direct 1-Click Download');
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
   * Sanitizes author username for Windows NTFS compatibility.
   *
   * @param {string} author
   * @returns {string} Sanitized author handle
   */
  function sanitizeAuthor(author) {
    if (author === null || author === undefined) return 'unknown';
    let str = String(author).trim();
    if (!str) return 'unknown';
    str = str.replace(/^[@.\s]+/, '');
    str = str.replace(/[/\\:*?"<>|\x00-\x1f\x7f-\x9f]/g, '_');
    str = str.replace(/\s+/g, '_');
    str = str.replace(/[.\s_]+$/, '');
    str = str.slice(0, 64);
    return str || 'unknown';
  }

  /**
   * Sanitizes video ID for Windows NTFS compatibility.
   *
   * @param {string|number} id
   * @returns {string} Sanitized video ID
   */
  function sanitizeVideoId(id) {
    if (id === null || id === undefined) return String(Date.now());
    let str = String(id).trim();
    if (!str) return String(Date.now());
    str = str.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    return str || String(Date.now());
  }

  /**
   * Formats standard output filename: tiktok_@[author]_[id].mp4
   *
   * @param {string} author
   * @param {string|number} id
   * @returns {string}
   */
  function formatFilename(author, id) {
    const safeAuthor = sanitizeAuthor(author);
    const safeId = sanitizeVideoId(id);
    return `tiktok_@${safeAuthor}_${safeId}.mp4`;
  }

  /**
   * Fetches stream directly in content script context (with native cookies and origin)
   * and triggers blob download via programmatic anchor click.
   * Falls back to background service worker DOWNLOAD_VIDEO on failure.
   *
   * @param {{ url: string, author?: string, videoId?: string, id?: string }|string} streamInput
   * @returns {Promise<{ success: boolean, filename: string, source: string }>}
   */
  async function downloadStreamInPage(streamInput) {
    const stream = (typeof streamInput === 'string') ? { url: streamInput } : streamInput;
    if (!stream || !stream.url || typeof stream.url !== 'string') {
      throw new Error('Invalid or missing stream URL');
    }

    const cleanUrl = stream.url.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      throw new Error('Stream URL must be an HTTP or HTTPS stream');
    }

    const videoId = stream.videoId || stream.id;
    const filename = formatFilename(stream.author, videoId);
    let blobUrl = null;

    try {
      if (typeof fetch !== 'function') {
        throw new Error('fetch API is unavailable');
      }

      // Step 1: In-page fetch with credentials: 'include' (Anti-403 Fix)
      const response = await fetch(cleanUrl, { method: 'GET', credentials: 'include' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      // Guard against HTML, XML, or JSON error pages (e.g. 200 OK returning error markup)
      if (response.headers && typeof response.headers.get === 'function') {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
          throw new Error('Received HTML error page instead of video stream');
        }
        if (contentType.includes('application/json')) {
          throw new Error('Received JSON error response instead of video stream');
        }
        if (contentType.includes('text/xml') || contentType.includes('application/xml')) {
          throw new Error('Received XML error response instead of video stream');
        }
      }

      // Step 2: Convert fetched response into Blob
      const blob = await response.blob();
      if (blob && blob.type && (blob.type.includes('text/html') || blob.type.includes('application/xhtml+xml'))) {
        throw new Error('Received HTML error page instead of video stream');
      }
      if (blob && blob.type && blob.type.includes('application/json')) {
        throw new Error('Received JSON error response instead of video stream');
      }
      if (blob && blob.type && (blob.type.includes('text/xml') || blob.type.includes('application/xml'))) {
        throw new Error('Received XML error response instead of video stream');
      }
      if (!blob || (typeof blob.size === 'number' && blob.size === 0)) {
        throw new Error('Received empty video stream (0 bytes)');
      }

      // Step 3: Generate Object URL
      if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        throw new Error('URL.createObjectURL is unavailable');
      }
      blobUrl = URL.createObjectURL(blob);

      // Step 4: Trigger download using programmatic anchor click
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
        throw new Error('Document environment is not available for in-page download');
      }
      const parent = document.body || document.documentElement;
      if (!parent) {
        throw new Error('Document root is not available for anchor attachment');
      }

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = filename;
      if (typeof a.setAttribute === 'function') {
        a.setAttribute('href', blobUrl);
        a.setAttribute('download', filename);
      }

      try {
        if (typeof parent.appendChild === 'function') {
          parent.appendChild(a);
        }
        if (typeof a.click === 'function') {
          a.click();
        } else {
          throw new Error('Anchor click method is unavailable');
        }
      } finally {
        if (typeof a.remove === 'function') {
          a.remove();
        } else if (a.parentElement && typeof a.parentElement.removeChild === 'function') {
          a.parentElement.removeChild(a);
        }
      }

      // Step 5: Cleanly revoke Object URL after download initiation (15 seconds)
      setTimeout(() => {
        try {
          if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(blobUrl);
          }
        } catch (_) {}
      }, 15000);

      // Step 6: Send IPC notification (RECORD_DOWNLOAD) to background service worker
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: 'RECORD_DOWNLOAD',
            payload: {
              author: stream.author,
              videoId: videoId,
              filename: filename
            }
          },
          (res) => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
              console.warn('[TikTok Downloader] Telemetry reporting warning:', chrome.runtime.lastError);
            }
          }
        );
      }

      return { success: true, filename, source: 'in_page' };
    } catch (inPageErr) {
      // Immediately clean up allocated Object URL to prevent renderer memory leak if Step 4/5 failed
      if (blobUrl) {
        try {
          if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(blobUrl);
          }
        } catch (_) {}
      }

      console.warn('[TikTok Downloader] In-page stream fetch failed, falling back to background service worker:', inPageErr);

      // Fallback: Dispatch DOWNLOAD_VIDEO to background service worker
      return new Promise((resolve, reject) => {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          return reject(inPageErr);
        }

        chrome.runtime.sendMessage(
          {
            type: 'DOWNLOAD_VIDEO',
            payload: {
              url: cleanUrl,
              author: stream.author,
              videoId: videoId
            }
          },
          (response) => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
              console.error('[TikTok Downloader] Background fallback runtime error:', chrome.runtime.lastError);
              return reject(new Error(chrome.runtime.lastError.message));
            }

            if (response && response.success) {
              resolve({
                success: true,
                filename: response.filename || filename,
                source: 'background_fallback'
              });
            } else {
              const errMsg = (response && response.error) || (inPageErr && inPageErr.message) || (typeof inPageErr === 'string' ? inPageErr : 'Download failed');
              reject(new Error(errMsg));
            }
          }
        );
      });
    }
  }

  /**
   * Handles download button click: resolves stream data and initiates in-page download.
   *
   * @param {HTMLButtonElement} btn
   * @param {HTMLElement} card
   */
  async function handleDownloadClick(btn, card) {
    if (!btn || btn.disabled || btn.getAttribute('data-state') === 'loading') {
      return;
    }
    setButtonState(btn, 'loading', 'Extracting...');

    try {
      const stream = await resolveStreamData(card);

      setButtonState(btn, 'loading', 'Saving...');

      const result = await downloadStreamInPage(stream);

      if (result && result.success) {
        setButtonState(btn, 'success', 'Saved!');
      } else {
        setButtonState(btn, 'error', 'Failed');
      }
    } catch (err) {
      console.error('[TikTok Downloader] Download failure:', err);
      const errMsg = (err && typeof err === 'object' && err.message)
        ? err.message
        : (typeof err === 'string' ? err : 'Failed');
      setButtonState(btn, 'error', errMsg);
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

    const onClick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleDownloadClick(btn, card);
    };

    btn.addEventListener('click', onClick);
    itemWrapper.addEventListener('click', (e) => {
      if (e.target !== btn && !btn.contains?.(e.target)) {
        onClick(e);
      }
    });

    return itemWrapper;
  }

  /**
   * Injects download action item directly above the Share button container.
   * Strictly enforces exactly ONE download button per card and action bar.
   *
   * @param {HTMLElement} card
   */
  function injectIntoCard(card) {
    if (!card) return;

    // Strict Card-Level Guards & Self-Healing Deduplication:
    // 1. If card already has duplicate download items, prune excess immediately
    const existingInCard = card.querySelectorAll ? card.querySelectorAll('.tt-dl-action-item') : [];
    if (existingInCard.length > 1) {
      for (let i = 1; i < existingInCard.length; i++) {
        if (typeof existingInCard[i].remove === 'function') {
          existingInCard[i].remove();
        } else if (existingInCard[i].parentElement) {
          existingInCard[i].parentElement.removeChild(existingInCard[i]);
        }
      }
    }
    if (existingInCard.length >= 1) {
      card.setAttribute('data-tt-dl-ready', 'true');
      const bar = existingInCard[0].parentElement;
      if (bar && typeof bar.setAttribute === 'function') {
        bar.setAttribute('data-tt-dl-ready', 'true');
      }
      return;
    }

    // 2. Skip if enclosing parent card is already marked ready with a button
    if (card.parentElement && card.parentElement.closest) {
      const parentReady = card.parentElement.closest('[data-tt-dl-ready="true"]');
      if (parentReady && parentReady.querySelector('.tt-dl-action-item')) {
        card.setAttribute('data-tt-dl-ready', 'true');
        return;
      }
    }

    // 3. Locate the Share button directly inside this card
    const shareBtn = card.querySelector(SELECTORS.shareButtons);
    if (!shareBtn) {
      return;
    }

    // 4. Resolve the Action Bar container & direct Share item child
    const actionBarSelectors = [
      'div[class*="DivActionItemContainer"]',
      'div[class*="DivFlexCenterRow-StyledWrapper"]',
      'div[class*="DivActionBarWrapper"]',
      'section[class*="DivActionItemContainer"]',
      'div[class*="DivVideoActionContainer"]',
      'div[class*="ActionBar"]'
    ].join(',');

    let actionBar = shareBtn.closest ? shareBtn.closest(actionBarSelectors) : null;
    let shareItem = null;

    if (actionBar) {
      // Find the direct child of actionBar containing shareBtn
      let current = shareBtn;
      while (current && current.parentElement && current.parentElement !== actionBar) {
        current = current.parentElement;
      }
      if (current && current.parentElement === actionBar) {
        shareItem = current;
      }
    }

    // Fallback if explicit action bar was not resolved above
    if (!shareItem) {
      const e2eItem = shareBtn.closest ? shareBtn.closest('[data-e2e*="action-item"]') : null;
      if (e2eItem && e2eItem.parentElement) {
        shareItem = e2eItem;
        actionBar = e2eItem.parentElement;
      } else {
        const btn = shareBtn.closest ? (shareBtn.closest('button') || shareBtn) : shareBtn;
        const parent = btn.parentElement;
        if (!parent) return;

        // If parent has a grandparent inside card and few children, parent is the item wrapper;
        // otherwise parent is the action bar itself and btn is the shareItem.
        if (parent.parentElement && parent.parentElement !== card && parent.children && parent.children.length <= 3) {
          shareItem = parent;
          actionBar = parent.parentElement;
        } else {
          shareItem = btn;
          actionBar = parent;
        }
      }
    }

    if (!actionBar || !shareItem) {
      return;
    }

    // Strict Action-Bar-Level Guards & Deduplication:
    const existingInBar = actionBar.querySelectorAll ? actionBar.querySelectorAll('.tt-dl-action-item') : [];
    if (existingInBar.length > 1) {
      for (let i = 1; i < existingInBar.length; i++) {
        if (typeof existingInBar[i].remove === 'function') {
          existingInBar[i].remove();
        } else if (existingInBar[i].parentElement) {
          existingInBar[i].parentElement.removeChild(existingInBar[i]);
        }
      }
      actionBar.setAttribute('data-tt-dl-ready', 'true');
      card.setAttribute('data-tt-dl-ready', 'true');
      return;
    }
    if (existingInBar.length >= 1) {
      actionBar.setAttribute('data-tt-dl-ready', 'true');
      card.setAttribute('data-tt-dl-ready', 'true');
      return;
    }

    const downloadItem = createDownloadActionItem(card);
    // Insert directly BEFORE the shareItem container (positions it directly ABOVE Share in the column)
    actionBar.insertBefore(downloadItem, shareItem);
    actionBar.setAttribute('data-tt-dl-ready', 'true');
    card.setAttribute('data-tt-dl-ready', 'true');

    // Mark parent and child cards to prevent duplicate injection in nested containers
    if (card.parentElement && card.parentElement.closest) {
      const parentCard = card.parentElement.closest(SELECTORS.videoCards);
      if (parentCard) parentCard.setAttribute('data-tt-dl-ready', 'true');
    }
    const childCards = card.querySelectorAll ? card.querySelectorAll(SELECTORS.videoCards) : [];
    if (childCards && childCards.length) {
      for (let i = 0; i < childCards.length; i++) {
        childCards[i].setAttribute('data-tt-dl-ready', 'true');
      }
    }
  }

  /**
   * Scans document for video cards and injects exactly 1 download button above Share.
   * Strict single-scan architecture: iterates video card containers only,
   * eliminating redundant secondary scan passes.
   */
  function scanAndInject() {
    if (typeof document === 'undefined') return;

    // Self-healing 1: if an element has data-tt-dl-ready="true" but lost its button child, reset attribute
    const markedElements = document.querySelectorAll('[data-tt-dl-ready="true"]');
    markedElements.forEach((el) => {
      const isButton = el.classList?.contains ? el.classList.contains('tt-dl-action-item') : String(el.getAttribute?.('class') || '').includes('tt-dl-action-item');
      if (!isButton && !el.querySelector('.tt-dl-action-item')) {
        el.removeAttribute('data-tt-dl-ready');
      }
    });

    // Self-healing 2: prune any duplicate download buttons on existing action bars across the document
    const allDownloadButtons = document.querySelectorAll('.tt-dl-action-item');
    if (allDownloadButtons && allDownloadButtons.length > 1) {
      const seenBars = new Set();
      allDownloadButtons.forEach((btn) => {
        const bar = btn.parentElement;
        if (bar) {
          if (seenBars.has(bar)) {
            if (typeof btn.remove === 'function') {
              btn.remove();
            } else if (bar.removeChild) {
              bar.removeChild(btn);
            }
          } else {
            seenBars.add(bar);
          }
        }
      });
    }

    // Strict single strategy: iterate known video card containers
    const cards = document.querySelectorAll(SELECTORS.videoCards);
    cards.forEach((card) => {
      injectIntoCard(card);
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
      const result = await downloadStreamInPage(stream);
      return { success: true, filename: result.filename };
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
      DOMObserverManager,
      createDownloadActionItem,
      injectIntoCard,
      scanAndInject,
      sanitizeAuthor,
      sanitizeVideoId,
      formatFilename,
      downloadStreamInPage,
      handleDownloadClick,
      handleActiveVideoDownload
    };
  }
})();
