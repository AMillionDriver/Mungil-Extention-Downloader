/**
 * AnoBoy (anoboy.quest / anoboy.*) Direct & Batch Downloader - Content Platform Script
 * Runs in ISOLATED world at document_idle.
 *
 * Capabilities:
 * 1. Automatic Episode & Parent Series detection from metadata table & breadcrumbs.
 * 2. Direct Video Stream Extraction (Blogger Video / Google Video CDN 720p & 360p).
 * 3. Mirror Download Extraction (Gofile, Mp4Upload, Mirrored.to).
 * 4. Automatic Parent Series Scraping to gather ALL available episodes.
 * 5. Interactive Batch Selector Modal with quick-filters (Semua, < Current, > Current).
 * 6. Paced sequential download queue (concurrency: 2) organized into auto-folders:
 *    Anime/[AnoBoy] {Anime Title}/[AnoBoy] {Anime Title} - Episode {XX} ({Resolution}).mp4
 * 7. Multi-Platform Popup IPC handlers (GET_ACTIVE_VIDEO_INFO, DOWNLOAD_ACTIVE_VIDEO).
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (typeof window !== 'undefined') {
    if (window.__MUNGIL_ANOBOY_INITIALIZED__) return;
    window.__MUNGIL_ANOBOY_INITIALIZED__ = true;
  }

  const LOG_PREFIX = '[AnoBoy Downloader]';

  const SVG_DOWNLOAD = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M17 18v1H7v-1h10zm-1-8l-4 4-4-4 1.4-1.4 1.6 1.6V4h2v6.2l1.6-1.6L16 10z"/>
    </svg>
  `;

  const SVG_CHECK = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>
  `;

  const SVG_LAYERS = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27zM12 16l7.36-5.73L21 9.07l-9-7-9 7 1.63 1.2z"/>
    </svg>
  `;

  // =========================================================================
  // 1. Windows NTFS Sanitization & Formatting
  // =========================================================================

  function sanitizeAnoboyTitle(title) {
    if (title === null || title === undefined) return 'Anime';
    let str = String(title).trim();
    if (!str) return 'Anime';

    str = str.replace(/&#8211;|&#8212;/g, '-');
    str = str.replace(/&#8220;|&#8221;|&quot;/g, '');
    str = str.replace(/&amp;/g, '&');
    str = str.replace(/&lt;/g, '<');
    str = str.replace(/&gt;/g, '>');

    str = str.replace(/[:：]/g, ' - ');
    str = str.replace(/[/\\|]/g, '-');
    str = str.replace(/[*?"<>|\x00-\x1f\x7f-\x9f]/g, '');
    str = str.replace(/\s+/g, ' ');
    str = str.replace(/-{2,}/g, '-');
    str = str.replace(/\s*-\s*/g, ' - ');
    str = str.replace(/^[.\s_-]+|[.\s_-]+$/g, '');
    str = str.slice(0, 120).trim();
    str = str.replace(/[.\s_-]+$/, '');

    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
    if (reserved.test(str)) {
      str = `Anime_${str}`;
    }

    return str || 'Anime';
  }

  function formatAnoboyFilename(params = {}) {
    const p = params && typeof params === 'object' ? params : {};
    const safeAnime = sanitizeAnoboyTitle(p.animeTitle || 'Anime');
    const epsRaw =
      p.episodeNum !== undefined && p.episodeNum !== null ? String(p.episodeNum).trim() : '01';
    const safeEps = epsRaw.padStart(2, '0');
    const ext = p.ext ? String(p.ext).replace(/^\./, '') : 'mp4';

    return `${safeAnime}_${safeEps}.${ext}`;
  }

  // =========================================================================
  // 2. Active Episode & Series Metadata Extraction
  // =========================================================================

  function extractEpisodeNumber(textOrUrl) {
    if (!textOrUrl || typeof textOrUrl !== 'string') return 1;
    const match =
      textOrUrl.match(/episode[-_ ]*(\d+)/i) ||
      textOrUrl.match(/eps[-_ ]*(\d+)/i) ||
      textOrUrl.match(/_-_(\d+)\./);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
    return 1;
  }

  function extractAnoboyPageData() {
    if (typeof document === 'undefined') return null;

    const rawTitle = (document.title || '').replace(/&#8211;|–|-/g, '-');
    let animeTitle = '';
    let episodeNum = 1;

    // 1. Try to get canonical series link & anime title from Content Table
    let seriesUrl = null;
    const allEpsTh = Array.from(document.querySelectorAll('th')).find(
      (th) => th.textContent && th.textContent.toLowerCase().includes('semua episode')
    );
    if (allEpsTh && allEpsTh.nextElementSibling) {
      const a = allEpsTh.nextElementSibling.querySelector('a');
      if (a) {
        seriesUrl = a.href;
        animeTitle = a.textContent.trim();
      }
    }

    // Fallback: Breadcrumbs
    if (!seriesUrl) {
      const breadcrumbLinks = document.querySelectorAll('.breadcrumb a, [itemprop="breadcrumb"] a');
      if (breadcrumbLinks.length >= 2) {
        const seriesLink = breadcrumbLinks[1];
        seriesUrl = seriesLink.href;
        if (!animeTitle) animeTitle = seriesLink.textContent.trim();
      }
    }

    // Episode title & number
    const h1 = document.querySelector('h1, .pagetitle h1');
    const h1Text = h1 ? h1.textContent.trim() : rawTitle;

    episodeNum = extractEpisodeNumber(h1Text || window.location.pathname);

    if (!animeTitle) {
      const cleaned = h1Text
        .replace(/Subtitle Indonesia/gi, '')
        .replace(/Episode \d+/gi, '')
        .replace(/anoBoy/gi, '')
        .replace(/[-|:]+$/, '')
        .trim();
      animeTitle = cleaned || 'Anime';
    }

    // 2. Stream Servers (a#allmiror)
    const servers = [];
    const mirrorLinks = document.querySelectorAll('a#allmiror');
    for (const a of mirrorLinks) {
      const label = a.textContent.trim();
      const videoData = a.getAttribute('data-video') || '';
      if (videoData) {
        let streamUrl = videoData;
        if (streamUrl.startsWith('/')) {
          streamUrl = window.location.origin + streamUrl;
        }

        // Check if it's blogger adsbatch
        const bloggerMatch = videoData.match(/url=([^&]+)/);
        const bloggerToken = bloggerMatch ? bloggerMatch[1] : null;
        servers.push({
          label,
          url: streamUrl,
          bloggerToken,
          isBlogger: Boolean(bloggerToken)
        });
      }
    }

    // 3. Download Mirrors (.udl links)
    const downloadMirrors = [];
    const udlLinks = document.querySelectorAll('a.udl');
    for (const a of udlLinks) {
      const href = a.getAttribute('href');
      const text = a.textContent.trim();
      if (href && href !== 'none' && !href.startsWith('javascript:')) {
        let provider = 'Mirror';
        const parentSpan = a.closest('.ud');
        if (parentSpan) {
          const udj = parentSpan.querySelector('.udj');
          if (udj) provider = udj.textContent.trim();
        }
        downloadMirrors.push({
          resolution: text,
          provider,
          url: href
        });
      }
    }

    // 4. Prev / Next Navigation Links
    const prevLink = document.querySelector(
      '#navigasi a[title*="Episode"], .widget-title a[href*="episode"]'
    );
    const prevUrl = prevLink ? prevLink.href : null;
    const prevEps = prevUrl ? extractEpisodeNumber(prevUrl) : null;

    return {
      animeTitle: sanitizeAnoboyTitle(animeTitle),
      episodeNum,
      seriesUrl,
      servers,
      downloadMirrors,
      prevUrl,
      prevEps,
      currentUrl: window.location.href
    };
  }

  function cleanTitleTokens(str) {
    return (str || '')
      .toLowerCase()
      .replace(/&#8211;|–|-/g, ' ')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseEpisodesFromHtml(html, currentTitle = '', currentUrl = '') {
    if (!html || typeof html !== 'string') return [];

    const contextStr = `${currentTitle} ${currentUrl}`;
    const sMatch =
      contextStr.match(/(?:season|part)\s*[-_]?\s*(\d+)/i) || contextStr.match(/\bs(\d+)\b/i);
    const activeSeason = sMatch ? parseInt(sMatch[1], 10) : 1;
    const isMultiSeason = Boolean(sMatch);

    const baseTitleClean = cleanTitleTokens(
      currentTitle
        .replace(/subtitle indonesia/gi, '')
        .replace(/episode\s*\d+/gi, '')
        .replace(/(?:season|part)\s*\d+/gi, '')
        .replace(/anoboy/gi, '')
    );
    const titleTokens = baseTitleClean.split(' ').filter((t) => t.length > 2);

    // Isolate main content from sidebar, widgets, and footers
    let mainContent = html;
    const colStart = html.indexOf('class="column-three-fourth');
    const colEnd = html.indexOf('column-three-fourth ends');
    if (colStart !== -1 && colEnd !== -1) {
      mainContent = html.substring(colStart, colEnd);
    } else {
      const sidebarIdx = html.indexOf('id="sidebar"');
      if (sidebarIdx !== -1) mainContent = mainContent.substring(0, sidebarIdx);
      const footerIdx = html.indexOf('id="footer"');
      if (footerIdx !== -1) mainContent = mainContent.substring(0, footerIdx);
    }

    const aRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
    let match;
    const episodesByNum = new Map();

    while ((match = aRegex.exec(mainContent)) !== null) {
      const href = match[1];
      let title = match[2].replace(/<[^>]+>/g, '').trim();
      if (!title) {
        const titleAttr = (match[0].match(/title=["']([^"']+)["']/) || [])[1];
        if (titleAttr) title = titleAttr.trim();
      }

      if (!href || href === '#' || href.startsWith('javascript:')) continue;

      const isEpsLink = /episode[-_ ]*\d+/i.test(href) || /episode[-_ ]*\d+/i.test(title);
      if (!isEpsLink) continue;

      const numMatch =
        (title + ' ' + href).match(/episode[-_ ]*(\d+)/i) ||
        (title + ' ' + href).match(/eps[-_ ]*(\d+)/i);
      if (!numMatch) continue;
      const epsNum = parseInt(numMatch[1], 10);

      // Verify anime title tokens - strictly filter out recent release sidebar leaks
      const candClean = cleanTitleTokens(title + ' ' + href);
      let matchedTokenCount = 0;
      for (const token of titleTokens) {
        if (candClean.includes(token)) matchedTokenCount++;
      }
      if (titleTokens.length > 0 && matchedTokenCount === 0) continue;

      // Season verification: prevent mixing S1 into S2 or S2 into S1
      const candSeasonMatch =
        (title + ' ' + href).match(/(?:season|part)\s*[-_]?\s*(\d+)/i) ||
        (title + ' ' + href).match(/\bs(\d+)\b/i);
      const candSeason = candSeasonMatch ? parseInt(candSeasonMatch[1], 10) : 1;

      if (isMultiSeason && candSeason !== activeSeason) continue;
      if (!isMultiSeason && candSeasonMatch && candSeason > 1) continue;

      if (!episodesByNum.has(epsNum)) {
        episodesByNum.set(epsNum, {
          episodeNum: epsNum,
          title: title || `Episode ${epsNum}`,
          url: href
        });
      }
    }

    return Array.from(episodesByNum.values()).sort((a, b) => a.episodeNum - b.episodeNum);
  }

  // =========================================================================
  // 3. Series Episode List Scraper
  // =========================================================================

  async function fetchSeriesEpisodes(seriesUrl, currentTitle = '', currentUrl = '') {
    let episodes = [];

    if (seriesUrl) {
      try {
        const res = await fetch(seriesUrl, { credentials: 'include' });
        if (res.ok) {
          const text = await res.text();
          episodes = parseEpisodesFromHtml(text, currentTitle, currentUrl);
        }
      } catch (e) {
        console.warn(`${LOG_PREFIX} Failed to fetch series episodes from seriesUrl:`, e);
      }
    }

    // Fallback or augment with current page DOM if empty or missing current episode
    if (episodes.length === 0 && typeof document !== 'undefined') {
      const pageHtml = document.documentElement ? document.documentElement.innerHTML : '';
      episodes = parseEpisodesFromHtml(pageHtml, currentTitle, currentUrl);
    }

    // Ensure active episode itself is represented
    if (currentUrl && typeof document !== 'undefined') {
      const currentEpsNum = extractEpisodeNumber(currentTitle || currentUrl);
      if (!episodes.some((e) => e.episodeNum === currentEpsNum)) {
        episodes.push({
          episodeNum: currentEpsNum,
          title: currentTitle || `Episode ${currentEpsNum}`,
          url: currentUrl
        });
        episodes.sort((a, b) => a.episodeNum - b.episodeNum);
      }
    }

    return episodes;
  }

  // =========================================================================
  // 4. Batch Selection Modal
  // =========================================================================

  let batchModalEl = null;
  let miniWidgetEl = null;
  const currentBatchState = {
    animeTitle: '',
    total: 0,
    completed: 0,
    speed: '',
    percent: 0,
    isDownloading: false
  };

  function updateMiniProgressWidget(data = {}) {
    if (!miniWidgetEl) return;
    Object.assign(currentBatchState, data);
    const pct = Math.min(100, Math.max(0, currentBatchState.percent || 0));
    const title = currentBatchState.animeTitle || 'AnoBoy Batch';
    const spd = currentBatchState.speed ? ` • ${currentBatchState.speed}` : '';

    miniWidgetEl.innerHTML = `
      <div class="mungil-ab-mini-top">
        <span class="mungil-ab-mini-title">⚡ ${title}</span>
        <span class="mungil-ab-mini-speed">${currentBatchState.speed || 'Turbo'}</span>
      </div>
      <div class="mungil-ab-mini-bar-bg">
        <div class="mungil-ab-mini-bar-fill" style="width: ${pct}%;"></div>
      </div>
      <div class="mungil-ab-mini-footer">
        <span>${currentBatchState.completed}/${currentBatchState.total} Selesai (${pct}%)${spd}</span>
        <span class="hint">Buka ↗</span>
      </div>
    `;
  }

  function showMiniProgressWidget(animeTitle, total) {
    if (!miniWidgetEl) {
      miniWidgetEl = document.createElement('div');
      miniWidgetEl.id = 'mungil-ab-mini-widget';
      document.body.appendChild(miniWidgetEl);

      miniWidgetEl.addEventListener('click', () => {
        restoreBatchModal();
      });
    }
    currentBatchState.animeTitle = animeTitle;
    currentBatchState.total = total;
    currentBatchState.completed = 0;
    currentBatchState.percent = 0;
    currentBatchState.isDownloading = true;
    miniWidgetEl.style.display = 'flex';
    updateMiniProgressWidget();
  }

  function hideMiniProgressWidget() {
    if (miniWidgetEl) {
      miniWidgetEl.style.display = 'none';
    }
    currentBatchState.isDownloading = false;
  }

  function minimizeBatchModal() {
    if (batchModalEl) {
      batchModalEl.style.display = 'none';
      if (!miniWidgetEl || miniWidgetEl.style.display === 'none') {
        showMiniProgressWidget(currentBatchState.animeTitle, currentBatchState.total);
      }
    }
  }

  function restoreBatchModal() {
    if (batchModalEl) {
      batchModalEl.style.display = 'flex';
    }
    hideMiniProgressWidget();
  }

  function openBatchModal(currentData, allEpisodes) {
    if (batchModalEl) {
      batchModalEl.remove();
      batchModalEl = null;
    }

    const modal = document.createElement('div');
    modal.id = 'mungil-anoboy-modal';

    const episodes =
      allEpisodes.length > 0
        ? allEpisodes
        : [
            {
              episodeNum: currentData.episodeNum,
              title: `Episode ${currentData.episodeNum}`,
              url: currentData.currentUrl
            }
          ];

    modal.innerHTML = `
      <div class="mungil-ab-backdrop"></div>
      <div class="mungil-ab-dialog">
        <div class="mungil-ab-header">
          <div class="mungil-ab-title-group">
            <h2 class="mungil-ab-title">${currentData.animeTitle}</h2>
            <span class="mungil-ab-subtitle">Batch Downloader • ${episodes.length} Episode Terdeteksi</span>
          </div>
          <div class="mungil-ab-header-actions">
            <button type="button" class="mungil-ab-action-btn min" id="mungil-ab-min-btn" title="Minimize ke widget kecil" aria-label="Minimize Modal">🗕</button>
            <button type="button" class="mungil-ab-action-btn close" id="mungil-ab-close-btn" title="Tutup Modal" aria-label="Tutup Modal">&times;</button>
          </div>
        </div>

        <div class="mungil-ab-controls">
          <div class="mungil-ab-filter-chips">
            <button type="button" class="mungil-ab-chip active" data-filter="all">Semua (${episodes.length})</button>
            <button type="button" class="mungil-ab-chip" data-filter="prev">Eps ≤ ${currentData.episodeNum}</button>
            <button type="button" class="mungil-ab-chip" data-filter="next">Eps ≥ ${currentData.episodeNum}</button>
            <button type="button" class="mungil-ab-chip" data-filter="none">Batal Pilih</button>
          </div>
          <div class="mungil-ab-res-picker">
            <label for="mungil-ab-modal-server-select">Server:</label>
            <select id="mungil-ab-modal-server-select" style="background:#1c202a;border:1px solid rgba(255,193,7,0.3);color:#ffc107;font-weight:700;padding:4px 8px;border-radius:6px;outline:none;cursor:pointer;">
              <option value="turbo" selected>⚡ Turbo Chunker (Native 16x - Tercepat)</option>
              <option value="gofile">⚡ Gofile (High Speed 1K/720p)</option>
              <option value="blogger">🌐 Blogger (Auto-Folder MP4)</option>
            </select>
            <label for="mungil-ab-concurrency-select" id="mungil-ab-concurrency-label">Simultan:</label>
            <select id="mungil-ab-concurrency-select" style="background:#1c202a;border:1px solid rgba(0,230,118,0.3);color:#00e676;font-weight:700;padding:4px 8px;border-radius:6px;outline:none;cursor:pointer;">
              <option value="1">1 File (Stabil)</option>
              <option value="2" selected>⚡ 2 File (Rekomendasi Cepat)</option>
              <option value="3">🚀 3 File (Maksimal)</option>
            </select>
            <label for="mungil-ab-res-select">Resolusi:</label>
            <select id="mungil-ab-res-select">
              <option value="1080p">1080p (1K)</option>
              <option value="720p" selected>720p HD</option>
              <option value="480p">480p Standar</option>
              <option value="360p">360p Hemat Kuota</option>
            </select>
          </div>
        </div>

        <div class="mungil-ab-list" id="mungil-ab-list">
          ${episodes
            .map(
              (ep) => `
            <label class="mungil-ab-item">
              <input type="checkbox" class="mungil-ab-checkbox" data-eps="${ep.episodeNum}" data-url="${ep.url}" checked>
              <span class="mungil-ab-item-badge">EPS ${ep.episodeNum}</span>
              <span class="mungil-ab-item-title">${ep.title}</span>
              <span class="mungil-ab-item-status" id="ab-status-${ep.episodeNum}">Ready</span>
            </label>
          `
            )
            .join('')}
        </div>

        <div class="mungil-ab-footer">
          <div class="mungil-ab-summary">
            <span id="mungil-ab-selected-count">${episodes.length}</span> episode dipilih
          </div>
          <div class="mungil-ab-footer-btns">
            <button type="button" class="mungil-ab-btn mungil-ab-btn-secondary" id="mungil-ab-cancel-btn">Tutup</button>
            <button type="button" class="mungil-ab-btn mungil-ab-btn-secondary" id="mungil-ab-copy-gofile-btn">
              <span>📋 Salin Link Gofile</span>
            </button>
            <button type="button" class="mungil-ab-btn mungil-ab-btn-primary" id="mungil-ab-start-btn">
              ${SVG_DOWNLOAD}
              <span>Unduh Batch Terpilih</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    batchModalEl = modal;

    // Event Listeners
    const closeBtn = modal.querySelector('#mungil-ab-close-btn');
    const minBtn = modal.querySelector('#mungil-ab-min-btn');
    const cancelBtn = modal.querySelector('#mungil-ab-cancel-btn');
    const backdrop = modal.querySelector('.mungil-ab-backdrop');
    const closeModal = () => {
      if (batchModalEl) {
        batchModalEl.remove();
        batchModalEl = null;
      }
      hideMiniProgressWidget();
    };
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (minBtn) minBtn.addEventListener('click', minimizeBatchModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    // Filters
    const checkboxes = modal.querySelectorAll('.mungil-ab-checkbox');
    const selectedCountEl = modal.querySelector('#mungil-ab-selected-count');
    const updateCount = () => {
      const checked = modal.querySelectorAll('.mungil-ab-checkbox:checked').length;
      if (selectedCountEl) selectedCountEl.textContent = String(checked);
    };

    modal.querySelectorAll('.mungil-ab-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        modal.querySelectorAll('.mungil-ab-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        const filter = chip.getAttribute('data-filter');

        checkboxes.forEach((cb) => {
          const num = parseInt(cb.getAttribute('data-eps'), 10);
          if (filter === 'all') cb.checked = true;
          else if (filter === 'prev') cb.checked = num <= currentData.episodeNum;
          else if (filter === 'next') cb.checked = num >= currentData.episodeNum;
          else if (filter === 'none') cb.checked = false;
        });
        updateCount();
      });
    });

    checkboxes.forEach((cb) => cb.addEventListener('change', updateCount));

    // Dynamic Server Selector Mode
    const serverSelect = modal.querySelector('#mungil-ab-modal-server-select');
    const startBtn = modal.querySelector('#mungil-ab-start-btn');
    const copyGofileBtn = modal.querySelector('#mungil-ab-copy-gofile-btn');

    function updateServerMode() {
      const mode = serverSelect ? serverSelect.value : 'turbo';
      const concSelect = modal.querySelector('#mungil-ab-concurrency-select');
      const concLabel = modal.querySelector('#mungil-ab-concurrency-label');
      if (mode === 'gofile') {
        if (startBtn) startBtn.innerHTML = `<span>⚡ Buka Gofile Terpilih</span>`;
        if (copyGofileBtn) copyGofileBtn.style.display = 'inline-flex';
        if (concSelect) concSelect.style.display = 'none';
        if (concLabel) concLabel.style.display = 'none';
      } else if (mode === 'turbo') {
        if (startBtn) startBtn.innerHTML = `<span>⚡ Mulai Unduh Turbo (Multi-File)</span>`;
        if (copyGofileBtn) copyGofileBtn.style.display = 'none';
        if (concSelect) concSelect.style.display = 'inline-block';
        if (concLabel) concLabel.style.display = 'inline-block';
      } else {
        if (startBtn) startBtn.innerHTML = `${SVG_DOWNLOAD} <span>Unduh Batch Terpilih</span>`;
        if (copyGofileBtn) copyGofileBtn.style.display = 'none';
        if (concSelect) concSelect.style.display = 'inline-block';
        if (concLabel) concLabel.style.display = 'inline-block';
      }
    }
    if (serverSelect) {
      serverSelect.addEventListener('change', updateServerMode);
      updateServerMode();
    }

    // Copy Gofile Links
    if (copyGofileBtn) {
      copyGofileBtn.addEventListener('click', async () => {
        const selected = Array.from(modal.querySelectorAll('.mungil-ab-checkbox:checked')).map(
          (cb) => ({
            episodeNum: parseInt(cb.getAttribute('data-eps'), 10),
            url: cb.getAttribute('data-url')
          })
        );
        if (selected.length === 0) return;

        copyGofileBtn.disabled = true;
        copyGofileBtn.innerHTML = `<span>Mengambil Link...</span>`;

        const resSelect = modal.querySelector('#mungil-ab-res-select');
        const resolution = resSelect ? resSelect.value : '1080p';

        const links = [];
        for (const ep of selected) {
          const statusEl = modal.querySelector(`#ab-status-${ep.episodeNum}`);
          if (statusEl) {
            statusEl.textContent = 'Mencari Gofile...';
            statusEl.style.color = '#FFC107';
          }
          const gofileUrl = await resolveGofileUrlForEpisode(ep.url, resolution);
          if (gofileUrl) {
            links.push(`Episode ${ep.episodeNum}: ${gofileUrl}`);
            if (statusEl) {
              statusEl.textContent = '✓ Gofile OK';
              statusEl.style.color = '#00E676';
            }
          } else if (statusEl) {
            statusEl.textContent = 'Gofile Nihil';
            statusEl.style.color = '#FF5252';
          }
        }

        if (links.length > 0) {
          try {
            await navigator.clipboard.writeText(links.join('\n'));
            copyGofileBtn.innerHTML = `<span>✓ ${links.length} Link Disalin!</span>`;
          } catch (_) {
            copyGofileBtn.innerHTML = `<span>Gagal Salin</span>`;
          }
        } else {
          copyGofileBtn.innerHTML = `<span>Link Tidak Ditemukan</span>`;
        }

        setTimeout(() => {
          if (copyGofileBtn) {
            copyGofileBtn.disabled = false;
            copyGofileBtn.innerHTML = `<span>📋 Salin Link Gofile</span>`;
          }
        }, 3000);
      });
    }

    // Start Action (Turbo Native / Gofile Open / Blogger Auto-Download)
    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        const selected = Array.from(modal.querySelectorAll('.mungil-ab-checkbox:checked')).map(
          (cb) => ({
            episodeNum: parseInt(cb.getAttribute('data-eps'), 10),
            url: cb.getAttribute('data-url')
          })
        );

        if (selected.length === 0) return;

        const mode = serverSelect ? serverSelect.value : 'turbo';
        const resSelect = modal.querySelector('#mungil-ab-res-select');
        const resolution = resSelect ? resSelect.value : '720p';

        if (mode === 'turbo') {
          startBtn.disabled = true;
          startBtn.innerHTML = `<span>⚡ Memulai Turbo (${selected.length})...</span>`;
          const concSelect = modal.querySelector('#mungil-ab-concurrency-select');
          const concurrency = concSelect ? parseInt(concSelect.value, 10) || 2 : 2;
          executeBatchTurbo(currentData.animeTitle, selected, resolution, modal, concurrency);
        } else if (mode === 'gofile') {
          startBtn.disabled = true;
          startBtn.innerHTML = `<span>Membuka Gofile...</span>`;

          for (let i = 0; i < selected.length; i++) {
            const ep = selected[i];
            const statusEl = modal.querySelector(`#ab-status-${ep.episodeNum}`);
            if (statusEl) {
              statusEl.textContent = 'Mencari Gofile...';
              statusEl.style.color = '#FFC107';
            }
            const gofileUrl = await resolveGofileUrlForEpisode(ep.url, resolution);
            if (gofileUrl) {
              window.open(gofileUrl, '_blank');
              if (statusEl) {
                statusEl.textContent = '✓ Terbuka';
                statusEl.style.color = '#00E676';
              }
            } else if (statusEl) {
              statusEl.textContent = 'Gofile Nihil';
              statusEl.style.color = '#FF5252';
            }
            if (i < selected.length - 1) {
              // 1500ms safety interval to prevent Cloudflare 429 Too Many Requests
              await new Promise((r) => setTimeout(r, 1500));
            }
          }

          startBtn.disabled = false;
          startBtn.innerHTML = `<span>✓ Selesai Terbuka</span>`;
          setTimeout(() => {
            if (startBtn) updateServerMode();
          }, 3000);
        } else {
          startBtn.disabled = true;
          startBtn.innerHTML = `<span>Memulai Antrean (${selected.length})...</span>`;
          executeBatchDownload(currentData.animeTitle, selected, resolution, modal);
        }
      });
    }
  }

  // =========================================================================
  // 5. Direct Stream Resolvers & Paced Sequential Download Execution
  // =========================================================================

  function extractStreamFromBloggerHtml(bloggerHtml, preferredRes = '720p') {
    if (!bloggerHtml || typeof bloggerHtml !== 'string') return null;

    // Strict regex: domain must directly be *.googlevideo.com
    const re =
      /https?:\/\/[a-zA-Z0-9.\-_]+?\.googlevideo\.com(?:\/|\\\/)videoplayback[^"'\s<>&;]+/g;
    let match;
    const streams = [];

    while ((match = re.exec(bloggerHtml)) !== null) {
      const raw = match[0];
      let decoded = raw
        .replace(/\\\\u0026|\\u0026/g, '&')
        .replace(/\\\\u003d|\\u003d/g, '=')
        .replace(/\\\\\//g, '/')
        .replace(/\\\//g, '/')
        .replace(/\\+$/, '')
        .trim();

      const itagMatch = decoded.match(/itag=(\d+)/);
      const itag = itagMatch ? parseInt(itagMatch[1], 10) : 0;
      if (itag > 0) {
        streams.push({ itag, url: decoded });
      }
    }

    if (streams.length === 0) return null;

    if (preferredRes && preferredRes.includes('720')) {
      const s720 = streams.find((s) => s.itag === 22);
      if (s720) return s720.url;
    }
    if (preferredRes && preferredRes.includes('360')) {
      const s360 = streams.find((s) => s.itag === 18);
      if (s360) return s360.url;
    }

    streams.sort((a, b) => b.itag - a.itag);
    return streams[0].url;
  }

  async function resolveStreamUrlForEpisode(episodeUrl, preferredRes = '720p') {
    // 1. Delegate to background service worker with full host permissions
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const bgRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'RESOLVE_ANOBOY_STREAM', url: episodeUrl, preferredRes },
            (response) => resolve(response)
          );
        });
        if (bgRes && bgRes.success && bgRes.streamUrl) {
          return bgRes.streamUrl;
        }
      } catch (_) {}
    }

    // 2. Direct client-side fallback
    try {
      const res = await fetch(episodeUrl, { credentials: 'include' });
      if (!res.ok) return null;
      const html = await res.text();

      let targetToken = null;
      const tokenMatch =
        html.match(/adsbatch(?:720)?\.php\?url=([^&"'>\s]+)/) ||
        html.match(/data-video=["'][^"']*url=([^&"'>\s]+)/) ||
        html.match(/token=(AD6v5[a-zA-Z0-9_-]+)/);
      if (tokenMatch && tokenMatch[1]) {
        targetToken = tokenMatch[1];
      }

      if (targetToken) {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          try {
            const tokenRes = await new Promise((resolve) => {
              chrome.runtime.sendMessage(
                { action: 'RESOLVE_ANOBOY_STREAM', bloggerToken: targetToken, preferredRes },
                (response) => resolve(response)
              );
            });
            if (tokenRes && tokenRes.success && tokenRes.streamUrl) {
              return tokenRes.streamUrl;
            }
          } catch (_) {}
        }
        try {
          const bRes = await fetch(`https://www.blogger.com/video.g?token=${targetToken}`, {
            headers: { Referer: 'https://anoboy.at/' }
          });
          if (bRes.ok) {
            const bHtml = await bRes.text();
            const direct = extractStreamFromBloggerHtml(bHtml, preferredRes);
            if (direct) return direct;
          }
        } catch (_) {}
      }

      // Check iframe #mediaplayer fallback
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const iframe = doc.querySelector('#mediaplayer');
      if (iframe && iframe.src) {
        const m =
          iframe.src.match(/adsbatch(?:720)?\.php\?url=([^&"'>\s]+)/) ||
          iframe.src.match(/url=([^&]+)/);
        if (m && m[1]) {
          try {
            const bRes = await fetch(`https://www.blogger.com/video.g?token=${m[1]}`);
            if (bRes.ok) {
              const bHtml = await bRes.text();
              const direct = extractStreamFromBloggerHtml(bHtml, preferredRes);
              if (direct) return direct;
            }
          } catch (_) {}
        }
      }

      // Fallback: Check .udl mp4upload or gofile
      const udl = doc.querySelectorAll('a.udl');
      for (const a of udl) {
        const href = a.getAttribute('href');
        if (href && (href.includes('mp4upload.com') || href.includes('gofile.io'))) {
          return href;
        }
      }
    } catch (_) {}
    return null;
  }

  async function executeBatchTurbo(animeTitle, items, resolution, modalEl, concurrency = 2) {
    const startBtn = modalEl?.querySelector('#mungil-ab-start-btn');
    let active = 0;
    let idx = 0;
    let completed = 0;

    currentBatchState.animeTitle = animeTitle;
    currentBatchState.total = items.length;
    currentBatchState.completed = 0;
    currentBatchState.percent = 0;
    currentBatchState.isDownloading = true;

    return new Promise((resolveAll) => {
      const runWorker = () => {
        if (completed >= items.length) {
          if (startBtn) {
            startBtn.disabled = false;
            startBtn.innerHTML = `${SVG_CHECK} <span>Selesai Turbo (${completed} File)!</span>`;
          }
          updateMiniProgressWidget({ completed, percent: 100, speed: 'Selesai!' });
          return resolveAll();
        }

        while (active < concurrency && idx < items.length) {
          const item = items[idx++];
          active++;
          const videoId = `anoboy_${item.episodeNum}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          const statusEl = modalEl?.querySelector(`#ab-status-${item.episodeNum}`);
          if (statusEl) {
            statusEl.textContent = 'Resolving Stream...';
            statusEl.style.color = '#FFC107';
          }

          (async () => {
            let progressListener = null;
            try {
              let streamUrl = await resolveStreamUrlForEpisode(item.url, resolution);
              if (!streamUrl) {
                if (statusEl) {
                  statusEl.textContent = 'No Stream';
                  statusEl.style.color = '#FF5252';
                }
                return;
              }

              if (statusEl) {
                statusEl.textContent = '⚡ Turbo 0%';
                statusEl.style.color = '#00E676';
              }

              const filename = formatAnoboyFilename({
                animeTitle,
                episodeNum: item.episodeNum,
                resolution,
                ext: 'mp4',
                includeFolder: true
              });

              progressListener = (msg) => {
                if (!msg || typeof msg !== 'object') return;
                if (
                  msg.type === 'ANOBOY_NATIVE_PROGRESS' ||
                  msg.type === 'NATIVE_DOWNLOAD_PROGRESS'
                ) {
                  if (
                    msg.videoId === videoId ||
                    msg.title?.includes(`Episode ${item.episodeNum}`)
                  ) {
                    if (statusEl && msg.percent !== undefined) {
                      const speedText = msg.speed ? ` (${msg.speed})` : '';
                      statusEl.textContent = `⚡ ${msg.percent}%${speedText}`;
                      statusEl.style.color = '#00E676';

                      const overallPct = Math.round(
                        ((completed + (msg.percent || 0) / 100) / items.length) * 100
                      );
                      updateMiniProgressWidget({ speed: msg.speed || '', percent: overallPct });
                    }
                  }
                }
              };

              if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.addListener(progressListener);
              }

              await new Promise((resolveTask) => {
                chrome.runtime.sendMessage(
                  {
                    action: 'DOWNLOAD_ANOBOY_NATIVE',
                    url: streamUrl,
                    filename,
                    title: `${animeTitle} - Episode ${item.episodeNum}`,
                    videoId,
                    referer: 'https://anoboy.at/',
                    userAgent: navigator.userAgent,
                    bloggerToken: item.bloggerToken || null,
                    episodeUrl: item.url || null
                  },
                  (res) => {
                    if (
                      typeof chrome !== 'undefined' &&
                      chrome.runtime &&
                      chrome.runtime.onMessage &&
                      progressListener
                    ) {
                      chrome.runtime.onMessage.removeListener(progressListener);
                      progressListener = null;
                    }
                    if (statusEl) {
                      if (res && res.success) {
                        statusEl.textContent = '✓ Saved (Turbo)';
                        statusEl.style.color = '#00E676';
                      } else {
                        statusEl.textContent = 'Failed';
                        statusEl.style.color = '#FF5252';
                      }
                    }
                    resolveTask(res);
                  }
                );
              });
            } catch (_) {
              if (statusEl) {
                statusEl.textContent = 'Error';
                statusEl.style.color = '#FF5252';
              }
            } finally {
              if (
                typeof chrome !== 'undefined' &&
                chrome.runtime &&
                chrome.runtime.onMessage &&
                progressListener
              ) {
                try {
                  chrome.runtime.onMessage.removeListener(progressListener);
                } catch (_) {}
              }
              active--;
              completed++;
              const overallPct = Math.round((completed / items.length) * 100);
              updateMiniProgressWidget({ completed, percent: overallPct });
              setTimeout(runWorker, 100);
            }
          })();
        }
      };

      runWorker();
    });
  }

  async function executeBatchDownload(animeTitle, items, resolution, modalEl) {
    let active = 0;
    let idx = 0;

    const runNext = async () => {
      if (idx >= items.length && active === 0) {
        const startBtn = modalEl?.querySelector('#mungil-ab-start-btn');
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.innerHTML = `${SVG_CHECK} <span>Selesai!</span>`;
        }
        return;
      }

      while (active < 2 && idx < items.length) {
        const item = items[idx++];
        active++;

        const statusEl = modalEl?.querySelector(`#ab-status-${item.episodeNum}`);
        if (statusEl) {
          statusEl.textContent = 'Resolving...';
          statusEl.style.color = 'var(--text-muted, #9E9E9E)';
        }

        (async () => {
          try {
            const streamUrl = await resolveStreamUrlForEpisode(item.url, resolution);
            if (streamUrl) {
              if (statusEl) {
                statusEl.textContent = 'Downloading';
                statusEl.style.color = '#FFC107';
              }

              const filename = formatAnoboyFilename({
                animeTitle,
                episodeNum: item.episodeNum,
                resolution,
                ext: 'mp4',
                includeFolder: true
              });

              chrome.runtime.sendMessage(
                { action: 'DOWNLOAD_VIDEO', url: streamUrl, filename, platform: 'anoboy' },
                (res) => {
                  if (statusEl) {
                    if (res && res.success) {
                      statusEl.textContent = '✓ Saved';
                      statusEl.style.color = '#00E676';
                    } else {
                      statusEl.textContent = 'Failed';
                      statusEl.style.color = '#FF5252';
                    }
                  }
                }
              );
            } else if (statusEl) {
              statusEl.textContent = 'No Stream';
              statusEl.style.color = '#FF5252';
            }
          } catch (_) {
            if (statusEl) {
              statusEl.textContent = 'Error';
              statusEl.style.color = '#FF5252';
            }
          } finally {
            active--;
            setTimeout(runNext, 400);
          }
        })();
      }
    };

    runNext();
  }

  /**
   * Resolves Gofile direct download URL for a given episode web page.
   * Prioritizes highest quality mirror (1K/1080p -> 720p).
   *
   * @param {string} episodeUrl
   * @param {string} [preferredRes='1080p']
   * @returns {Promise<string|null>}
   */
  async function resolveGofileUrlForEpisode(episodeUrl, preferredRes = '1080p') {
    try {
      const res = await fetch(episodeUrl, { credentials: 'include' });
      if (!res.ok) return null;
      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const udlLinks = doc.querySelectorAll('a.udl');
      const gofileCandidates = [];
      for (const a of udlLinks) {
        const href = a.getAttribute('href') || '';
        const text = a.textContent.trim();
        if (href.includes('gofile.io') && href !== 'none') {
          gofileCandidates.push({ resolution: text, url: href });
        }
      }
      if (gofileCandidates.length === 0) return null;
      if (preferredRes.includes('1080') || preferredRes.includes('1k')) {
        const item1k = gofileCandidates.find((c) => /1k|1080/i.test(c.resolution));
        if (item1k) return item1k.url;
      }
      const item720 = gofileCandidates.find((c) => /720/i.test(c.resolution));
      if (item720) return item720.url;
      return gofileCandidates[0].url;
    } catch (_) {
      return null;
    }
  }

  // =========================================================================
  // 6. In-Page Floating Bar
  // =========================================================================

  let floatingBarEl = null;

  function renderFloatingBar(data) {
    if (!data) return;

    if (!floatingBarEl) {
      floatingBarEl = document.createElement('div');
      floatingBarEl.id = 'mungil-anoboy-bar';
      document.body.appendChild(floatingBarEl);
    }

    const mirrors = Array.isArray(data.downloadMirrors) ? data.downloadMirrors : [];
    const gofileItems = mirrors.filter(
      (m) => m.provider && m.provider.toLowerCase().includes('gofile') && m.url && m.url !== 'none'
    );
    const hasGofile = gofileItems.length > 0;

    const isMin =
      typeof sessionStorage !== 'undefined' && sessionStorage.getItem('mungil_ab_bar_min') === '1';
    if (isMin && floatingBarEl.classList && floatingBarEl.classList.add) {
      floatingBarEl.classList.add('minimized');
    }

    floatingBarEl.innerHTML = `
      <div class="mungil-ab-fab-icon" title="Buka Mungil Downloader">⚡</div>
      <div class="mungil-ab-bar-content">
        <div class="mungil-ab-bar-info">
          <span class="mungil-ab-bar-badge">EPS ${data.episodeNum}</span>
          <span class="mungil-ab-bar-title" title="${data.animeTitle}">${data.animeTitle}</span>
        </div>
        <div class="mungil-ab-bar-actions">
          <select class="mungil-ab-server-select" id="mungil-ab-server-select" title="Pilih server unduhan">
            <option value="turbo" selected>⚡ Turbo Chunker (Native 16x - Tercepat)</option>
            ${hasGofile ? '<option value="gofile">⚡ Gofile (High Speed 1K/720p)</option>' : ''}
            <option value="blogger">🌐 Blogger Direct (Browser)</option>
          </select>
          <button type="button" class="mungil-ab-btn mungil-ab-btn-primary" id="mungil-ab-btn-single">
            ${SVG_DOWNLOAD}
            <span>Unduh Eps Ini</span>
          </button>
          <button type="button" class="mungil-ab-btn mungil-ab-btn-batch" id="mungil-ab-btn-batch">
            ${SVG_LAYERS}
            <span>Batch Download</span>
          </button>
          <button type="button" class="mungil-ab-btn-min" id="mungil-ab-bar-min-btn" title="Sembunyikan / Minimize bar" aria-label="Minimize Bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
        </div>
      </div>
    `;

    const minBarBtn = floatingBarEl.querySelector('#mungil-ab-bar-min-btn');
    if (minBarBtn && minBarBtn.addEventListener) {
      minBarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        floatingBarEl.classList.add('minimized');
        try {
          sessionStorage.setItem('mungil_ab_bar_min', '1');
        } catch (_) {}
      });
    }

    if (floatingBarEl.addEventListener) {
      floatingBarEl.addEventListener('click', () => {
        if (floatingBarEl.classList.contains('minimized')) {
          floatingBarEl.classList.remove('minimized');
          try {
            sessionStorage.setItem('mungil_ab_bar_min', '0');
          } catch (_) {}
        }
      });
    }

    const singleBtn = floatingBarEl.querySelector('#mungil-ab-btn-single');
    if (singleBtn) {
      singleBtn.addEventListener('click', async () => {
        const serverSelect = floatingBarEl.querySelector('#mungil-ab-server-select');
        const selectedServer = serverSelect ? serverSelect.value : 'turbo';

        if (selectedServer === 'gofile') {
          let targetGofile = gofileItems.find((i) => /1k|1080/i.test(i.resolution));
          if (!targetGofile) {
            targetGofile = gofileItems.find((i) => /720/i.test(i.resolution)) || gofileItems[0];
          }

          if (targetGofile && targetGofile.url) {
            window.open(targetGofile.url, '_blank');
            singleBtn.disabled = false;
            singleBtn.innerHTML = `${SVG_CHECK} <span>Membuka Gofile (${targetGofile.resolution})...</span>`;
            setTimeout(() => {
              if (singleBtn) singleBtn.innerHTML = `${SVG_DOWNLOAD} <span>Unduh Eps Ini</span>`;
            }, 3000);
            return;
          }
        }

        singleBtn.disabled = true;
        singleBtn.innerHTML = `<span>Resolving...</span>`;

        let streamUrl = await resolveStreamUrlForEpisode(data.currentUrl, '720p');
        if (!streamUrl && data.servers.length > 0 && data.servers[0].bloggerToken) {
          streamUrl = await resolveStreamUrlForEpisode(
            `https://www.blogger.com/video.g?token=${data.servers[0].bloggerToken}`,
            '720p'
          );
        }

        if (streamUrl) {
          const filename = formatAnoboyFilename({
            animeTitle: data.animeTitle,
            episodeNum: data.episodeNum,
            resolution: '720p',
            ext: 'mp4',
            includeFolder: true
          });

          if (selectedServer === 'turbo') {
            singleBtn.innerHTML = `<span>⚡ Memulai Turbo...</span>`;

            const progressListener = (msg) => {
              if (!msg || typeof msg !== 'object') return;
              if (
                msg.type === 'ANOBOY_NATIVE_PROGRESS' ||
                msg.type === 'NATIVE_DOWNLOAD_PROGRESS'
              ) {
                if (singleBtn && msg.percent !== undefined) {
                  const spd = msg.speed ? ` (${msg.speed})` : '';
                  singleBtn.innerHTML = `<span>⚡ ${msg.percent}%${spd}</span>`;
                }
              }
            };

            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
              chrome.runtime.onMessage.addListener(progressListener);
            }

            let bToken = data.servers && data.servers[0] ? data.servers[0].bloggerToken : null;
            if (!bToken && typeof document !== 'undefined') {
              const tm =
                document.body.innerHTML.match(/adsbatch(?:720)?\.php\?url=([^&"'>\s]+)/) ||
                document.body.innerHTML.match(/token=(AD6v5[a-zA-Z0-9_-]+)/);
              if (tm) bToken = tm[1];
            }

            chrome.runtime.sendMessage(
              {
                action: 'DOWNLOAD_ANOBOY_NATIVE',
                url: streamUrl,
                filename,
                title: `${data.animeTitle} - Episode ${data.episodeNum}`,
                referer: 'https://anoboy.at/',
                userAgent: navigator.userAgent,
                bloggerToken: bToken || null,
                episodeUrl: data.currentUrl || null
              },
              (res) => {
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
                  chrome.runtime.onMessage.removeListener(progressListener);
                }
                singleBtn.disabled = false;
                if (res && res.success) {
                  singleBtn.innerHTML = `${SVG_CHECK} <span>Tersimpan (Turbo)!</span>`;
                } else {
                  singleBtn.innerHTML = `${SVG_DOWNLOAD} <span>Coba Lagi</span>`;
                }
                setTimeout(() => {
                  if (singleBtn) singleBtn.innerHTML = `${SVG_DOWNLOAD} <span>Unduh Eps Ini</span>`;
                }, 3000);
              }
            );
          } else {
            singleBtn.innerHTML = `<span>Mengunduh...</span>`;
            chrome.runtime.sendMessage(
              { action: 'DOWNLOAD_VIDEO', url: streamUrl, filename, platform: 'anoboy' },
              (res) => {
                singleBtn.disabled = false;
                if (res && res.success) {
                  singleBtn.innerHTML = `${SVG_CHECK} <span>Tersimpan!</span>`;
                } else {
                  singleBtn.innerHTML = `${SVG_DOWNLOAD} <span>Coba Lagi</span>`;
                }
                setTimeout(() => {
                  if (singleBtn) singleBtn.innerHTML = `${SVG_DOWNLOAD} <span>Unduh Eps Ini</span>`;
                }, 3000);
              }
            );
          }
        } else {
          singleBtn.disabled = false;
          singleBtn.textContent = 'Gagal';
        }
      });
    }

    const batchBtn = floatingBarEl.querySelector('#mungil-ab-btn-batch');
    if (batchBtn) {
      batchBtn.addEventListener('click', async () => {
        batchBtn.disabled = true;
        batchBtn.innerHTML = `<span>Memuat Episode...</span>`;

        const allEpisodes = await fetchSeriesEpisodes(
          data.seriesUrl,
          data.animeTitle,
          data.currentUrl
        );
        batchBtn.disabled = false;
        batchBtn.innerHTML = `${SVG_LAYERS} <span>Batch Download</span>`;

        openBatchModal(data, allEpisodes);
      });
    }
  }

  // =========================================================================
  // 7. Initialization & IPC Handlers
  // =========================================================================

  function init() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const data = extractAnoboyPageData();
    if (!data) return;

    renderFloatingBar(data);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;

        if (message.action === 'GET_ACTIVE_VIDEO_INFO') {
          sendResponse({
            success: true,
            platform: 'anoboy',
            animeTitle: data.animeTitle,
            episodeNum: data.episodeNum,
            seriesUrl: data.seriesUrl,
            serverCount: data.servers.length,
            mirrorCount: data.downloadMirrors.length
          });
          return true;
        }

        if (message.action === 'DOWNLOAD_ACTIVE_VIDEO') {
          (async () => {
            const allEpisodes = await fetchSeriesEpisodes(
              data.seriesUrl,
              data.animeTitle,
              data.currentUrl
            );
            openBatchModal(data, allEpisodes);
            sendResponse({ success: true, platform: 'anoboy' });
          })();
          return true;
        }

        return false;
      });
    }
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // Export for testing in Node environment
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      sanitizeAnoboyTitle,
      formatAnoboyFilename,
      extractEpisodeNumber,
      extractAnoboyPageData,
      parseEpisodesFromHtml,
      fetchSeriesEpisodes,
      extractStreamFromBloggerHtml,
      resolveStreamUrlForEpisode,
      resolveGofileUrlForEpisode,
      executeBatchTurbo,
      renderFloatingBar
    };
  }
})();
