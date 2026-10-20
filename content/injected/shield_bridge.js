/**
 * Mungil Security Shield - Injected Anti-Clickjacking, Popunder & Anti-Adblock Defuser
 * Runs in MAIN world at document_start to establish early protective boundaries.
 *
 * Capabilities:
 * 1. Stealth window.open wrapper with "[native code]" .toString() spoofing.
 * 2. Iframe function harvesting prevention (Node.prototype.appendChild trap).
 * 3. Synthetic anchor click & form submit defuser for unprompted popunders.
 * 4. Transparent overlay & cursor-tracking hitbox neutralizer (MutationObserver).
 * 5. Anti-Anti-Adblock Bait Emulation & SweetAlert2 modal suppressor.
 * 6. Opt-in: Remains pure passthrough unless shield_clickjack is explicitly enabled.
 */

(function initMungilShield() {
  'use strict';

  // Prevent multiple injections
  if (window.__MUNGIL_SHIELD_INITIALIZED__) return;
  window.__MUNGIL_SHIELD_INITIALIZED__ = true;

  let isClickjackShieldActive = false;
  let isAdblockShieldActive = false;

  // Track recent genuine user clicks with timestamps
  let lastUserClickTimestamp = 0;

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.isTrusted) {
        lastUserClickTimestamp = Date.now();
      }
    },
    true
  );

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
                if (isClickjackShieldActive || isAdblockShieldActive) {
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
  }

  window.addEventListener('MUNGIL_SHIELD_CONFIG', (e) => {
    if (e && e.detail) {
      updateConfig(e.detail);
    }
  });

  // Check if dataset was set on documentElement by isolated content script
  if (document.documentElement) {
    if (document.documentElement.dataset.shieldClickjack === 'true') {
      isClickjackShieldActive = true;
    }
    if (document.documentElement.dataset.shieldAdblock === 'true') {
      isAdblockShieldActive = true;
    }
  }

  // --------------------------------------------------------------------------
  // 1. Stealth window.open Defuser
  // --------------------------------------------------------------------------
  const nativeOpen = window.open;

  function isSuspiciousPopunder(url) {
    if (!url || typeof url !== 'string') return true;
    const lower = url.toLowerCase().trim();
    if (lower === '' || lower === 'about:blank' || lower.startsWith('javascript:')) {
      return true;
    }

    // Common popunder, adware, tracker, and affiliate redirect patterns
    const suspiciousPatterns = [
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
      'go.php?',
      'click.php?',
      'out.php?',
      'affiliate',
      'campaign',
      'offer'
    ];

    for (const pat of suspiciousPatterns) {
      if (lower.includes(pat)) return true;
    }

    // Check if opened without a recent genuine physical user click within 1000ms
    const timeSinceClick = Date.now() - lastUserClickTimestamp;
    if (timeSinceClick > 1000) {
      return true;
    }

    return false;
  }

  const safeOpen = function (url, _target, _features) {
    if (isClickjackShieldActive && isSuspiciousPopunder(url)) {
      console.warn('[Mungil Shield] Blocked unauthorized popunder / window.open:', url);
      return null;
    }
    return nativeOpen.apply(this, arguments);
  };

  // Stealth .toString() kamuflase agar anti-adblock tidak mendeteksi tampering
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
  // 2. Iframe Function Harvesting Trap
  // --------------------------------------------------------------------------
  const nativeAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function (child) {
    const result = nativeAppendChild.apply(this, arguments);
    if (isClickjackShieldActive && child instanceof HTMLIFrameElement && child.contentWindow) {
      try {
        child.contentWindow.open = safeOpen;
      } catch (_) {}
    }
    return result;
  };

  // --------------------------------------------------------------------------
  // 3. Anchor & Form Popunder Click Defuser
  // --------------------------------------------------------------------------
  const nativeAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (isClickjackShieldActive) {
      const href = this.getAttribute('href') || this.href || '';
      const target = this.getAttribute('target') || this.target || '';
      if (target === '_blank' && isSuspiciousPopunder(href)) {
        console.warn('[Mungil Shield] Blocked synthetic anchor click popunder:', href);
        return;
      }
    }
    return nativeAnchorClick.apply(this, arguments);
  };

  // Intercept clickjacking links in capturing phase
  window.addEventListener(
    'click',
    (e) => {
      if (!isClickjackShieldActive) return;

      const link = e.target && e.target.closest ? e.target.closest('a') : null;
      if (link) {
        const href = link.getAttribute('href') || link.href || '';
        const target = link.getAttribute('target') || link.target || '';
        if (target === '_blank' && isSuspiciousPopunder(href)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          console.warn('[Mungil Shield] Intercepted clickjack link navigation:', href);
          return false;
        }
      }
    },
    true
  );

  // --------------------------------------------------------------------------
  // 4. Anti-Adblock SweetAlert2 Modal Suppressor
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
  // 5. Transparent Overlay & Cursor-Following Hitbox Neutralizer
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
      const isUltraHighZ = !isNaN(zIndex) && zIndex >= 1000;
      const isTransparent =
        opacity <= 0.05 ||
        style.backgroundColor === 'transparent' ||
        style.backgroundColor === 'rgba(0, 0, 0, 0)';
      const isLargeArea =
        (w >= winW * 0.5 && h >= winH * 0.5) || (w >= 300 && h >= 300 && !el.textContent.trim());

      if (isFixedOrAbsolute && isUltraHighZ && isTransparent && isLargeArea) {
        console.warn('[Mungil Shield] Neutralized transparent overlay clickjack trap:', el);
        el.style.setProperty('pointer-events', 'none', 'important');
        el.style.setProperty('display', 'none', 'important');
      }
    } catch (_) {}
  }

  function scanOverlays() {
    if (!isClickjackShieldActive) return;
    try {
      suppressAntiAdblockModal();
      const candidates = document.querySelectorAll(
        'div[style*="z-index"], a[style*="z-index"], span[style*="z-index"]'
      );
      for (const el of candidates) {
        neutralizeOverlayElement(el);
      }
    } catch (_) {}
  }

  // MutationObserver for dynamically injected overlays and anti-adblock modals
  const overlayObserver = new MutationObserver((mutations) => {
    if (!isClickjackShieldActive && !isAdblockShieldActive) return;
    suppressAntiAdblockModal();

    if (!isClickjackShieldActive) return;
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
  // 6. Cosmetic Adblock Rule Injection
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
        iframe[src*="ophionbonish"] {
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

  // Periodic scan for residual overlays and modals every 1.5 seconds if active
  setInterval(() => {
    if (isClickjackShieldActive || isAdblockShieldActive) {
      scanOverlays();
    }
  }, 1500);
})();
