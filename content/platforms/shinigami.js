/**
 * Shinigami Comics (shinigami.asia / 11.shinigami.asia) Downloader - Content Platform Script
 * Runs in ISOLATED world at document_idle.
 *
 * Capabilities:
 * 1. Automatic Manga & Chapter detection from URL UUID and DOM.
 * 2. API Integration with api.shngm.io (chapter detail, series list, manga metadata).
 * 3. Multi-Format Packaging:
 *    - PDF (Standard E-Book per Chapter with native PDF 1.4 generation)
 *    - Long Image (Vertical canvas stitching for webtoon strip reading)
 *    - CBZ / ZIP (Pure JS PKZIP comic archive with original lossless WebP panels)
 * 4. Paced Batch Downloader Queue (concurrency: 2) with NTFS safe filenames:
 *    {MANGATITLE}_Chapter_{CHAPTERNUMBER}.{pdf|webp|zip}
 * 5. Floating Action Bar & Batch Selector Modal.
 * 6. Popup IPC Handlers (GET_ACTIVE_VIDEO_INFO, DOWNLOAD_ACTIVE_VIDEO).
 */

(function () {
  'use strict';

  // Prevent duplicate injections
  if (typeof window !== 'undefined') {
    if (window.__MUNGIL_SHINIGAMI_INITIALIZED__) return;
    window.__MUNGIL_SHINIGAMI_INITIALIZED__ = true;
  }

  const LOG_PREFIX = '[Shinigami Downloader]';

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

  function sanitizeShinigamiTitle(title) {
    if (title === null || title === undefined) return 'Manga';
    let str = String(title).trim();
    if (!str) return 'Manga';

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
      str = `Manga_${str}`;
    }

    return str || 'Manga';
  }

  function formatShinigamiFilename(titleOrParams, chapterNumber, ext) {
    let mangaTitle = '';
    let ch = chapterNumber;
    let fileExt = ext;

    if (typeof titleOrParams === 'object' && titleOrParams !== null) {
      mangaTitle = titleOrParams.mangaTitle || titleOrParams.title || 'Shinigami_Comic';
      ch = titleOrParams.chapterNumber;
      fileExt = titleOrParams.ext;
    } else {
      mangaTitle = titleOrParams || 'Shinigami_Comic';
    }

    const safeManga = sanitizeShinigamiTitle(mangaTitle)
      .replace(/[\s-]+/g, '_')
      .replace(/_+/g, '_');
    const chRaw = ch !== undefined && ch !== null ? String(ch).trim() : '1';
    const cleanExt = fileExt ? String(fileExt).replace(/^\./, '') : 'pdf';

    return `${safeManga}_Chapter_${chRaw}.${cleanExt}`;
  }

  // =========================================================================
  // 2. Active Page Metadata & API Discovery
  // =========================================================================

  function extractShinigamiPageInfo(customUrl, customDoc) {
    const doc = customDoc || (typeof document !== 'undefined' ? document : null);
    let pathname = '';
    if (customUrl) {
      try {
        pathname = new URL(customUrl).pathname;
      } catch (_) {
        pathname = customUrl;
      }
    } else if (typeof window !== 'undefined' && window.location) {
      pathname = window.location.pathname || '';
    }

    const chapterMatch = pathname.match(/\/chapter\/([a-zA-Z0-9-]+)/i);
    const seriesMatch = pathname.match(/\/series\/([a-zA-Z0-9-]+)/i);

    const chapterId = chapterMatch ? chapterMatch[1] : null;
    let mangaId = seriesMatch ? seriesMatch[1] : null;

    let rawTitle = '';
    let chapterNumber = 1;

    if (doc) {
      const h1 = doc.querySelector ? doc.querySelector('h1, .chapter-title, .series-title') : null;
      if (h1) rawTitle = h1.textContent.trim();
      if (!rawTitle && doc.querySelector) {
        const breadcrumb = doc.querySelector('.breadcrumb, nav[aria-label="breadcrumb"]');
        if (breadcrumb) {
          const aTags = breadcrumb.querySelectorAll('a');
          for (let i = aTags.length - 1; i >= 0; i--) {
            const txt = aTags[i].textContent.trim();
            if (
              txt &&
              !txt.toLowerCase().includes('home') &&
              !txt.toLowerCase().includes('chapter')
            ) {
              rawTitle = txt;
              break;
            }
          }
        }
      }
      if (!rawTitle && doc.title) {
        rawTitle = doc.title;
      }

      const titleAndDoc = (rawTitle || '') + ' ' + (doc.title || '');
      const chMatch = titleAndDoc.match(/chapter\s*(\d+)/i) || titleAndDoc.match(/\bch\s*(\d+)/i);
      if (chMatch) chapterNumber = parseInt(chMatch[1], 10);

      if (!mangaId && doc.querySelector) {
        const seriesLink = doc.querySelector('a[href*="/series/"]');
        if (seriesLink) {
          const href =
            (typeof seriesLink.getAttribute === 'function'
              ? seriesLink.getAttribute('href')
              : seriesLink.href) || '';
          const m = href.match(/\/series\/([a-zA-Z0-9-]+)/i);
          if (m) mangaId = m[1];
        }
      }
    }

    // Clean manga title (remove Chapter X, Shinigami, Scans, etc.)
    const cleanTitle = (rawTitle || 'Manga')
      .replace(/chapter\s*\d+/gi, '')
      .replace(/shinigami(?:\s*id)?/gi, '')
      .replace(/scans/gi, '')
      .replace(/undefined/gi, '')
      .replace(/[-|:]+$/g, '')
      .trim();

    return {
      chapterId,
      mangaId,
      chapterNumber,
      title: sanitizeShinigamiTitle(cleanTitle || 'Manga')
        .replace(/[\s-]+/g, '_')
        .replace(/_+/g, '_')
    };
  }

  async function fetchChapterDetail(chapterId) {
    if (!chapterId) return null;
    try {
      const origin =
        typeof window !== 'undefined' && window.location && window.location.origin
          ? window.location.origin
          : 'https://11.shinigami.asia';
      const referer =
        typeof window !== 'undefined' && window.location && window.location.href
          ? window.location.href
          : 'https://11.shinigami.asia/';

      const apiUrl = `https://api.shngm.io/v1/chapter/detail/${chapterId}`;
      const res = await fetch(apiUrl, {
        headers: {
          Origin: origin,
          Referer: referer
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || (!json.data && json.retcode !== 0 && json.retcode !== 200)) return null;

      const d = json.data || {};
      const baseUrl = d.base_url || 'https://assets.shngm.id';
      let path = d.chapter?.path || '';
      if (path && !path.endsWith('/')) path += '/';
      const files = Array.isArray(d.chapter?.data) ? d.chapter.data : [];

      const imageUrls = files.map((f) => {
        if (f.startsWith('http://') || f.startsWith('https://')) return f;
        if (path.startsWith('http://') || path.startsWith('https://')) {
          return `${path}${f.replace(/^\//, '')}`;
        }
        return `${baseUrl}${path}${f.replace(/^\//, '')}`;
      });

      return {
        chapterId: d.chapter_id || chapterId,
        mangaId: d.manga_id || (d.manga && d.manga.manga_id) || null,
        chapterNumber: d.chapter_number || (d.chapter && d.chapter.chapter_number) || 1,
        imageUrls,
        prevChapterId: d.prev_chapter_id || null,
        nextChapterId: d.next_chapter_id || null
      };
    } catch (e) {
      console.warn(`${LOG_PREFIX} fetchChapterDetail error:`, e.message);
      return null;
    }
  }

  async function fetchSeriesChapters(mangaId) {
    if (!mangaId) return [];
    try {
      const origin =
        typeof window !== 'undefined' && window.location && window.location.origin
          ? window.location.origin
          : 'https://11.shinigami.asia';
      const referer =
        typeof window !== 'undefined' && window.location && window.location.href
          ? window.location.href
          : 'https://11.shinigami.asia/';

      let allData = [];
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= 15) {
        const apiUrl = `https://api.shngm.io/v1/chapter/${mangaId}/list?page=${page}&page_size=100&sort_by=chapter_number&sort_order=asc`;
        const res = await fetch(apiUrl, {
          headers: {
            Origin: origin,
            Referer: referer
          }
        });
        if (!res.ok) break;
        const json = await res.json();
        if (!json || !Array.isArray(json.data) || json.data.length === 0) break;
        allData = allData.concat(json.data);
        if (json.data.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }

      return allData
        .map((c) => {
          const num = c.chapter_number || 1;
          const title = (c.chapter_title && c.chapter_title.trim()) || `Chapter ${num}`;
          return {
            chapterId: c.chapter_id,
            mangaId: c.manga_id || mangaId,
            chapterNumber: num,
            chapterTitle: title,
            title
          };
        })
        .sort((a, b) => a.chapterNumber - b.chapterNumber);
    } catch (e) {
      console.warn(`${LOG_PREFIX} fetchSeriesChapters error:`, e.message);
      return [];
    }
  }

  async function fetchMangaDetail(mangaId) {
    if (!mangaId) return null;
    try {
      const origin =
        typeof window !== 'undefined' && window.location && window.location.origin
          ? window.location.origin
          : 'https://11.shinigami.asia';
      const referer =
        typeof window !== 'undefined' && window.location && window.location.href
          ? window.location.href
          : 'https://11.shinigami.asia/';

      const apiUrl = `https://api.shngm.io/v1/manga/detail/${mangaId}`;
      const res = await fetch(apiUrl, {
        headers: {
          Origin: origin,
          Referer: referer
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || (!json.data && json.retcode !== 0 && json.retcode !== 200)) return null;
      const d = json.data || {};
      return {
        mangaId: d.manga_id || mangaId,
        title: sanitizeShinigamiTitle(d.title || 'Manga'),
        description: d.description || ''
      };
    } catch (e) {
      console.warn(`${LOG_PREFIX} fetchMangaDetail error:`, e.message);
      return null;
    }
  }

  // =========================================================================
  // 3. Document Packaging Engines (Pure JS: PDF, Canvas Long Image, PKZIP)
  // =========================================================================

  /**
   * Helper: Fetches raw ArrayBuffer with dual-tier fallback (In-page fetch -> SW proxy)
   * to guarantee immune execution against strict CDN CORS policies.
   */
  async function fetchImageBuffer(url) {
    // Attempt 1: Direct in-page fetch
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.arrayBuffer();
      }
    } catch (_) {}

    // Attempt 2: Background service worker proxy (Extension privileges bypass page CORS)
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error(`Failed to fetch image: ${url}`));
        return;
      }
      chrome.runtime.sendMessage(
        { action: 'FETCH_IMAGE_DATA', url, referer: 'https://11.shinigami.asia/' },
        (res) => {
          if (chrome.runtime.lastError || !res || !res.success || !res.dataUrl) {
            reject(new Error((res && res.error) || `Background fetch failed: ${url}`));
            return;
          }
          try {
            const commaIdx = res.dataUrl.indexOf(',');
            const b64 = commaIdx !== -1 ? res.dataUrl.slice(commaIdx + 1) : res.dataUrl;
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            resolve(bytes.buffer);
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  /**
   * Helper: Loads an image URL into an HTML Image Element.
   */
  function loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = async () => {
        // Fallback: If anonymous crossOrigin was rejected, fetch via SW and load as object URL
        try {
          const buf = await fetchImageBuffer(url);
          const mimeType =
            url.includes('.jpg') || url.includes('.jpeg') ? 'image/jpeg' : 'image/webp';
          const blob = new Blob([buf], { type: mimeType });
          const blobUrl = URL.createObjectURL(blob);
          const fallbackImg = new Image();
          fallbackImg.onload = () => {
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            resolve(fallbackImg);
          };
          fallbackImg.onerror = (_e) => {
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            reject(new Error(`Failed to load fallback image: ${url}`));
          };
          fallbackImg.src = blobUrl;
        } catch (_err) {
          reject(new Error(`Failed to load image: ${url}`));
        }
      };
      img.src = url;
    });
  }

  /**
   * Helper: Parallel Worker Pool executor
   * Concurrently processes items through worker slots while maintaining strict input order.
   */
  async function mapConcurrent(items, concurrency, asyncFn, onProgress) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const results = new Array(items.length);
    let nextIdx = 0;
    let completed = 0;

    async function worker() {
      while (nextIdx < items.length) {
        const i = nextIdx++;
        try {
          results[i] = await asyncFn(items[i], i);
        } catch (err) {
          console.warn(`${LOG_PREFIX} Item worker error at index ${i}:`, err.message);
          results[i] = null;
        } finally {
          completed++;
          if (typeof onProgress === 'function') {
            onProgress(completed, items.length);
          }
        }
      }
    }

    const workerLimit = Math.max(1, Math.min(concurrency || 8, items.length));
    const workers = [];
    for (let w = 0; w < workerLimit; w++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return results;
  }

  /**
   * Generates a valid standard PDF 1.4 file containing all chapter images.
   */
  async function generateChapterPdf(images, onProgress) {
    // Collect JPEG byte buffers from each image using parallel image workers
    const rawPages = await mapConcurrent(
      images,
      8,
      async (imgUrl) => {
        const img = await loadImageElement(imgUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0);

        const jpegBlob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
        const jpegBuffer = await jpegBlob.arrayBuffer();

        return {
          width: canvas.width,
          height: canvas.height,
          bytes: new Uint8Array(jpegBuffer)
        };
      },
      (curr, total) => {
        if (typeof onProgress === 'function') {
          onProgress(curr, total, 'Mengonversi halaman...');
        }
      }
    );

    const pageDataList = rawPages.filter(Boolean);

    if (typeof onProgress === 'function') {
      onProgress(images.length, images.length, 'Merakit PDF...');
    }

    // Assemble PDF 1.4 Binary Structure
    const chunks = [];
    let currentOffset = 0;
    const offsets = [];

    function writeStr(str) {
      const bytes = new TextEncoder().encode(str);
      chunks.push(bytes);
      currentOffset += bytes.length;
    }

    function writeBytes(bytes) {
      chunks.push(bytes);
      currentOffset += bytes.length;
    }

    writeStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    const numPages = pageDataList.length;
    // Object IDs:
    // 1: Catalog
    // 2: Pages tree
    // Pages: 3 + i * 3
    // Image XObjects: 4 + i * 3
    // Page Content streams: 5 + i * 3

    // 1. Catalog
    offsets[1] = currentOffset;
    writeStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // 2. Pages
    const pageRefs = [];
    for (let i = 0; i < numPages; i++) {
      pageRefs.push(`${3 + i * 3} 0 R`);
    }
    offsets[2] = currentOffset;
    writeStr(
      `2 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${numPages} >>\nendobj\n`
    );

    // Write each page
    for (let i = 0; i < numPages; i++) {
      const p = pageDataList[i];
      const pageObj = 3 + i * 3;
      const imgObj = 4 + i * 3;
      const contentObj = 5 + i * 3;

      // Page Object
      offsets[pageObj] = currentOffset;
      writeStr(
        `${pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.width} ${p.height}] ` +
          `/Contents ${contentObj} 0 R /Resources << /XObject << /Im${i} ${imgObj} 0 R >> >> >>\nendobj\n`
      );

      // Image XObject
      offsets[imgObj] = currentOffset;
      writeStr(
        `${imgObj} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`
      );
      writeBytes(p.bytes);
      writeStr('\nendstream\nendobj\n');

      // Content stream
      const streamContent = `q ${p.width} 0 0 ${p.height} 0 0 cm /Im${i} Do Q\n`;
      const streamLen = new TextEncoder().encode(streamContent).length;
      offsets[contentObj] = currentOffset;
      writeStr(
        `${contentObj} 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}endstream\nendobj\n`
      );
    }

    // Cross-Reference Table
    const xrefOffset = currentOffset;
    const totalObjs = 2 + numPages * 3;
    writeStr(`xref\n0 ${totalObjs + 1}\n`);
    writeStr('0000000000 65535 f \n');
    for (let i = 1; i <= totalObjs; i++) {
      const off = String(offsets[i] || 0).padStart(10, '0');
      writeStr(`${off} 00000 n \n`);
    }

    // Trailer
    writeStr(
      `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
    );

    return new Blob(chunks, { type: 'application/pdf' });
  }

  /**
   * Stitches all chapter panels vertically into a single continuous WebP image.
   */
  async function generateLongImage(images, onProgress) {
    const rawImages = await mapConcurrent(
      images,
      8,
      async (url) => {
        return await loadImageElement(url);
      },
      (curr, total) => {
        if (typeof onProgress === 'function') {
          onProgress(curr, total, 'Memuat panel gambar...');
        }
      }
    );

    const loadedImages = rawImages.filter(Boolean);
    let totalHeight = 0;
    let maxWidth = 0;

    for (const img of loadedImages) {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w > maxWidth) maxWidth = w;
      totalHeight += h;
    }

    // Safety ceiling for Canvas height (browser standard limit ~32767px)
    let scale = 1.0;
    if (totalHeight > 32000) {
      scale = 32000 / totalHeight;
      maxWidth = Math.round(maxWidth * scale);
      totalHeight = 32000;
    }

    if (typeof onProgress === 'function') {
      onProgress(images.length, images.length, 'Menggabungkan strip vertikal...');
    }

    const canvas = document.createElement('canvas');
    canvas.width = maxWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');

    let currentY = 0;
    for (const img of loadedImages) {
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;
      const drawW = Math.round(origW * scale);
      const drawH = Math.round(origH * scale);
      ctx.drawImage(img, 0, currentY, drawW, drawH);
      currentY += drawH;
    }

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.92);
    });
  }

  /**
   * Packages all chapter panels into a pure PKZIP archive (.cbz / .zip).
   */
  async function generateCbzArchive(images, onProgress) {
    // Helper: Simple CRC32 implementation
    const makeCrcTable = () => {
      let c;
      const table = [];
      for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
      }
      return table;
    };
    const crcTable = makeCrcTable();
    const crc32 = (buf) => {
      let crc = 0 ^ -1;
      for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
      }
      return (crc ^ -1) >>> 0;
    };

    const rawEntries = await mapConcurrent(
      images,
      12,
      async (url, i) => {
        const buf = await fetchImageBuffer(url);
        const bytes = new Uint8Array(buf);
        const filename = `page_${String(i + 1).padStart(3, '0')}.webp`;
        return {
          name: filename,
          data: bytes,
          crc: crc32(bytes)
        };
      },
      (curr, total) => {
        if (typeof onProgress === 'function') {
          onProgress(curr, total, 'Mengunduh panel WebP...');
        }
      }
    );

    const fileEntries = rawEntries.filter(Boolean);

    if (typeof onProgress === 'function') {
      onProgress(images.length, images.length, 'Mengompresi CBZ/ZIP...');
    }

    const chunks = [];
    const cdEntries = [];
    let offset = 0;

    for (const entry of fileEntries) {
      const nameBytes = new TextEncoder().encode(entry.name);
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const view = new DataView(localHeader.buffer);

      view.setUint32(0, 0x04034b50, true); // Local file header signature
      view.setUint16(4, 20, true); // Version needed to extract
      view.setUint16(6, 0, true); // General purpose bit flag
      view.setUint16(8, 0, true); // Compression method (0 = uncompressed store)
      view.setUint16(10, 0, true); // File last mod time
      view.setUint16(12, 0, true); // File last mod date
      view.setUint32(14, entry.crc, true); // CRC-32
      view.setUint32(18, entry.data.length, true); // Compressed size
      view.setUint32(22, entry.data.length, true); // Uncompressed size
      view.setUint16(26, nameBytes.length, true); // File name length
      view.setUint16(28, 0, true); // Extra field length
      localHeader.set(nameBytes, 30);

      chunks.push(localHeader);
      chunks.push(entry.data);

      cdEntries.push({
        entry,
        nameBytes,
        localHeaderOffset: offset
      });

      offset += localHeader.length + entry.data.length;
    }

    const cdStartOffset = offset;
    let cdSize = 0;

    for (const item of cdEntries) {
      const cdHeader = new Uint8Array(46 + item.nameBytes.length);
      const view = new DataView(cdHeader.buffer);

      view.setUint32(0, 0x02014b50, true); // Central directory header signature
      view.setUint16(4, 20, true); // Version made by
      view.setUint16(6, 20, true); // Version needed to extract
      view.setUint16(8, 0, true); // General purpose bit flag
      view.setUint16(10, 0, true); // Compression method (0)
      view.setUint16(12, 0, true); // File last mod time
      view.setUint16(14, 0, true); // File last mod date
      view.setUint32(16, item.entry.crc, true); // CRC-32
      view.setUint32(20, item.entry.data.length, true); // Compressed size
      view.setUint32(24, item.entry.data.length, true); // Uncompressed size
      view.setUint16(28, item.nameBytes.length, true); // File name length
      view.setUint16(30, 0, true); // Extra field length
      view.setUint16(32, 0, true); // Comment length
      view.setUint16(34, 0, true); // Disk number start
      view.setUint16(36, 0, true); // Internal file attributes
      view.setUint32(38, 0, true); // External file attributes
      view.setUint32(42, item.localHeaderOffset, true); // Relative offset of local header
      cdHeader.set(item.nameBytes, 46);

      chunks.push(cdHeader);
      cdSize += cdHeader.length;
    }

    // End of central directory record
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
    eocdView.setUint16(4, 0, true); // Number of this disk
    eocdView.setUint16(6, 0, true); // Disk where central directory starts
    eocdView.setUint16(8, cdEntries.length, true); // Total entries on this disk
    eocdView.setUint16(10, cdEntries.length, true); // Total entries
    eocdView.setUint32(12, cdSize, true); // Size of central directory
    eocdView.setUint32(16, cdStartOffset, true); // Offset of start of CD
    eocdView.setUint16(20, 0, true); // Comment length

    chunks.push(eocd);

    return new Blob(chunks, { type: 'application/vnd.comicbook+zip' });
  }

  function triggerBlobDownload(blob, filename) {
    if (!blob || !filename) return false;
    if (typeof document === 'undefined' || !document.createElement) return false;

    try {
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = filename;
      if (document.body) {
        document.body.appendChild(a);
      }
      if (typeof a.click === 'function') {
        a.click();
      }
      setTimeout(() => {
        if (typeof a.remove === 'function') {
          a.remove();
        }
        if (typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(blobUrl);
        }
      }, 45000);
      return true;
    } catch (_) {
      return false;
    }
  }

  // =========================================================================
  // 4. Batch Downloader Modal
  // =========================================================================

  let batchModalEl = null;

  function openBatchModal(data, allChapters) {
    if (batchModalEl) {
      batchModalEl.remove();
      batchModalEl = null;
    }

    const modal = document.createElement('div');
    modal.id = 'mungil-shinigami-modal';

    const chapters =
      allChapters.length > 0
        ? allChapters
        : [
            {
              chapterId: data.chapterId,
              chapterNumber: data.chapterNumber || 1,
              title: `Chapter ${data.chapterNumber || 1}`
            }
          ];

    const currentChNum = data.chapterNumber || (chapters[0] ? chapters[0].chapterNumber : 1);

    modal.innerHTML = `
      <div class="mungil-sn-backdrop"></div>
      <div class="mungil-sn-dialog">
        <div class="mungil-sn-header">
          <div class="mungil-sn-title-group">
            <h2 class="mungil-sn-title">${data.title}</h2>
            <span class="mungil-sn-subtitle">Batch Downloader • ${chapters.length} Chapter Terdeteksi</span>
          </div>
          <button type="button" class="mungil-sn-close" id="mungil-sn-close-btn">&times;</button>
        </div>

        <div class="mungil-sn-controls">
          <div class="mungil-sn-filter-chips">
            <button type="button" class="mungil-sn-chip active" data-filter="all">Semua (${chapters.length})</button>
            <button type="button" class="mungil-sn-chip" data-filter="prev">Ch ≤ ${currentChNum}</button>
            <button type="button" class="mungil-sn-chip" data-filter="next">Ch ≥ ${currentChNum}</button>
            <button type="button" class="mungil-sn-chip" data-filter="none">Batal</button>
          </div>
          <div class="mungil-sn-options-group">
            <div class="mungil-sn-format-picker">
              <label for="mungil-sn-format-select">Format:</label>
              <select id="mungil-sn-format-select">
                <option value="cbz" selected>CBZ / ZIP Archive (Lossless Original HD)</option>
                <option value="pdf">PDF Document (E-Book HD)</option>
                <option value="long_image">Long Image (Webtoon Strip)</option>
              </select>
            </div>
            <div class="mungil-sn-worker-picker">
              <label for="mungil-sn-workers-select">Workers:</label>
              <select id="mungil-sn-workers-select">
                <option value="2">2x Slots</option>
                <option value="4" selected>4x Turbo</option>
                <option value="8">8x Extreme</option>
              </select>
            </div>
          </div>
        </div>

        <div class="mungil-sn-list" id="mungil-sn-list">
          ${chapters
            .map(
              (ch) => `
            <label class="mungil-sn-item">
              <input type="checkbox" class="mungil-sn-checkbox" data-chid="${ch.chapterId}" data-chnum="${ch.chapterNumber}" checked>
              <span class="mungil-sn-item-badge">CH ${ch.chapterNumber}</span>
              <span class="mungil-sn-item-title">${ch.chapterTitle || ch.title || `Chapter ${ch.chapterNumber}`}</span>
              <span class="mungil-sn-item-status" id="sn-status-${ch.chapterNumber}">Ready</span>
            </label>
          `
            )
            .join('')}
        </div>

        <div class="mungil-sn-footer">
          <div class="mungil-sn-summary">
            <span id="mungil-sn-selected-count">${chapters.length}</span> chapter dipilih
          </div>
          <div class="mungil-sn-footer-btns">
            <button type="button" class="mungil-sn-btn mungil-sn-btn-secondary" id="mungil-sn-cancel-btn">Tutup</button>
            <button type="button" class="mungil-sn-btn mungil-sn-btn-primary" id="mungil-sn-start-btn">
              ${SVG_DOWNLOAD}
              <span>Unduh Batch Terpilih</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    batchModalEl = modal;

    const closeBtn = modal.querySelector('#mungil-sn-close-btn');
    const cancelBtn = modal.querySelector('#mungil-sn-cancel-btn');
    const backdrop = modal.querySelector('.mungil-sn-backdrop');
    const closeModal = () => {
      if (batchModalEl) {
        batchModalEl.remove();
        batchModalEl = null;
      }
    };
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    const checkboxes = modal.querySelectorAll('.mungil-sn-checkbox');
    const selectedCountEl = modal.querySelector('#mungil-sn-selected-count');
    const updateCount = () => {
      const checked = modal.querySelectorAll('.mungil-sn-checkbox:checked').length;
      if (selectedCountEl) selectedCountEl.textContent = String(checked);
    };

    modal.querySelectorAll('.mungil-sn-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        modal.querySelectorAll('.mungil-sn-chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        const filter = chip.getAttribute('data-filter');

        checkboxes.forEach((cb) => {
          const num = parseFloat(cb.getAttribute('data-chnum')) || 1;
          if (filter === 'all') cb.checked = true;
          else if (filter === 'prev') cb.checked = num <= currentChNum;
          else if (filter === 'next') cb.checked = num >= currentChNum;
          else if (filter === 'none') cb.checked = false;
        });
        updateCount();
      });
    });

    checkboxes.forEach((cb) => cb.addEventListener('change', updateCount));

    const startBtn = modal.querySelector('#mungil-sn-start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const selected = Array.from(modal.querySelectorAll('.mungil-sn-checkbox:checked')).map(
          (cb) => ({
            chapterId: cb.getAttribute('data-chid'),
            chapterNumber: cb.getAttribute('data-chnum')
          })
        );

        if (selected.length === 0) return;

        startBtn.disabled = true;
        startBtn.innerHTML = `<span>Memproses (${selected.length})...</span>`;

        const formatSelect = modal.querySelector('#mungil-sn-format-select');
        const format = formatSelect ? formatSelect.value : 'cbz';

        const workersSelect = modal.querySelector('#mungil-sn-workers-select');
        const workers = workersSelect ? parseInt(workersSelect.value, 10) || 4 : 4;

        executeBatchMangaDownload(data.title, selected, format, modal, workers);
      });
    }
  }

  // =========================================================================
  // 5. High-Throughput Multi-Worker Chapter Download Execution
  // =========================================================================

  async function executeBatchMangaDownload(mangaTitle, items, format, modalEl, maxWorkers = 4) {
    let active = 0;
    let idx = 0;
    let slotCounter = 0;

    const runNext = async () => {
      if (idx >= items.length && active === 0) {
        const startBtn = modalEl?.querySelector('#mungil-sn-start-btn');
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.innerHTML = `${SVG_CHECK} <span>Selesai!</span>`;
        }
        return;
      }

      while (active < maxWorkers && idx < items.length) {
        const item = items[idx++];
        active++;
        const workerId = (slotCounter++ % maxWorkers) + 1;

        const statusEl = modalEl?.querySelector(`#sn-status-${item.chapterNumber}`);
        if (statusEl) {
          statusEl.textContent = `W#${workerId}: Memuat...`;
          statusEl.style.color = 'var(--sn-text-muted, #9E9E9E)';
        }

        (async () => {
          try {
            const detail = await fetchChapterDetail(item.chapterId);
            if (!detail || !detail.imageUrls || detail.imageUrls.length === 0) {
              if (statusEl) {
                statusEl.textContent = 'Gagal';
                statusEl.style.color = '#FF5252';
              }
              return;
            }

            let blob = null;
            let ext = 'pdf';

            if (format === 'long_image') {
              ext = 'webp';
              blob = await generateLongImage(detail.imageUrls, (curr, total, _msg) => {
                if (statusEl) statusEl.textContent = `W#${workerId}: ${curr}/${total}`;
              });
            } else if (format === 'cbz') {
              ext = 'cbz';
              blob = await generateCbzArchive(detail.imageUrls, (curr, total, _msg) => {
                if (statusEl) statusEl.textContent = `W#${workerId}: ${curr}/${total}`;
              });
            } else {
              ext = 'pdf';
              blob = await generateChapterPdf(detail.imageUrls, (curr, total, _msg) => {
                if (statusEl) statusEl.textContent = `W#${workerId}: ${curr}/${total}`;
              });
            }

            if (!blob) throw new Error('Blob generation failed');

            if (statusEl) {
              statusEl.textContent = `W#${workerId}: Menyimpan...`;
              statusEl.style.color = '#FFB300';
            }

            const filename = formatShinigamiFilename({
              mangaTitle,
              chapterNumber: item.chapterNumber,
              ext
            });

            const saved = triggerBlobDownload(blob, filename);

            if (statusEl) {
              if (saved) {
                statusEl.textContent = `✓ Ch ${item.chapterNumber} Saved`;
                statusEl.style.color = '#00E676';
              } else {
                statusEl.textContent = 'Failed';
                statusEl.style.color = '#FF5252';
              }
            }
          } catch (err) {
            console.error(`${LOG_PREFIX} Chapter download error:`, err);
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

  // =========================================================================
  // 6. In-Page Floating Bar
  // =========================================================================

  let floatingBarEl = null;

  function renderFloatingBar(data, customDoc) {
    if (!data) return null;
    const doc = customDoc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;

    let bar = doc.getElementById ? doc.getElementById('mungil-shinigami-bar') : null;
    if (!bar) {
      bar = doc.createElement('div');
      bar.id = 'mungil-shinigami-bar';
      if (doc.body) doc.body.appendChild(bar);
    }
    floatingBarEl = bar;

    const chBadge = data.chapterNumber ? `CH ${data.chapterNumber}` : 'MANGA';

    floatingBarEl.innerHTML = `
      <div class="mungil-sn-bar-content">
        <div class="mungil-sn-bar-info">
          <span class="mungil-sn-bar-badge">${chBadge}</span>
          <span class="mungil-sn-bar-title" title="${data.title}">${data.title}</span>
        </div>
        <div class="mungil-sn-bar-actions">
          ${
            data.chapterId
              ? `
            <button type="button" class="mungil-sn-btn mungil-sn-btn-primary" id="mungil-sn-btn-single">
              ${SVG_DOWNLOAD}
              <span>Unduh PDF</span>
            </button>
          `
              : ''
          }
          <button type="button" class="mungil-sn-btn mungil-sn-btn-batch" id="mungil-sn-btn-batch">
            ${SVG_LAYERS}
            <span>Batch Download</span>
          </button>
        </div>
      </div>
    `;

    const singleBtn = floatingBarEl.querySelector('#mungil-sn-btn-single');
    if (singleBtn && data.chapterId) {
      singleBtn.addEventListener('click', async () => {
        singleBtn.disabled = true;
        singleBtn.innerHTML = `<span>Memuat...</span>`;

        try {
          const detail = await fetchChapterDetail(data.chapterId);
          if (!detail || !detail.imageUrls || detail.imageUrls.length === 0) {
            singleBtn.disabled = false;
            singleBtn.textContent = 'Gagal';
            return;
          }

          singleBtn.innerHTML = `<span>Merakit PDF...</span>`;
          const pdfBlob = await generateChapterPdf(detail.imageUrls, (curr, total) => {
            singleBtn.innerHTML = `<span>PDF ${curr}/${total}</span>`;
          });

          const filename = formatShinigamiFilename({
            mangaTitle: data.title,
            chapterNumber: detail.chapterNumber,
            ext: 'pdf'
          });

          const saved = triggerBlobDownload(pdfBlob, filename);
          singleBtn.disabled = false;
          if (saved) {
            singleBtn.innerHTML = `${SVG_CHECK} <span>Tersimpan!</span>`;
          } else {
            singleBtn.innerHTML = `${SVG_DOWNLOAD} <span>Coba Lagi</span>`;
          }
          setTimeout(() => {
            if (singleBtn) singleBtn.innerHTML = `${SVG_DOWNLOAD} <span>Unduh PDF</span>`;
          }, 3000);
        } catch (_e) {
          singleBtn.disabled = false;
          singleBtn.textContent = 'Error';
        }
      });
    }

    const batchBtn = floatingBarEl.querySelector('#mungil-sn-btn-batch');
    if (batchBtn) {
      batchBtn.addEventListener('click', async () => {
        batchBtn.disabled = true;
        batchBtn.innerHTML = `<span>Memuat Chapter...</span>`;

        let chapters = [];
        if (data.mangaId) {
          chapters = await fetchSeriesChapters(data.mangaId);
        }

        batchBtn.disabled = false;
        batchBtn.innerHTML = `${SVG_LAYERS} <span>Batch Download</span>`;

        openBatchModal(data, chapters);
      });
    }

    return floatingBarEl;
  }

  // =========================================================================
  // 7. Initialization & IPC Handlers
  // =========================================================================

  async function init() {
    if (typeof document === 'undefined') return;

    const pageInfo = extractShinigamiPageInfo();
    if (!pageInfo) return;

    let mangaId = pageInfo.mangaId;
    let chapterNumber = null;

    if (pageInfo.chapterId) {
      const detail = await fetchChapterDetail(pageInfo.chapterId);
      if (detail) {
        if (!mangaId) mangaId = detail.mangaId;
        chapterNumber = detail.chapterNumber;
      }
    }

    if (mangaId) {
      const mDetail = await fetchMangaDetail(mangaId);
      if (mDetail && mDetail.title) {
        pageInfo.title = mDetail.title;
      }
    }

    const activeData = {
      ...pageInfo,
      mangaId,
      chapterNumber
    };

    renderFloatingBar(activeData);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;

        if (
          message.action === 'GET_ACTIVE_VIDEO_INFO' ||
          message.action === 'GET_ACTIVE_MANGA_INFO'
        ) {
          sendResponse({
            success: true,
            platform: 'shinigami',
            mangaTitle: activeData.title,
            chapterNumber: activeData.chapterNumber,
            mangaId: activeData.mangaId,
            chapterId: activeData.chapterId
          });
          return true;
        }

        if (
          message.action === 'DOWNLOAD_ACTIVE_VIDEO' ||
          message.action === 'DOWNLOAD_ACTIVE_MANGA'
        ) {
          (async () => {
            const chapters = activeData.mangaId
              ? await fetchSeriesChapters(activeData.mangaId)
              : [];
            openBatchModal(activeData, chapters);
            sendResponse({ success: true, platform: 'shinigami' });
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
      sanitizeShinigamiTitle,
      formatShinigamiFilename,
      extractShinigamiPageInfo,
      fetchChapterDetail,
      fetchSeriesChapters,
      fetchMangaDetail,
      generateChapterPdf,
      generateLongImage,
      generateCbzArchive,
      renderFloatingBar,
      triggerBlobDownload
    };
  }
})();
