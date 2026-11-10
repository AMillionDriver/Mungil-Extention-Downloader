/**
 * Doodstream Direct Downloader - Multi-System Content Platform Script
 * Runs in the ISOLATED world at document_idle (with all_frames: true).
 *
 * Supports 3 Architectures:
 * 1. Direct Web (/d/{id}) - Bypass countdown & ads via /e/ conversion
 * 2. Standard Embed (/e/{id}) - Known mirror domains (dood.to, ds2play.com, do0od.co, etc.)
 * 3. Custom Domain CNAME - Dynamic fingerprinting via /pass_md5/ and makePlay()
 *
 * Zero-Leak Event Listener Architecture & Strict Windows NTFS Sanitization.
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. Doodstream Fingerprint Detection (Fail-Fast for Non-Dood Pages)
  // =========================================================================

  const KNOWN_DOOD_HOSTS = [
    'dood.to',
    'doodstream.com',
    'dood.so',
    'dood.la',
    'dood.ws',
    'dood.wf',
    'dood.re',
    'dood.pm',
    'ds2play.com',
    'do0od.co',
    'dood.cx',
    'dood.sh'
  ];

  function isDoodHost(hostname) {
    if (!hostname) return false;
    const lower = hostname.toLowerCase();
    return KNOWN_DOOD_HOSTS.some((h) => lower === h || lower.endsWith(`.${h}`));
  }

  function detectDoodEngine() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return null;
    }
    const host = window.location?.hostname || '';
    const path = window.location?.pathname || '';

    // Check direct host match
    if (isDoodHost(host)) {
      if (path.includes('/d/')) return { type: 'DIRECT_WEB', host, path };
      if (path.includes('/e/')) return { type: 'EMBED', host, path };
      return { type: 'UNKNOWN_DOOD', host, path };
    }

    // Check CNAME or embedded iframe with /pass_md5/
    if (path.includes('/e/')) {
      const html = document.documentElement ? document.documentElement.innerHTML : '';
      if (html.includes('/pass_md5/') || typeof window.makePlay === 'function') {
        return { type: 'CNAME_EMBED', host, path };
      }
    }

    // Fallback: check scripts inside page for pass_md5
    if (typeof document.querySelectorAll === 'function') {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (text.includes('/pass_md5/') || text.includes('makePlay')) {
          return { type: 'CNAME_EMBED', host, path };
        }
      }
    }

    return null;
  }

  // Node.js test environment export guard
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isDoodHost,
      detectDoodEngine,
      sanitizeDoodTitle,
      formatDoodFilename,
      generateDoodSalt,
      buildDoodFinalUrl,
      extractPassMd5Endpoint
    };
  }

  const doodEngine = detectDoodEngine();
  if (!doodEngine) {
    // Not a Doodstream page/frame, exit silently
    return;
  }

  // =========================================================================
  // 2. Windows NTFS Filename Sanitization Utilities
  // =========================================================================

  function sanitizeDoodTitle(title) {
    if (title === null || title === undefined) return 'Doodstream_Video';
    let str = String(title).trim();
    if (!str) return 'Doodstream_Video';

    // Normalize colons and slashes
    str = str.replace(/[:：]/g, ' - ');
    str = str.replace(/[/\\|]/g, '-');

    // Strip Win32 forbidden characters (* ? " < >) and control codes
    str = str.replace(/[*?"<>|\x00-\x1f\x7f-\x9f]/g, '');

    // Collapse consecutive whitespace and dashes
    str = str.replace(/\s+/g, ' ');
    str = str.replace(/-{2,}/g, '-');
    str = str.replace(/\s*-\s*/g, ' - ');

    // Trim dots and hyphens
    str = str.replace(/^[.\s_-]+|[.\s_-]+$/g, '');
    str = str.slice(0, 120).trim();

    return str || 'Doodstream_Video';
  }

  function formatDoodFilename(title, id) {
    const raw = title !== null && title !== undefined ? String(title).trim() : '';
    const safe = sanitizeDoodTitle(raw || (id ? `dood_${id}` : 'Doodstream_Video'));
    if (safe.toLowerCase().endsWith('.mp4')) {
      return safe;
    }
    return `${safe}.mp4`;
  }

  // =========================================================================
  // 3. Dynamic Salt & Final Video URL Generator (makePlay simulation)
  // =========================================================================

  function generateDoodSalt(length = 10) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let salt = '';
    for (let i = 0; i < length; i++) {
      salt += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return salt;
  }

  function buildDoodFinalUrl(baseCdnUrl, tokenKey) {
    if (!baseCdnUrl) return null;
    const salt = generateDoodSalt(10);
    const expiry = Date.now();
    const cleanBase = baseCdnUrl.endsWith('~') ? baseCdnUrl : `${baseCdnUrl}~`;
    return `${cleanBase}${salt}?token=${encodeURIComponent(tokenKey || '')}&expiry=${expiry}`;
  }

  // =========================================================================
  // 4. Token & pass_md5 Extraction Engine
  // =========================================================================

  function extractPassMd5Endpoint() {
    const html = document.documentElement ? document.documentElement.innerHTML : '';

    // Pattern 1: $.get('/pass_md5/xyz/abc'
    const m1 = html.match(/\/pass_md5\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?/);
    if (m1) {
      const fullPath = m1[0];
      const token = m1[2] || m1[1];
      return { path: fullPath, token };
    }

    // Pattern 2: /pass_md5/ concatenated in JS
    const m2 = html.match(/['"]\/pass_md5\/['"]\s*\+\s*['"]([a-zA-Z0-9_-]+)['"]/);
    if (m2) {
      return { path: `/pass_md5/${m2[1]}`, token: m2[1] };
    }

    return null;
  }

  function extractVideoTitle() {
    // Try meta tags or page title
    const titleTag = document.querySelector('title');
    let title = titleTag ? titleTag.textContent : '';
    title = title.replace(/\s*-\s*DoodStream.*$/i, '').trim();

    if (!title || title.toLowerCase() === 'doodstream') {
      const h1 = document.querySelector('h1, .video-title, #video-title');
      if (h1 && h1.textContent) title = h1.textContent.trim();
    }

    return title || 'Doodstream_Video';
  }

  // =========================================================================
  // 5. Mini Progress Widget (Zero-Leak Persistent Lifecycle)
  // =========================================================================

  let activeWidgetEl = null;
  let activeFillEl = null;
  let activePercentEl = null;
  let activeSpeedEl = null;
  let activePlayBtn = null;
  let activePauseBtn = null;
  let activeCurrentJobId = null;

  function createProgressWidget(filename, jobId) {
    if (activeWidgetEl) {
      activeWidgetEl.remove();
      activeWidgetEl = null;
    }

    activeCurrentJobId = jobId;

    const widget = document.createElement('div');
    widget.className = 'dood-progress-widget';

    const header = document.createElement('div');
    header.className = 'dood-widget-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'dood-widget-title';
    titleEl.textContent = filename;

    const percentEl = document.createElement('span');
    percentEl.className = 'dood-widget-percent';
    percentEl.textContent = '0%';

    header.appendChild(titleEl);
    header.appendChild(percentEl);

    const barBg = document.createElement('div');
    barBg.className = 'dood-progress-bar-bg';

    const barFill = document.createElement('div');
    barFill.className = 'dood-progress-bar-fill';
    barBg.appendChild(barFill);

    const footer = document.createElement('div');
    footer.className = 'dood-widget-footer';

    const speedEl = document.createElement('span');
    speedEl.className = 'dood-widget-speed';
    speedEl.textContent = 'Memulai multi-chunk...';

    const ctrls = document.createElement('div');
    ctrls.className = 'dood-widget-ctrls';

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'dood-btn-icon';
    pauseBtn.title = 'Pause';
    pauseBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'dood-btn-icon';
    playBtn.title = 'Resume';
    playBtn.style.display = 'none';
    playBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'dood-btn-icon';
    cancelBtn.title = 'Cancel';
    cancelBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

    ctrls.appendChild(pauseBtn);
    ctrls.appendChild(playBtn);
    ctrls.appendChild(cancelBtn);

    footer.appendChild(speedEl);
    footer.appendChild(ctrls);

    widget.appendChild(header);
    widget.appendChild(barBg);
    widget.appendChild(footer);

    // Event Listeners bound ONCE
    pauseBtn.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'NATIVE_HOST_PAUSE',
          jobId: activeCurrentJobId
        });
        pauseBtn.style.display = 'none';
        playBtn.style.display = 'inline-flex';
        speedEl.textContent = 'Dijeda';
      }
    });

    playBtn.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'NATIVE_HOST_RESUME',
          jobId: activeCurrentJobId
        });
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'inline-flex';
        speedEl.textContent = 'Melanjutkan...';
      }
    });

    cancelBtn.addEventListener('click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'NATIVE_HOST_CANCEL',
          jobId: activeCurrentJobId
        });
      }
      widget.remove();
      activeWidgetEl = null;
    });

    document.body.appendChild(widget);

    activeWidgetEl = widget;
    activeFillEl = barFill;
    activePercentEl = percentEl;
    activeSpeedEl = speedEl;
    activePauseBtn = pauseBtn;
    activePlayBtn = playBtn;

    return widget;
  }

  function updateProgressWidget(msg) {
    if (!activeWidgetEl) return;
    const pct = typeof msg.percent === 'number' ? Math.round(msg.percent) : 0;
    if (activeFillEl) activeFillEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (activePercentEl) activePercentEl.textContent = `${pct}%`;
    const speed = msg.speedText || msg.speed;
    if (activeSpeedEl && speed) activeSpeedEl.textContent = speed;

    if (msg.status === 'paused') {
      if (activeSpeedEl) activeSpeedEl.textContent = 'Dijeda';
      if (activePauseBtn) activePauseBtn.style.display = 'none';
      if (activePlayBtn) activePlayBtn.style.display = 'inline-flex';
    } else if (msg.status === 'downloading') {
      if (activePlayBtn) activePlayBtn.style.display = 'none';
      if (activePauseBtn) activePauseBtn.style.display = 'inline-flex';
    }

    if (msg.status === 'complete' || pct === 100) {
      if (activeSpeedEl) activeSpeedEl.textContent = 'Selesai 100%';
      if (activePauseBtn) activePauseBtn.style.display = 'none';
      if (activePlayBtn) activePlayBtn.style.display = 'none';
      activeCurrentJobId = null;
      setTimeout(() => {
        if (activeWidgetEl) {
          activeWidgetEl.remove();
          activeWidgetEl = null;
        }
      }, 3500);
    }
  }

  function handleProgressError(msg) {
    if (!activeWidgetEl) return;
    if (activeSpeedEl) {
      activeSpeedEl.textContent = `Gagal: ${msg.error || 'Koneksi terputus'}`;
      activeSpeedEl.style.color = 'var(--dood-danger, #ef4444)';
    }
    if (activePauseBtn) activePauseBtn.style.display = 'none';
    if (activePlayBtn) activePlayBtn.style.display = 'none';
    activeCurrentJobId = null;
  }

  function findActiveVideoElement() {
    const video = document.querySelector('video');
    if (video && video.src && !video.src.startsWith('blob:') && video.src.startsWith('http')) {
      return video.src;
    }
    const source = document.querySelector('video source');
    if (source && source.src && !source.src.startsWith('blob:') && source.src.startsWith('http')) {
      return source.src;
    }
    return null;
  }

  // =========================================================================
  // 6. Download Trigger & Stream Resolution
  // =========================================================================

  let isResolving = false;

  async function startDoodDownload(triggerBtn) {
    if (activeCurrentJobId) {
      // Download already in progress - visual feedback
      if (activeWidgetEl) {
        activeWidgetEl.style.transition = 'transform 0.15s ease, box-shadow 0.15s ease';
        activeWidgetEl.style.transform = 'scale(1.04)';
        activeWidgetEl.style.boxShadow = '0 0 20px rgba(99, 102, 241, 0.6)';
        setTimeout(() => {
          if (activeWidgetEl) {
            activeWidgetEl.style.transform = 'scale(1)';
            activeWidgetEl.style.boxShadow = '';
          }
        }, 200);
      }
      return;
    }
    if (isResolving) return;
    isResolving = true;
    if (triggerBtn) triggerBtn.disabled = true;

    try {
      const referer = window.location.href;
      let finalVideoUrl = findActiveVideoElement();

      // If video element hasn't populated src yet, attempt to trigger play and poll
      if (!finalVideoUrl) {
        const bigPlayBtn =
          document.querySelector('.vjs-big-play-button') ||
          document.querySelector('.play-btn') ||
          document.querySelector('#os_player') ||
          document.querySelector('video');
        if (bigPlayBtn) {
          try {
            bigPlayBtn.click();
          } catch (_) {}
        }
        const video = document.querySelector('video');
        if (video) {
          try {
            video.play().catch(() => {});
          } catch (_) {}
        }

        // Poll up to 3 seconds for dsplayer to finish /pass_md5/ and set video.src
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 200));
          finalVideoUrl = findActiveVideoElement();
          if (finalVideoUrl) break;
        }
      }

      // Fallback: try pass_md5 endpoint extraction if available
      if (!finalVideoUrl) {
        const passData = extractPassMd5Endpoint();
        if (passData) {
          const passUrl = `${window.location.origin}${passData.path}`;

          // Ask service worker to fetch pass_md5 with correct Referer header
          try {
            const res = await new Promise((resolve, reject) => {
              if (!chrome.runtime || !chrome.runtime.sendMessage) {
                return reject(new Error('Extension runtime offline'));
              }
              chrome.runtime.sendMessage(
                {
                  action: 'RESOLVE_DOOD_STREAM',
                  passUrl,
                  referer
                },
                (response) => {
                  if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                  }
                  if (!response || !response.success) {
                    return reject(
                      new Error(response?.error || 'Gagal mengambil base token Doodstream')
                    );
                  }
                  resolve(response);
                }
              );
            });

            const baseCdnUrl = res.baseCdnUrl;
            finalVideoUrl = buildDoodFinalUrl(baseCdnUrl, passData.token);
          } catch (_) {
            // Handshake blocked or failed
          }
        }
      }

      if (!finalVideoUrl) {
        throw new Error(
          'Video belum diputar! Silakan tekan tombol Play pada video terlebih dahulu agar token stream aktif, lalu klik Download lagi.'
        );
      }

      const title = extractVideoTitle();
      const filename = formatDoodFilename(title);
      const jobId = `dood_${Date.now()}`;

      // Show in-page mini progress widget
      createProgressWidget(filename, jobId);

      // Start download via Native Host multi-chunker
      chrome.runtime.sendMessage({
        action: 'NATIVE_DOWNLOAD_STREAM',
        jobId,
        url: finalVideoUrl,
        filename,
        title,
        author: 'Doodstream',
        headers: {
          Referer: referer,
          'User-Agent': navigator.userAgent
        }
      });
    } catch (err) {
      console.error('[Doodstream Downloader] Error:', err);
      alert(`[Doodstream] Gagal memulai unduhan: ${err.message}`);
    } finally {
      isResolving = false;
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  // =========================================================================
  // 7. In-Page UI Injection
  // =========================================================================

  function injectDoodUI() {
    if (document.getElementById('dood-dl-btn')) return;

    if (doodEngine.type === 'DIRECT_WEB') {
      // Direct Web (/d/): Inject Hero Download Button
      const container =
        document.querySelector('.download-content, #download_section, .video-details') ||
        document.body;
      const heroBtn = document.createElement('button');
      heroBtn.type = 'button';
      heroBtn.id = 'dood-dl-btn';
      heroBtn.className = 'dood-web-hero-btn';
      heroBtn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Unduh Video (Bypass Timer)';
      heroBtn.addEventListener('click', () => startDoodDownload(heroBtn));
      container.prepend(heroBtn);
    } else {
      // Embed (/e/) or CNAME: Inject Floating Action Button on Player
      const floatingBtn = document.createElement('button');
      floatingBtn.type = 'button';
      floatingBtn.id = 'dood-dl-btn';
      floatingBtn.className = 'dood-dl-floating-btn';
      floatingBtn.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> <span>Download MP4</span>';
      floatingBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startDoodDownload(floatingBtn);
      });
      document.body.appendChild(floatingBtn);
    }
  }

  // Global Message & Progress Listener
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const type = msg.type || msg.action;
      const id = msg.jobId || msg.videoId;

      if (
        type === 'ANOBOY_NATIVE_PROGRESS' ||
        type === 'DOOD_NATIVE_PROGRESS' ||
        type === 'NATIVE_DOWNLOAD_PROGRESS'
      ) {
        if (!activeCurrentJobId || id === activeCurrentJobId) {
          updateProgressWidget(msg);
        }
      } else if (type === 'ANOBOY_NATIVE_ERROR' || type === 'DOOD_NATIVE_ERROR') {
        if (!activeCurrentJobId || id === activeCurrentJobId) {
          handleProgressError(msg);
        }
      } else if (
        type === 'ANOBOY_NATIVE_COMPLETE' ||
        type === 'DOOD_NATIVE_COMPLETE' ||
        type === 'NATIVE_DOWNLOAD_COMPLETE'
      ) {
        if (!activeCurrentJobId || id === activeCurrentJobId) {
          updateProgressWidget({ status: 'complete', percent: 100, speedText: 'Selesai 100%' });
        }
      } else if (type === 'TRIGGER_DOOD_DOWNLOAD') {
        const btn = document.getElementById('dood-dl-btn');
        startDoodDownload(btn);
        if (sendResponse) sendResponse({ success: true });
      } else if (type === 'GET_ACTIVE_VIDEO_INFO') {
        const title = extractVideoTitle();
        if (sendResponse) {
          sendResponse({
            success: true,
            platform: 'doodstream',
            title
          });
        }
      }
    });
  }

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectDoodUI);
  } else {
    injectDoodUI();
  }

  // Expose module functions for unit testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isDoodHost,
      detectDoodEngine,
      sanitizeDoodTitle,
      formatDoodFilename,
      generateDoodSalt,
      buildDoodFinalUrl,
      extractPassMd5Endpoint
    };
  }
})();
