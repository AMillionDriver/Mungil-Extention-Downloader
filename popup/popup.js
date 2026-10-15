/**
 * TikTok Direct Downloader - Popup Controller
 * Implements Linear / Raycast Minimalist Context Architecture
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Element Bindings (defensive dual-binding)
  const statusDot = document.getElementById('status-dot');
  const stateTiktok = document.getElementById('state-tiktok') || document.getElementById('context-active');
  const stateEmpty = document.getElementById('state-empty') || document.getElementById('context-inactive') || document.getElementById('platform-card');
  const videoAuthor = document.getElementById('video-author') || document.getElementById('video-creator');
  const videoDesc = document.getElementById('video-desc') || document.getElementById('video-title');
  const videoStatusChip = document.getElementById('video-status-chip');
  const btnDownloadActive = document.getElementById('btn-download-active');
  const btnDownloadText = document.getElementById('btn-download-text');
  const btnOpenTikTok = document.getElementById('btn-open-tiktok');
  const btnOpenDownloads = document.getElementById('btn-open-downloads');
  const downloadCountEl = document.getElementById('download-count');
  const statusPill = document.getElementById('popup-status-msg');
  const platformTitle = document.getElementById('platform-title');
  const platformDesc = document.getElementById('platform-desc');
  const metricLabel = document.querySelector('.metric-label');

  let statusTimeout = null;

  // 2. Feedback Pill Helper
  function showStatus(text, type = 'info', duration = 4000) {
    if (!statusPill) return;
    if (statusTimeout) {
      clearTimeout(statusTimeout);
      statusTimeout = null;
    }
    statusPill.textContent = text;
    statusPill.className = `feedback-pill popup-status-msg ${type}`;
    statusPill.style.display = 'block';

    if (duration > 0) {
      statusTimeout = setTimeout(() => {
        statusPill.style.display = 'none';
        statusTimeout = null;
      }, duration);
    }
  }

  // 3. Storage Counter Synchronization
  function updateCounter(count) {
    if (!downloadCountEl) return;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    downloadCountEl.textContent = String(n);
    if (metricLabel) {
      metricLabel.textContent = n === 1 ? 'download' : 'downloads';
    }
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['downloadCount'], (data) => {
        updateCounter(data?.downloadCount);
      });

      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes.downloadCount) {
            updateCounter(changes.downloadCount.newValue);
          }
        });
      }
    }
  } catch (_) {}

  // 4. Quick Action Listeners
  if (btnOpenDownloads) {
    btnOpenDownloads.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.showDefaultFolder) {
          chrome.downloads.showDefaultFolder();
        }
      } catch (err) {
        console.warn('[Popup] showDefaultFolder failed:', err);
      }
    });
  }

  if (btnOpenTikTok) {
    btnOpenTikTok.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: 'https://www.tiktok.com' });
        } else if (typeof window !== 'undefined' && window.open) {
          window.open('https://www.tiktok.com', '_blank');
        }
      } catch (err) {
        console.warn('[Popup] open TikTok tab failed:', err);
      }
    });
  }

  // 5. Active Tab Detection & TikTok Context Query
  let activeTab = null;
  let isTikTok = false;

  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab;
      const tabUrl = (tab && tab.url) ? tab.url : '';
      if (tabUrl) {
        try {
          const parsed = new URL(tabUrl);
          isTikTok = parsed.hostname === 'tiktok.com' || parsed.hostname.endsWith('.tiktok.com');
        } catch (_) {
          isTikTok = tabUrl.includes('tiktok.com');
        }
      }
    }
  } catch (err) {
    console.warn('[Popup] Tab query failed:', err);
  }

  // 6. View Rendering & Context State Setup
  if (isTikTok && activeTab && activeTab.id) {
    // Online / Active State
    if (statusDot) statusDot.className = 'status-dot online';
    if (stateTiktok) stateTiktok.style.display = 'flex';
    if (stateEmpty) stateEmpty.style.display = 'none';
    if (btnDownloadActive) btnDownloadActive.style.display = 'inline-flex';
    if (btnOpenTikTok) btnOpenTikTok.style.display = 'none';

    // Query active video metadata via GET_ACTIVE_VIDEO_INFO
    try {
      chrome.tabs.sendMessage(activeTab.id, { type: 'GET_ACTIVE_VIDEO_INFO' }, (response) => {
        if (chrome.runtime.lastError) {
          // Tab un-refreshed or content script uninitialized
          if (videoAuthor) videoAuthor.textContent = 'TikTok Web Active';
          if (videoDesc) videoDesc.textContent = 'Reload tab (F5) to enable 1-click download';
          if (videoStatusChip) {
            videoStatusChip.textContent = 'Connected';
            videoStatusChip.style.color = 'var(--text-muted)';
          }
          return;
        }

        if (response && response.success) {
          if (response.ready) {
            const authorHandle = (response.author && response.author !== 'unknown' && response.author !== '')
              ? (response.author.startsWith('@') ? response.author : `@${response.author}`)
              : 'Video Ready';
            if (videoAuthor) videoAuthor.textContent = authorHandle;
            if (videoDesc) videoDesc.textContent = response.title || 'Direct stream ready for download';
            if (videoStatusChip) {
              videoStatusChip.textContent = 'Ready';
              videoStatusChip.style.color = 'var(--accent-green)';
            }
          } else {
            if (videoAuthor) videoAuthor.textContent = 'Video Ready';
            if (videoDesc) videoDesc.textContent = 'Browse or play a video to download';
            if (videoStatusChip) {
              videoStatusChip.textContent = 'Detecting';
              videoStatusChip.style.color = 'var(--accent-cyan)';
            }
          }
        } else {
          if (videoAuthor) videoAuthor.textContent = 'TikTok Web';
          if (videoDesc) videoDesc.textContent = 'Ready to download active video';
        }
      });
    } catch (err) {
      console.warn('[Popup] GET_ACTIVE_VIDEO_INFO query failed:', err);
    }

    // Handle "Download Video" click with 5-state lifecycle
    if (btnDownloadActive) {
      btnDownloadActive.addEventListener('click', () => {
        if (btnDownloadActive.disabled || !activeTab || !activeTab.id) return;

        btnDownloadActive.disabled = true;
        if (btnDownloadText) btnDownloadText.textContent = 'Extracting...';
        showStatus('Extracting video stream...', 'info', 0);

        chrome.tabs.sendMessage(activeTab.id, { type: 'DOWNLOAD_ACTIVE_VIDEO' }, (res) => {
          if (chrome.runtime.lastError) {
            btnDownloadActive.disabled = false;
            if (btnDownloadText) btnDownloadText.textContent = 'Download Video';
            showStatus('Please reload the TikTok tab (F5) to connect extension.', 'error', 5000);
            return;
          }

          if (res && res.success) {
            if (btnDownloadText) btnDownloadText.textContent = 'Saved!';
            showStatus(`✓ Saved: ${res.filename || 'video.mp4'}`, 'success', 3500);

            // Revert button after 2.5s
            setTimeout(() => {
              btnDownloadActive.disabled = false;
              if (btnDownloadText) btnDownloadText.textContent = 'Download Video';
            }, 2500);
          } else {
            btnDownloadActive.disabled = false;
            if (btnDownloadText) btnDownloadText.textContent = 'Retry Download';
            showStatus(res?.error || 'Failed to download video stream.', 'error', 4500);

            setTimeout(() => {
              if (btnDownloadText && btnDownloadText.textContent === 'Retry Download') {
                btnDownloadText.textContent = 'Download Video';
              }
            }, 4000);
          }
        });
      });
    }
  } else {
    // Inactive / Non-TikTok State
    if (statusDot) statusDot.className = 'status-dot idle';
    if (stateTiktok) stateTiktok.style.display = 'none';
    if (stateEmpty) stateEmpty.style.display = 'flex';
    if (btnDownloadActive) btnDownloadActive.style.display = 'none';
    if (btnOpenTikTok) btnOpenTikTok.style.display = 'inline-flex';
    if (platformTitle) platformTitle.textContent = 'Not on TikTok';
    if (platformDesc) platformDesc.textContent = 'Open TikTok Web to start downloading videos directly.';
  }
});
