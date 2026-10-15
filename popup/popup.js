/**
 * Direct Downloader - Popup Controller
 * Supports Multi-Platform Context Switching (TikTok & Bstation)
 * Implements Linear / Raycast Minimalist Context Architecture
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Element Bindings (defensive dual-binding)
  const statusDot = document.getElementById('status-dot');
  const stateTiktok = document.getElementById('state-tiktok') || document.getElementById('context-active');
  const stateBstation = document.getElementById('state-bstation');
  const stateEmpty = document.getElementById('state-empty') || document.getElementById('context-inactive') || document.getElementById('platform-card');
  const videoAuthor = document.getElementById('video-author') || document.getElementById('video-creator');
  const videoDesc = document.getElementById('video-desc') || document.getElementById('video-title');
  const videoStatusChip = document.getElementById('video-status-chip');
  const bstationTitle = document.getElementById('bstation-title');
  const bstationEpBadge = document.getElementById('bstation-ep-badge');
  const bstationStatusChip = document.getElementById('bstation-status-chip');
  const btnDownloadActive = document.getElementById('btn-download-active');
  const btnDownloadText = document.getElementById('btn-download-text');
  const btnOpenTikTok = document.getElementById('btn-open-tiktok');
  const btnOpenBstation = document.getElementById('btn-open-bstation');
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

  if (btnOpenBstation) {
    btnOpenBstation.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: 'https://www.bilibili.tv' });
        } else if (typeof window !== 'undefined' && window.open) {
          window.open('https://www.bilibili.tv', '_blank');
        }
      } catch (err) {
        console.warn('[Popup] open Bstation tab failed:', err);
      }
    });
  }

  // 5. Active Tab Detection & Platform Resolution
  let activeTab = null;
  let isTikTok = false;
  let isBstation = false;

  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab;
      const tabUrl = (tab && tab.url) ? tab.url : '';
      if (tabUrl) {
        try {
          const parsed = new URL(tabUrl);
          const host = parsed.hostname;
          isTikTok = host === 'tiktok.com' || host.endsWith('.tiktok.com');
          isBstation = host === 'bilibili.tv' || host.endsWith('.bilibili.tv') ||
                       host === 'bstation.tv' || host.endsWith('.bstation.tv');
        } catch (_) {
          isTikTok = tabUrl.includes('tiktok.com');
          isBstation = tabUrl.includes('bilibili.tv') || tabUrl.includes('bstation.tv');
        }
      }
    }
  } catch (err) {
    console.warn('[Popup] Tab query failed:', err);
  }

  // 6. View Rendering & Context State Setup
  if (isTikTok && activeTab && activeTab.id) {
    // Online / Active TikTok State
    if (statusDot) statusDot.className = 'status-dot online';
    if (stateTiktok) stateTiktok.style.display = 'flex';
    if (stateBstation) stateBstation.style.display = 'none';
    if (stateEmpty) stateEmpty.style.display = 'none';
    if (btnDownloadActive) btnDownloadActive.style.display = 'inline-flex';
    if (btnDownloadText) btnDownloadText.textContent = 'Download Video';

    // Query active video metadata via GET_ACTIVE_VIDEO_INFO
    try {
      chrome.tabs.sendMessage(activeTab.id, { type: 'GET_ACTIVE_VIDEO_INFO' }, (response) => {
        if (chrome.runtime.lastError) {
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

    // Handle "Download Video" click
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
  } else if (isBstation && activeTab && activeTab.id) {
    // Online / Active Bstation State
    if (statusDot) statusDot.className = 'status-dot online';
    if (stateTiktok) stateTiktok.style.display = 'none';
    if (stateBstation) stateBstation.style.display = 'flex';
    if (stateEmpty) stateEmpty.style.display = 'none';
    if (btnDownloadActive) btnDownloadActive.style.display = 'inline-flex';
    if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video Aktif';

    // Query active Bstation video metadata
    try {
      chrome.tabs.sendMessage(activeTab.id, { type: 'GET_BSTATION_ACTIVE_VIDEO_INFO' }, (response) => {
        if (chrome.runtime.lastError) {
          if (bstationTitle) bstationTitle.textContent = 'Bstation Anime Active';
          if (bstationEpBadge) bstationEpBadge.textContent = 'Reload tab (F5) to enable 1-click download';
          if (bstationStatusChip) {
            bstationStatusChip.textContent = 'Connected';
            bstationStatusChip.style.color = 'var(--text-muted)';
          }
          return;
        }

        if (response && response.success) {
          if (bstationTitle) bstationTitle.textContent = response.title || 'Anime';
          if (bstationEpBadge) bstationEpBadge.textContent = `${response.episode || 'E01'} • ${response.quality || '720p'}`;
          if (bstationStatusChip) {
            bstationStatusChip.textContent = response.isVip ? 'VIP Ready' : 'Ready';
            bstationStatusChip.style.color = 'var(--accent-green)';
          }
        }
      });
    } catch (err) {
      console.warn('[Popup] Bstation query failed:', err);
    }

    // Handle "Unduh Video Aktif" click
    if (btnDownloadActive) {
      btnDownloadActive.addEventListener('click', () => {
        if (btnDownloadActive.disabled || !activeTab || !activeTab.id) return;

        btnDownloadActive.disabled = true;
        if (btnDownloadText) btnDownloadText.textContent = 'Mengunduh...';
        showStatus('Mengunduh aliran video Bstation...', 'info', 0);

        chrome.tabs.sendMessage(activeTab.id, { type: 'DOWNLOAD_ACTIVE_VIDEO' }, (res) => {
          if (chrome.runtime.lastError) {
            btnDownloadActive.disabled = false;
            if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video Aktif';
            showStatus('Mohon refresh tab Bstation (F5).', 'error', 5000);
            return;
          }

          if (res && res.success) {
            if (btnDownloadText) btnDownloadText.textContent = 'Tersimpan!';
            showStatus(`✓ Tersimpan: ${res.filename || 'video.mp4'}`, 'success', 3500);

            setTimeout(() => {
              btnDownloadActive.disabled = false;
              if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video Aktif';
            }, 2500);
          } else {
            btnDownloadActive.disabled = false;
            if (btnDownloadText) btnDownloadText.textContent = 'Coba Lagi';
            showStatus(res?.error || 'Gagal mengunduh video.', 'error', 4500);

            setTimeout(() => {
              if (btnDownloadText && btnDownloadText.textContent === 'Coba Lagi') {
                btnDownloadText.textContent = 'Unduh Video Aktif';
              }
            }, 4000);
          }
        });
      });
    }
  } else {
    // Inactive / Non-Supported State
    if (statusDot) statusDot.className = 'status-dot idle';
    if (stateTiktok) stateTiktok.style.display = 'none';
    if (stateBstation) stateBstation.style.display = 'none';
    if (stateEmpty) stateEmpty.style.display = 'flex';
    if (btnDownloadActive) btnDownloadActive.style.display = 'none';
    if (platformTitle) platformTitle.textContent = 'Not on Supported Platform';
    if (platformDesc) platformDesc.textContent = 'Open TikTok or Bstation Web to start downloading videos directly.';
  }
});
