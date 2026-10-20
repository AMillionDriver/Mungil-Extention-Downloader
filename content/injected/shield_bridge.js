/**
 * Mungil Security Shield - Injected Anti-Clickjacking & Popunder Guard
 * Runs in MAIN world at document_start to establish early protective boundaries.
 *
 * Capabilities:
 * 1. Stealth window.open wrapper with "[native code]" .toString() spoofing.
 * 2. Iframe function harvesting prevention (Node.prototype.appendChild trap).
 * 3. Synthetic anchor click & form submit defuser for unprompted popunders.
 * 4. Transparent overlay & cursor-tracking hitbox neutralizer (MutationObserver).
 * 5. Opt-in: Remains pure passthrough unless shield_clickjack is explicitly enabled.
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

    // Common popunder & ad network indicators
    const suspiciousPatterns = [
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
      'out.php?'
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

  // --------------------------------------------------------------------------
  // 4. Transparent Overlay & Cursor-Following Hitbox Neutralizer
  // --------------------------------------------------------------------------
  function neutralizeOverlayElement(el) {
    if (!el || !(el instanceof HTMLElement)) return;

    // Do not touch video elements or legitimate player controls
    const tagName = el.tagName.toLowerCase();
    if (
      tagName === 'video' ||
      tagName === 'audio' ||
      tagName === 'iframe' ||
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
      const isUltraHighZ = !isNaN(zIndex) && zIndex >= 99999;
      const isTransparent = opacity <= 0.05 || style.backgroundColor === 'transparent';
      const isHugeDimensions = w >= winW * 0.7 && h >= winH * 0.7;

      if (isFixedOrAbsolute && isUltraHighZ && isTransparent && isHugeDimensions) {
        console.warn('[Mungil Shield] Neutralized transparent overlay clickjack trap:', el);
        el.style.setProperty('pointer-events', 'none', 'important');
        el.style.setProperty('display', 'none', 'important');
      }
    } catch (_) {}
  }

  function scanOverlays() {
    if (!isClickjackShieldActive) return;
    try {
      const candidates = document.querySelectorAll(
        'div[style*="z-index"], a[style*="z-index"], span[style*="z-index"]'
      );
      for (const el of candidates) {
        neutralizeOverlayElement(el);
      }
    } catch (_) {}
  }

  // MutationObserver for dynamically injected overlays
  const overlayObserver = new MutationObserver((mutations) => {
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
  // 5. Cosmetic Adblock Rule Injection
  // --------------------------------------------------------------------------
  function applyCosmeticAdRules() {
    if (document.getElementById('mungil-cosmetic-ad-shield')) return;
    try {
      const style = document.createElement('style');
      style.id = 'mungil-cosmetic-ad-shield';
      style.textContent = `
        /* Mungil Cosmetic Ad & Banner Shield */
        [id*="ad-banner"],
        [class*="ad-banner"],
        [id*="popunder"],
        [class*="popunder"],
        .jw-ad,
        .jw-ad-container,
        .floating-ad,
        .floating-banner,
        iframe[src*="adsterra"],
        iframe[src*="popcash"],
        iframe[src*="propellerads"],
        iframe[src*="exoclick"] {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
          opacity: 0 !important;
          height: 0 !important;
          width: 0 !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    } catch (_) {}
  }

  // Periodic scan for residual overlays every 3 seconds if active
  setInterval(() => {
    if (isClickjackShieldActive) {
      scanOverlays();
    }
  }, 3000);
})();
