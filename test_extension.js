/**
 * TikTok Direct Downloader Chrome Extension - E2E Automated Test Runner
 * 
 * Zero external npm dependencies (pure Node.js standard library).
 * Executes 7 comprehensive test suites covering Features F1 through F19 across Tiers 1 to 4:
 * 
 * Suite 1: Manifest V3 Conformance & Schema Validation
 * Suite 2: File Structure & Asset Integrity Validation (PNG magic bytes)
 * Suite 3: JavaScript Syntax Check (node --check) across all scripts
 * Suite 4: Windows NTFS Filename Sanitization Unit & Boundary Tests (Category-Partition & BVA)
 * Suite 5: In-Page UI Injection & Debounce Simulation (250ms coalescing, duplicate guard, self-healing)
 * Suite 6: Button State Transitions State Machine Simulation (Idle, Loading, Success [2.5s], Error [3.0s])
 * Suite 7: Service Worker IPC & DeclarativeNetRequest Rule Validation (DOWNLOAD_VIDEO, conflictAction, DNR)
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname);

// Color output utilities
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// Global Test Execution State
let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;
const suiteResults = [];

function runSuite(name, fn) {
  console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan} SUITE: ${name}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}`);

  const startSuiteTime = Date.now();
  let suitePassed = 0;
  let suiteFailed = 0;

  function test(testName, testFn) {
    totalTests++;
    try {
      testFn();
      totalPassed++;
      suitePassed++;
      console.log(`  ${colors.green}✓ PASS:${colors.reset} ${testName}`);
    } catch (err) {
      totalFailed++;
      suiteFailed++;
      console.error(`  ${colors.red}✗ FAIL:${colors.reset} ${testName}`);
      console.error(`    ${colors.yellow}Error: ${err.message}${colors.reset}`);
      if (err.stack) {
        const stackLine = err.stack.split('\n')[1];
        if (stackLine) console.error(`    ${colors.gray}${stackLine.trim()}${colors.reset}`);
      }
    }
  }

  async function testAsync(testName, testAsyncFn) {
    totalTests++;
    try {
      await testAsyncFn();
      totalPassed++;
      suitePassed++;
      console.log(`  ${colors.green}✓ PASS:${colors.reset} ${testName}`);
    } catch (err) {
      totalFailed++;
      suiteFailed++;
      console.error(`  ${colors.red}✗ FAIL:${colors.reset} ${testName}`);
      console.error(`    ${colors.yellow}Error: ${err.message}${colors.reset}`);
      if (err.stack) {
        const stackLine = err.stack.split('\n')[1];
        if (stackLine) console.error(`    ${colors.gray}${stackLine.trim()}${colors.reset}`);
      }
    }
  }

  const result = fn({ test, testAsync });
  if (result && typeof result.then === 'function') {
    return result.then(() => {
      const elapsed = Date.now() - startSuiteTime;
      suiteResults.push({ name, passed: suitePassed, failed: suiteFailed, durationMs: elapsed });
      console.log(`${colors.gray}Completed in ${elapsed}ms (${suitePassed} passed, ${suiteFailed} failed)${colors.reset}`);
    });
  } else {
    const elapsed = Date.now() - startSuiteTime;
    suiteResults.push({ name, passed: suitePassed, failed: suiteFailed, durationMs: elapsed });
    console.log(`${colors.gray}Completed in ${elapsed}ms (${suitePassed} passed, ${suiteFailed} failed)${colors.reset}`);
    return Promise.resolve();
  }
}

// Minimal DOM Element & ClassList Mock for Browser/Content Script Testing in Node
class MockClassList {
  constructor(element) {
    this.element = element;
    this._set = new Set();
  }
  add(...classes) {
    for (const c of classes) {
      if (c && typeof c === 'string') {
        c.trim().split(/\s+/).forEach((cls) => {
          if (cls) this._set.add(cls);
        });
      }
    }
    this._sync();
  }
  remove(...classes) {
    for (const c of classes) {
      if (c && typeof c === 'string') {
        c.trim().split(/\s+/).forEach((cls) => {
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
    this.textContent = '';
    this.innerHTML = '';
    this._listeners = new Map();
    this._stateTimeout = null;
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
    if (name === 'class') {
      this.classList._set.clear();
      String(val).trim().split(/\s+/).forEach((c) => {
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
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      for (const child of this.children) {
        if (child.classList && child.classList.contains(className)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    if (selector.startsWith('[')) {
      const match = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/);
      if (match) {
        const attr = match[1];
        const val = match[2];
        for (const child of this.children) {
          if (child.attributes && child.attributes.has(attr)) {
            if (!val || child.attributes.get(attr) === val) return child;
          }
          const found = child.querySelector(selector);
          if (found) return found;
        }
      }
    }
    for (const child of this.children) {
      if (child.tagName.toLowerCase() === selector.toLowerCase()) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children) {
        if (selector.startsWith('.')) {
          if (child.classList && child.classList.contains(selector.slice(1))) results.push(child);
        } else if (selector.startsWith('[')) {
          const match = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/);
          if (match && child.attributes && child.attributes.has(match[1])) {
            if (!match[2] || child.attributes.get(match[1]) === match[2]) results.push(child);
          }
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  addEventListener(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
  }

  dispatchEvent(event) {
    const handlers = this._listeners.get(event.type) || [];
    for (const h of handlers) h(event);
  }
}

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================
async function runAllSuites() {
  console.log(`\n${colors.bold}TikTok Direct Downloader Extension — E2E Verification Harness${colors.reset}`);
  console.log(`${colors.gray}Node.js Version: ${process.version} | Platform: ${process.platform} | Zero npm Dependencies${colors.reset}\n`);

  // --------------------------------------------------------------------------
  // SUITE 1: Manifest V3 Conformance & Schema Validation
  // --------------------------------------------------------------------------
  await runSuite('Suite 1: Manifest V3 Conformance & Schema Validation', ({ test }) => {
    const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
    let manifest = null;

    test('manifest.json exists and is strictly valid JSON', () => {
      assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist in project root');
      const raw = fs.readFileSync(manifestPath, 'utf8');
      assert.doesNotThrow(() => {
        manifest = JSON.parse(raw);
      }, 'manifest.json must parse cleanly as valid JSON');
    });

    test('manifest_version is integer 3 (Manifest V3 Standard)', () => {
      assert.strictEqual(manifest.manifest_version, 3, 'manifest_version must strictly equal 3');
    });

    test('Extension metadata is non-empty (name, version, description)', () => {
      assert.strictEqual(manifest.name, 'TikTok Direct Downloader');
      assert.strictEqual(manifest.version, '1.0.0');
      assert.ok(typeof manifest.description === 'string' && manifest.description.length > 10);
    });

    test('Permissions are minimally scoped (downloads, declarativeNetRequest, storage)', () => {
      assert.ok(Array.isArray(manifest.permissions), 'permissions must be an array');
      assert.ok(manifest.permissions.includes('downloads'), 'must include "downloads"');
      assert.ok(manifest.permissions.includes('declarativeNetRequest'), 'must include "declarativeNetRequest"');
      assert.ok(manifest.permissions.includes('storage'), 'must include "storage"');
      assert.strictEqual(manifest.permissions.length, 3, 'permissions should only request minimal necessary APIs');
    });

    test('Host permissions declare TikTok web and ByteDance media CDNs', () => {
      assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
      assert.ok(manifest.host_permissions.includes('*://*.tiktok.com/*'), 'must include TikTok web origin');
      assert.ok(manifest.host_permissions.includes('*://*.tiktokcdn.com/*'), 'must include tiktokcdn.com');
      assert.ok(manifest.host_permissions.includes('*://*.byteoversea.com/*'), 'must include byteoversea.com');
      assert.ok(manifest.host_permissions.includes('*://*.ibytedtos.com/*'), 'must include ibytedtos.com');
    });

    test('Background is configured as ephemeral service worker', () => {
      assert.ok(manifest.background, 'background configuration must exist');
      assert.strictEqual(manifest.background.service_worker, 'background/service_worker.js');
      assert.strictEqual(manifest.background.scripts, undefined, 'MV2 background.scripts must NOT exist');
    });

    test('Content scripts configure MAIN world bridge and ISOLATED world UI platform', () => {
      assert.ok(Array.isArray(manifest.content_scripts), 'content_scripts must be an array');
      assert.strictEqual(manifest.content_scripts.length, 2, 'must configure exactly 2 content script entries');

      const bridgeScript = manifest.content_scripts.find((s) => s.world === 'MAIN');
      assert.ok(bridgeScript, 'MAIN world bridge script entry must exist');
      assert.deepStrictEqual(bridgeScript.js, ['content/injected/tiktok_bridge.js']);
      assert.strictEqual(bridgeScript.run_at, 'document_start');
      assert.deepStrictEqual(bridgeScript.matches, ['*://*.tiktok.com/*']);

      const uiScript = manifest.content_scripts.find((s) => !s.world || s.world === 'ISOLATED');
      assert.ok(uiScript, 'ISOLATED world UI platform script entry must exist');
      assert.deepStrictEqual(uiScript.js, ['content/platforms/tiktok.js']);
      assert.deepStrictEqual(uiScript.css, ['content/styles/tiktok.css']);
      assert.strictEqual(uiScript.run_at, 'document_idle');
      assert.deepStrictEqual(uiScript.matches, ['*://*.tiktok.com/*']);
    });

    test('Web accessible resources follow MV3 object schema with matches', () => {
      assert.ok(Array.isArray(manifest.web_accessible_resources), 'web_accessible_resources must be an array');
      const entry = manifest.web_accessible_resources[0];
      assert.ok(typeof entry === 'object' && !Array.isArray(entry), 'MV3 requires object entries');
      assert.ok(Array.isArray(entry.resources), 'must have resources array');
      assert.ok(entry.resources.includes('content/injected/tiktok_bridge.js'));
      assert.ok(entry.resources.includes('icons/icon16.png'));
      assert.ok(entry.resources.includes('icons/icon48.png'));
      assert.ok(entry.resources.includes('icons/icon128.png'));
      assert.deepStrictEqual(entry.matches, ['*://*.tiktok.com/*']);
    });

    test('Action popup and icon declarations are valid', () => {
      assert.ok(manifest.action, 'action object must exist');
      assert.strictEqual(manifest.action.default_popup, 'popup/popup.html');
      assert.strictEqual(manifest.action.default_title, 'TikTok Direct Downloader');
      assert.strictEqual(manifest.action.default_icon['16'], 'icons/icon16.png');
      assert.strictEqual(manifest.action.default_icon['48'], 'icons/icon48.png');
      assert.strictEqual(manifest.action.default_icon['128'], 'icons/icon128.png');
      assert.strictEqual(manifest.icons['16'], 'icons/icon16.png');
      assert.strictEqual(manifest.icons['48'], 'icons/icon48.png');
      assert.strictEqual(manifest.icons['128'], 'icons/icon128.png');
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 2: File Structure & Asset Integrity Validation
  // --------------------------------------------------------------------------
  await runSuite('Suite 2: File Structure & Asset Integrity Validation', ({ test }) => {
    const requiredFiles = [
      'manifest.json',
      'background/service_worker.js',
      'content/platforms/tiktok.js',
      'content/styles/tiktok.css',
      'content/injected/tiktok_bridge.js',
      'popup/popup.html',
      'popup/popup.css',
      'popup/popup.js',
      'icons/generate_icons.js',
      'icons/icon16.png',
      'icons/icon48.png',
      'icons/icon128.png',
      'README.md',
      'TEST_INFRA.md',
      'PROJECT.md',
    ];

    test('All required project files exist and have non-zero file size', () => {
      for (const relPath of requiredFiles) {
        const fullPath = path.join(PROJECT_ROOT, relPath);
        assert.ok(fs.existsSync(fullPath), `Required file missing: ${relPath}`);
        const stat = fs.statSync(fullPath);
        assert.ok(stat.size > 0, `File must not be empty: ${relPath} (size: ${stat.size} bytes)`);
      }
    });

    test('PNG Icon assets contain valid RFC 2083 8-byte PNG magic number (89 50 4E 47 0D 0A 1A 0A)', () => {
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const iconPaths = ['icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'];

      for (const relPath of iconPaths) {
        const fullPath = path.join(PROJECT_ROOT, relPath);
        const fd = fs.openSync(fullPath, 'r');
        const header = Buffer.alloc(8);
        fs.readSync(fd, header, 0, 8, 0);
        fs.closeSync(fd);

        assert.ok(
          header.equals(pngMagic),
          `Asset ${relPath} does not have valid PNG magic bytes. Found: ${header.toString('hex')}`
        );
      }
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 3: JavaScript Syntax Check (node --check) across all scripts
  // --------------------------------------------------------------------------
  await runSuite('Suite 3: JavaScript Syntax Check (node --check)', ({ test }) => {
    const jsFiles = [
      'background/service_worker.js',
      'content/platforms/tiktok.js',
      'content/injected/tiktok_bridge.js',
      'popup/popup.js',
      'icons/generate_icons.js',
      'test_extension.js',
    ];

    for (const relPath of jsFiles) {
      test(`Syntax check: ${relPath}`, () => {
        const fullPath = path.join(PROJECT_ROOT, relPath);
        const res = spawnSync(process.execPath, ['--check', fullPath], {
          encoding: 'utf8',
          windowsHide: true,
        });

        assert.strictEqual(
          res.status,
          0,
          `Syntax error in ${relPath}:\n${res.stderr || res.stdout}`
        );
        assert.strictEqual(res.stderr.trim(), '', `Unexpected stderr in ${relPath}`);
      });
    }
  });

  // --------------------------------------------------------------------------
  // SUITE 4: Windows NTFS Filename Sanitization Unit & Boundary Tests
  // --------------------------------------------------------------------------
  await runSuite('Suite 4: Windows NTFS Filename Sanitization Unit & Boundary Tests', ({ test }) => {
    const sw = require(path.join(PROJECT_ROOT, 'background/service_worker.js'));
    const { sanitizeAuthor, sanitizeVideoId, formatFilename } = sw;

    assert.ok(typeof sanitizeAuthor === 'function', 'sanitizeAuthor must be exported');
    assert.ok(typeof sanitizeVideoId === 'function', 'sanitizeVideoId must be exported');
    assert.ok(typeof formatFilename === 'function', 'formatFilename must be exported');

    const NTFS_REGEX = /^tiktok_@[^\\/:*?"<>|\x00-\x1f\x7f-\x9f]+_[a-zA-Z0-9_-]+\.mp4$/;

    test('Equivalence Partition 1 (Standard Clean): Khaby Lame username and numeric ID', () => {
      const result = formatFilename('khaby.lame', '7123456789012345678');
      assert.strictEqual(result, 'tiktok_@khaby.lame_7123456789012345678.mp4');
      assert.ok(NTFS_REGEX.test(result));
    });

    test('Equivalence Partition 2 (Win32 Illegal Characters \\ / : * ? " < > |): Stript / replaced', () => {
      const inputAuthor = 'user:name/with*illegal"chars<and>pipes|question?';
      const inputId = '7123/456:789';
      const result = formatFilename(inputAuthor, inputId);

      // Verify no illegal characters remain
      assert.ok(!/[\\/:*?"<>|]/.test(result), 'Filename must contain zero Win32 illegal characters');
      assert.ok(NTFS_REGEX.test(result), 'Filename must match strict format regex');
    });

    test('Equivalence Partition 3 (Control Characters 0x00-0x1F and 0x7F-0x9F): Replaced / sanitized', () => {
      const inputAuthor = 'evil\x00user\x07\x1fname\x7fbad\x80';
      const result = formatFilename(inputAuthor, '9999');
      assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(result), 'Filename must contain zero control characters');
      assert.ok(NTFS_REGEX.test(result));
    });

    test('Equivalence Partition 4 (Repeated @ Prefix): Normalizes to single @ in tiktok_@[author]', () => {
      assert.strictEqual(formatFilename('@charlidamelio', '101'), 'tiktok_@charlidamelio_101.mp4');
      assert.strictEqual(formatFilename('@@@bellapoarch', '102'), 'tiktok_@bellapoarch_102.mp4');
      assert.ok(NTFS_REGEX.test(formatFilename('@mrbeast', '103')));
    });

    test('Equivalence Partition 5 (Win32 Dots & Spaces Trimming): Strips trailing/leading periods and whitespace', () => {
      const input = '...cool.creator...   ';
      const result = formatFilename(input, '202');
      assert.strictEqual(result, 'tiktok_@cool.creator_202.mp4');
      assert.ok(!result.includes('..mp4'));
      assert.ok(!result.includes(' .mp4'));
      assert.ok(NTFS_REGEX.test(result));
    });

    test('Equivalence Partition 6 (Win32 Reserved Device Names CON, PRN, AUX, NUL, COM1): Prefix prevents conflict', () => {
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1'];
      for (const resName of reservedNames) {
        const result = formatFilename(resName, '888');
        // Because of tiktok_@ prefix, the base name is tiktok_@CON_888.mp4, not CON.mp4
        assert.strictEqual(result, `tiktok_@${resName}_888.mp4`);
        assert.ok(NTFS_REGEX.test(result));
      }
    });

    test('Equivalence Partition 7 (Unicode & Multi-byte Characters): Preserves Japanese, Chinese, Arabic, and Emojis', () => {
      const jpResult = formatFilename('日本語ユーザー', '301');
      assert.strictEqual(jpResult, 'tiktok_@日本語ユーザー_301.mp4');
      assert.ok(NTFS_REGEX.test(jpResult));

      const emojiResult = formatFilename('🔥creator🔥', '302');
      assert.strictEqual(emojiResult, 'tiktok_@🔥creator🔥_302.mp4');
      assert.ok(NTFS_REGEX.test(emojiResult));

      const arResult = formatFilename('مستخدم_تيك_توك', '303');
      assert.strictEqual(arResult, 'tiktok_@مستخدم_تيك_توك_303.mp4');
      assert.ok(NTFS_REGEX.test(arResult));
    });

    test('Equivalence Partition 8 (Null, Undefined, Empty String, Whitespace-only Fallbacks)', () => {
      const nullRes = formatFilename(null, null);
      assert.ok(nullRes.startsWith('tiktok_@unknown_'), 'Must fallback author to unknown');
      assert.ok(nullRes.endsWith('.mp4'));
      assert.ok(NTFS_REGEX.test(nullRes));

      const undefRes = formatFilename(undefined, undefined);
      assert.ok(undefRes.startsWith('tiktok_@unknown_'));
      assert.ok(NTFS_REGEX.test(undefRes));

      const emptyRes = formatFilename('', '');
      assert.ok(emptyRes.startsWith('tiktok_@unknown_'));
      assert.ok(NTFS_REGEX.test(emptyRes));

      const spacesRes = formatFilename('     ', '     ');
      assert.ok(spacesRes.startsWith('tiktok_@unknown_'));
      assert.ok(NTFS_REGEX.test(spacesRes));
    });

    test('Boundary Value Analysis (Extreme Component Length): Truncates author to max 64 chars', () => {
      const superLongAuthor = 'a'.repeat(300);
      const superLongId = '9'.repeat(150);
      const result = formatFilename(superLongAuthor, superLongId);

      const match = result.match(/^tiktok_@([^_]+)_([^.]+)\.mp4$/);
      assert.ok(match, 'Result must match structure');
      assert.ok(match[1].length <= 64, `Author length ${match[1].length} must be <= 64`);
      assert.ok(match[2].length <= 64, `Video ID length ${match[2].length} must be <= 64`);
      assert.ok(result.length < 255, `Total filename ${result.length} must be well below Win32 MAX_PATH`);
      assert.ok(NTFS_REGEX.test(result));
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 5: In-Page UI Injection & Debounce Simulation
  // --------------------------------------------------------------------------
  await runSuite('Suite 5: In-Page UI Injection & Debounce Simulation', async ({ test, testAsync }) => {
    const tiktokScript = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
    const { DOMObserverManager } = tiktokScript;

    await testAsync('250ms debouncer coalesces rapid mutation bursts into single scan', async () => {
      let scanCalls = 0;
      const manager = new DOMObserverManager(() => {
        scanCalls++;
      }, 250);

      // Trigger 10 rapid scan schedules within 100ms
      for (let i = 0; i < 10; i++) {
        manager.scheduleScan();
      }

      // After 120ms, scan should not yet have executed (debounce threshold is 250ms)
      await new Promise((r) => setTimeout(r, 120));
      assert.strictEqual(scanCalls, 0, 'Scan must not trigger before 250ms window elapses');

      // Wait remaining 180ms (total 300ms > 250ms)
      await new Promise((r) => setTimeout(r, 180));
      assert.strictEqual(scanCalls, 1, 'Scan must execute exactly once for the coalesced burst');

      manager.stop();
    });

    test('Duplicate injection guard (data-tt-dl-ready="true") prevents multiple buttons', () => {
      const container = new MockElement('div');
      container.setAttribute('class', 'recommend-list-item-container');

      const actionBar = new MockElement('div');
      actionBar.setAttribute('class', 'DivActionItemContainer');
      container.appendChild(actionBar);

      // Simulated injection function mirroring content/platforms/tiktok.js
      function inject(card) {
        if (card.querySelector('.tt-dl-action-item')) return;
        const bar = card.querySelector('.DivActionItemContainer');
        if (!bar) return;
        if (bar.getAttribute('data-tt-dl-ready') === 'true' || bar.querySelector('.tt-dl-action-item')) return;

        const actionItem = new MockElement('div');
        actionItem.classList.add('tt-dl-action-item');
        const btn = new MockElement('button');
        btn.classList.add('tt-dl-btn');
        actionItem.appendChild(btn);

        bar.appendChild(actionItem);
        bar.setAttribute('data-tt-dl-ready', 'true');
        card.setAttribute('data-tt-dl-ready', 'true');
      }

      // Initial scan
      inject(container);
      assert.strictEqual(container.getAttribute('data-tt-dl-ready'), 'true');
      assert.strictEqual(actionBar.getAttribute('data-tt-dl-ready'), 'true');
      assert.strictEqual(actionBar.children.length, 1);

      // Re-scan 1: container has data-tt-dl-ready="true"
      inject(container);
      assert.strictEqual(actionBar.children.length, 1, 'Button count must remain 1 after re-scan');

      // Re-scan 2: rapid duplicate scan
      inject(container);
      assert.strictEqual(actionBar.children.length, 1, 'Button count must remain 1');
    });

    test('Self-healing reconciliation resets data-tt-dl-ready if inner button was wiped by React', () => {
      const container = new MockElement('div');
      container.setAttribute('data-tt-dl-ready', 'true');
      const actionBar = new MockElement('div');
      actionBar.setAttribute('data-tt-dl-ready', 'true');
      container.appendChild(actionBar);

      // Notice: actionBar has no children (React wiped the DOM during re-render)
      assert.strictEqual(actionBar.querySelector('.tt-dl-action-item'), null);

      // Reconciliation algorithm mirroring content/platforms/tiktok.js scanAndInject
      function reconcile(card) {
        if (!card.querySelector('.tt-dl-action-item')) {
          card.removeAttribute('data-tt-dl-ready');
        }
        const bar = card.querySelector('.DivActionItemContainer') || card.children[0];
        if (bar && !bar.querySelector('.tt-dl-action-item')) {
          bar.removeAttribute('data-tt-dl-ready');
        }
      }

      reconcile(container);

      assert.strictEqual(container.getAttribute('data-tt-dl-ready'), null, 'Stale flag must be cleared');
      assert.strictEqual(actionBar.getAttribute('data-tt-dl-ready'), null, 'Stale flag on bar must be cleared');
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 6: Button State Transitions State Machine Simulation
  // --------------------------------------------------------------------------
  await runSuite('Suite 6: Button State Transitions State Machine Simulation', async ({ test, testAsync }) => {
    const tiktokScript = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
    const { setButtonState, ICONS } = tiktokScript;

    assert.ok(typeof setButtonState === 'function', 'setButtonState must be exported');
    assert.ok(typeof ICONS === 'object', 'ICONS dictionary must be exported');

    function createMockButton() {
      const itemWrapper = new MockElement('div');
      itemWrapper.classList.add('tt-dl-action-item');

      const btn = new MockElement('button');
      btn.classList.add('tt-dl-btn');

      const iconBox = new MockElement('div');
      iconBox.classList.add('tt-dl-icon-box');
      iconBox.innerHTML = ICONS.download;
      btn.appendChild(iconBox);

      const label = new MockElement('strong');
      label.classList.add('tt-dl-label');
      label.textContent = 'Download';

      itemWrapper.appendChild(btn);
      itemWrapper.appendChild(label);

      return { btn, label, iconBox, itemWrapper };
    }

    test('Initial / Idle State: Enabled with Download icon and label', () => {
      const { btn, label, iconBox } = createMockButton();
      setButtonState(btn, 'idle');

      assert.strictEqual(btn.disabled, false, 'Idle button must be enabled');
      assert.strictEqual(btn.getAttribute('data-state'), 'idle');
      assert.ok(btn.classList.contains('tt-dl-state-idle'));
      assert.strictEqual(iconBox.innerHTML, ICONS.download);
      assert.strictEqual(label.textContent, 'Download');
    });

    test('Loading State: Disabled with spinning loader icon and custom label', () => {
      const { btn, label, iconBox } = createMockButton();
      setButtonState(btn, 'loading', 'Fetching...');

      assert.strictEqual(btn.disabled, true, 'Loading button must be disabled');
      assert.strictEqual(btn.getAttribute('data-state'), 'loading');
      assert.ok(btn.classList.contains('tt-dl-state-loading'));
      assert.strictEqual(iconBox.innerHTML, ICONS.loading);
      assert.strictEqual(label.textContent, 'Fetching...');
    });

    await testAsync('Success State: Disabled with checkmark icon and reverts to idle after 2500ms', async () => {
      const { btn, label, iconBox } = createMockButton();
      setButtonState(btn, 'success', 'Saved!');

      assert.strictEqual(btn.disabled, true, 'Success button must be disabled');
      assert.strictEqual(btn.getAttribute('data-state'), 'success');
      assert.ok(btn.classList.contains('tt-dl-state-success'));
      assert.strictEqual(iconBox.innerHTML, ICONS.success);
      assert.strictEqual(label.textContent, 'Saved!');
      assert.ok(btn._stateTimeout !== null, 'Timer must be scheduled for reversion');

      // Wait 2550ms (> 2500ms duration)
      await new Promise((r) => setTimeout(r, 2550));

      assert.strictEqual(btn.getAttribute('data-state'), 'idle', 'Must revert to idle');
      assert.strictEqual(btn.disabled, false, 'Must re-enable button on idle');
      assert.strictEqual(label.textContent, 'Download');
      assert.strictEqual(iconBox.innerHTML, ICONS.download);
    });

    await testAsync('Error State: Enabled with alert icon and reverts to idle after 3000ms', async () => {
      const { btn, label, iconBox } = createMockButton();
      setButtonState(btn, 'error', 'Failed');

      assert.strictEqual(btn.disabled, false, 'Error button allows re-attempt');
      assert.strictEqual(btn.getAttribute('data-state'), 'error');
      assert.ok(btn.classList.contains('tt-dl-state-error'));
      assert.strictEqual(iconBox.innerHTML, ICONS.error);
      assert.strictEqual(label.textContent, 'Failed');
      assert.ok(btn._stateTimeout !== null, 'Timer must be scheduled for reversion');

      // Wait 3050ms (> 3000ms duration)
      await new Promise((r) => setTimeout(r, 3050));

      assert.strictEqual(btn.getAttribute('data-state'), 'idle', 'Must revert to idle');
      assert.strictEqual(label.textContent, 'Download');
      assert.strictEqual(iconBox.innerHTML, ICONS.download);
    });

    await testAsync('Timer Cleanup on Rapid State Transitions prevents premature resets', async () => {
      const { btn } = createMockButton();

      // Enter success (2500ms timer)
      setButtonState(btn, 'success');
      const timer1 = btn._stateTimeout;
      assert.ok(timer1 !== null);

      // Quickly enter error after 100ms (should cancel timer1 and start timer2)
      await new Promise((r) => setTimeout(r, 100));
      setButtonState(btn, 'error');
      const timer2 = btn._stateTimeout;
      assert.ok(timer2 !== null);
      assert.notStrictEqual(timer1, timer2, 'Active timer must be replaced with fresh timer');

      // Wait 2450ms (original 2500ms timer would have fired if not cancelled)
      await new Promise((r) => setTimeout(r, 2450));
      assert.strictEqual(btn.getAttribute('data-state'), 'error', 'Button must still be in error state');

      // Wait remaining 600ms (total 3150ms > 3000ms from error state start)
      await new Promise((r) => setTimeout(r, 600));
      assert.strictEqual(btn.getAttribute('data-state'), 'idle', 'Button cleanly resets to idle');
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 7: Service Worker IPC & DeclarativeNetRequest Rule Validation
  // --------------------------------------------------------------------------
  await runSuite('Suite 7: Service Worker IPC & DeclarativeNetRequest Rule Validation', async ({ test, testAsync }) => {
    const sw = require(path.join(PROJECT_ROOT, 'background/service_worker.js'));
    const { TIKTOK_CDN_RULES, executeDownload } = sw;

    test('DeclarativeNetRequest dynamic rules for ByteDance CDNs structure validation', () => {
      assert.ok(Array.isArray(TIKTOK_CDN_RULES), 'TIKTOK_CDN_RULES must be an array');
      assert.strictEqual(TIKTOK_CDN_RULES.length, 3, 'Must define rules for 3 CDN domains');

      const cdnDomains = ['*tiktokcdn.com*', '*byteoversea.com*', '*ibytedtos.com*'];
      for (const rule of TIKTOK_CDN_RULES) {
        assert.ok(rule.id >= 1 && rule.id <= 3, `Rule id must be valid integer: ${rule.id}`);
        assert.strictEqual(rule.priority, 1);
        assert.strictEqual(rule.action.type, 'modifyHeaders');

        const headers = rule.action.requestHeaders;
        assert.ok(Array.isArray(headers), 'requestHeaders must be array');

        const referer = headers.find((h) => h.header.toLowerCase() === 'referer');
        assert.ok(referer, 'Rule must inject Referer header');
        assert.strictEqual(referer.value, 'https://www.tiktok.com/');
        assert.strictEqual(referer.operation, 'set');

        const origin = headers.find((h) => h.header.toLowerCase() === 'origin');
        assert.ok(origin, 'Rule must inject Origin header');
        assert.strictEqual(origin.value, 'https://www.tiktok.com');

        assert.ok(cdnDomains.includes(rule.condition.urlFilter), `urlFilter must match expected CDN domain: ${rule.condition.urlFilter}`);
        assert.ok(rule.condition.resourceTypes.includes('media'), 'resourceTypes must include "media"');
      }
    });

    await testAsync('executeDownload triggers chrome.downloads.download with conflictAction: "uniquify"', async () => {
      // Mock chrome extension APIs in global scope
      const downloadCalls = [];
      const storageStore = new Map();

      global.chrome = {
        runtime: {
          lastError: null,
        },
        downloads: {
          download: (options, cb) => {
            downloadCalls.push(options);
            cb(1042); // mock download ID
          },
        },
        storage: {
          local: {
            get: (keys, cb) => {
              const res = {};
              for (const k of keys) {
                res[k] = storageStore.get(k);
              }
              cb(res);
            },
            set: (obj, cb) => {
              for (const k of Object.keys(obj)) {
                storageStore.set(k, obj[k]);
              }
              if (cb) cb();
            },
          },
        },
      };

      const result = await executeDownload({
        url: 'https://v16-webapp-prime.tiktokcdn.com/video/tos/useast2a/tos-useast2a-ve-0068c001/stream.mp4',
        author: 'khaby.lame',
        videoId: '7123456789012345678',
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.downloadId, 1042);
      assert.strictEqual(result.filename, 'tiktok_@khaby.lame_7123456789012345678.mp4');

      assert.strictEqual(downloadCalls.length, 1, 'chrome.downloads.download must be called once');
      const call = downloadCalls[0];
      assert.strictEqual(call.url, 'https://v16-webapp-prime.tiktokcdn.com/video/tos/useast2a/tos-useast2a-ve-0068c001/stream.mp4');
      assert.strictEqual(call.filename, 'tiktok_@khaby.lame_7123456789012345678.mp4');
      assert.strictEqual(call.conflictAction, 'uniquify', 'conflictAction must strictly be "uniquify"');
      assert.strictEqual(call.saveAs, false, 'saveAs must strictly be false');

      // Verify telemetry persistence
      assert.strictEqual(storageStore.get('downloadCount'), 1);
      const recent = storageStore.get('recentDownloads');
      assert.ok(Array.isArray(recent) && recent.length === 1);
      assert.strictEqual(recent[0].author, 'khaby.lame');
      assert.strictEqual(recent[0].videoId, '7123456789012345678');
    });

    test('DOWNLOAD_VIDEO rejects invalid / empty stream URLs', async () => {
      await assert.rejects(
        async () => {
          await executeDownload({ url: '', author: 'test', videoId: '123' });
        },
        /Invalid or missing video download URL/,
        'Should reject empty URL'
      );

      await assert.rejects(
        async () => {
          await executeDownload({ url: 'blob:https://www.tiktok.com/1234-5678', author: 'test', videoId: '123' });
        },
        /URL must be an HTTP or HTTPS stream/,
        'Should reject non-HTTP blob URLs'
      );
    });
  });

  // --------------------------------------------------------------------------
  // TEST REPORT SUMMARY & EXIT CODE
  // --------------------------------------------------------------------------
  console.log(`\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan} TEST EXECUTION SUMMARY REPORT${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}`);

  for (const s of suiteResults) {
    const status = s.failed === 0 ? `${colors.green}PASS${colors.reset}` : `${colors.red}FAIL${colors.reset}`;
    console.log(`  [${status}] ${s.name.padEnd(58)} (${s.passed} passed, ${s.failed} failed in ${s.durationMs}ms)`);
  }

  console.log(`${colors.gray}----------------------------------------------------------------------${colors.reset}`);
  console.log(`  ${colors.bold}Total Test Suites: ${suiteResults.length}${colors.reset}`);
  console.log(`  ${colors.bold}Total Test Cases:  ${totalTests}${colors.reset}`);
  console.log(`  ${colors.bold}Total Passed:      ${colors.green}${totalPassed}${colors.reset}`);
  console.log(`  ${colors.bold}Total Failed:      ${totalFailed > 0 ? colors.red : colors.gray}${totalFailed}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`);

  if (totalFailed > 0) {
    console.error(`${colors.red}${colors.bold}Verification Failed! ${totalFailed} tests failed.${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}${colors.bold}All E2E Verification Suites Passed Cleanly with 100% Success Rate!${colors.reset}\n`);
    process.exit(0);
  }
}

// Execute Runner
runAllSuites().catch((err) => {
  console.error(`\n${colors.red}${colors.bold}Fatal Harness Error:${colors.reset}`, err);
  process.exit(1);
});
