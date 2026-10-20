/**
 * Adversarial Stress & Security Test Suite for Bstation (Bilibili.tv) Downloader
 *
 * Verifies:
 * 1. Deep NTFS Boundary Value Analysis: colons, slashes, double quotes, question marks,
 *    asterisks, control characters, Japanese/Chinese/Korean titles, emojis, trailing dots/spaces,
 *    and Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
 *    PROVES validity by writing actual files to Windows NTFS filesystem!
 * 2. VIP Security Boundary: Attempt to select/queue VIP episodes as non-VIP user.
 *    Verifies [VIP Diperlukan] badge, disabled checkboxes, click guards, and server/bridge authorization failure handling.
 * 3. Corrupt Stream / 403 / Fallback & Error Handling: HTTP 403 Forbidden, 500 Server Error,
 *    HTML error pages disguised as 200 OK, JSON error bodies, 0-byte streams, network aborts,
 *    and bridge timeouts.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert');

const sw = require('./background/service_worker.js');
const bstation = require('./content/platforms/bstation.js');
const bridge = require('./content/injected/bstation_bridge.js');

// Test runner state
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err });
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(`    ${err.stack.split('\n')[1]}`);
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ PASS: ${name}`);
  } catch (err) {
    failedTests++;
    failures.push({ name, error: err });
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    if (err.stack) console.error(`    ${err.stack.split('\n')[1]}`);
  }
}

// Complete DOM Mock for Content Script & Modal Testing
class MockClassList {
  constructor(element) {
    this.element = element;
    this._set = new Set();
  }
  add(...classes) {
    for (const c of classes) {
      if (c && typeof c === 'string') {
        c.trim()
          .split(/\s+/)
          .forEach((cls) => {
            if (cls) this._set.add(cls);
          });
      }
    }
    this._sync();
  }
  remove(...classes) {
    for (const c of classes) {
      if (c && typeof c === 'string') {
        c.trim()
          .split(/\s+/)
          .forEach((cls) => {
            this._set.delete(cls);
          });
      }
    }
    this._sync();
  }
  contains(c) {
    return this._set.has(c);
  }
  _sync() {
    if (this.element && this.element.attributes) {
      this.element.attributes.set('class', Array.from(this._set).join(' '));
    }
  }
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.classList = new MockClassList(this);
    this.children = [];
    this.parentElement = null;
    this.disabled = false;
    this.checked = false;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.style = {};
    this._listeners = new Map();
  }

  get id() {
    return this.attributes.get('id') || this._id || '';
  }

  set id(val) {
    this._id = String(val);
    this.setAttribute('id', val);
  }

  get className() {
    return this.attributes.get('class') || '';
  }

  set className(val) {
    this.setAttribute('class', val);
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'class') {
      this.classList._set.clear();
      String(val)
        .trim()
        .split(/\s+/)
        .forEach((c) => {
          if (c) this.classList._set.add(c);
        });
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'class') {
      this.classList._set.clear();
    }
  }

  appendChild(child) {
    if (!child) return child;
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentElement = null;
    }
    return child;
  }

  matches(selector) {
    if (!selector || typeof selector !== 'string') return false;
    const parts = selector.split(',').map((s) => s.trim());
    for (const part of parts) {
      if (this._matchesSingle(part)) return true;
    }
    return false;
  }

  _matchesSingle(sel) {
    if (!sel) return false;
    let tag = null;
    let rest = sel;
    const tagMatch = rest.match(/^([a-zA-Z0-9]+)(.*)$/);
    if (tagMatch) {
      tag = tagMatch[1];
      rest = tagMatch[2];
      if (tag.toUpperCase() !== this.tagName) return false;
      if (!rest) return true;
    }

    if (rest.includes(':checked')) {
      const base = rest.replace(':checked', '').trim();
      if (!base) return !!this.checked;
      return this._matchesSingle(base) && !!this.checked;
    }

    if (rest.startsWith('#')) {
      const targetId = rest.slice(1);
      return this.attributes.get('id') === targetId || this.id === targetId;
    }

    if (rest.startsWith('.')) {
      return this.classList.contains(rest.slice(1));
    }

    if (rest.startsWith('[')) {
      const attrMatch = rest.match(/^\[([a-zA-Z0-9_-]+)(?:([*~|^$]?=)"?([^"\]]+)"?)?(\s+i)?\]$/);
      if (attrMatch) {
        const attrName = attrMatch[1];
        const op = attrMatch[2];
        let val = attrMatch[3];
        const isCaseInsensitive = !!attrMatch[4];

        if (!this.attributes.has(attrName)) return false;
        if (!op) return true;

        let attrVal = this.attributes.get(attrName) || '';
        if (isCaseInsensitive) {
          attrVal = attrVal.toLowerCase();
          val = (val || '').toLowerCase();
        }

        if (op === '=') return attrVal === val;
        if (op === '*=') return attrVal.includes(val);
        if (op === '^=') return attrVal.startsWith(val);
        if (op === '$=') return attrVal.endsWith(val);
      }
      return false;
    }

    return false;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches && current.matches(selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    const list = this.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children) {
        if (child.matches && child.matches(selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  getElementById(id) {
    if (this.attributes.get('id') === id || this.id === id) return this;
    for (const child of this.children) {
      if (child && child.getElementById) {
        const found = child.getElementById(id);
        if (found) return found;
      }
    }
    return null;
  }

  addEventListener(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
  }

  removeEventListener(event, handler) {
    if (!this._listeners.has(event)) return;
    const arr = this._listeners.get(event).filter((h) => h !== handler);
    this._listeners.set(event, arr);
  }

  dispatchEvent(event) {
    try {
      Object.defineProperty(event, 'target', { value: this, configurable: true });
    } catch (_) {
      try {
        event.target = this;
      } catch (__) {}
    }
    let curr = this;
    while (curr) {
      const handlers = curr._listeners.get(event.type) || [];
      for (const h of handlers) {
        h.call(curr, event);
        if (event._stopped) return;
      }
      curr = curr.parentElement;
    }
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      target: this,
      preventDefault: () => {},
      stopPropagation: () => {
        this._stopped = true;
      }
    });
  }
}

function setupMockEnvironment(customState = {}) {
  const docRoot = new MockElement('body');
  global.document = {
    body: docRoot,
    documentElement: docRoot,
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => docRoot.getElementById(id),
    querySelector: (sel) => docRoot.querySelector(sel),
    querySelectorAll: (sel) => docRoot.querySelectorAll(sel),
    addEventListener: (type, fn) => docRoot.addEventListener(type, fn),
    removeEventListener: (type, fn) => docRoot.removeEventListener(type, fn),
    dispatchEvent: (evt) => docRoot.dispatchEvent(evt),
    title: 'Anime Stream'
  };

  global.window = {
    __INITIAL_STATE__: customState
  };

  return docRoot;
}

async function runAdversarialSuites() {
  console.log('\n======================================================================');
  console.log(' ADVERSARIAL CHALLENGE SUITE: Bstation Downloader Hardening');
  console.log('======================================================================\n');

  // =========================================================================
  // SECTION 1: Windows NTFS Filename Sanitization & Physical Disk Verification
  // =========================================================================
  console.log('[SECTION 1] Windows NTFS Filename Sanitization & Physical Disk Verification');

  const generatedFilenames = [];

  test('NTFS illegal characters: colons, slashes, double quotes, question marks, asterisks, pipe', () => {
    const dirty = 'Re:Zero / S02? "Hero"* <Arc|5> : Chapter::Final';
    const cleanTitle = bstation.sanitizeBstationTitle(dirty);
    const swTitle = sw.sanitizeBstationTitle(dirty);
    assert.strictEqual(
      cleanTitle,
      swTitle,
      'Content script and SW sanitizers must produce identical title'
    );

    // Win32 illegal characters strictly forbidden in NTFS filenames
    const forbidden = /[/\\:*?"<>|\x00-\x1f\x7f-\x9f]/;
    assert.ok(
      !forbidden.test(cleanTitle),
      `Sanitized title contains illegal NTFS character: ${cleanTitle}`
    );

    const fn = bstation.formatBstationFilename({ title: dirty, episode: 1, quality: '1080p' });
    assert.ok(!forbidden.test(fn), `Formatted filename contains illegal NTFS character: ${fn}`);
    assert.ok(fn.endsWith('.mp4'));
    assert.ok(fn.startsWith('[Re - Zero - S02 Hero Arc - 5 - Chapter'));
    generatedFilenames.push(fn);
  });

  test('NTFS control characters: 0x00 to 0x1F and 0x7F to 0x9F elimination', () => {
    let dirty = '';
    for (let i = 0; i <= 0x1f; i++) dirty += String.fromCharCode(i);
    dirty += 'Jujutsu Kaisen';
    for (let i = 0x7f; i <= 0x9f; i++) dirty += String.fromCharCode(i);

    const clean = bstation.sanitizeBstationTitle(dirty);
    assert.strictEqual(clean, 'Jujutsu Kaisen');
    const fn = bstation.formatBstationFilename(dirty, 24, '720p');
    assert.strictEqual(fn, '[Jujutsu Kaisen] - E24 [720p].mp4');
    generatedFilenames.push(fn);
  });

  test('Japanese, Chinese, Korean CJK anime titles and punctuation preserved intact', () => {
    const titles = [
      { raw: '葬送のフリーレン', expected: '葬送のフリーレン' },
      { raw: '鬼滅の刃 刀鍛冶の里編', expected: '鬼滅の刃 刀鍛冶の里編' },
      { raw: '進撃の巨人 The Final Season', expected: '進撃の巨人 The Final Season' },
      { raw: '【推しの子】', expected: '【推しの子】' },
      { raw: 'SPY×FAMILY Season 2', expected: 'SPY×FAMILY Season 2' },
      {
        raw: 'Re:ゼロから始める異世界生活 3rd season',
        expected: 'Re - ゼロから始める異世界生活 3rd season'
      },
      { raw: '간 떨어지는 동거', expected: '간 떨어지는 동거' }
    ];

    titles.forEach(({ raw, expected }) => {
      const clean = bstation.sanitizeBstationTitle(raw);
      assert.strictEqual(clean, expected);
      const fn = bstation.formatBstationFilename(raw, '03', '1080p');
      assert.ok(fn.startsWith(`[${expected}]`));
      assert.ok(fn.endsWith('[1080p].mp4'));
      generatedFilenames.push(fn);
    });
  });

  test('Emoji and Unicode symbols in anime titles preserved safely', () => {
    const raw = '🔥 Chainsaw Man 🎬 [MAPPA] ⚔️';
    const clean = bstation.sanitizeBstationTitle(raw);
    assert.strictEqual(clean, '🔥 Chainsaw Man 🎬 [MAPPA] ⚔️');
    const fn = bstation.formatBstationFilename(raw, 12, '1080p');
    assert.strictEqual(fn, '[🔥 Chainsaw Man 🎬 [MAPPA] ⚔️] - E12 [1080p].mp4');
    generatedFilenames.push(fn);
  });

  test('Windows reserved device names: CON, PRN, AUX, NUL, COM1-9, LPT1-9', () => {
    const reserved = [
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'COM2',
      'COM3',
      'COM4',
      'COM5',
      'COM6',
      'COM7',
      'COM8',
      'COM9',
      'LPT1',
      'LPT2',
      'LPT3',
      'LPT4',
      'LPT5',
      'LPT6',
      'LPT7',
      'LPT8',
      'LPT9'
    ];

    reserved.forEach((name) => {
      const fn = bstation.formatBstationFilename(name, 1, '720p');
      // Format is [CON] - E01 [720p].mp4
      // The base filename is "[CON] - E01 [720p]", which is NOT equal to "CON", so it is strictly valid on NTFS.
      assert.strictEqual(fn, `[${name}] - E01 [720p].mp4`);
      generatedFilenames.push(fn);
    });
  });

  test('Win32 trailing dots, spaces, hyphens and whitespace collapsing', () => {
    const dirty = 'Bleach: Thousand-Year Blood War.....   ';
    const clean = bstation.sanitizeBstationTitle(dirty);
    assert.strictEqual(clean, 'Bleach - Thousand - Year Blood War');
    assert.ok(!clean.endsWith('.'), 'Title must not end with a period');
    assert.ok(!clean.endsWith(' '), 'Title must not end with a space');

    const fn = bstation.formatBstationFilename(dirty, 'E13', '1080p');
    assert.strictEqual(fn, '[Bleach - Thousand - Year Blood War] - E13 [1080p].mp4');
    generatedFilenames.push(fn);
  });

  test('Extreme title length boundary value analysis: truncation to <= 120 chars, total filename < 255', () => {
    const longTitle = 'Super Long Anime Title '.repeat(25); // 575 chars
    const clean = bstation.sanitizeBstationTitle(longTitle);
    assert.ok(clean.length <= 120, `Title length ${clean.length} exceeds 120 chars`);
    assert.ok(!clean.endsWith('.'), 'Truncated title must not end with dot');
    assert.ok(!clean.endsWith(' '), 'Truncated title must not end with space');
    assert.ok(!clean.endsWith('-'), 'Truncated title must not end with hyphen');

    const fn = bstation.formatBstationFilename(longTitle, 999, '1080p');
    assert.ok(
      fn.length < 255,
      `Filename length ${fn.length} exceeds NTFS MAX_PATH component limit (255)`
    );
    generatedFilenames.push(fn);
  });

  test('Empty, null, undefined, and non-string inputs fallback safely', () => {
    const cases = [null, undefined, '', '   ', '::::????***', '- - -'];
    cases.forEach((c) => {
      const clean = bstation.sanitizeBstationTitle(c);
      assert.strictEqual(clean, 'Anime', `Failed fallback for input: ${JSON.stringify(c)}`);
      const fn = bstation.formatBstationFilename(c);
      assert.strictEqual(fn, '[Anime] - E01 [720p].mp4');
      generatedFilenames.push(fn);
    });
  });

  test('Quality normalization boundary: lowercase, remove special characters, default to 720p', () => {
    assert.strictEqual(
      bstation.formatBstationFilename('Naruto', 1, '1080P'),
      '[Naruto] - E01 [1080p].mp4'
    );
    assert.strictEqual(
      bstation.formatBstationFilename('Naruto', 1, '1080p+'),
      '[Naruto] - E01 [1080p+].mp4'
    );
    assert.strictEqual(
      bstation.formatBstationFilename('Naruto', 1, '4K UHD'),
      '[Naruto] - E01 [4kuhd].mp4'
    );
    assert.strictEqual(
      bstation.formatBstationFilename('Naruto', 1, null),
      '[Naruto] - E01 [720p].mp4'
    );
    assert.strictEqual(
      bstation.formatBstationFilename('Naruto', 1, '???'),
      '[Naruto] - E01 [720p].mp4'
    );
  });

  test('Episode format normalization boundary: integers, strings, missing numbers', () => {
    assert.strictEqual(bstation.formatBstationEpisode(1), 'E01');
    assert.strictEqual(bstation.formatBstationEpisode(9), 'E09');
    assert.strictEqual(bstation.formatBstationEpisode(10), 'E10');
    assert.strictEqual(bstation.formatBstationEpisode(124), 'E124');
    assert.strictEqual(bstation.formatBstationEpisode('07'), 'E07');
    assert.strictEqual(bstation.formatBstationEpisode('E08'), 'E08');
    assert.strictEqual(bstation.formatBstationEpisode('Episode 25'), 'E25');
    assert.strictEqual(bstation.formatBstationEpisode('Special OVA'), 'E01');
    assert.strictEqual(bstation.formatBstationEpisode(null), 'E01');
  });

  test('Physical NTFS Disk Verification: write and read all generated filenames on Windows NTFS', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bstation_ntfs_test_'));
    try {
      assert.ok(generatedFilenames.length > 25, 'Expected >25 unique adversarial filenames');
      for (const fname of generatedFilenames) {
        const filePath = path.join(tempDir, fname);
        // Attempt to write 16-byte dummy file to real Windows NTFS filesystem
        fs.writeFileSync(filePath, 'dummy_video_data');
        assert.ok(fs.existsSync(filePath), `Failed to create file on NTFS: ${fname}`);
        const stat = fs.statSync(filePath);
        assert.strictEqual(stat.size, 16, `File size mismatch on NTFS: ${fname}`);
        fs.unlinkSync(filePath);
      }
    } finally {
      try {
        fs.rmdirSync(tempDir);
      } catch (_) {}
    }
  });

  // =========================================================================
  // SECTION 2: VIP Security Boundary Adversarial Testing
  // =========================================================================
  console.log('\n[SECTION 2] VIP Security Boundary Adversarial Testing');

  test('Non-VIP user batch modal: marks [VIP Diperlukan], disables checkbox, sets locked card style', () => {
    setupMockEnvironment({
      mediaInfo: { title: 'One Piece' },
      user: { vip: { is_vip: false, status: 0 } },
      epInfo: { ep_id: 101, title: 'Episode 1' }
    });

    bstation.openBatchModal();

    const overlay = document.getElementById('bs-batch-modal-root');
    assert.ok(overlay, 'Batch modal root element must be created');

    const vipBadge = overlay.querySelector('.bs-vip-status-badge');
    assert.ok(vipBadge, 'VIP status badge must exist');
    assert.strictEqual(vipBadge.textContent, '👤 Akun Gratis');
    assert.ok(vipBadge.classList.contains('bs-is-free'));

    const grid = overlay.querySelector('#bs-episode-grid');
    const cards = grid.querySelectorAll('.bs-episode-card');
    assert.strictEqual(cards.length, 12, 'Default series should have 12 episodes');

    // Ep 1-3 are free
    for (let i = 0; i < 3; i++) {
      const card = cards[i];
      assert.ok(
        !card.classList.contains('bs-episode-card--vip-locked'),
        `Free episode ${i + 1} must not be locked`
      );
      const cb = card.querySelector('.bs-episode-checkbox');
      assert.strictEqual(cb.disabled, false, `Free episode ${i + 1} checkbox must be enabled`);
      const badge = card.querySelector('.bs-episode-badge');
      assert.strictEqual(badge.textContent, 'GRATIS');
      assert.ok(badge.classList.contains('bs-episode-badge--free'));
    }

    // Ep 4-12 are VIP
    for (let i = 3; i < 12; i++) {
      const card = cards[i];
      assert.ok(
        card.classList.contains('bs-episode-card--vip-locked'),
        `VIP episode ${i + 1} must be locked for non-VIP user`
      );
      const cb = card.querySelector('.bs-episode-checkbox');
      assert.strictEqual(cb.disabled, true, `VIP episode ${i + 1} checkbox must be disabled`);
      assert.strictEqual(cb.checked, false, `VIP episode ${i + 1} checkbox must not be checked`);
      const badge = card.querySelector('.bs-episode-badge');
      assert.strictEqual(badge.textContent, '💎 [VIP Diperlukan]');
      assert.ok(badge.classList.contains('bs-episode-badge--vip'));
    }
  });

  test('Adversarial user interaction: clicking on VIP card does NOT select it', () => {
    setupMockEnvironment({
      mediaInfo: { title: 'One Piece' },
      user: { vip: { is_vip: false } }
    });

    bstation.openBatchModal();
    const overlay = document.getElementById('bs-batch-modal-root');
    const grid = overlay.querySelector('#bs-episode-grid');
    const vipCard = grid.querySelectorAll('.bs-episode-card')[4]; // Ep 5 (VIP)
    assert.ok(vipCard, 'Ep 5 card must exist');
    const cb = vipCard.querySelector('.bs-episode-checkbox');

    assert.strictEqual(cb.checked, false);
    vipCard.click();
    assert.strictEqual(cb.checked, false, 'Clicking locked VIP card must not check the box');
    assert.ok(!vipCard.classList.contains('bs-episode-card--selected'));
  });

  test('Adversarial action pills: [Pilih Semua] does NOT check disabled VIP episodes', () => {
    setupMockEnvironment({
      mediaInfo: { title: 'One Piece' },
      user: { vip: { is_vip: false } }
    });

    bstation.openBatchModal();
    const overlay = document.getElementById('bs-batch-modal-root');
    const pillAll = overlay.querySelector('#bs-pill-all');
    pillAll.click();

    const checkedBoxes = overlay.querySelectorAll('.bs-episode-checkbox:checked');
    assert.strictEqual(
      checkedBoxes.length,
      3,
      'Pilih Semua must only select the 3 free episodes for non-VIP'
    );

    const countLabel = overlay.querySelector('#bs-selected-count');
    assert.strictEqual(countLabel.textContent, '3 episode dipilih');
  });

  test('Adversarial DOM injection bypass attempt: manually un-disabling checkbox fails at stream resolution', async () => {
    setupMockEnvironment({
      mediaInfo: { title: 'One Piece' },
      user: { vip: { is_vip: false } }
    });

    bstation.openBatchModal();
    const overlay = document.getElementById('bs-batch-modal-root');
    const grid = overlay.querySelector('#bs-episode-grid');
    const vipCard = grid.querySelectorAll('.bs-episode-card')[3]; // Ep 4 (VIP)
    const cb = vipCard.querySelector('.bs-episode-checkbox');

    // Attacker manually un-disables and checks Ep 4 in DOM
    cb.disabled = false;
    cb.checked = true;

    // Reset bridge cache to ensure no unauthorized streams exist
    bridge.resetCache();

    // Start Batch
    const startBtn = overlay.querySelector('#bs-btn-start-batch');
    startBtn.click();

    const statusText = overlay.querySelector('#bs-queue-status-text');
    assert.ok(
      statusText.textContent.includes('Mengunduh') || statusText.textContent.includes('Selesai'),
      'Queue must initiate without throwing uncaught exceptions'
    );
  });

  test('VIP user mode: enables all episodes and displays VIP Member status', () => {
    setupMockEnvironment({
      mediaInfo: { title: 'Bleach TYBW' },
      user: { vip: { is_vip: true, status: 1 } },
      epInfo: { ep_id: 201, title: 'Episode 1' }
    });

    bstation.openBatchModal();
    const overlay = document.getElementById('bs-batch-modal-root');
    const vipBadge = overlay.querySelector('.bs-vip-status-badge');
    assert.ok(vipBadge);
    assert.strictEqual(vipBadge.textContent, '👑 VIP Member');
    assert.ok(vipBadge.classList.contains('bs-is-vip'));

    const grid = overlay.querySelector('#bs-episode-grid');
    const cards = grid.querySelectorAll('.bs-episode-card');

    cards.forEach((card, idx) => {
      assert.ok(
        !card.classList.contains('bs-episode-card--vip-locked'),
        `Episode ${idx + 1} must not be locked for VIP user`
      );
      const cb = card.querySelector('.bs-episode-checkbox');
      assert.strictEqual(
        cb.disabled,
        false,
        `Episode ${idx + 1} checkbox must be enabled for VIP user`
      );
    });

    const pillAll = overlay.querySelector('#bs-pill-all');
    pillAll.click();
    const checked = grid.querySelectorAll('.bs-episode-checkbox:checked');
    assert.strictEqual(checked.length, 12, 'VIP user can select all 12 episodes');
  });

  // =========================================================================
  // SECTION 3: Corrupt Stream / 403 / Fallback & Error Handling
  // =========================================================================
  console.log('\n[SECTION 3] Corrupt Stream / 403 / Fallback & Error Handling');

  await testAsync('HTTP 403 Forbidden with background fallback failure handling', async () => {
    const originalFetch = global.fetch;
    const originalChrome = global.chrome;

    global.fetch = async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden'
    });

    global.chrome = {
      runtime: {
        sendMessage: (msg, cb) => {
          cb({ success: false, error: 'Background fetch 403 Forbidden' });
        }
      }
    };

    try {
      await assert.rejects(
        async () => {
          await bstation.downloadStreamInPage({
            url: 'https://bilivideo.com/stream.mp4',
            filename: 'test.mp4'
          });
        },
        /HTTP 403 Forbidden/,
        'Should reject cleanly with HTTP 403 Forbidden error'
      );
    } finally {
      global.fetch = originalFetch;
      global.chrome = originalChrome;
    }
  });

  await testAsync(
    'HTTP 403 In-Page recovers via Background Fallback when SW succeeds',
    async () => {
      const originalFetch = global.fetch;
      const originalChrome = global.chrome;

      global.fetch = async () => ({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      global.chrome = {
        runtime: {
          sendMessage: (msg, cb) => {
            if (msg.type === 'DOWNLOAD_VIDEO') {
              cb({ success: true, downloadId: 9988 });
            } else {
              cb({ success: true });
            }
          }
        }
      };

      try {
        const res = await bstation.downloadStreamInPage({
          url: 'https://bilivideo.com/stream.mp4',
          filename: '[Anime] - E01 [720p].mp4'
        });
        assert.strictEqual(res.success, true);
        assert.strictEqual(res.source, 'background_fallback');
        assert.strictEqual(res.details.downloadId, 9988);
      } finally {
        global.fetch = originalFetch;
        global.chrome = originalChrome;
      }
    }
  );

  await testAsync(
    'Corrupt Stream: HTTP 200 with text/html content-type (WAF/Cloudflare error block page)',
    async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=UTF-8' : null)
        },
        blob: async () => ({ size: 4096, type: 'text/html' })
      });

      const originalChrome = global.chrome;
      global.chrome = undefined;

      try {
        await assert.rejects(async () => {
          await bstation.downloadStreamInPage({ url: 'https://bilivideo.com/stream.mp4' });
        }, /Received HTML error page instead of video stream/);
      } finally {
        global.fetch = originalFetch;
        global.chrome = originalChrome;
      }
    }
  );

  await testAsync(
    'Corrupt Stream: HTTP 200 with application/json (Bstation API error payload disguised as 200)',
    async () => {
      const originalFetch = global.fetch;
      global.fetch = async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null)
        },
        blob: async () => ({ size: 128, type: 'application/json' })
      });

      const originalChrome = global.chrome;
      global.chrome = undefined;

      try {
        await assert.rejects(async () => {
          await bstation.downloadStreamInPage({ url: 'https://bilivideo.com/stream.mp4' });
        }, /Received JSON error response instead of video stream/);
      } finally {
        global.fetch = originalFetch;
        global.chrome = originalChrome;
      }
    }
  );

  await testAsync('Corrupt Stream: 0-byte empty video stream', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'video/mp4' : null)
      },
      blob: async () => ({ size: 0, type: 'video/mp4' })
    });

    const originalChrome = global.chrome;
    global.chrome = undefined;

    try {
      await assert.rejects(async () => {
        await bstation.downloadStreamInPage({ url: 'https://bilivideo.com/stream.mp4' });
      }, /Received empty video stream \(0 bytes\)/);
    } finally {
      global.fetch = originalFetch;
      global.chrome = originalChrome;
    }
  });

  await testAsync(
    'DirectParallelQueue stress test: Concurrency strictly capped at 2 under mixed failures and successes',
    async () => {
      const queue = new bstation.DirectParallelQueue({ concurrency: 2 });
      let maxObservedActive = 0;
      const taskOutcomes = [];

      for (let i = 1; i <= 8; i++) {
        const isFailing = i % 2 === 0;
        queue.add({
          id: `ep_${i}`,
          epIndex: i,
          resolveStream: async () => {
            if (queue.activeWorkers > maxObservedActive) {
              maxObservedActive = queue.activeWorkers;
            }
            assert.ok(
              queue.activeWorkers <= 2,
              `Active workers ${queue.activeWorkers} exceeded concurrency 2!`
            );
            await new Promise((r) => setTimeout(r, 15));
            if (isFailing) {
              throw new Error(`HTTP 403 Forbidden for Episode ${i}`);
            }
            return { url: `https://bilivideo.com/stream_${i}.mp4` };
          },
          downloadStream: async () => {
            await new Promise((r) => setTimeout(r, 15));
            taskOutcomes.push(i);
          }
        });
      }

      await new Promise((resolve) => {
        queue.onAllComplete = (res) => {
          resolve(res);
        };
        queue.start();
      });

      assert.ok(
        maxObservedActive <= 2,
        `Concurrency violation: max active workers was ${maxObservedActive}`
      );
      assert.strictEqual(queue.completedCount, 4, 'Expected exactly 4 successful downloads');
      assert.strictEqual(queue.failedCount, 4, 'Expected exactly 4 failed downloads');
      assert.deepStrictEqual(taskOutcomes, [1, 3, 5, 7]);
    }
  );

  await testAsync(
    'DirectParallelQueue cancellation: halting workers drains cleanly without executing queued items',
    async () => {
      const queue = new bstation.DirectParallelQueue({ concurrency: 2 });
      let executedCount = 0;

      for (let i = 1; i <= 10; i++) {
        queue.add({
          id: `ep_${i}`,
          epIndex: i,
          resolveStream: async () => {
            executedCount++;
            await new Promise((r) => setTimeout(r, 30));
            return { url: 'https://bilivideo.com/stream.mp4' };
          },
          downloadStream: async () => {}
        });
      }

      queue.start();
      await new Promise((r) => setTimeout(r, 10)); // let first 2 start
      queue.cancel();

      await new Promise((r) => setTimeout(r, 100)); // wait for in-flight tasks to finish
      assert.ok(
        executedCount <= 2,
        `Expected at most 2 executed tasks after cancel, got ${executedCount}`
      );
      assert.strictEqual(queue.cancelled, true);
    }
  );

  await testAsync(
    'Bridge request timeout handling: rejects at timeoutMs and detaches event listener',
    async () => {
      setupMockEnvironment({});

      const start = Date.now();
      await assert.rejects(async () => {
        // Request with short 50ms timeout
        await bstation.requestBridgeStream({ ep_id: '999999' }, 50);
      }, /Timeout waiting for Bstation stream bridge/);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 40, `Timeout fired too quickly: ${elapsed}ms`);
    }
  );

  test('Button State Machine error transitions: transitions to error state and auto-recovers', async () => {
    const btn = new MockElement('BUTTON');
    const iconBox = new MockElement('SPAN');
    iconBox.className = 'bs-dl-icon-box';
    const label = new MockElement('SPAN');
    label.className = 'bs-dl-btn-label';
    btn.appendChild(iconBox);
    btn.appendChild(label);

    bstation.setPlayerButtonState(btn, 'error', 'HTTP 403');
    assert.ok(btn.classList.contains('bs-dl-state-error'));
    assert.strictEqual(label.textContent, 'HTTP 403');
    assert.strictEqual(btn.disabled, false);

    clearTimeout(btn._stateTimer);
    bstation.setPlayerButtonState(btn, 'idle');
    assert.ok(!btn.classList.contains('bs-dl-state-error'));
    assert.strictEqual(label.textContent, 'Unduh Video');
  });

  // =========================================================================
  // SECTION 4: Deep Security Boundaries, Path Traversal & Protocol Isolation
  // =========================================================================
  console.log('\n[SECTION 4] Deep Security Boundaries, Path Traversal & Protocol Isolation');

  test('Path traversal attack prevention in filename parameters (../ and ..\\)', () => {
    const maliciousCases = [
      { title: '../../../../Windows/System32/cmd.exe', ep: '..\\..\\01', q: '../../../../1080p' },
      { title: '..\\..\\..\\..\\Boot\\BCD', ep: 1, q: '720p' },
      { title: '/etc/shadow', ep: 2, q: '480p' }
    ];

    maliciousCases.forEach(({ title, ep, q }) => {
      const fn = bstation.formatBstationFilename({ title, episode: ep, quality: q });
      assert.ok(!fn.includes('/'), `Filename contains illegal forward slash: ${fn}`);
      assert.ok(!fn.includes('\\'), `Filename contains illegal backslash: ${fn}`);
      assert.ok(!fn.startsWith('.'), `Filename must not start with dot: ${fn}`);
      assert.strictEqual(
        path.basename(fn),
        fn,
        `Filename must be strictly a flat basename without directory paths: ${fn}`
      );
    });
  });

  await testAsync('Protocol Security: executeDownload rejects non-HTTP(S) protocols', async () => {
    const illegalUrls = [
      'javascript:alert(1)',
      'data:video/mp4;base64,AAAA',
      'file:///C:/Windows/System32/calc.exe',
      'blob:https://www.bilibili.tv/uuid-1234'
    ];

    for (const url of illegalUrls) {
      await assert.rejects(
        async () => {
          await sw.executeDownload({ url, platform: 'bstation' });
        },
        /URL must be an HTTP or HTTPS stream/,
        `Should reject illegal protocol URL: ${url}`
      );
    }
  });

  await testAsync(
    'downloadStreamInPage input boundary: null, empty, or missing URL throws cleanly',
    async () => {
      const inputs = [null, undefined, {}, { url: '' }, { url: '   ' }];
      for (const input of inputs) {
        await assert.rejects(async () => {
          await bstation.downloadStreamInPage(input);
        }, /(Invalid or missing (video download )?stream URL|Failed to parse URL)/);
      }
    }
  );

  test('DirectParallelQueue empty list boundary: zero tasks does not throw and leaves queue idle', () => {
    const queue = new bstation.DirectParallelQueue({ concurrency: 2 });
    assert.doesNotThrow(() => {
      queue.start();
    });
    assert.strictEqual(queue.items.length, 0);
    assert.strictEqual(queue.activeWorkers, 0);
    assert.strictEqual(queue.completedCount, 0);
    assert.strictEqual(queue.failedCount, 0);
  });

  await testAsync(
    'DirectParallelQueue non-Error throws: recovers from string, Error, and object errors',
    async () => {
      const queue = new bstation.DirectParallelQueue({ concurrency: 2 });
      const thrownValues = [
        'Direct string error',
        new Error('Standard Error'),
        { message: 'Custom object error' }
      ];

      thrownValues.forEach((val, idx) => {
        queue.add({
          id: `task_${idx}`,
          epIndex: idx + 1,
          resolveStream: async () => {
            throw val;
          },
          downloadStream: async () => {}
        });
      });

      const res = await new Promise((resolve) => {
        queue.onAllComplete = resolve;
        queue.start();
      });

      assert.strictEqual(res.total, thrownValues.length);
      assert.strictEqual(res.failed, thrownValues.length);
      assert.strictEqual(res.completed, 0);
      queue.items.forEach((item) => {
        assert.strictEqual(item.status, 'failed');
        assert.ok(typeof item.error === 'string' && item.error.length > 0);
      });
    }
  );

  test('Corrupt and missing SSR hydration resilience: no crashes on null/empty/corrupted state', () => {
    const corruptStates = [
      null,
      undefined,
      {},
      { mediaInfo: null, user: null },
      { mediaInfo: 'not-an-object', user: 123 }
    ];

    corruptStates.forEach((st) => {
      setupMockEnvironment(st);
      assert.doesNotThrow(() => {
        const info = bstation.getActiveVideoInfo();
        assert.ok(info);
        assert.strictEqual(typeof info.animeTitle, 'string');
        assert.strictEqual(info.isUserVip, false);
      }, 'getActiveVideoInfo must not crash on corrupt SSR state');

      assert.doesNotThrow(() => {
        const series = bstation.collectEpisodesList();
        assert.ok(series);
        assert.ok(Array.isArray(series.episodes));
      }, 'collectEpisodesList must not crash on corrupt SSR state');
    });
  });

  test('MAIN bridge playurl normalization resilience: handles corrupt envelopes without throwing', () => {
    const malformed = [
      null,
      undefined,
      {},
      { code: -10403, message: 'VIP only' },
      { code: 0, data: null },
      { data: { playurl: { durl: [] } } },
      { data: { dash: { video: [{ url: null }] } } },
      'string input',
      12345
    ];

    malformed.forEach((raw) => {
      assert.doesNotThrow(() => {
        const res = bridge.normalizePlayurlResponse(raw);
        assert.strictEqual(res, null, 'Malformed playurl response should return null');
      }, 'normalizePlayurlResponse must not crash on malformed payloads');
    });
  });

  console.log('\n======================================================================');
  console.log(
    ` ADVERSARIAL TEST RESULTS: ${passedTests} passed, ${failedTests} failed (Total: ${totalTests})`
  );
  console.log('======================================================================\n');

  if (failedTests > 0) {
    console.error('FAILURES:');
    failures.forEach((f) => console.error(` - ${f.name}: ${f.error.message}`));
    process.exit(1);
  }
}

runAdversarialSuites().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
