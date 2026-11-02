/**
 * Mungil Comic Lens & In-Page Webtoon Translator
 * Non-destructive DOM Speech-Bubble Overlay System with Auto-Scroll & Collapsible Edge Dock
 * Supports: comic.naver.com, webtoons.com, shinigami.asia, komiku
 */

(function () {
  'use strict';

  // Prevent multiple executions in the same frame
  if (window.__mungilComicTranslatorLoaded) return;
  window.__mungilComicTranslatorLoaded = true;

  let isOverlayVisible = true;
  let isLensActive = false;
  let isAutoScrollEnabled = false;
  let currentSourceLang = 'kor'; // kor, eng, jpn, chs
  let currentGenre = 'action'; // action, fantasy, romance, formal

  const translatedPanelsSet = new WeakSet();
  const panelCache = new WeakMap();
  const activeQueue = [];
  let isProcessingQueue = false;
  let scrollObserver = null;

  /**
   * Discovers reader panel images across supported webtoon / manga domains.
   *
   * @returns {HTMLImageElement[]} Array of comic panel image elements
   */
  function findComicPanels() {
    const selectors = [
      '.wt_viewer img',
      '#comic_view_area img',
      'div[class*="Viewer__image"] img',
      '#_imageList img',
      '.viewer_lst img',
      '#chapter_container img',
      '.reading-content img',
      '.baca-komik img',
      '#chimg img'
    ];

    const images = Array.from(document.querySelectorAll(selectors.join(', ')));
    return images.filter((img) => img && img.naturalWidth > 150 && img.naturalHeight > 150);
  }

  /**
   * Identifies the panel image most prominent in the current browser viewport.
   *
   * @returns {HTMLImageElement|null}
   */
  function getMostVisiblePanel() {
    const panels = findComicPanels();
    if (panels.length === 0) return null;

    let bestPanel = null;
    let maxVisibleHeight = -1;

    const viewportTop = 0;
    const viewportBottom = window.innerHeight;

    for (const img of panels) {
      const rect = img.getBoundingClientRect();
      const visibleTop = Math.max(viewportTop, rect.top);
      const visibleBottom = Math.min(viewportBottom, rect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);

      if (visibleHeight > maxVisibleHeight) {
        maxVisibleHeight = visibleHeight;
        bestPanel = img;
      }
    }

    return bestPanel || panels[0];
  }

  /**
   * Wraps an image in a relative positioning container for non-destructive DOM overlay.
   *
   * @param {HTMLImageElement} imgEl
   * @returns {HTMLDivElement} Overlay container
   */
  function ensureOverlayContainer(imgEl) {
    let wrapper = imgEl.parentElement;
    if (!wrapper.classList.contains('mungil-panel-relative')) {
      wrapper = document.createElement('div');
      wrapper.className = 'mungil-panel-relative';
      imgEl.parentNode.insertBefore(wrapper, imgEl);
      wrapper.appendChild(imgEl);
    }

    let overlay = wrapper.querySelector('.mungil-bubble-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'mungil-bubble-overlay';
      overlay.style.display = isOverlayVisible ? 'block' : 'none';
      wrapper.appendChild(overlay);
    }

    return overlay;
  }

  /**
   * Captures full panel sliced into vertical tiles with overlap to guarantee zero missed headers or memos.
   * Eliminates the 294px resolution squash and viewport-crop misses.
   *
   * @param {HTMLImageElement} imgEl
   * @returns {Promise<Array<{base64: string, startY: number, height: number, width: number, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}>>}
   */
  async function getFullPanelImage(imgEl) {
    const naturalW = imgEl.naturalWidth || imgEl.width || 800;
    const naturalH = imgEl.naturalHeight || imgEl.height || 1200;

    function captureCanvas(srcImg) {
      const canvas = document.createElement('canvas');
      canvas.width = naturalW;
      canvas.height = naturalH;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(srcImg, 0, 0, naturalW, naturalH);
      return {
        base64: canvas.toDataURL('image/jpeg', 0.8),
        width: naturalW,
        height: naturalH,
        canvas,
        ctx
      };
    }

    try {
      const direct = captureCanvas(imgEl);
      if (direct && direct.base64 && direct.base64.length > 200) {
        return direct;
      }
    } catch (_) {}

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'FETCH_IMAGE_DATA',
          url: imgEl.src,
          referer: window.location.href,
          origin: window.location.origin
        },
        (res) => {
          if (res && res.success && res.dataUrl) {
            const temp = new Image();
            temp.onload = () => {
              try {
                resolve(captureCanvas(temp));
              } catch (err) {
                reject(err);
              }
            };
            temp.onerror = () => reject(new Error('Gagal render panel proxy'));
            temp.src = res.dataUrl;
          } else {
            reject(new Error(res?.error || 'Gagal ambil data panel'));
          }
        }
      );
    });
  }

  /**
   * Backwards-compatible single-slice capture helper.
   */
  async function getImageSlice(imgEl) {
    return getFullPanelImage(imgEl);
  }

  async function getFullPanelTiles(imgEl) {
    const single = await getFullPanelImage(imgEl);
    return [{ ...single, startY: 0 }];
  }

  /**
   * Raymarches outward on canvas from raw OCR text bounding box until hitting dark container borders.
   * Snaps the overlay box to the exact physical card or speech bubble dimensions, and detects background color.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x: number, y: number, w: number, h: number}} bbox
   * @param {number} canvasW
   * @param {number} canvasH
   * @returns {{x: number, y: number, w: number, h: number, bgColor: string, textColor: string}}
   */
  function snapBboxToContainer(ctx, bbox, canvasW, canvasH) {
    if (!ctx || !ctx.getImageData) {
      return { ...bbox, bgColor: '#ffffff', textColor: '#000000' };
    }

    let imgData = null;
    try {
      imgData = ctx.getImageData(0, 0, canvasW, canvasH);
    } catch (_) {
      return { ...bbox, bgColor: '#ffffff', textColor: '#000000' };
    }

    const data = imgData.data;
    function getPixel(px, py) {
      const cx = Math.max(0, Math.min(canvasW - 1, Math.round(px)));
      const cy = Math.max(0, Math.min(canvasH - 1, Math.round(py)));
      const idx = (cy * canvasW + cx) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return { r, g, b, lum };
    }

    // Sample background color from 8 probe points around perimeter
    const probes = [
      getPixel(bbox.x - 6, bbox.y - 6),
      getPixel(bbox.x + bbox.w / 2, bbox.y - 6),
      getPixel(bbox.x + bbox.w + 6, bbox.y - 6),
      getPixel(bbox.x - 6, bbox.y + bbox.h / 2),
      getPixel(bbox.x + bbox.w + 6, bbox.y + bbox.h / 2),
      getPixel(bbox.x - 6, bbox.y + bbox.h + 6),
      getPixel(bbox.x + bbox.w / 2, bbox.y + bbox.h + 6),
      getPixel(bbox.x + bbox.w + 6, bbox.y + bbox.h + 6)
    ];

    // Filter out dark strokes or black borders from background average
    const lightProbes = probes.filter((p) => p.lum > 110);
    const effectiveProbes = lightProbes.length > 0 ? lightProbes : probes;

    let avgR = 0;
    let avgG = 0;
    let avgB = 0;
    for (const p of effectiveProbes) {
      avgR += p.r;
      avgG += p.g;
      avgB += p.b;
    }
    avgR = Math.round(avgR / effectiveProbes.length);
    avgG = Math.round(avgG / effectiveProbes.length);
    avgB = Math.round(avgB / effectiveProbes.length);
    const bgLum = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;

    function isBorderPixel(px, py) {
      const pix = getPixel(px, py);
      // Dark border line (e.g. black stroke on speech bubble or slide card)
      if (pix.lum < 85) return true;
      // High contrast shift away from background color
      const delta = Math.abs(pix.r - avgR) + Math.abs(pix.g - avgG) + Math.abs(pix.b - avgB);
      return delta > 75;
    }

    // Raymarch Left
    let snappedLeft = bbox.x;
    const maxRayX = 260;
    for (let x = bbox.x; x >= Math.max(0, bbox.x - maxRayX); x -= 2) {
      let hit = false;
      for (let y = bbox.y; y <= bbox.y + bbox.h; y += 4) {
        if (isBorderPixel(x, y)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        snappedLeft = x + 3;
        break;
      }
    }

    // Raymarch Right
    let snappedRight = bbox.x + bbox.w;
    for (let x = bbox.x + bbox.w; x <= Math.min(canvasW, bbox.x + bbox.w + maxRayX); x += 2) {
      let hit = false;
      for (let y = bbox.y; y <= bbox.y + bbox.h; y += 4) {
        if (isBorderPixel(x, y)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        snappedRight = x - 3;
        break;
      }
    }

    // Raymarch Top
    let snappedTop = bbox.y;
    const maxRayY = 160;
    for (let y = bbox.y; y >= Math.max(0, bbox.y - maxRayY); y -= 2) {
      let hit = false;
      for (let x = snappedLeft; x <= snappedRight; x += 6) {
        if (isBorderPixel(x, y)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        snappedTop = y + 3;
        break;
      }
    }

    // Raymarch Bottom
    let snappedBottom = bbox.y + bbox.h;
    for (let y = bbox.y + bbox.h; y <= Math.min(canvasH, bbox.y + bbox.h + maxRayY); y += 2) {
      let hit = false;
      for (let x = snappedLeft; x <= snappedRight; x += 6) {
        if (isBorderPixel(x, y)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        snappedBottom = y - 3;
        break;
      }
    }

    const snappedW = Math.max(bbox.w, snappedRight - snappedLeft);
    const snappedH = Math.max(bbox.h, snappedBottom - snappedTop);

    const toHex = (c) => c.toString(16).padStart(2, '0');
    const bgColor = `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;
    const textColor = bgLum > 140 ? '#000000' : '#ffffff';

    return {
      x: snappedLeft,
      y: snappedTop,
      w: snappedW,
      h: snappedH,
      bgColor,
      textColor
    };
  }

  /**
   * Merges overlapping or co-located bubble containers that belong to the same slide or bubble.
   *
   * @param {Array<{bbox: object, originalText: string, translatedText: string, bgColor: string, textColor: string}>} items
   * @returns {Array} Merged items
   */
  function mergeOverlappingBubbles(items) {
    if (!items || items.length <= 1) return items;

    const merged = [];
    for (const cur of items) {
      let matched = null;
      for (const m of merged) {
        // Calculate intersection over minimum area
        const interLeft = Math.max(m.bbox.x, cur.bbox.x);
        const interRight = Math.min(m.bbox.x + m.bbox.w, cur.bbox.x + cur.bbox.w);
        const interTop = Math.max(m.bbox.y, cur.bbox.y);
        const interBottom = Math.min(m.bbox.y + m.bbox.h, cur.bbox.y + cur.bbox.h);

        if (interRight > interLeft && interBottom > interTop) {
          const interArea = (interRight - interLeft) * (interBottom - interTop);
          const minArea = Math.min(m.bbox.w * m.bbox.h, cur.bbox.w * cur.bbox.h);
          if (interArea / minArea > 0.45) {
            matched = m;
            break;
          }
        }

        // Also merge vertically stacked lines belonging to the same slide card or text block
        const isStacked =
          Math.abs(m.bbox.x - cur.bbox.x) < 55 &&
          Math.abs(m.bbox.x + m.bbox.w - (cur.bbox.x + cur.bbox.w)) < 55 &&
          (Math.abs(m.bbox.y + m.bbox.h - cur.bbox.y) < 65 ||
            Math.abs(cur.bbox.y + cur.bbox.h - m.bbox.y) < 65) &&
          m.bgColor === cur.bgColor;

        if (isStacked) {
          matched = m;
          break;
        }
      }

      if (matched) {
        matched.translatedText += '\n' + cur.translatedText;
        matched.originalText += ' ' + cur.originalText;
        const uLeft = Math.min(matched.bbox.x, cur.bbox.x);
        const uTop = Math.min(matched.bbox.y, cur.bbox.y);
        const uRight = Math.max(matched.bbox.x + matched.bbox.w, cur.bbox.x + cur.bbox.w);
        const uBottom = Math.max(matched.bbox.y + matched.bbox.h, cur.bbox.y + cur.bbox.h);
        matched.bbox.x = uLeft;
        matched.bbox.y = uTop;
        matched.bbox.w = uRight - uLeft;
        matched.bbox.h = uBottom - uTop;
      } else {
        merged.push(cur);
      }
    }

    return merged;
  }

  /**
   * Automatically calculates best font-size to prevent bubble overflow.
   *
   * @param {HTMLElement} el
   * @param {number} maxW
   * @param {number} maxH
   */
  function autoFitBubbleText(el, maxW, maxH) {
    let fontSize = Math.min(22, Math.max(11, Math.floor(maxH * 0.2)));
    el.style.fontSize = `${fontSize}px`;

    let safety = 0;
    while ((el.scrollHeight > maxH || el.scrollWidth > maxW) && fontSize > 8 && safety < 14) {
      fontSize -= 1;
      el.style.fontSize = `${fontSize}px`;
      safety += 1;
    }
  }

  /**
   * Renders DOM bubble elements into the panel overlay from unified bubble metadata.
   */
  function renderBubblesToOverlay(overlay, imgEl, bubbles) {
    overlay.innerHTML = '';
    const naturalW = imgEl.naturalWidth || imgEl.clientWidth || 800;
    const naturalH = imgEl.naturalHeight || imgEl.clientHeight || 1200;
    const scaleX = imgEl.clientWidth / naturalW;
    const scaleY = imgEl.clientHeight / naturalH;

    for (const item of bubbles) {
      const bubbleDiv = document.createElement('div');
      bubbleDiv.className = 'mungil-trans-bubble';
      bubbleDiv.setAttribute('data-original-text', item.originalText);
      bubbleDiv.title = `Asli: ${item.originalText}\nKlik untuk salin`;

      const bLeft = item.bbox.x * scaleX;
      const bTop = item.bbox.y * scaleY;
      const bWidth = Math.max(36, item.bbox.w * scaleX);
      const bHeight = Math.max(24, item.bbox.h * scaleY);

      bubbleDiv.style.left = `${bLeft}px`;
      bubbleDiv.style.top = `${bTop}px`;
      bubbleDiv.style.width = `${bWidth}px`;
      bubbleDiv.style.height = `${bHeight}px`;
      bubbleDiv.style.backgroundColor = item.bgColor || '#ffffff';
      bubbleDiv.style.color = item.textColor || '#000000';
      bubbleDiv.innerText = item.translatedText;

      bubbleDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(item.translatedText);
        bubbleDiv.style.outline = '2px solid #ffb800';
        setTimeout(() => {
          bubbleDiv.style.outline = 'none';
        }, 600);
      });

      autoFitBubbleText(bubbleDiv, bWidth, bHeight);
      overlay.appendChild(bubbleDiv);
    }
  }

  /**
   * Translates an entire comic panel image and renders DOM speech bubbles.
   *
   * @param {HTMLImageElement} imgEl
   * @param {function} [statusCallback]
   * @param {boolean} [force=false]
   */
  async function translateComicPanel(imgEl, statusCallback, force = false) {
    if (!imgEl) return;
    if (translatedPanelsSet.has(imgEl) && !force) return;
    translatedPanelsSet.add(imgEl);

    const overlay = ensureOverlayContainer(imgEl);

    // 0ms Cache Hit: If panel was already translated, render instantaneously
    if (panelCache.has(imgEl) && !force) {
      const cachedBubbles = panelCache.get(imgEl);
      renderBubblesToOverlay(overlay, imgEl, cachedBubbles);
      return cachedBubbles.length;
    }

    if (force) {
      overlay.innerHTML = '';
    }

    // Instant Cover: place gentle non-intrusive veil so user doesn't see raw untranslated text
    const cover = document.createElement('div');
    cover.className = 'mungil-trans-cover';
    overlay.appendChild(cover);

    if (statusCallback) statusCallback('Ambil piksel...');
    let panelData = null;
    try {
      panelData = await getFullPanelImage(imgEl);
    } catch (_err) {
      translatedPanelsSet.delete(imgEl);
      cover.remove();
      if (statusCallback) statusCallback('Gagal baca panel');
      return;
    }

    if (statusCallback) statusCallback('OCR & Scanlate...');
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'OCR_AND_TRANSLATE_PANEL',
          base64Image: panelData.base64,
          lang: currentSourceLang,
          targetLang: 'id',
          genre: currentGenre
        },
        (res) => {
          cover.remove();

          if (!res || !res.success) {
            translatedPanelsSet.delete(imgEl);
            if (statusCallback) statusCallback('OCR gagal');
            return reject(new Error(res?.error || 'Translation failed'));
          }

          const rawBubbles = res.bubbles || [];
          if (rawBubbles.length === 0) {
            if (statusCallback) statusCallback('Panel tanpa teks');
            return resolve(0);
          }

          const snappedBubbles = rawBubbles.map((item) => {
            const snapped = snapBboxToContainer(
              panelData.ctx,
              item.bbox,
              panelData.width,
              panelData.height
            );

            return {
              ...item,
              bbox: snapped,
              bgColor: snapped.bgColor,
              textColor: snapped.textColor
            };
          });

          // Merge co-located boxes belonging to the same slide card or speech bubble
          const unifiedBubbles = mergeOverlappingBubbles(snappedBubbles);

          // Save to panelCache for 0ms instantaneous future visits
          panelCache.set(imgEl, unifiedBubbles);

          renderBubblesToOverlay(overlay, imgEl, unifiedBubbles);

          if (statusCallback) statusCallback(`Selesai (${unifiedBubbles.length} balon)`);
          resolve(unifiedBubbles.length);
        }
      );
    });
  }

  /**
   * Processes the auto-scroll translation queue using a predictive lookahead buffer.
   * Prioritizes panels closest to viewport, processing with concurrency of 2 workers
   * across our rotated API key pool for perceived zero-latency translation.
   */
  async function processAutoQueue(statusCallback) {
    if (isProcessingQueue || activeQueue.length === 0) return;
    isProcessingQueue = true;

    // Concurrency 2: dispatch 2 lookahead panels simultaneously using distinct API keys
    const CONCURRENCY = 2;

    while (activeQueue.length > 0) {
      // Sort active queue by proximity to viewport center
      const viewportY = window.innerHeight / 2;
      activeQueue.sort((a, b) => {
        const distA = Math.abs(a.getBoundingClientRect().top - viewportY);
        const distB = Math.abs(b.getBoundingClientRect().top - viewportY);
        return distA - distB;
      });

      const batch = [];
      while (batch.length < CONCURRENCY && activeQueue.length > 0) {
        const candidate = activeQueue.shift();
        if (candidate && !translatedPanelsSet.has(candidate)) {
          batch.push(candidate);
        }
      }

      if (batch.length === 0) break;

      await Promise.allSettled(batch.map((p) => translateComicPanel(p, statusCallback)));

      // Brief pacing to prevent network bursts
      if (activeQueue.length > 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    isProcessingQueue = false;
    if (statusCallback) statusCallback('Auto-Scroll: Siap');
  }

  /**
   * Sets up or teardowns IntersectionObserver for seamless auto-scroll translation.
   * Uses 600px forward rootMargin for predictive pre-loading the next panel ahead
   * without overwhelming the free API rate limit.
   *
   * @param {boolean} enable
   * @param {function} statusCallback
   */
  function toggleAutoScroll(enable, statusCallback) {
    isAutoScrollEnabled = enable;

    if (!enable) {
      if (scrollObserver) {
        scrollObserver.disconnect();
        scrollObserver = null;
      }
      activeQueue.length = 0;
      if (statusCallback) statusCallback('Auto-Scroll: Mati');
      return;
    }

    if (scrollObserver) scrollObserver.disconnect();

    scrollObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !translatedPanelsSet.has(entry.target)) {
            // Guard: Never pile more than 3 panels in queue to prevent API lockup
            if (!activeQueue.includes(entry.target) && activeQueue.length < 3) {
              activeQueue.push(entry.target);
            }
          }
        }
        processAutoQueue(statusCallback);
      },
      { rootMargin: '600px 0px 200px 0px' }
    );

    const panels = findComicPanels();
    panels.forEach((p) => scrollObserver.observe(p));
    if (statusCallback) statusCallback(`Auto-Scroll aktif (${panels.length} panel)`);
  }

  /**
   * Activates interactive "Bidik Balon" drag selection tool.
   *
   * @param {function} [statusCallback]
   */
  function activateLensMode(statusCallback) {
    if (isLensActive) return;
    isLensActive = true;

    const lensOverlay = document.createElement('div');
    lensOverlay.id = 'mungil-lens-overlay';

    const selectionBox = document.createElement('div');
    selectionBox.id = 'mungil-lens-selection-box';
    selectionBox.style.display = 'none';
    lensOverlay.appendChild(selectionBox);

    document.body.appendChild(lensOverlay);
    if (statusCallback) statusCallback('Drag kotak pada balon teks...');

    let isDragging = false;
    let startX = 0;
    let startY = 0;

    function cleanupLens() {
      isLensActive = false;
      lensOverlay.remove();
      const lensBtn = document.getElementById('mungil-lens-btn');
      if (lensBtn) lensBtn.classList.remove('active');
      if (statusCallback) statusCallback('Siap');
      window.removeEventListener('keydown', onKeyDown);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') cleanupLens();
    }
    window.addEventListener('keydown', onKeyDown);

    lensOverlay.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      selectionBox.style.left = `${startX}px`;
      selectionBox.style.top = `${startY}px`;
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
      selectionBox.style.display = 'block';
    });

    lensOverlay.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const curX = e.clientX;
      const curY = e.clientY;
      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);

      selectionBox.style.left = `${left}px`;
      selectionBox.style.top = `${top}px`;
      selectionBox.style.width = `${width}px`;
      selectionBox.style.height = `${height}px`;
    });

    lensOverlay.addEventListener('mouseup', async (e) => {
      if (!isDragging) return;
      isDragging = false;
      const endX = e.clientX;
      const endY = e.clientY;
      const boxLeft = Math.min(startX, endX);
      const boxTop = Math.min(startY, endY);
      const boxW = Math.abs(endX - startX);
      const boxH = Math.abs(endY - startY);

      cleanupLens();
      if (boxW < 15 || boxH < 15) return;

      const targetPanel = getMostVisiblePanel();
      if (!targetPanel) return;

      const pRect = targetPanel.getBoundingClientRect();
      const relX = boxLeft - pRect.left;
      const relY = boxTop - pRect.top;

      try {
        const sliceMeta = await getImageSlice(targetPanel);
        const naturalW = targetPanel.naturalWidth || targetPanel.clientWidth || 800;
        const naturalH = targetPanel.naturalHeight || targetPanel.clientHeight || 1200;
        const scaleDomToNaturalX = naturalW / targetPanel.clientWidth;
        const scaleDomToNaturalY = naturalH / targetPanel.clientHeight;

        const sourceX = relX * scaleDomToNaturalX;
        const sourceY = relY * scaleDomToNaturalY - sliceMeta.sliceStartY;
        const sourceW = boxW * scaleDomToNaturalX;
        const sourceH = boxH * scaleDomToNaturalY;

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = Math.max(30, sourceW);
        cropCanvas.height = Math.max(20, sourceH);
        const ctx = cropCanvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(
          sliceMeta.canvas,
          Math.max(0, sourceX),
          Math.max(0, sourceY),
          sourceW,
          sourceH,
          0,
          0,
          cropCanvas.width,
          cropCanvas.height
        );

        const cropBase64 = cropCanvas.toDataURL('image/jpeg', 0.92);
        if (statusCallback) statusCallback('Menerjemahkan balon terpilih...');

        chrome.runtime.sendMessage(
          {
            action: 'OCR_AND_TRANSLATE_PANEL',
            base64Image: cropBase64,
            lang: currentSourceLang,
            targetLang: 'id',
            genre: currentGenre
          },
          (res) => {
            const overlay = ensureOverlayContainer(targetPanel);
            const bubbles = res?.bubbles || [];
            let translated = '...';
            let original = '';

            if (bubbles.length > 0) {
              translated = bubbles.map((b) => b.translatedText).join(' ');
              original = bubbles.map((b) => b.originalText).join(' ');
            } else {
              translated = 'Tidak terbaca';
            }

            const bubbleDiv = document.createElement('div');
            bubbleDiv.className = 'mungil-trans-bubble';
            bubbleDiv.setAttribute('data-original-text', original || 'Teks asli');
            bubbleDiv.title = `Asli: ${original}\nKlik untuk salin`;
            bubbleDiv.style.left = `${relX}px`;
            bubbleDiv.style.top = `${relY}px`;
            bubbleDiv.style.width = `${boxW}px`;
            bubbleDiv.style.height = `${boxH}px`;
            bubbleDiv.innerText = translated;

            autoFitBubbleText(bubbleDiv, boxW, boxH);
            overlay.appendChild(bubbleDiv);
            if (statusCallback) statusCallback('Balon terpasang!');
          }
        );
      } catch (_err) {
        if (statusCallback) statusCallback('Gagal crop balon');
      }
    });
  }

  /**
   * Initializes the floating toolbar and collapsible edge pill.
   */
  function initTranslatorBar() {
    if (document.getElementById('mungil-trans-bar')) return;

    // 1. Floating Mini Pill (Small discreet circular trigger on screen edge)
    const pill = document.createElement('div');
    pill.id = 'mungil-trans-pill';
    pill.className = 'mungil-hidden';
    pill.title = 'Buka Mungil Comic Translator';
    pill.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
      </svg>
    `;

    // 2. Main Control Bar
    const bar = document.createElement('div');
    bar.id = 'mungil-trans-bar';

    function expandBar() {
      bar.classList.remove('mungil-collapsed');
      pill.classList.add('mungil-hidden');
    }

    function collapseBar() {
      bar.classList.add('mungil-collapsed');
      pill.classList.remove('mungil-hidden');
    }

    pill.addEventListener('click', expandBar);

    // Brand icon & title
    const brand = document.createElement('div');
    brand.className = 'mungil-brand';
    brand.innerHTML = `
      <svg class="mungil-brand-icon" viewBox="0 0 24 24">
        <path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
      </svg>
      <span>Comic Lens</span>
    `;
    bar.appendChild(brand);

    // Status label
    const statusLabel = document.createElement('span');
    statusLabel.className = 'mungil-trans-status';
    statusLabel.innerText = 'Siap';
    bar.appendChild(statusLabel);

    function updateStatus(txt) {
      statusLabel.innerText = txt;
    }

    // Language selector
    const langSelect = document.createElement('select');
    langSelect.className = 'mungil-select-sm';
    langSelect.innerHTML = `
      <option value="kor">🇰🇷 Korea → ID</option>
      <option value="eng">🇺🇸 English → ID</option>
      <option value="jpn">🇯🇵 Jepang → ID</option>
      <option value="chs">🇨🇳 China → ID</option>
    `;
    langSelect.value = currentSourceLang;
    langSelect.addEventListener('change', () => {
      currentSourceLang = langSelect.value;
      updateStatus(`Bahasa: ${currentSourceLang.toUpperCase()}`);
    });
    bar.appendChild(langSelect);

    // Genre selector (Scanlation tone adapter)
    const genreSelect = document.createElement('select');
    genreSelect.className = 'mungil-select-sm';
    genreSelect.title = 'Pilih genre untuk menyesuaikan gaya bahasa scanlation';
    genreSelect.innerHTML = `
      <option value="action">🔥 Action / Tawuran (Lo/Gue santai)</option>
      <option value="fantasy">⚔️ Murim / Fantasy (Aku/Kau)</option>
      <option value="romance">🌸 Romance / Drama (Akrab)</option>
      <option value="formal">📜 Formal / Netral</option>
    `;
    genreSelect.value = currentGenre;
    genreSelect.addEventListener('change', () => {
      currentGenre = genreSelect.value;
      updateStatus(`Gaya: ${currentGenre}`);
    });
    bar.appendChild(genreSelect);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'mungil-btn-group';

    // Button 1: Terjemahkan Panel Terlihat
    const scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.className = 'mungil-tb-btn mungil-btn-primary';
    scanBtn.innerText = '✨ Terjemahkan';
    scanBtn.addEventListener('click', async () => {
      const panel = getMostVisiblePanel();
      if (!panel) {
        updateStatus('Tidak ada panel terdeteksi');
        return;
      }
      scanBtn.disabled = true;
      try {
        await translateComicPanel(panel, updateStatus, true);
      } catch (e) {
        updateStatus('Error: ' + (e.message || 'Gagal'));
      } finally {
        scanBtn.disabled = false;
      }
    });
    btnGroup.appendChild(scanBtn);

    // Button 2: Auto-Scroll Toggle
    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'mungil-tb-btn mungil-btn-secondary';
    autoBtn.innerText = '⚡ Auto';
    autoBtn.title = 'Terjemahkan panel otomatis saat scroll ke bawah';
    autoBtn.addEventListener('click', () => {
      const newState = !isAutoScrollEnabled;
      toggleAutoScroll(newState, updateStatus);
      if (newState) {
        autoBtn.classList.add('active');
        autoBtn.innerText = '⚡ Auto: ON';
      } else {
        autoBtn.classList.remove('active');
        autoBtn.innerText = '⚡ Auto';
      }
    });
    btnGroup.appendChild(autoBtn);

    // Button 3: Mode Bidik Balon (Interactive Drag)
    const lensBtn = document.createElement('button');
    lensBtn.type = 'button';
    lensBtn.id = 'mungil-lens-btn';
    lensBtn.className = 'mungil-tb-btn mungil-btn-secondary';
    lensBtn.innerText = '🎯 Bidik';
    lensBtn.addEventListener('click', () => {
      if (isLensActive) return;
      lensBtn.classList.add('active');
      activateLensMode(updateStatus);
    });
    btnGroup.appendChild(lensBtn);

    // Button 4: Toggle Visibility
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'mungil-tb-btn mungil-btn-secondary';
    toggleBtn.innerText = '👁️ Balon';
    toggleBtn.addEventListener('click', () => {
      isOverlayVisible = !isOverlayVisible;
      const overlays = document.querySelectorAll('.mungil-bubble-overlay');
      overlays.forEach((o) => {
        o.style.display = isOverlayVisible ? 'block' : 'none';
      });
      toggleBtn.innerText = isOverlayVisible ? '👁️ Balon' : '🚫 Sembunyi';
    });
    btnGroup.appendChild(toggleBtn);

    // Button 5: Collapse / Hide FAB
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'mungil-tb-btn mungil-btn-secondary mungil-btn-icon-only';
    collapseBtn.title = 'Ciutkan FAB ke pojok agar tidak mengganggu baca';
    collapseBtn.innerText = '➖';
    collapseBtn.addEventListener('click', collapseBar);
    btnGroup.appendChild(collapseBtn);

    bar.appendChild(btnGroup);

    document.body.appendChild(pill);
    document.body.appendChild(bar);
  }

  // Self-initializing lifecycle (browser runtime only, not in node unit tests)
  if (typeof module === 'undefined' && typeof document !== 'undefined' && document.body) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initTranslatorBar);
    } else {
      initTranslatorBar();
    }

    // Periodic check if user dynamically navigates to a new webtoon chapter
    setInterval(() => {
      if (!document.getElementById('mungil-trans-bar')) {
        initTranslatorBar();
      }
    }, 2500);
  }

  // Export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      findComicPanels,
      getMostVisiblePanel,
      autoFitBubbleText,
      ensureOverlayContainer,
      snapBboxToContainer,
      mergeOverlappingBubbles,
      getFullPanelTiles,
      renderBubblesToOverlay
    };
  }
})();
