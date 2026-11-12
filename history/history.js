// Direct Downloader — Smart History & File Lifecycle Tracker Controller
(function () {
  'use strict';

  // DOM Elements
  const historyListEl = document.getElementById('history-list');
  const loadingStateEl = document.getElementById('loading-state');
  const emptyStateEl = document.getElementById('empty-state');

  // Metrics Elements
  const totalCountEl = document.getElementById('metric-total-count');
  const totalSizeEl = document.getElementById('metric-total-size');
  const countOriginalEl = document.getElementById('metric-count-original');
  const countMovedEl = document.getElementById('metric-count-moved');
  const countBinEl = document.getElementById('metric-count-bin');
  const countDeletedEl = document.getElementById('metric-count-deleted');

  // Metric Filter Cards
  const filterCardOriginal = document.getElementById('filter-card-original');
  const filterCardMoved = document.getElementById('filter-card-moved');
  const filterCardBin = document.getElementById('filter-card-bin');
  const filterCardDeleted = document.getElementById('filter-card-deleted');

  // Toolbar Elements
  const searchInput = document.getElementById('search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const platformFilter = document.getElementById('platform-filter');
  const statusFilter = document.getElementById('status-filter');

  // Header Actions
  const btnAuditNow = document.getElementById('btn-audit-now');
  const auditIcon = document.getElementById('audit-icon');
  const auditText = document.getElementById('audit-text');
  const btnOpenRecycleBin = document.getElementById('btn-open-recycle-bin');
  const btnClearHistory = document.getElementById('btn-clear-history');

  // In-memory state
  let allItems = [];
  let isAuditing = false;

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadHistory(true);
  });

  function bindEvents() {
    // Toolbar search & filters
    searchInput.addEventListener('input', () => {
      btnClearSearch.style.display = searchInput.value ? 'block' : 'none';
      renderList();
    });

    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      btnClearSearch.style.display = 'none';
      renderList();
      searchInput.focus();
    });

    platformFilter.addEventListener('change', renderList);
    statusFilter.addEventListener('change', () => {
      updateActiveMetricCards();
      renderList();
    });

    // Quick filter cards
    setupMetricFilter(filterCardOriginal, 'EXISTS_ORIGINAL');
    setupMetricFilter(filterCardMoved, 'MOVED');
    setupMetricFilter(filterCardBin, 'IN_RECYCLE_BIN');
    setupMetricFilter(filterCardDeleted, 'PERMANENTLY_DELETED');

    // Header buttons
    btnAuditNow.addEventListener('click', () => {
      if (!isAuditing) {
        performAudit();
      }
    });

    btnOpenRecycleBin.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'OPEN_RECYCLE_BIN' }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success) {
          console.warn(
            '[History] Failed to open Recycle Bin:',
            chrome.runtime.lastError || res?.error
          );
        }
      });
    });

    btnClearHistory.addEventListener('click', () => {
      if (
        confirm(
          'Apakah Anda yakin ingin menghapus seluruh riwayat unduhan? (File fisik di komputer tidak akan terhapus)'
        )
      ) {
        chrome.runtime.sendMessage({ action: 'CLEAR_SMART_HISTORY' }, (res) => {
          if (res && res.success) {
            allItems = [];
            updateMetrics();
            renderList();
          }
        });
      }
    });
  }

  function setupMetricFilter(el, statusValue) {
    if (!el) return;
    el.addEventListener('click', () => {
      if (statusFilter.value === statusValue) {
        statusFilter.value = 'ALL';
      } else {
        statusFilter.value = statusValue;
      }
      updateActiveMetricCards();
      renderList();
    });
  }

  function updateActiveMetricCards() {
    const val = statusFilter.value;
    filterCardOriginal?.classList.toggle('active-filter', val === 'EXISTS_ORIGINAL');
    filterCardMoved?.classList.toggle('active-filter', val === 'MOVED');
    filterCardBin?.classList.toggle('active-filter', val === 'IN_RECYCLE_BIN');
    filterCardDeleted?.classList.toggle('active-filter', val === 'PERMANENTLY_DELETED');
  }

  // Load history from background Service Worker
  function loadHistory(triggerAuditAfter = false) {
    setLoading(true);
    chrome.runtime.sendMessage({ action: 'GET_SMART_HISTORY' }, (res) => {
      setLoading(false);
      if (chrome.runtime.lastError || !res || !res.success) {
        console.warn(
          '[History] Failed to get smart history:',
          chrome.runtime.lastError || res?.error
        );
        allItems = [];
      } else {
        allItems = Array.isArray(res.history) ? res.history : [];
      }
      updateMetrics();
      renderList();

      if (triggerAuditAfter && allItems.length > 0) {
        performAudit();
      }
    });
  }

  // Trigger file status audit via Native Host
  function performAudit() {
    isAuditing = true;
    auditIcon.classList.add('spinning');
    auditText.textContent = 'Memeriksa File...';
    btnAuditNow.disabled = true;

    chrome.runtime.sendMessage({ action: 'AUDIT_ALL_HISTORY_FILES' }, (res) => {
      isAuditing = false;
      auditIcon.classList.remove('spinning');
      auditText.textContent = 'Periksa Status File';
      btnAuditNow.disabled = false;

      if (res && res.success && Array.isArray(res.history)) {
        allItems = res.history;
        updateMetrics();
        renderList();
      }
    });
  }

  function setLoading(show) {
    if (loadingStateEl) {
      loadingStateEl.style.display = show ? 'flex' : 'none';
    }
  }

  // Update counter metrics cards
  function updateMetrics() {
    const total = allItems.length;
    let totalBytes = 0;
    let countOriginal = 0;
    let countMoved = 0;
    let countBin = 0;
    let countDeleted = 0;

    allItems.forEach((item) => {
      totalBytes += item.sizeBytes || 0;
      const status = item.fileStatus || 'EXISTS_ORIGINAL';
      if (status === 'EXISTS_ORIGINAL') countOriginal++;
      else if (status === 'MOVED') countMoved++;
      else if (status === 'IN_RECYCLE_BIN') countBin++;
      else if (status === 'PERMANENTLY_DELETED') countDeleted++;
    });

    if (totalCountEl) totalCountEl.textContent = total.toLocaleString('id-ID');
    if (totalSizeEl) totalSizeEl.textContent = formatBytes(totalBytes) + ' Data';
    if (countOriginalEl) countOriginalEl.textContent = countOriginal.toLocaleString('id-ID');
    if (countMovedEl) countMovedEl.textContent = countMoved.toLocaleString('id-ID');
    if (countBinEl) countBinEl.textContent = countBin.toLocaleString('id-ID');
    if (countDeletedEl) countDeletedEl.textContent = countDeleted.toLocaleString('id-ID');
  }

  // Filter items and render list
  function renderList() {
    const query = (searchInput.value || '').trim().toLowerCase();
    const plat = platformFilter.value;
    const stat = statusFilter.value;

    const filtered = allItems.filter((item) => {
      // Platform filter
      if (plat !== 'ALL' && (item.platform || '').toLowerCase() !== plat.toLowerCase()) {
        return false;
      }
      // Status filter
      const curStatus = item.fileStatus || 'EXISTS_ORIGINAL';
      if (stat !== 'ALL' && curStatus !== stat) {
        return false;
      }
      // Text search
      if (query) {
        const title = (item.title || '').toLowerCase();
        const filename = (item.filename || '').toLowerCase();
        const url = (item.sourceUrl || '').toLowerCase();
        const curPath = (item.currentPath || item.originalPath || '').toLowerCase();
        if (
          !title.includes(query) &&
          !filename.includes(query) &&
          !url.includes(query) &&
          !curPath.includes(query)
        ) {
          return false;
        }
      }
      return true;
    });

    historyListEl.innerHTML = '';

    if (filtered.length === 0) {
      emptyStateEl.style.display = 'flex';
      return;
    }
    emptyStateEl.style.display = 'none';

    filtered.forEach((item) => {
      const card = createCardElement(item);
      historyListEl.appendChild(card);
    });
  }

  // Create DOM card for a single history item
  function createCardElement(item) {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.dataset.id = item.id;

    const platform = (item.platform || 'video').toLowerCase();
    const status = item.fileStatus || 'EXISTS_ORIGINAL';
    const activePath = item.currentPath || item.originalPath || item.filename;

    let badgeClass = 'status-exists';
    let badgeText = 'Di Folder Asli';
    let statusDesc = activePath;

    if (status === 'EXISTS_ORIGINAL') {
      badgeClass = 'status-exists';
      badgeText = 'Lokasi Asli (Downloads)';
      statusDesc = activePath;
    } else if (status === 'MOVED') {
      badgeClass = 'status-moved';
      badgeText = 'Dipindah ke Lokasi Lain';
      statusDesc = 'Lokasi baru: ' + activePath;
    } else if (status === 'IN_RECYCLE_BIN') {
      badgeClass = 'status-bin';
      badgeText = 'Di Recycle Bin Windows';
      statusDesc = 'File berada di Tempat Sampah Windows — dapat dipulihkan kapan saja.';
    } else if (status === 'PERMANENTLY_DELETED') {
      badgeClass = 'status-deleted';
      badgeText = 'Dihapus Permanen';
      statusDesc = 'File fisik tidak ditemukan lagi di disk penyimpanan.';
    }

    const dateStr = formatDate(item.downloadedAt);
    const sizeStr = item.size || (item.sizeBytes ? formatBytes(item.sizeBytes) : '-');

    // Build markup
    card.innerHTML = `
      <div class="card-main">
        <div class="card-header-line">
          <span class="platform-badge ${escapeHtml(platform)}">${escapeHtml(item.platform || 'Video')}</span>
          <span class="card-title">${escapeHtml(item.title || item.filename)}</span>
        </div>
        <div class="card-meta-line">
          <span class="card-meta-item" title="Waktu Unduh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${dateStr}
          </span>
          <span class="card-meta-item" title="Ukuran File">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            ${sizeStr}
          </span>
          ${item.resolution ? `<span class="card-meta-item"><b>${escapeHtml(item.resolution)}</b></span>` : ''}
          ${item.author ? `<span class="card-meta-item">Uploader: ${escapeHtml(item.author)}</span>` : ''}
        </div>
        <div>
          <span class="status-badge ${badgeClass}">
            <span class="status-dot"></span>
            <span>${badgeText}</span>
          </span>
        </div>
        <div class="card-path-detail" title="${escapeHtml(statusDesc)}">
          ${escapeHtml(statusDesc)}
        </div>
      </div>
      <div class="card-actions">
        ${renderCardActions(item, status, activePath)}
      </div>
    `;

    wireCardEventListeners(card, item, activePath);
    return card;
  }

  function renderCardActions(item, status, _activePath) {
    let html = '';

    if (status === 'EXISTS_ORIGINAL' || status === 'MOVED') {
      html += `
        <button type="button" class="btn-card btn-open-folder" title="Tampilkan file di Windows Explorer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span>Buka Folder</span>
        </button>
        <button type="button" class="btn-card btn-play" title="Putar file di pemutar media Windows">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span>Putar</span>
        </button>
      `;
    } else if (status === 'IN_RECYCLE_BIN') {
      html += `
        <button type="button" class="btn-card btn-open-bin" title="Buka Recycle Bin Windows untuk memulihkan file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          <span>Buka Recycle Bin</span>
        </button>
      `;
    }

    if (item.sourceUrl) {
      html += `
        <button type="button" class="btn-card btn-redownload" title="Buka halaman sumber video untuk unduh ulang">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
          <span>${status === 'PERMANENTLY_DELETED' ? 'Unduh Ulang' : 'Buka Sumber'}</span>
        </button>
      `;
    }

    html += `
      <button type="button" class="btn-card btn-remove" title="Hapus dari daftar riwayat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    return html;
  }

  function wireCardEventListeners(card, item, activePath) {
    // Open in Windows Explorer
    const btnOpen = card.querySelector('.btn-open-folder');
    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        chrome.runtime.sendMessage(
          { action: 'OPEN_FILE_LOCATION', filePath: activePath },
          (res) => {
            if (chrome.runtime.lastError || !res || !res.success) {
              console.warn(
                '[History] Could not open file location:',
                chrome.runtime.lastError || res?.error
              );
            }
          }
        );
      });
    }

    // Play in Default Video Player
    const btnPlay = card.querySelector('.btn-play');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'PLAY_LOCAL_VIDEO', filePath: activePath }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            console.warn('[History] Could not play file:', chrome.runtime.lastError || res?.error);
          }
        });
      });
    }

    // Open Recycle Bin
    const btnOpenBin = card.querySelector('.btn-open-bin');
    if (btnOpenBin) {
      btnOpenBin.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'OPEN_RECYCLE_BIN' });
      });
    }

    // Open Source URL
    const btnRedownload = card.querySelector('.btn-redownload');
    if (btnRedownload && item.sourceUrl) {
      btnRedownload.addEventListener('click', () => {
        chrome.tabs.create({ url: item.sourceUrl });
      });
    }

    // Remove single item from history
    const btnRemove = card.querySelector('.btn-remove');
    if (btnRemove) {
      btnRemove.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'REMOVE_HISTORY_ITEM', id: item.id }, (res) => {
          if (res && res.success) {
            allItems = allItems.filter((x) => x.id !== item.id);
            updateMetrics();
            renderList();
          }
        });
      });
    }
  }

  // Utilities
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoStr;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
