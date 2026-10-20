/**
 * Mungil Security Shield - Content Platform Listener
 * Runs in ISOLATED world at document_start to bridge chrome.storage configuration
 * directly to the MAIN world shield_bridge.js script.
 */

(function initShieldListener() {
  'use strict';

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

  // Immediate sync at document_start
  syncShieldConfig();

  // Listen for real-time toggle changes from the popup UI
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.shield_clickjack || changes.shield_adblock)) {
        syncShieldConfig();
      }
    });
  }

  // Re-sync on DOM ready to ensure dataset is preserved
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncShieldConfig);
    }
  }
})();
