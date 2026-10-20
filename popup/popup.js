/**
 * Direct Downloader - Popup Controller
 * Supports Multi-Platform Context Switching (TikTok & Bstation)
 * Implements Linear / Raycast Minimalist Context Architecture
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Element Bindings (defensive dual-binding)
  const statusDot = document.getElementById('status-dot');
  const stateTiktok =
    document.getElementById('state-tiktok') || document.getElementById('context-active');
  const stateBstation = document.getElementById('state-bstation');
  const stateEmpty =
    document.getElementById('state-empty') ||
    document.getElementById('context-inactive') ||
    document.getElementById('platform-card');
  const videoAuthor =
    document.getElementById('video-author') || document.getElementById('video-creator');
  const videoDesc = document.getElementById('video-desc') || document.getElementById('video-title');
  const videoStatusChip = document.getElementById('video-status-chip');
  const bstationTitle = document.getElementById('bstation-title');
  const bstationEpBadge = document.getElementById('bstation-ep-badge');
  const bstationStatusChip = document.getElementById('bstation-status-chip');
  const bsQualitySelect = document.getElementById('bs-quality-select');
  const bsQualityEstBadge = document.getElementById('bs-quality-est-badge');
  const stateJwplyr = document.getElementById('state-jwplyr');
  const jwplyrTitle = document.getElementById('jwplyr-title');
  const jwplyrDesc = document.getElementById('jwplyr-desc');
  const jwplyrStatusChip = document.getElementById('jwplyr-status-chip');
  const stateYoutube = document.getElementById('state-youtube');
  const ytTitle = document.getElementById('yt-title');
  const ytAuthor = document.getElementById('yt-author');
  const ytStatusChip = document.getElementById('yt-status-chip');
  const ytQualitySelect = document.getElementById('yt-quality-select');
  const ytQualityEstBadge = document.getElementById('yt-quality-est-badge');
  const btnDownloadActive = document.getElementById('btn-download-active');
  const btnDownloadText = document.getElementById('btn-download-text');
  const btnOpenTikTok = document.getElementById('btn-open-tiktok');
  const btnOpenBstation = document.getElementById('btn-open-bstation');
  const btnOpenJwplyr = document.getElementById('btn-open-jwplyr');
  const btnOpenYoutube = document.getElementById('btn-open-youtube');
  const btnOpenDownloads = document.getElementById('btn-open-downloads');
  const downloadCountEl = document.getElementById('download-count');
  const statusPill = document.getElementById('popup-status-msg');
  const platformTitle = document.getElementById('platform-title');
  const platformDesc = document.getElementById('platform-desc');
  const metricLabel = document.querySelector('.metric-label');
  const toggleDataSaver = document.getElementById('toggle-data-saver');
  const prefDesc = document.getElementById('pref-desc');
  const prefBadge = document.getElementById('pref-badge');
  const activeTasksCard = document.getElementById('active-tasks-card');
  const activeTasksCount = document.getElementById('active-tasks-count');
  const activeTasksList = document.getElementById('active-tasks-list');

  let statusTimeout = null;

  // Active Tasks Queue Rendering (Live feedback for background yt-dlp tasks)
  function renderActiveTasks(activeDownloads) {
    if (!activeTasksCard || !activeTasksList || !activeTasksCount) return;
    const taskIds = activeDownloads ? Object.keys(activeDownloads) : [];
    const activeList = taskIds
      .map((id) => activeDownloads[id])
      .filter((t) => t && (t.status === 'downloading' || t.status === 'merging'));

    if (activeList.length === 0) {
      activeTasksCard.style.display = 'none';
      activeTasksList.innerHTML = '';
      activeTasksCount.textContent = '0';
      return;
    }

    activeTasksCard.style.display = 'flex';
    activeTasksCount.textContent = String(activeList.length);

    let html = '';
    for (const task of activeList) {
      const pct = Math.min(100, Math.max(0, Math.round(task.percent || 0)));
      const isMerging = task.status === 'merging';
      const stageText = isMerging ? 'Muxing MP4...' : task.part || 'Download';
      const metricsText = isMerging
        ? 'Menggabungkan format'
        : `${pct}%${task.speed ? ` • ${task.speed}` : ''}${task.eta ? ` • ETA ${task.eta}` : ''}`;
      const safeTitle = (task.title || 'YouTube Video').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      html += `
        <div class="active-task-item" data-video-id="${task.videoId || ''}">
          <div class="active-task-title" title="${safeTitle}">${safeTitle}</div>
          <div class="active-task-meta">
            <span class="active-task-stage">${stageText}</span>
            <span class="active-task-metrics">${metricsText}</span>
          </div>
          <div class="active-task-bar-bg">
            <div class="active-task-bar-fill" style="width: ${isMerging ? 99 : pct}%;"></div>
          </div>
        </div>
      `;
    }
    activeTasksList.innerHTML = html;
  }

  function refreshActiveTasks() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'GET_ACTIVE_DOWNLOADS' }, (res) => {
        if (chrome.runtime.lastError || !res || !res.activeDownloads) return;
        renderActiveTasks(res.activeDownloads);
      });
    }
  }

  // Initial active tasks poll
  refreshActiveTasks();

  // Listen for real-time progress broadcast from Service Worker
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (
        msg.type === 'YT_NATIVE_PROGRESS' ||
        msg.type === 'YT_NATIVE_COMPLETE' ||
        msg.type === 'YT_NATIVE_ERROR'
      ) {
        refreshActiveTasks();
      }
    });
  }

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

  // 4. Codec / Data Saver Preference Management
  const updatePrefUI = (isDataSaver) => {
    if (toggleDataSaver) toggleDataSaver.checked = isDataSaver;
    if (prefBadge) {
      prefBadge.textContent = isDataSaver ? 'Hemat ~60%' : 'H.264 (AVC)';
      prefBadge.style.color = isDataSaver ? 'var(--accent-green)' : 'var(--text-secondary)';
      prefBadge.style.background = isDataSaver
        ? 'rgba(34, 197, 94, 0.15)'
        : 'rgba(255, 255, 255, 0.08)';
    }
    if (prefDesc) {
      prefDesc.textContent = isDataSaver
        ? 'Prioritas HEVC / AV1 (Ukuran lebih kecil, kualitas sama)'
        : 'Kompatibilitas Maksimal (Standar H.264, ukuran asli)';
    }
  };

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['downloadCount', 'codecPreference'], (data) => {
        updateCounter(data?.downloadCount);
        const pref = data?.codecPreference || 'data_saver';
        updatePrefUI(pref === 'data_saver');
      });

      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local') {
            if (changes.downloadCount) {
              updateCounter(changes.downloadCount.newValue);
            }
            if (changes.codecPreference) {
              updatePrefUI(changes.codecPreference.newValue === 'data_saver');
            }
          }
        });
      }
    }
  } catch (_) {}

  if (toggleDataSaver) {
    toggleDataSaver.addEventListener('change', () => {
      const isDataSaver = toggleDataSaver.checked;
      const newPref = isDataSaver ? 'data_saver' : 'compatibility';
      updatePrefUI(isDataSaver);

      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ codecPreference: newPref }, () => {
            showStatus(
              isDataSaver
                ? 'Mode Hemat Kuota Aktif (HEVC/AV1: Hemat ~60%)'
                : 'Mode Kompatibilitas Aktif (Standar H.264)',
              'info',
              2500
            );
          });
        }
      } catch (_) {}
    });
  }

  // 4. Quick Action Listeners
  if (btnOpenDownloads) {
    btnOpenDownloads.addEventListener('click', () => {
      try {
        if (
          typeof chrome !== 'undefined' &&
          chrome.downloads &&
          chrome.downloads.showDefaultFolder
        ) {
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

  if (btnOpenJwplyr) {
    btnOpenJwplyr.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: 'https://jwplyr.com' });
        } else if (typeof window !== 'undefined' && window.open) {
          window.open('https://jwplyr.com', '_blank');
        }
      } catch (err) {
        console.warn('[Popup] open JWPlyr tab failed:', err);
      }
    });
  }

  if (btnOpenYoutube) {
    btnOpenYoutube.addEventListener('click', () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
          chrome.tabs.create({ url: 'https://www.youtube.com' });
        } else if (typeof window !== 'undefined' && window.open) {
          window.open('https://www.youtube.com', '_blank');
        }
      } catch (err) {
        console.warn('[Popup] open YouTube tab failed:', err);
      }
    });
  }

  let activeTab = null;
  let isTikTok = false;
  let isBstation = false;
  let isJwplyr = false;
  let isYoutube = false;

  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTab = tab;
      const tabUrl = tab && tab.url ? tab.url : '';
      if (tabUrl) {
        try {
          const parsed = new URL(tabUrl);
          const host = parsed.hostname;
          isTikTok = host === 'tiktok.com' || host.endsWith('.tiktok.com');
          isBstation =
            host === 'bilibili.tv' ||
            host.endsWith('.bilibili.tv') ||
            host === 'bstation.tv' ||
            host.endsWith('.bstation.tv');
          isJwplyr = host === 'jwplyr.com' || host.endsWith('.jwplyr.com');
          isYoutube =
            host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
        } catch (_) {
          isTikTok = tabUrl.includes('tiktok.com');
          isBstation = tabUrl.includes('bilibili.tv') || tabUrl.includes('bstation.tv');
          isJwplyr = tabUrl.includes('jwplyr.com');
          isYoutube = tabUrl.includes('youtube.com') || tabUrl.includes('youtu.be');
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
            const authorHandle =
              response.author && response.author !== 'unknown' && response.author !== ''
                ? response.author.startsWith('@')
                  ? response.author
                  : `@${response.author}`
                : 'Video Ready';
            if (videoAuthor) videoAuthor.textContent = authorHandle;
            if (videoDesc)
              videoDesc.textContent = response.title || 'Direct stream ready for download';
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
    if (stateJwplyr) stateJwplyr.style.display = 'none';
    if (stateYoutube) stateYoutube.style.display = 'none';
    if (stateEmpty) stateEmpty.style.display = 'none';
    if (btnDownloadActive) btnDownloadActive.style.display = 'inline-flex';
    if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video Aktif';

    // Quality preference & size estimation state for Bstation
    let currentBsQuality = '720p';
    let cachedBsSizes = {
      '1080p': '~648 MB',
      '720p': '~316 MB',
      '480p': '~144 MB',
      '360p': '~72 MB'
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['bstationSelectedQuality'], (data) => {
        if (data && data.bstationSelectedQuality) {
          currentBsQuality = data.bstationSelectedQuality;
          if (bsQualitySelect) bsQualitySelect.value = currentBsQuality;
          if (bsQualityEstBadge)
            bsQualityEstBadge.textContent = cachedBsSizes[currentBsQuality] || '~316 MB';
        }
      });
    }

    if (bsQualitySelect) {
      bsQualitySelect.addEventListener('change', () => {
        currentBsQuality = bsQualitySelect.value;
        if (bsQualityEstBadge) {
          bsQualityEstBadge.textContent = cachedBsSizes[currentBsQuality] || '~316 MB';
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ bstationSelectedQuality: currentBsQuality });
        }
        if (bstationEpBadge && bstationEpBadge.textContent) {
          const parts = bstationEpBadge.textContent.split('•');
          if (parts.length > 0) {
            bstationEpBadge.textContent = `${parts[0].trim()} • ${currentBsQuality}`;
          }
        }
      });
    }

    // Query active Bstation video metadata
    try {
      chrome.tabs.sendMessage(
        activeTab.id,
        { type: 'GET_BSTATION_ACTIVE_VIDEO_INFO' },
        (response) => {
          if (chrome.runtime.lastError) {
            if (bstationTitle) bstationTitle.textContent = 'Bstation Anime Active';
            if (bstationEpBadge)
              bstationEpBadge.textContent = 'Reload tab (F5) to enable 1-click download';
            if (bstationStatusChip) {
              bstationStatusChip.textContent = 'Connected';
              bstationStatusChip.style.color = 'var(--text-muted)';
            }
            return;
          }

          if (response && response.success) {
            if (bstationTitle) bstationTitle.textContent = response.title || 'Anime';
            if (bstationEpBadge)
              bstationEpBadge.textContent = `${response.episode || 'E01'} • ${response.quality || currentBsQuality}`;
            if (bstationStatusChip) {
              bstationStatusChip.textContent = response.isVip ? 'VIP Ready' : 'Ready';
              bstationStatusChip.style.color = 'var(--accent-green)';
            }

            if (response.estimatedSizes && typeof response.estimatedSizes === 'object') {
              cachedBsSizes = response.estimatedSizes;
              if (bsQualityEstBadge) {
                bsQualityEstBadge.textContent = cachedBsSizes[currentBsQuality] || '~316 MB';
              }
            }

            if (response.videoId) {
              chrome.runtime.sendMessage(
                { action: 'CHECK_DOWNLOADED_STATUS', videoId: response.videoId },
                (statusRes) => {
                  if (chrome.runtime.lastError || !statusRes) return;
                  if (statusRes.downloaded) {
                    if (btnDownloadText)
                      btnDownloadText.textContent = 'Sudah Diunduh (Download Lagi?)';
                    if (btnDownloadActive) btnDownloadActive.classList.add('is-downloaded');
                  }
                }
              );
            }
          }
        }
      );
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

        chrome.tabs.sendMessage(
          activeTab.id,
          {
            type: 'DOWNLOAD_ACTIVE_VIDEO',
            quality: currentBsQuality
          },
          (res) => {
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
                if (btnDownloadText) btnDownloadText.textContent = 'Sudah Diunduh (Download Lagi?)';
                btnDownloadActive.classList.add('is-downloaded');
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
          }
        );
      });
    }
  } else if (isJwplyr && activeTab && activeTab.id) {
    // Online / Active JWPlyr State
    if (statusDot) statusDot.className = 'status-dot online';
    if (stateTiktok) stateTiktok.style.display = 'none';
    if (stateBstation) stateBstation.style.display = 'none';
    if (stateJwplyr) stateJwplyr.style.display = 'flex';
    if (stateEmpty) stateEmpty.style.display = 'none';
    if (btnDownloadActive) btnDownloadActive.style.display = 'inline-flex';
    if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video';

    // Query active JWPlyr metadata
    try {
      chrome.tabs.sendMessage(activeTab.id, { type: 'GET_ACTIVE_VIDEO_INFO' }, (response) => {
        if (chrome.runtime.lastError) {
          if (jwplyrTitle) jwplyrTitle.textContent = 'JWPlyr Active';
          if (jwplyrDesc) jwplyrDesc.textContent = 'Reload tab (F5) to enable 1-click download';
          if (jwplyrStatusChip) {
            jwplyrStatusChip.textContent = 'Connected';
            jwplyrStatusChip.style.color = 'var(--text-muted)';
          }
          return;
        }

        if (response && response.success) {
          if (response.ready) {
            if (response.isFolder) {
              if (jwplyrTitle) jwplyrTitle.textContent = response.title || 'Folder Video';
              if (jwplyrDesc)
                jwplyrDesc.textContent = `${response.count || 0} video • 1-Click Batch`;
              if (btnDownloadText) btnDownloadText.textContent = 'Buka Batch Downloader';
            } else {
              if (jwplyrTitle) jwplyrTitle.textContent = response.title || 'Video JWPlyr';
              if (jwplyrDesc) jwplyrDesc.textContent = 'Direct stream ready for download';
              if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video';
            }
            if (jwplyrStatusChip) {
              jwplyrStatusChip.textContent = 'Ready';
              jwplyrStatusChip.style.color = 'var(--accent-pink, #fe6081)';
            }
          } else {
            if (jwplyrTitle) jwplyrTitle.textContent = 'JWPlyr Video';
            if (jwplyrDesc)
              jwplyrDesc.textContent = 'Buka folder atau tonton video untuk mengunduh';
            if (jwplyrStatusChip) {
              jwplyrStatusChip.textContent = 'Detecting';
              jwplyrStatusChip.style.color = 'var(--accent-cyan)';
            }
          }
        }
      });
    } catch (err) {
      console.warn('[Popup] GET_ACTIVE_VIDEO_INFO query failed:', err);
    }

    // Handle JWPlyr download click
    if (btnDownloadActive) {
      btnDownloadActive.addEventListener('click', () => {
        if (btnDownloadActive.disabled || !activeTab || !activeTab.id) return;

        btnDownloadActive.disabled = true;
        if (btnDownloadText) btnDownloadText.textContent = 'Memproses...';
        showStatus('Mengekstrak stream JWPlyr...', 'info', 0);

        chrome.tabs.sendMessage(activeTab.id, { type: 'DOWNLOAD_ACTIVE_VIDEO' }, (res) => {
          if (chrome.runtime.lastError) {
            btnDownloadActive.disabled = false;
            if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video';
            showStatus('Mohon refresh tab JWPlyr (F5).', 'error', 5000);
            return;
          }

          if (res && res.success) {
            if (btnDownloadText) btnDownloadText.textContent = 'Tersimpan!';
            showStatus(
              `✓ ${res.filename ? 'Tersimpan: ' + res.filename : 'Berhasil diproses!'}`,
              'success',
              3500
            );

            setTimeout(() => {
              btnDownloadActive.disabled = false;
              if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video';
            }, 2500);
          } else {
            btnDownloadActive.disabled = false;
            if (btnDownloadText) btnDownloadText.textContent = 'Coba Lagi';
            showStatus(res?.error || 'Gagal mengunduh video.', 'error', 4500);

            setTimeout(() => {
              if (btnDownloadText && btnDownloadText.textContent === 'Coba Lagi') {
                btnDownloadText.textContent = 'Unduh Video';
              }
            }, 4000);
          }
        });
      });
    }
  } else if (isYoutube && activeTab && activeTab.id) {
    // Online / Active YouTube State
    if (statusDot) statusDot.className = 'status-dot online';
    if (stateTiktok) stateTiktok.style.display = 'none';
    if (stateBstation) stateBstation.style.display = 'none';
    if (stateJwplyr) stateJwplyr.style.display = 'none';
    if (stateYoutube) stateYoutube.style.display = 'flex';
    if (stateEmpty) stateEmpty.style.display = 'none';
    if (btnDownloadActive) btnDownloadActive.style.display = 'inline-flex';
    if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video YouTube';

    // Quality preference & size estimation state for YouTube
    let currentYtQuality = '1080p';
    let cachedEstimatedSizes = {
      '1080p': '~45 MB',
      '720p': '~22 MB',
      '480p': '~11 MB',
      '360p': '~6 MB'
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['ytSelectedQuality'], (data) => {
        if (data && data.ytSelectedQuality) {
          currentYtQuality = data.ytSelectedQuality;
          if (ytQualitySelect) ytQualitySelect.value = currentYtQuality;
          if (ytQualityEstBadge)
            ytQualityEstBadge.textContent = cachedEstimatedSizes[currentYtQuality] || '~45 MB';
        }
      });
    }

    if (ytQualitySelect) {
      ytQualitySelect.addEventListener('change', () => {
        currentYtQuality = ytQualitySelect.value;
        if (ytQualityEstBadge) {
          ytQualityEstBadge.textContent = cachedEstimatedSizes[currentYtQuality] || '~45 MB';
        }
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ ytSelectedQuality: currentYtQuality });
        }
      });
    }

    // Query active YouTube video metadata
    try {
      chrome.tabs.sendMessage(activeTab.id, { action: 'GET_ACTIVE_VIDEO_INFO' }, (response) => {
        if (chrome.runtime.lastError) {
          if (ytTitle) ytTitle.textContent = 'YouTube Video Active';
          if (ytAuthor) ytAuthor.textContent = 'Buka video untuk mengunduh stream MP4';
          if (ytStatusChip) {
            ytStatusChip.textContent = 'Connected';
            ytStatusChip.style.color = 'var(--text-muted)';
          }
          return;
        }

        if (response && response.success) {
          if (ytTitle) ytTitle.textContent = response.title || 'YouTube Video';
          if (ytAuthor) ytAuthor.textContent = response.author ? `${response.author}` : 'Creator';
          if (ytStatusChip) {
            ytStatusChip.textContent = 'Ready';
            ytStatusChip.style.color = '#FF4D4D';
          }

          if (response.estimatedSizes && typeof response.estimatedSizes === 'object') {
            cachedEstimatedSizes = response.estimatedSizes;
            if (ytQualitySelect) {
              const opts = [
                { val: '1080p', label: `1080p (Full HD) • ${cachedEstimatedSizes['1080p'] || ''}` },
                { val: '720p', label: `720p (HD) • ${cachedEstimatedSizes['720p'] || ''}` },
                { val: '480p', label: `480p (Standar) • ${cachedEstimatedSizes['480p'] || ''}` },
                { val: '360p', label: `360p (Hemat) • ${cachedEstimatedSizes['360p'] || ''}` }
              ];
              ytQualitySelect.innerHTML = opts
                .map(
                  (o) =>
                    `<option value="${o.val}" ${o.val === currentYtQuality ? 'selected' : ''}>${o.label}</option>`
                )
                .join('');
            }
            if (ytQualityEstBadge) {
              ytQualityEstBadge.textContent = cachedEstimatedSizes[currentYtQuality] || '~45 MB';
            }
          }

          if (response.videoId) {
            chrome.runtime.sendMessage(
              { action: 'CHECK_DOWNLOADED_STATUS', videoId: response.videoId },
              (statusRes) => {
                if (chrome.runtime.lastError || !statusRes) return;
                if (statusRes.downloaded) {
                  if (btnDownloadText)
                    btnDownloadText.textContent = 'Sudah Diunduh (Download Lagi?)';
                  if (btnDownloadActive) btnDownloadActive.classList.add('is-downloaded');
                }
              }
            );
          }
        }
      });
    } catch (err) {
      console.warn('[Popup] YouTube query failed:', err);
    }

    // Handle "Unduh Video YouTube" click
    if (btnDownloadActive) {
      btnDownloadActive.addEventListener('click', () => {
        if (btnDownloadActive.disabled || !activeTab || !activeTab.id) return;

        btnDownloadActive.disabled = true;
        if (btnDownloadText) btnDownloadText.textContent = 'Mengunduh...';
        showStatus('Mengekstrak stream YouTube...', 'info', 0);

        chrome.tabs.sendMessage(
          activeTab.id,
          {
            type: 'DOWNLOAD_ACTIVE_VIDEO',
            quality: currentYtQuality
          },
          (res) => {
            if (chrome.runtime.lastError) {
              btnDownloadActive.disabled = false;
              if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video YouTube';
              showStatus('Gunakan tombol Download merah di halaman YouTube.', 'info', 5000);
              return;
            }

            if (res && res.success) {
              if (res.alreadyActive) {
                btnDownloadActive.disabled = true;
                if (btnDownloadText) btnDownloadText.textContent = 'Sedang Mengunduh...';
                showStatus(res.message || 'Video ini sedang diproses oleh yt-dlp...', 'info', 4000);
                refreshActiveTasks();
              } else {
                if (btnDownloadText) btnDownloadText.textContent = 'Tersimpan!';
                showStatus(
                  `✓ ${res.filename ? 'Tersimpan: ' + res.filename : 'Video tersimpan!'}`,
                  'success',
                  3500
                );
                refreshActiveTasks();

                setTimeout(() => {
                  btnDownloadActive.disabled = false;
                  if (btnDownloadText) btnDownloadText.textContent = 'Unduh Video YouTube';
                }, 2500);
              }
            } else {
              btnDownloadActive.disabled = false;
              if (btnDownloadText) btnDownloadText.textContent = 'Coba Lagi';
              showStatus(res?.error || 'Gagal mengunduh stream YouTube.', 'error', 4500);

              setTimeout(() => {
                if (btnDownloadText && btnDownloadText.textContent === 'Coba Lagi') {
                  btnDownloadText.textContent = 'Unduh Video YouTube';
                }
              }, 4000);
            }
          }
        );
      });
    }
  } else {
    // Inactive / Non-Supported State
    if (statusDot) statusDot.className = 'status-dot idle';
    if (stateTiktok) stateTiktok.style.display = 'none';
    if (stateBstation) stateBstation.style.display = 'none';
    if (stateJwplyr) stateJwplyr.style.display = 'none';
    if (stateYoutube) stateYoutube.style.display = 'none';
    if (stateEmpty) stateEmpty.style.display = 'flex';
    if (btnDownloadActive) btnDownloadActive.style.display = 'none';
    if (platformTitle) platformTitle.textContent = 'Not on Supported Platform';
    if (platformDesc)
      platformDesc.textContent =
        'Open TikTok, Bstation, JWPlyr, or YouTube Web to start downloading videos directly.';
  }
});
