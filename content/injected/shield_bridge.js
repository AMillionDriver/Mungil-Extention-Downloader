/**
 * Mungil Security Shield - Injected Anti-Clickjacking, Popunder & Anti-Adblock Defuser
 * Runs in MAIN world at document_start to establish early protective boundaries.
 *
 * Capabilities:
 * 1. Stealth window.open wrapper with "[native code]" .toString() spoofing & dummy window mock.
 * 2. Origin & element context verification: blocks third-party popunders triggered by image/background clicks.
 * 3. Iframe function harvesting prevention (Node.prototype.appendChild trap).
 * 4. Synthetic anchor click & form submit defuser for unprompted popunders.
 * 5. Transparent overlay & cursor-tracking hitbox neutralizer (MutationObserver).
 * 6. Anti-Anti-Adblock Bait Emulation & SweetAlert2 modal suppressor.
 * 7. Opt-in: Dynamic detection from dataset/attributes; remains passthrough unless enabled.
 */

(function initMungilShield() {
  'use strict';

  // Prevent multiple injections
  if (window.__MUNGIL_SHIELD_INITIALIZED__) return;
  window.__MUNGIL_SHIELD_INITIALIZED__ = true;

  let isClickjackShieldActive = false;
  let isAdblockShieldActive = false;

  // Synchronous cache from localStorage for instant 0ms activation
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem('__MUNGIL_SHIELD_CACHE__');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.clickjack) isClickjackShieldActive = true;
        if (parsed.adblock) isAdblockShieldActive = true;
      }
    }
  } catch (_) {}

  // Track recent genuine user clicks and clicked element
  let lastUserClickTimestamp = 0;
  let lastClickedElement = null;

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.isTrusted) {
        lastUserClickTimestamp = Date.now();
        lastClickedElement = e.target;
      }
    },
    true
  );

  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.isTrusted) {
        lastUserClickTimestamp = Date.now();
        lastClickedElement = e.target;
      }
    },
    true
  );

  // Dynamic status evaluation: checks memory flag and DOM attributes synced from isolated world
  function isShieldClickjackActive() {
    if (isClickjackShieldActive) return true;
    if (typeof document !== 'undefined') {
      const root = document.documentElement || document.body;
      if (root) {
        const attr =
          root.getAttribute('data-shield-clickjack') ||
          root.getAttribute('data-mungil-clickjack') ||
          root.dataset?.shieldClickjack;
        if (attr === 'true') {
          isClickjackShieldActive = true;
          return true;
        }
      }
    }
    return false;
  }

  function isShieldAdblockActive() {
    if (isAdblockShieldActive) return true;
    if (typeof document !== 'undefined') {
      const root = document.documentElement || document.body;
      if (root) {
        const attr =
          root.getAttribute('data-shield-adblock') ||
          root.getAttribute('data-mungil-adblock') ||
          root.dataset?.shieldAdblock;
        if (attr === 'true') {
          isAdblockShieldActive = true;
          return true;
        }
      }
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Anti-Anti-Adblock Emulation & Bait Protection
  // --------------------------------------------------------------------------
  try {
    window.ads_detected = false;
    window.canRunAds = true;
    window.isAdblockActive = false;
    window.adblockDetected = false;

    // Defuse getter/setter traps for common anti-adblock variables
    Object.defineProperty(window, 'ads_detected', {
      get: () => false,
      set: () => {},
      configurable: true
    });
    Object.defineProperty(window, 'canRunAds', {
      get: () => true,
      set: () => {},
      configurable: true
    });
  } catch (_) {}

  // Hook SweetAlert2 (Swal) to defuse anti-adblock modals at invocation
  try {
    let swalInstance = window.Swal;
    Object.defineProperty(window, 'Swal', {
      get: () => {
        if (!swalInstance) return undefined;
        return new Proxy(swalInstance, {
          get(target, prop) {
            if (prop === 'fire') {
              return function (options) {
                if (isShieldClickjackActive() || isShieldAdblockActive()) {
                  const str = typeof options === 'string' ? options : JSON.stringify(options || {});
                  if (/adblock|iklan|nonaktifkan/i.test(str)) {
                    console.warn('[Mungil Shield] Defused Swal anti-adblock modal:', str);
                    suppressAntiAdblockModal();
                    return Promise.resolve({ isConfirmed: false, isDismissed: true });
                  }
                }
                return target.fire.apply(target, arguments);
              };
            }
            return target[prop];
          }
        });
      },
      set: (val) => {
        swalInstance = val;
      },
      configurable: true
    });
  } catch (_) {}

  // Sync configuration from isolated content script via custom event or DOM dataset
  function updateConfig(config = {}) {
    if (typeof config.clickjack === 'boolean') {
      isClickjackShieldActive = config.clickjack;
    }
    if (typeof config.adblock === 'boolean') {
      isAdblockShieldActive = config.adblock;
      if (isAdblockShieldActive) {
        applyCosmeticAdRules();
      }
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          '__MUNGIL_SHIELD_CACHE__',
          JSON.stringify({
            clickjack: isClickjackShieldActive,
            adblock: isAdblockShieldActive
          })
        );
      }
    } catch (_) {}
  }

  window.addEventListener('MUNGIL_SHIELD_CONFIG', (e) => {
    if (e && e.detail) {
      updateConfig(e.detail);
    }
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('MUNGIL_SHIELD_CONFIG', (e) => {
      if (e && e.detail) {
        updateConfig(e.detail);
      }
    });
  }

  // Observe attribute changes on root for real-time toggle reflection
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    try {
      const rootObserver = new MutationObserver(() => {
        isShieldClickjackActive();
        if (isShieldAdblockActive()) {
          applyCosmeticAdRules();
        }
      });
      rootObserver.observe(document.documentElement, { attributes: true });
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // 1. Origin & Suspicious Popunder Target Detection
  // --------------------------------------------------------------------------
  function isSameOriginTarget(targetUrl) {
    if (!targetUrl || typeof targetUrl !== 'string') return false;
    const trimmed = targetUrl.trim();
    if (
      trimmed.startsWith('/') ||
      trimmed.startsWith('?') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('./') ||
      trimmed.startsWith('../')
    ) {
      return true;
    }

    try {
      const parsed = new URL(trimmed, window.location.href);
      const currentHost = window.location.hostname.toLowerCase();
      const targetHost = parsed.hostname.toLowerCase();

      if (targetHost === currentHost) return true;

      // Check apex domain (e.g. komiku.org vs api.komiku.org, bilibili.tv vs api.bilibili.tv)
      const curParts = currentHost.split('.').filter(Boolean);
      const tarParts = targetHost.split('.').filter(Boolean);
      if (curParts.length >= 2 && tarParts.length >= 2) {
        const curApex = curParts.slice(-2).join('.');
        const tarApex = tarParts.slice(-2).join('.');
        if (curApex === tarApex) return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function isKnownAdPattern(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase().trim();

    const patterns = [
      'frs2c',
      'frs2.',
      'link2?',
      'var_3=',
      'ymid=',
      'ophionbonish',
      '073m.com',
      'shope.ee',
      'shp.ee',
      'shopee.',
      'lazada.',
      'tokopedia.',
      'adsterra',
      'popcash',
      'propellerads',
      'monetag',
      'exoclick',
      'clickadu',
      'hilltopads',
      'juicyads',
      'yadro.ru',
      'trafficspecialist',
      'rotator',
      'direct-link',
      'smartlink',
      'bicolink',
      'bewbin',
      'honmia',
      'hepifun',
      'fundingchoicesmessages',
      'googleads',
      'doubleclick',
      'googlesyndication',
      'highperformancegate',
      'admaven',
      'vidoomy',
      'outbrain',
      'taboola',
      'go.php?',
      'click.php?',
      'out.php?',
      'affiliate',
      'campaign',
      'offer'
    ];

    for (const pat of patterns) {
      if (lower.includes(pat)) return true;
    }
    return false;
  }

  function isPopunderOrThirdPartyHijack(url) {
    if (!url || typeof url !== 'string') return true;
    const lower = url.toLowerCase().trim();
    if (lower === '' || lower === 'about:blank' || lower.startsWith('javascript:')) {
      return true;
    }

    // Always allow legitimate data downloads and in-memory blobs generated by the extension/browser
    if (lower.startsWith('blob:') || lower.startsWith('data:')) {
      return false;
    }

    // Always block known ad networks and redirect patterns
    if (isKnownAdPattern(lower)) {
      return true;
    }

    // If opening a same-origin URL, allow
    if (isSameOriginTarget(url)) {
      return false;
    }

    // The destination is a 3rd-party external domain.
    // Check what the user clicked recently:
    const timeSinceClick = Date.now() - lastUserClickTimestamp;
    if (timeSinceClick > 3000) {
      // Unprompted or delayed popunder
      return true;
    }

    // If user clicked on comic images, canvas, background, or reader body:
    if (lastClickedElement && lastClickedElement instanceof HTMLElement) {
      const tag = lastClickedElement.tagName.toLowerCase();
      if (
        tag === 'img' ||
        tag === 'picture' ||
        tag === 'canvas' ||
        tag === 'svg' ||
        tag === 'body' ||
        tag === 'html' ||
        tag === 'section' ||
        tag === 'article' ||
        lastClickedElement.closest('#chapter-image, .chapter-body, .reader-area, .content-comic')
      ) {
        // Legitimate user reading interaction was hijacked to open 3rd party ad!
        return true;
      }

      // Check if clicked element was an invisible overlay
      try {
        const style = window.getComputedStyle(lastClickedElement);
        const opacity = parseFloat(style.opacity);
        const rect = lastClickedElement.getBoundingClientRect();
        const winW = window.innerWidth || 1000;
        const winH = window.innerHeight || 800;
        if (
          opacity <= 0.05 ||
          (rect.width >= winW * 0.4 && rect.height >= winH * 0.4 && style.position === 'fixed')
        ) {
          return true;
        }
      } catch (_) {}
    }

    // By default, any 3rd party window.open during non-anchor click is blocked
    if (!lastClickedElement || !(lastClickedElement.closest && lastClickedElement.closest('a'))) {
      return true;
    }

    return false;
  }

  // Dummy mock window returned to deceiving popunder scripts so they don't fire secondary evasion traps
  function createDummyWindow() {
    return {
      closed: false,
      name: '',
      opener: window,
      focus: function () {},
      blur: function () {},
      close: function () {
        this.closed = true;
      },
      location: {
        href: '',
        replace: function () {},
        assign: function () {},
        reload: function () {}
      },
      document: {
        write: function () {},
        writeln: function () {},
        open: function () {},
        close: function () {}
      }
    };
  }

  // --------------------------------------------------------------------------
  // 2. Stealth window.open Defuser
  // --------------------------------------------------------------------------
  const nativeOpen = window.open;

  const safeOpen = function (url, _target, _features) {
    if (isShieldClickjackActive() && isPopunderOrThirdPartyHijack(url)) {
      console.warn('[Mungil Shield] Neutralized unauthorized popunder / window.open:', url);
      return createDummyWindow();
    }
    return nativeOpen.apply(this, arguments);
  };

  // Stealth .toString() camouflage
  try {
    Object.defineProperty(safeOpen, 'toString', {
      value: function () {
        return 'function open() { [native code] }';
      },
      writable: true,
      configurable: true
    });
  } catch (_) {}

  try {
    Object.defineProperty(window, 'open', {
      value: safeOpen,
      writable: true,
      configurable: true
    });
  } catch (_) {
    window.open = safeOpen;
  }

  // --------------------------------------------------------------------------
  // 3. Iframe Function Harvesting Trap
  // --------------------------------------------------------------------------
  const nativeAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function (child) {
    const result = nativeAppendChild.apply(this, arguments);
    if (isShieldClickjackActive() && child instanceof HTMLIFrameElement && child.contentWindow) {
      try {
        child.contentWindow.open = safeOpen;
      } catch (_) {}
    }
    return result;
  };

  // --------------------------------------------------------------------------
  // 4. Anchor & Form Popunder Click Defuser
  // --------------------------------------------------------------------------
  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isShieldClickjackActive()) {
      // Never block legitimate file downloads triggered programmatically
      if (
        this.hasAttribute('download') ||
        this.download ||
        this.classList.contains('mungil-terabox-btn') ||
        this.classList.contains('mungil-terabox-row-btn')
      ) {
        return nativeAnchorClick.apply(this, arguments);
      }

      const href = this.getAttribute('href') || this.href || '';
      if (
        href.startsWith('blob:') ||
        href.startsWith('data:') ||
        !isPopunderOrThirdPartyHijack(href)
      ) {
        return nativeAnchorClick.apply(this, arguments);
      }

      console.warn('[Mungil Shield] Blocked synthetic anchor click popunder:', href);
      return;
    }
    return nativeAnchorClick.apply(this, arguments);
  };

  // Intercept clickjacking links in capturing phase
  window.addEventListener(
    'click',
    (e) => {
      if (!isShieldClickjackActive()) return;

      const link = e.target && e.target.closest ? e.target.closest('a') : null;
      if (link) {
        // Never intercept file download links or extension buttons
        if (
          link.hasAttribute('download') ||
          link.download ||
          link.classList.contains('mungil-terabox-btn') ||
          link.classList.contains('mungil-terabox-row-btn')
        ) {
          return;
        }

        const href = link.getAttribute('href') || link.href || '';
        if (href.startsWith('blob:') || href.startsWith('data:')) {
          return;
        }

        if (href && isPopunderOrThirdPartyHijack(href)) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.warn('[Mungil Shield] Intercepted clickjack link navigation:', href);
          try {
            link.style.setProperty('pointer-events', 'none', 'important');
            link.style.setProperty('display', 'none', 'important');
            if (typeof link.remove === 'function') {
              link.remove();
            }
          } catch (_) {}
          return false;
        }
      }
    },
    true
  );

  // --------------------------------------------------------------------------
  // 5. Anti-Adblock SweetAlert2 Modal Suppressor
  // --------------------------------------------------------------------------
  function suppressAntiAdblockModal() {
    try {
      const swalContainers = document.querySelectorAll(
        '#swal2-container, .swal2-container, .modal-backdrop, .swal2-backdrop-show, [class*="adblock-modal"]'
      );
      for (const el of swalContainers) {
        const text = el.textContent || '';
        if (
          text.includes('Adblock') ||
          text.includes('adblock') ||
          text.includes('Komiku gratis') ||
          text.includes('iklan') ||
          text.includes('Iklan') ||
          el.querySelector('.swal2-title')
        ) {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
          if (typeof el.remove === 'function') {
            el.remove();
          }
        }
      }

      // Restore scroll lock if body or html was frozen
      if (document.body) {
        if (document.body.classList.contains('swal2-shown')) {
          document.body.classList.remove('swal2-shown');
        }
        document.body.style.setProperty('overflow', 'auto', 'important');
      }
      if (document.documentElement) {
        if (document.documentElement.classList.contains('swal2-shown')) {
          document.documentElement.classList.remove('swal2-shown');
        }
        document.documentElement.style.setProperty('overflow', 'auto', 'important');
      }
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // 6. Transparent Overlay & Cursor-Following Hitbox Neutralizer
  // --------------------------------------------------------------------------
  function neutralizeOverlayElement(el) {
    if (!el || !(el instanceof HTMLElement)) return;

    // Do not touch images (comic readers), video, audio, or form controls
    const tagName = el.tagName.toLowerCase();
    if (
      tagName === 'img' ||
      tagName === 'picture' ||
      tagName === 'video' ||
      tagName === 'audio' ||
      tagName === 'iframe' ||
      tagName === 'button' ||
      tagName === 'input' ||
      tagName === 'select' ||
      el.id === 'mungil-batch-modal' ||
      el.closest('#mungil-batch-modal')
    ) {
      return;
    }

    try {
      const style = window.getComputedStyle(el);
      const pos = style.position;
      const zIndex = parseInt(style.zIndex, 10);
      const opacity = parseFloat(style.opacity);
      const w = el.offsetWidth || 0;
      const h = el.offsetHeight || 0;
      const winW = window.innerWidth || 1000;
      const winH = window.innerHeight || 800;

      // Detect full viewport transparent overlay or high-z hitbox
      const isFixedOrAbsolute = pos === 'fixed' || pos === 'absolute';
      const isUltraHighZ = !isNaN(zIndex) && zIndex >= 100;
      const isTransparent =
        opacity <= 0.05 ||
        style.backgroundColor === 'transparent' ||
        style.backgroundColor === 'rgba(0, 0, 0, 0)';
      const isLargeArea =
        (w >= winW * 0.4 && h >= winH * 0.4) || (w >= 200 && h >= 200 && !el.textContent.trim());

      if (isFixedOrAbsolute && isUltraHighZ && isTransparent && isLargeArea) {
        console.warn('[Mungil Shield] Neutralized transparent overlay clickjack trap:', el);
        el.style.setProperty('pointer-events', 'none', 'important');
        el.style.setProperty('display', 'none', 'important');
      }
    } catch (_) {}
  }

  function scanOverlays() {
    if (!isShieldClickjackActive() && !isShieldAdblockActive()) return;
    try {
      suppressAntiAdblockModal();
      if (!isShieldClickjackActive()) return;
      const candidates = document.querySelectorAll(
        'div[style*="z-index"], a[style*="z-index"], span[style*="z-index"]'
      );
      for (const el of candidates) {
        neutralizeOverlayElement(el);
      }
    } catch (_) {}
  }

  // MutationObserver for dynamically injected overlays, modals, and ads
  const overlayObserver = new MutationObserver((mutations) => {
    if (!isShieldClickjackActive() && !isShieldAdblockActive()) return;
    suppressAntiAdblockModal();

    if (
      typeof window !== 'undefined' &&
      window.location &&
      window.location.hostname.includes('youtube.com')
    ) {
      runYouTubeAdSkipper();
    }

    if (typeof window !== 'undefined' && isSafelinkDomain()) {
      runSafelinkDefuser();
    }

    if (!isShieldClickjackActive()) return;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement) {
          neutralizeOverlayElement(node);
        }
      }
    }
  });

  if (document.body) {
    overlayObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        overlayObserver.observe(document.body, { childList: true, subtree: true });
      }
      scanOverlays();
    });
  }

  // --------------------------------------------------------------------------
  // 7. Cosmetic Adblock Rule Injection
  // --------------------------------------------------------------------------
  function applyCosmeticAdRules() {
    if (document.getElementById('mungil-cosmetic-ad-shield')) return;
    try {
      const style = document.createElement('style');
      style.id = 'mungil-cosmetic-ad-shield';
      style.textContent = `
        /* Mungil Cosmetic Ad, Banner & Anti-Adblock Modal Shield */
        [id*="ad-banner"],
        [class*="ad-banner"],
        [id*="popunder"],
        [class*="popunder"],
        .jw-ad,
        .jw-ad-container,
        .floating-ad,
        .floating-banner,
        #swal2-container,
        .swal2-container,
        .modal-backdrop,
        .swal2-backdrop-show,
        [class*="adblock-modal"],
        iframe[src*="adsterra"],
        iframe[src*="popcash"],
        iframe[src*="propellerads"],
        iframe[src*="exoclick"],
        iframe[src*="monetag"],
        iframe[src*="ophionbonish"],
        iframe[src*="frs2c"],
        iframe[src*="073m"],
        /* Google Funding Choices & AdSense Overlays */
        #fc-dialog,
        .fc-dialog-container,
        iframe[src*="fundingchoicesmessages"],
        ins.adsbygoogle,
        .adsbygoogle,
        div[id^="google_ads_iframe"],
        iframe[src*="googleads"],
        #aswift_0_expand,
        #aswift_1_expand,
        div[class*="bottom-ads"],
        div[class*="sticky-ads"],
        div[id*="bottom-ads"],
        div[id*="sticky-ads"],
        /* YouTube Video, Sidebar Companion Ads, Overlays & Promos */
        ytd-ad-slot-renderer,
        ytd-companion-slot-renderer,
        ytd-in-feed-ad-layout-renderer,
        ytd-banner-promo-renderer,
        ytd-statement-banner-renderer,
        ytd-promoted-sparkles-web-renderer,
        ytd-promoted-video-renderer,
        ytd-compact-promoted-video-renderer,
        ytd-display-ad-renderer,
        #masthead-ad,
        #player-ads,
        .ytp-ad-overlay-container,
        .ytp-ad-player-overlay,
        .ytp-ad-player-overlay-flyout-cta,
        .ytp-ad-action-interstitial,
        .ytp-ad-message-container,
        .ytp-ad-overlay-slot,
        .ytp-ad-progress-list,
        ytd-enforcement-message-view-model {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
          opacity: 0 !important;
          height: 0 !important;
          width: 0 !important;
        }

        body.swal2-shown,
        html.swal2-shown {
          overflow: auto !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // 8. Rich Click Simulation Helper (Full Event Dispatch for Modern SPAs)
  // --------------------------------------------------------------------------
  function simulateRichClick(el) {
    if (!el) return;
    const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    for (const evtName of events) {
      try {
        const evt = new MouseEvent(evtName, {
          bubbles: true,
          cancelable: true,
          view: window,
          buttons: 1
        });
        el.dispatchEvent(evt);
      } catch (_) {}
    }
    try {
      if (typeof el.click === 'function') {
        el.click();
      }
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // 9. YouTube Video Ad Auto-Skipper & Anti-Adblock Defuser (Flawless UX)
  // --------------------------------------------------------------------------
  let userOriginalPlaybackRate = 1;
  let userOriginalMuted = false;
  let isFastForwardingAd = false;

  function runYouTubeAdSkipper() {
    if (!isShieldAdblockActive() && !isShieldClickjackActive()) return;
    if (
      typeof window === 'undefined' ||
      !window.location ||
      !window.location.hostname.includes('youtube.com')
    ) {
      return;
    }

    try {
      // 1. Defuse YouTube Anti-Adblock Enforcement Dialog
      const enforcementModal = document.querySelector(
        'ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(#feedback.ytd-enforcement-message-view-model)'
      );
      if (enforcementModal) {
        enforcementModal.style.setProperty('display', 'none', 'important');
        if (typeof enforcementModal.remove === 'function') {
          enforcementModal.remove();
        }
        const backdrop = document.querySelector('tp-yt-iron-overlay-backdrop');
        if (backdrop) backdrop.remove();
        document.body.style.setProperty('overflow', 'auto', 'important');
        const video =
          document.querySelector('video.html5-main-video') || document.querySelector('video');
        if (video && video.paused) {
          video.play().catch(() => {});
        }
      }

      // 2. Unconditional Skip Button Hunter (Modern & Multilingual "Lewati" support)
      const skipSelectors = [
        '.ytp-ad-skip-button-modern',
        '.ytp-skip-ad-button',
        '.ytp-ad-skip-button',
        'button.ytp-ad-skip-button-modern',
        '.ytp-ad-skip-button-slot button',
        '.ytp-ad-skip-button-container button',
        '.ytp-ad-skip-button-text',
        '.ytp-skip-ad-button__text',
        '[class*="ytp-ad-skip-button"]',
        '[class*="ytp-skip-ad-button"]',
        'button[id*="skip-button"]',
        '.ytp-ad-overlay-close-button',
        '.ytp-ad-overlay-close-container button'
      ];
      const skipButtons = document.querySelectorAll(skipSelectors.join(', '));
      for (const btn of skipButtons) {
        simulateRichClick(btn);
        if (btn.parentElement && btn.parentElement !== document.body) {
          simulateRichClick(btn.parentElement);
        }
      }

      // Multilingual text search for Indonesian "Lewati" or English "Skip"
      const candidates = document.querySelectorAll('button, div[role="button"], .ytp-button');
      for (const el of candidates) {
        const txt = (el.textContent || '').trim().toLowerCase();
        if (
          txt.includes('lewati') ||
          txt.includes('skip ad') ||
          txt.includes('skip ads') ||
          (txt.startsWith('skip') && txt.length <= 15)
        ) {
          simulateRichClick(el);
          if (el.parentElement) simulateRichClick(el.parentElement);
        }
      }

      // 3. Video Ad Detection & Fast-Forward
      const player = document.querySelector('#movie_player, .html5-video-player');
      const adShowing =
        (player &&
          (player.classList.contains('ad-showing') ||
            player.classList.contains('ad-interrupting'))) ||
        document.querySelector('.ad-showing, .ad-interrupting, .ytp-ad-player-overlay');

      const video =
        document.querySelector('video.html5-main-video') || document.querySelector('video');

      if (adShowing && video) {
        if (!isFastForwardingAd) {
          isFastForwardingAd = true;
          userOriginalPlaybackRate = video.playbackRate !== 16 ? video.playbackRate : 1;
          userOriginalMuted = video.muted;
        }

        // Mute video ad completely
        video.muted = true;

        // Accelerate to 16x speed
        if (video.playbackRate !== 16) {
          try {
            video.playbackRate = 16;
          } catch (_) {}
        }

        // Jump straight to the end of the ad to trigger instant completion or skip
        if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration) {
          try {
            video.currentTime = video.duration - 0.05 > 0 ? video.duration - 0.05 : video.duration;
            video.dispatchEvent(new Event('timeupdate'));
          } catch (_) {}
        }
      } else if (isFastForwardingAd && video) {
        // Restore original playback rate and audio state
        isFastForwardingAd = false;
        try {
          video.playbackRate = userOriginalPlaybackRate || 1;
          video.muted = userOriginalMuted || false;
        } catch (_) {}
      }
    } catch (_) {}
  }

  // --------------------------------------------------------------------------
  // 10. Safelink & Bicolink Video Ad Defuser (Bicolink, Bewbin, Honmia, Semawur)
  // --------------------------------------------------------------------------
  function isSafelinkDomain() {
    if (typeof window === 'undefined' || !window.location) return false;
    const host = window.location.hostname.toLowerCase();
    const href = window.location.href.toLowerCase();
    return (
      host.includes('bicolink') ||
      host.includes('bewbin') ||
      host.includes('honmia') ||
      host.includes('semawur') ||
      host.includes('safelink') ||
      href.includes('saham-anjlok') ||
      href.includes('token=') ||
      document.querySelector('[id*="safelink"], [class*="safelink"]') !== null
    );
  }

  function runSafelinkDefuser() {
    if (!isShieldClickjackActive() && !isShieldAdblockActive()) return;
    if (!isSafelinkDomain()) return;

    try {
      // 1. Defuse forced ad video (e.g. hepifun.mp4 or ad stream)
      const videos = document.querySelectorAll('video');
      for (const v of videos) {
        try {
          const src = (v.src || v.currentSrc || '').toLowerCase();
          const isAdVideo =
            src.includes('hepifun') ||
            src.includes('ads') ||
            src.includes('promo') ||
            v.closest('.modal, [class*="modal"], [class*="popup"], [class*="overlay"]') !== null ||
            isSafelinkDomain();

          if (isAdVideo) {
            v.muted = true;
            if (v.playbackRate !== 16) {
              try {
                v.playbackRate = 16;
              } catch (_) {}
            }
            if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration) {
              v.currentTime = v.duration;
            }
            v.dispatchEvent(new Event('timeupdate'));
            v.dispatchEvent(new Event('ended'));
            if (typeof v.onended === 'function') {
              v.onended();
            }
          }
        } catch (_) {}
      }

      // 2. Auto-trigger unlock buttons ("Putar dengan suara", "Lanjutkan", "Get Link")
      const candidates = document.querySelectorAll(
        'button, a, div[role="button"], span[role="button"], .btn'
      );
      for (const btn of candidates) {
        const txt = (btn.textContent || '').trim().toLowerCase();
        if (
          txt.includes('putar dengan suara') ||
          txt.includes('putar video') ||
          txt.includes('tonton video') ||
          txt.includes('saya bukan robot') ||
          txt.includes('verifikasi') ||
          txt.includes('get link') ||
          txt.includes('generate link') ||
          txt.includes('buka tautan') ||
          txt.includes('click here to continue') ||
          txt.includes('lanjutkan') ||
          (txt.includes('download') && txt.includes('link'))
        ) {
          if (btn.hasAttribute('disabled')) {
            btn.removeAttribute('disabled');
          }
          if (btn.style.pointerEvents === 'none') {
            btn.style.pointerEvents = 'auto';
          }
          simulateRichClick(btn);
        }
      }

      // 3. Auto-click scroll-down arrow button
      const arrowBtns = document.querySelectorAll(
        'button[class*="arrow"], .arrow-down, [class*="scroll-down"]'
      );
      for (const ab of arrowBtns) {
        simulateRichClick(ab);
      }

      // 4. Suppress Google Funding Choices & floating bottom ad banners
      const fcDialogs = document.querySelectorAll(
        '#fc-dialog, .fc-dialog-container, iframe[src*="fundingchoicesmessages"], tp-yt-paper-dialog'
      );
      for (const fc of fcDialogs) {
        fc.style.setProperty('display', 'none', 'important');
        if (typeof fc.remove === 'function') fc.remove();
      }

      const adBanners = document.querySelectorAll(
        'ins.adsbygoogle, div[id^="google_ads_iframe"], .adsbygoogle, #aswift_0_expand, #aswift_1_expand, iframe[src*="googleads"], div[class*="bottom-ads"], div[class*="sticky-ads"]'
      );
      for (const b of adBanners) {
        b.style.setProperty('display', 'none', 'important');
        b.style.setProperty('pointer-events', 'none', 'important');
      }
    } catch (_) {}
  }

  // Periodic YouTube ad skipper loop every 50ms on YouTube
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.hostname.includes('youtube.com')
  ) {
    setInterval(runYouTubeAdSkipper, 50);
  }

  // Periodic Safelink defuser loop every 100ms on Safelinks
  if (typeof window !== 'undefined' && isSafelinkDomain()) {
    setInterval(runSafelinkDefuser, 100);
  }

  // Periodic scan for residual overlays and modals every 1.5 seconds if active
  setInterval(() => {
    if (isShieldClickjackActive() || isShieldAdblockActive()) {
      scanOverlays();
      if (
        typeof window !== 'undefined' &&
        window.location &&
        window.location.hostname.includes('youtube.com')
      ) {
        runYouTubeAdSkipper();
      }
      if (typeof window !== 'undefined' && isSafelinkDomain()) {
        runSafelinkDefuser();
      }
    }
  }, 1500);
})();
