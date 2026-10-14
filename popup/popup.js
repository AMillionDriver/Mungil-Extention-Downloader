/**
 * TikTok Direct Downloader - Popup Script
 * Manages active tab detection, downloads directory access, and metrics display.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const platformTitle = document.getElementById('platform-title');
  const platformDesc = document.getElementById('platform-desc');
  const platformIcon = document.getElementById('platform-icon');
  const btnOpenTikTok = document.getElementById('btn-open-tiktok');
  const btnOpenDownloads = document.getElementById('btn-open-downloads');
  const downloadCountEl = document.getElementById('download-count');

  // 1. Detect Active Tab
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.url) {
        let isTikTok = false;
        try {
          const url = new URL(activeTab.url);
          isTikTok = url.hostname.includes('tiktok.com');
        } catch (_) {
          isTikTok = activeTab.url.includes('tiktok.com');
        }

        if (isTikTok) {
          if (platformTitle) {
            platformTitle.textContent = 'TikTok Web Active';
            platformTitle.style.color = '#25F4EE';
          }
          if (platformIcon) platformIcon.textContent = '🎵';
          if (platformDesc) {
            platformDesc.textContent = 'Ready! In-page download buttons are active in video action bars.';
          }
          if (btnOpenTikTok) btnOpenTikTok.style.display = 'none';
        } else {
          if (platformTitle) {
            platformTitle.textContent = 'Not on TikTok';
            platformTitle.style.color = '#e0e0e0';
          }
          if (platformIcon) platformIcon.textContent = '🌐';
          if (platformDesc) {
            platformDesc.textContent = 'Open TikTok in this browser to download videos directly.';
          }
          if (btnOpenTikTok) btnOpenTikTok.style.display = 'block';
        }
      }
    }
  } catch (err) {
    if (platformTitle) platformTitle.textContent = 'Ready';
    if (platformDesc) {
      platformDesc.textContent = 'Navigate to tiktok.com to use the downloader.';
    }
  }

  // 2. Open TikTok CTA
  if (btnOpenTikTok) {
    btnOpenTikTok.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: 'https://www.tiktok.com' });
      }
    });
  }

  // 3. Open Downloads Folder
  if (btnOpenDownloads) {
    btnOpenDownloads.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.showDefaultFolder) {
        chrome.downloads.showDefaultFolder();
      }
    });
  }

  // 4. Fetch Lifetime Download Metrics
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['downloadCount'], (data) => {
        if (downloadCountEl) {
          downloadCountEl.textContent = String(data.downloadCount || 0);
        }
      });

      // Update in real-time if storage changes while popup is open
      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.downloadCount && downloadCountEl) {
            downloadCountEl.textContent = String(changes.downloadCount.newValue || 0);
          }
        });
      }
    }
  } catch (_) {}
});
