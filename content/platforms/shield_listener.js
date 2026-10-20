/**
 * Mungil Security Shield - Content Platform Listener
 * Runs in ISOLATED world at document_start to bridge chrome.storage configuration
 * directly to the MAIN world shield_bridge.js script.
 */

(function initShieldListener() {
  'use strict';

  function applyConfigToDOM(clickjack, adblock) {
    const root = document.documentElement || document.body;
    if (root) {
      try {
        root.setAttribute('data-shield-clickjack', clickjack ? 'true' : 'false');
        root.setAttribute('data-shield-adblock', adblock ? 'true' : 'false');
        root.setAttribute('data-mungil-clickjack', clickjack ? 'true' : 'false');
        root.setAttribute('data-mungil-adblock', adblock ? 'true' : 'false');
        if (!root.dataset) {
          root.dataset = {};
        }
        root.dataset.shieldClickjack = clickjack ? 'true' : 'false';
        root.dataset.shieldAdblock = adblock ? 'true' : 'false';
      } catch (_) {}
    }

    // Broadcast custom event across worlds
    try {
      const eventPayload = { detail: { clickjack, adblock } };
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('MUNGIL_SHIELD_CONFIG', eventPayload));
      }
      if (typeof document !== 'undefined' && document.dispatchEvent) {
        document.dispatchEvent(new CustomEvent('MUNGIL_SHIELD_CONFIG', eventPayload));
      }
    } catch (_) {}
  }

  function syncShieldConfig() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['shield_clickjack', 'shield_adblock'], (data) => {
        const clickjack = Boolean(data?.shield_clickjack);
        const adblock = Boolean(data?.shield_adblock);

        applyConfigToDOM(clickjack, adblock);

        // If root element wasn't ready yet, retry when DOMContentLoaded or readyState changes
        if (!document.documentElement) {
          const onReady = () => {
            applyConfigToDOM(clickjack, adblock);
            document.removeEventListener('DOMContentLoaded', onReady);
            document.removeEventListener('readystatechange', onReady);
          };
          document.addEventListener('DOMContentLoaded', onReady);
          document.addEventListener('readystatechange', onReady);
        }
      });
    }
  }

  // Immediate sync at document_start
  syncShieldConfig();

  // Polling guard for the first 500ms to guarantee root element receives dataset
  let retryCount = 0;
  const retryInterval = setInterval(() => {
    retryCount++;
    if (
      document.documentElement &&
      document.documentElement.dataset?.shieldClickjack !== undefined
    ) {
      clearInterval(retryInterval);
      return;
    }
    syncShieldConfig();
    if (retryCount >= 10) {
      clearInterval(retryInterval);
    }
  }, 50);

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
