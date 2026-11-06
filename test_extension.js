/**
 * TikTok Direct Downloader Chrome Extension - E2E Automated Test Runner
 *
 * Zero external npm dependencies (pure Node.js standard library).
 * Executes 8 comprehensive test suites covering Features F1 through F19 across Tiers 1 to 4:
 *
 * Suite 1: Manifest V3 Conformance & Schema Validation
 * Suite 2: File Structure & Asset Integrity Validation (PNG magic bytes)
 * Suite 3: JavaScript Syntax Check (node --check) across all scripts
 * Suite 4: Windows NTFS Filename Sanitization Unit & Boundary Tests (Category-Partition & BVA)
 * Suite 5: In-Page UI Injection & Debounce Simulation (250ms coalescing, duplicate guard, self-healing)
 * Suite 6: Button State Transitions State Machine Simulation (Idle, Loading, Success [2.5s], Error [3.0s])
 * Suite 7: Service Worker IPC & DeclarativeNetRequest Rule Validation (DOWNLOAD_VIDEO, conflictAction, DNR)
 * Suite 8: Popup UI Markup, Controller Lifecycle & Active Video IPC Verification
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
  gray: '\x1b[90m'
};

// Global Test Execution State
let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;
const suiteResults = [];

function runSuite(name, fn) {
  console.log(
    `\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`
  );
  console.log(`${colors.bold}${colors.cyan} SUITE: ${name}${colors.reset}`);
  console.log(
    `${colors.bold}${colors.cyan}======================================================================${colors.reset}`
  );

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
      console.log(
        `${colors.gray}Completed in ${elapsed}ms (${suitePassed} passed, ${suiteFailed} failed)${colors.reset}`
      );
    });
  } else {
    const elapsed = Date.now() - startSuiteTime;
    suiteResults.push({ name, passed: suitePassed, failed: suiteFailed, durationMs: elapsed });
    console.log(
      `${colors.gray}Completed in ${elapsed}ms (${suitePassed} passed, ${suiteFailed} failed)${colors.reset}`
    );
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
    this.textContent = '';
    this.innerHTML = '';
    this.style = {};
    this._listeners = new Map();
    this._stateTimeout = null;
    this._clicked = false;
  }

  get id() {
    return this.attributes.get('id') || this._id || '';
  }

  set id(val) {
    this._id = String(val);
    this.setAttribute('id', val);
  }

  get href() {
    return this.attributes.get('href') || this._href || '';
  }

  set href(val) {
    this._href = String(val);
    this.setAttribute('href', val);
  }

  get download() {
    return this.attributes.get('download') || this._download || '';
  }

  set download(val) {
    this._download = String(val);
    this.setAttribute('download', val);
  }

  get value() {
    return this.attributes.get('value') || this._value || '';
  }

  set value(val) {
    this._value = String(val);
    this.setAttribute('value', val);
  }

  get disabled() {
    return this.attributes.has('disabled')
      ? this.attributes.get('disabled') !== 'false'
      : !!this._disabled;
  }

  set disabled(val) {
    this._disabled = !!val;
    if (val) {
      this.setAttribute('disabled', 'true');
    } else {
      this.removeAttribute('disabled');
    }
  }

  click() {
    this._clicked = true;
    this.dispatchEvent({
      type: 'click',
      target: this,
      preventDefault: () => {},
      stopPropagation: () => {}
    });
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
    if (child.parentElement) {
      child.parentElement.removeChild(child);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(newChild, refChild) {
    if (newChild.parentElement) {
      newChild.parentElement.removeChild(newChild);
    }
    newChild.parentElement = this;
    const index = this.children.indexOf(refChild);
    if (index === -1) {
      this.children.push(newChild);
    } else {
      this.children.splice(index, 0, newChild);
    }
    return newChild;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  insertAdjacentElement(position, element) {
    if (!element) return null;
    if (position === 'beforebegin' && this.parentElement) {
      this.parentElement.insertBefore(element, this);
    } else if (position === 'afterbegin') {
      this.insertBefore(element, this.children[0] || null);
    } else if (position === 'beforeend') {
      this.appendChild(element);
    } else if (position === 'afterend' && this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      const next = this.parentElement.children[idx + 1] || null;
      this.parentElement.insertBefore(element, next);
    }
    return element;
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

  dispatchEvent(event) {
    const handlers = this._listeners.get(event.type) || [];
    for (const h of handlers) h(event);
  }
}

// ============================================================================
// STRICT CODE QUALITY & HTML VALIDATION ENGINES (ZERO-TOLERANCE LINTER)
// ============================================================================

/**
 * Strict HTML Linter & Validator Engine
 * Emulates html-validate and W3C conformance rules without external dependencies:
 * - no-raw-characters: Raw '&' must be escaped as '&amp;' (unless part of valid entity)
 * - no-implicit-button-type: <button> tags must have explicit type="button|submit|reset"
 * - no-duplicate-id: element IDs must be strictly unique across the document
 * - element-permitted-content: tags must be well-formed, balanced, and properly closed
 * - no-inline-event-handlers: no inline JS (onclick/onload/etc.) to satisfy MV3 CSP
 */
function lintHtmlStrict(html, sourceName = 'inline') {
  const errors = [];
  const warnings = [];

  // Strip comments, script, and style blocks for content & markup linting
  const strippedHtml = html
    .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => ' '.repeat(m.length))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (m) => ' '.repeat(m.length));

  // 1. Rule: no-raw-characters (Raw '&' must be encoded as '&amp;')
  // Matches any '&' not followed by a valid named entity (&amp;, &lt;, etc.) or numeric entity (&#123;, &#x1F;)
  const rawAmpRegex = /&(?!([a-zA-Z0-9]+|#[0-9]{1,6}|#[xX][0-9a-fA-F]{1,6});)/g;
  let match;
  while ((match = rawAmpRegex.exec(strippedHtml)) !== null) {
    const index = match.index;
    const lineNum = strippedHtml.substring(0, index).split('\n').length;
    const colNum = index - strippedHtml.lastIndexOf('\n', index);
    errors.push({
      rule: 'no-raw-characters',
      line: lineNum,
      col: colNum,
      message: `Raw "&" must be encoded as "&amp;" (html-validate: no-raw-characters) at [Ln ${lineNum}, Col ${colNum}]`
    });
  }

  // 2. Rule: no-implicit-button-type (<button> is missing recommended "type" attribute)
  const buttonRegex = /<button\b([^>]*)>/gi;
  while ((match = buttonRegex.exec(html)) !== null) {
    const attrs = match[1];
    const index = match.index;
    const lineNum = html.substring(0, index).split('\n').length;
    const colNum = index - html.lastIndexOf('\n', index);

    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    if (!typeMatch) {
      errors.push({
        rule: 'no-implicit-button-type',
        line: lineNum,
        col: colNum,
        message: `<button> is missing recommended "type" attribute (e.g. type="button") [Ln ${lineNum}, Col ${colNum}]`
      });
    } else {
      const typeVal = typeMatch[1].toLowerCase();
      if (!['button', 'submit', 'reset'].includes(typeVal)) {
        errors.push({
          rule: 'valid-button-type',
          line: lineNum,
          col: colNum,
          message: `<button> has invalid type "${typeVal}". Must be button, submit, or reset [Ln ${lineNum}, Col ${colNum}]`
        });
      }
    }
  }

  // 3. Rule: no-duplicate-id (Duplicate element IDs are forbidden)
  const idRegex = /\bid\s*=\s*["']([^"']+)["']/gi;
  const seenIds = new Map();
  while ((match = idRegex.exec(html)) !== null) {
    const id = match[1];
    const index = match.index;
    const lineNum = html.substring(0, index).split('\n').length;
    if (seenIds.has(id)) {
      errors.push({
        rule: 'no-duplicate-id',
        line: lineNum,
        message: `Duplicate ID "${id}" detected. First defined on line ${seenIds.get(id)}, duplicate on line ${lineNum}`
      });
    } else {
      seenIds.set(id, lineNum);
    }
  }

  // 4. Rule: no-inline-event-handlers (MV3 Content Security Policy compliance)
  const inlineHandlerRegex = /\s(on[a-z]+)\s*=\s*["'][^"']*["']/gi;
  while ((match = inlineHandlerRegex.exec(html)) !== null) {
    const handler = match[1];
    const index = match.index;
    const lineNum = html.substring(0, index).split('\n').length;
    errors.push({
      rule: 'no-inline-event-handlers',
      line: lineNum,
      message: `Inline event handler "${handler}" violates Manifest V3 CSP at line ${lineNum}`
    });
  }

  // 5. Rule: element-permitted-content & Balanced Tag Matching
  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
    '!doctype',
    'path',
    'circle',
    'line',
    'polyline',
    'polygon',
    'rect',
    'ellipse',
    'stop',
    'use'
  ]);
  const tagTokenRegex = /<(\/)?([a-zA-Z0-9-]+)([^>]*?)(\/?)>/g;
  const tagStack = [];
  while ((match = tagTokenRegex.exec(strippedHtml)) !== null) {
    const isClosing = match[1] === '/';
    const tagName = match[2].toLowerCase();
    const isSelfClosing = match[4] === '/' || voidTags.has(tagName) || match[0].startsWith('<!--');
    const index = match.index;
    const lineNum = strippedHtml.substring(0, index).split('\n').length;

    if (voidTags.has(tagName) && !isClosing) continue;

    if (isClosing) {
      if (tagStack.length === 0) {
        errors.push({
          rule: 'element-closing-match',
          line: lineNum,
          message: `Unexpected closing tag </${tagName}> without matching opening tag at line ${lineNum}`
        });
      } else {
        const last = tagStack.pop();
        if (last.tagName !== tagName) {
          errors.push({
            rule: 'element-closing-match',
            line: lineNum,
            message: `Mismatched tag: expected </${last.tagName}> (opened at line ${last.lineNum}) but found </${tagName}> at line ${lineNum}`
          });
        }
      }
    } else if (!isSelfClosing) {
      tagStack.push({ tagName, lineNum });
    }
  }

  while (tagStack.length > 0) {
    const unclosed = tagStack.pop();
    errors.push({
      rule: 'element-unclosed',
      line: unclosed.lineNum,
      message: `Unclosed tag <${unclosed.tagName}> opened at line ${unclosed.lineNum}`
    });
  }

  return { errors, warnings, valid: errors.length === 0 };
}

/**
 * Scans JavaScript source files for button element creation and verifies
 * that explicit `.type = 'button'` or `.setAttribute('type', 'button')` is applied.
 */
function checkJsButtonCreationHygiene(jsContent, filename) {
  const lines = jsContent.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(
      /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*document\.createElement\(['"`]button['"`]\)/
    );
    if (match) {
      const varName = match[1];
      const startLine = i + 1;
      const block = lines.slice(i, Math.min(lines.length, i + 20)).join('\n');
      const hasType = new RegExp(
        `${varName}\\.type\\s*=\\s*['"\`]button['"\`]|${varName}\\.setAttribute\\(['"\`]type['"\`],\\s*['"\`]button['"\`]\\)`
      ).test(block);
      if (!hasType) {
        violations.push({
          file: filename,
          line: startLine,
          variable: varName,
          message: `Button variable "${varName}" created at line ${startLine} in ${filename} is missing explicit .type = 'button'`
        });
      }
    }
  }

  return violations;
}

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================
async function runAllSuites() {
  console.log(
    `\n${colors.bold}TikTok Direct Downloader Extension — E2E Verification Harness${colors.reset}`
  );
  console.log(
    `${colors.gray}Node.js Version: ${process.version} | Platform: ${process.platform} | Zero npm Dependencies${colors.reset}\n`
  );

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

    test('Permissions are minimally scoped (downloads, declarativeNetRequest, storage, contextMenus, nativeMessaging, notifications, cookies)', () => {
      assert.ok(Array.isArray(manifest.permissions), 'permissions must be an array');
      assert.ok(manifest.permissions.includes('downloads'), 'must include "downloads"');
      assert.ok(
        manifest.permissions.includes('declarativeNetRequest'),
        'must include "declarativeNetRequest"'
      );
      assert.ok(manifest.permissions.includes('storage'), 'must include "storage"');
      assert.ok(manifest.permissions.includes('contextMenus'), 'must include "contextMenus"');
      assert.ok(manifest.permissions.includes('nativeMessaging'), 'must include "nativeMessaging"');
      assert.ok(manifest.permissions.includes('notifications'), 'must include "notifications"');
      assert.ok(manifest.permissions.includes('cookies'), 'must include "cookies"');
      assert.strictEqual(
        manifest.permissions.length,
        7,
        'permissions should only request minimal necessary APIs'
      );
    });

    test('Host permissions declare TikTok, Bstation, JWPlyr and YouTube CDNs', () => {
      assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
      assert.ok(
        manifest.host_permissions.includes('*://*.tiktok.com/*'),
        'must include TikTok web origin'
      );
      assert.ok(
        manifest.host_permissions.includes('*://*.tiktokcdn.com/*'),
        'must include tiktokcdn.com'
      );
      assert.ok(
        manifest.host_permissions.includes('*://*.byteoversea.com/*'),
        'must include byteoversea.com'
      );
      assert.ok(
        manifest.host_permissions.includes('*://*.ibytedtos.com/*'),
        'must include ibytedtos.com'
      );
      assert.ok(
        manifest.host_permissions.includes('*://*.youtube.com/*'),
        'must include youtube.com'
      );
      assert.ok(
        manifest.host_permissions.includes('*://*.googlevideo.com/*'),
        'must include googlevideo.com'
      );
    });

    test('Background is configured as ephemeral service worker', () => {
      assert.ok(manifest.background, 'background configuration must exist');
      assert.strictEqual(manifest.background.service_worker, 'background/service_worker.js');
      assert.strictEqual(
        manifest.background.scripts,
        undefined,
        'MV2 background.scripts must NOT exist'
      );
    });

    test('Content scripts configure MAIN world bridge and ISOLATED world UI platform', () => {
      assert.ok(Array.isArray(manifest.content_scripts), 'content_scripts must be an array');
      assert.ok(
        manifest.content_scripts.length >= 4,
        'must configure at least 4 content script entries (TikTok, Bstation, JWPlyr, YouTube)'
      );

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
      assert.ok(
        Array.isArray(manifest.web_accessible_resources),
        'web_accessible_resources must be an array'
      );
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
      'content/platforms/youtube.js',
      'content/styles/youtube.css',
      'content/injected/youtube_bridge.js',
      'popup/popup.html',
      'popup/popup.css',
      'popup/popup.js',
      'icons/generate_icons.js',
      'icons/icon16.png',
      'icons/icon48.png',
      'icons/icon128.png',
      'README.md',
      'TEST_INFRA.md',
      'PROJECT.md'
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
  // SUITE 3: JavaScript Syntax Check (node --check) across all scripts & Strict DOM Hygiene
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 3: JavaScript Syntax Check (node --check) & Strict DOM Hygiene',
    ({ test }) => {
      const jsFiles = [
        'background/service_worker.js',
        'content/platforms/tiktok.js',
        'content/injected/tiktok_bridge.js',
        'content/platforms/bstation.js',
        'content/injected/bstation_bridge.js',
        'content/platforms/jwplyr.js',
        'content/platforms/youtube.js',
        'content/injected/youtube_bridge.js',
        'popup/popup.js',
        'icons/generate_icons.js',
        'content/injected/shield_bridge.js',
        'content/platforms/shield_listener.js',
        'content/platforms/cosplaytele.js',
        'content/platforms/pinterest.js',
        'content/platforms/anoboy.js',
        'content/platforms/comic_translator.js',
        'test_extension.js',
        'test_adversarial_bstation.js'
      ];

      for (const relPath of jsFiles) {
        test(`Syntax check: ${relPath}`, () => {
          const fullPath = path.join(PROJECT_ROOT, relPath);
          const res = spawnSync(process.execPath, ['--check', fullPath], {
            encoding: 'utf8',
            windowsHide: true
          });

          assert.strictEqual(
            res.status,
            0,
            `Syntax error in ${relPath}:\n${res.stderr || res.stdout}`
          );
          assert.strictEqual(res.stderr.trim(), '', `Unexpected stderr in ${relPath}`);
        });
      }

      test('Strict DOM Button Creation Hygiene: all document.createElement("button") in scripts enforce explicit type="button"', () => {
        const targetScriptFiles = [
          'content/platforms/tiktok.js',
          'content/platforms/bstation.js',
          'content/platforms/jwplyr.js',
          'content/platforms/youtube.js',
          'popup/popup.js'
        ];

        for (const relPath of targetScriptFiles) {
          const fullPath = path.join(PROJECT_ROOT, relPath);
          const content = fs.readFileSync(fullPath, 'utf8');
          const violations = checkJsButtonCreationHygiene(content, relPath);
          assert.strictEqual(
            violations.length,
            0,
            `DOM Button Hygiene violations found in ${relPath}:\n${violations.map((v) => `  - [Line ${v.line}] ${v.message}`).join('\n')}`
          );
        }
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 4: Windows NTFS Filename Sanitization Unit & Boundary Tests
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 4: Windows NTFS Filename Sanitization Unit & Boundary Tests',
    ({ test }) => {
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
        assert.ok(
          !/[\\/:*?"<>|]/.test(result),
          'Filename must contain zero Win32 illegal characters'
        );
        assert.ok(NTFS_REGEX.test(result), 'Filename must match strict format regex');
      });

      test('Equivalence Partition 3 (Control Characters 0x00-0x1F and 0x7F-0x9F): Replaced / sanitized', () => {
        const inputAuthor = 'evil\x00user\x07\x1fname\x7fbad\x80';
        const result = formatFilename(inputAuthor, '9999');
        assert.ok(
          !/[\x00-\x1f\x7f-\x9f]/.test(result),
          'Filename must contain zero control characters'
        );
        assert.ok(NTFS_REGEX.test(result));
      });

      test('Equivalence Partition 4 (Repeated @ Prefix): Normalizes to single @ in tiktok_@[author]', () => {
        assert.strictEqual(
          formatFilename('@charlidamelio', '101'),
          'tiktok_@charlidamelio_101.mp4'
        );
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
        assert.ok(
          result.length < 255,
          `Total filename ${result.length} must be well below Win32 MAX_PATH`
        );
        assert.ok(NTFS_REGEX.test(result));
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 5: In-Page UI Injection & Debounce Simulation
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 5: In-Page UI Injection & Debounce Simulation',
    async ({ test, testAsync }) => {
      const tiktokScript = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
      const { DOMObserverManager, injectIntoCard, scanAndInject } = tiktokScript;

      // Set up mock DOM environment
      let documentRoot = new MockElement('body');
      global.document = {
        createElement: (tag) => new MockElement(tag),
        querySelectorAll: (sel) => documentRoot.querySelectorAll(sel),
        querySelector: (sel) => documentRoot.querySelector(sel),
        body: documentRoot,
        documentElement: documentRoot,
        addEventListener: () => {},
        removeEventListener: () => {}
      };

      await testAsync(
        '250ms debouncer coalesces rapid mutation bursts into single scan',
        async () => {
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
          assert.strictEqual(
            scanCalls,
            1,
            'Scan must execute exactly once for the coalesced burst'
          );

          manager.stop();
        }
      );

      test('Strict Single Injection: exactly ONE download button is injected directly above Share button', () => {
        documentRoot = new MockElement('body');
        const card = new MockElement('div');
        card.setAttribute('data-e2e', 'feed-video');

        const actionBar = new MockElement('div');
        actionBar.setAttribute('class', 'DivActionItemContainer');

        const likeItem = new MockElement('div');
        likeItem.setAttribute('data-e2e', 'feed-action-item');
        likeItem.setAttribute('class', 'like-btn');
        actionBar.appendChild(likeItem);

        const shareItem = new MockElement('div');
        shareItem.setAttribute('data-e2e', 'feed-action-item');
        const shareBtn = new MockElement('button');
        shareBtn.setAttribute('data-e2e', 'feed-share-icon');
        shareBtn.setAttribute('aria-label', 'Share to friend');
        shareItem.appendChild(shareBtn);
        actionBar.appendChild(shareItem);

        card.appendChild(actionBar);
        documentRoot.appendChild(card);

        injectIntoCard(card);

        // Button must be injected directly BEFORE shareItem (positioned directly ABOVE Share button)
        const downloadItem = actionBar.querySelector('.tt-dl-action-item');
        assert.ok(downloadItem, 'Download item must be injected');
        assert.strictEqual(
          actionBar.children.length,
          3,
          'Action bar must contain like, download, and share'
        );
        assert.strictEqual(
          actionBar.children[1],
          downloadItem,
          'Download item must be index 1 (directly before shareItem)'
        );
        assert.strictEqual(
          actionBar.children[2],
          shareItem,
          'Share item must be index 2 (directly after downloadItem)'
        );
        assert.strictEqual(card.getAttribute('data-tt-dl-ready'), 'true');
        assert.strictEqual(actionBar.getAttribute('data-tt-dl-ready'), 'true');
      });

      test('Duplicate injection guards prevent multiple buttons on repeated scans', () => {
        const card = documentRoot.querySelector('[data-e2e="feed-video"]');
        const actionBar = card.querySelector('.DivActionItemContainer');

        // Re-scan 1: injectIntoCard called directly
        injectIntoCard(card);
        assert.strictEqual(
          actionBar.querySelectorAll('.tt-dl-action-item').length,
          1,
          'Button count must strictly remain 1'
        );

        // Re-scan 2: scanAndInject called across document
        scanAndInject();
        assert.strictEqual(
          actionBar.querySelectorAll('.tt-dl-action-item').length,
          1,
          'Button count must strictly remain 1'
        );
      });

      test('Elimination of secondary strategy: nested video cards never inject duplicate buttons', () => {
        documentRoot = new MockElement('body');
        const outerCard = new MockElement('div');
        outerCard.setAttribute('class', 'DivItemContainer');

        const innerCard = new MockElement('div');
        innerCard.setAttribute('data-e2e', 'feed-video');

        const innerBar = new MockElement('div');
        innerBar.setAttribute('class', 'DivActionItemContainer');

        const innerShare = new MockElement('div');
        innerShare.setAttribute('data-e2e', 'feed-action-item');
        const innerShareBtn = new MockElement('button');
        innerShareBtn.setAttribute('data-e2e', 'feed-share-icon');
        innerShare.appendChild(innerShareBtn);

        innerBar.appendChild(innerShare);
        innerCard.appendChild(innerBar);
        outerCard.appendChild(innerCard);
        documentRoot.appendChild(outerCard);

        scanAndInject();

        assert.strictEqual(
          innerBar.querySelectorAll('.tt-dl-action-item').length,
          1,
          'Exactly 1 button in action bar'
        );
        assert.strictEqual(
          outerCard.querySelectorAll('.tt-dl-action-item').length,
          1,
          'Exactly 1 button in entire card'
        );

        // Rapid successive scans
        scanAndInject();
        scanAndInject();
        assert.strictEqual(
          innerBar.querySelectorAll('.tt-dl-action-item').length,
          1,
          'No duplicate buttons on repeated scans'
        );
      });

      test('Self-healing reconciliation resets data-tt-dl-ready if inner button was wiped by React', () => {
        const innerBar = documentRoot.querySelector('.DivActionItemContainer');
        const dlBtn = innerBar.querySelector('.tt-dl-action-item');
        assert.ok(dlBtn, 'Download item exists prior to React wipe');

        // Simulate React re-render wiping inner button while keeping ready attribute
        dlBtn.remove();
        assert.strictEqual(
          innerBar.querySelector('.tt-dl-action-item'),
          null,
          'Button removed by React'
        );

        // scanAndInject must reconcile stale data-tt-dl-ready and cleanly re-inject exactly 1 button
        scanAndInject();
        assert.strictEqual(
          innerBar.querySelectorAll('.tt-dl-action-item').length,
          1,
          'Button cleanly re-injected'
        );
        assert.strictEqual(innerBar.getAttribute('data-tt-dl-ready'), 'true');
      });

      test('Self-healing deduplication prunes existing duplicate download buttons down to exactly 1', () => {
        const innerBar = documentRoot.querySelector('.DivActionItemContainer');
        assert.strictEqual(innerBar.querySelectorAll('.tt-dl-action-item').length, 1);

        // Artificially inject 2 additional duplicate download buttons into the action bar
        const dup1 = new MockElement('div');
        dup1.setAttribute('class', 'tt-dl-action-item');
        innerBar.appendChild(dup1);

        const dup2 = new MockElement('div');
        dup2.setAttribute('class', 'tt-dl-action-item');
        innerBar.appendChild(dup2);

        assert.strictEqual(
          innerBar.querySelectorAll('.tt-dl-action-item').length,
          3,
          'Bar artificially has 3 buttons'
        );

        // scanAndInject must aggressively deduplicate and restore strictly 1 button
        scanAndInject();
        assert.strictEqual(
          innerBar.querySelectorAll('.tt-dl-action-item').length,
          1,
          'Duplicate buttons pruned to strictly 1'
        );
      });

      test('Action bar resolution correctly nests download button inside DivActionItemContainer when Share lacks data-e2e', () => {
        const customCard = new MockElement('div');
        customCard.setAttribute('class', 'DivItemContainer');

        const customBar = new MockElement('div');
        customBar.setAttribute('class', 'DivActionItemContainer');

        const shareWrapper = new MockElement('div');
        const shareBtn = new MockElement('button');
        shareBtn.setAttribute('aria-label', 'Share video');
        shareWrapper.appendChild(shareBtn);

        customBar.appendChild(shareWrapper);
        customCard.appendChild(customBar);
        documentRoot.appendChild(customCard);

        injectIntoCard(customCard);

        // Verify the download button is placed INSIDE the action bar directly before shareWrapper
        assert.strictEqual(
          customBar.querySelectorAll('.tt-dl-action-item').length,
          1,
          'Button must be inside DivActionItemContainer'
        );
        assert.strictEqual(
          customCard.children[0],
          customBar,
          'First child of card must be the action bar, not an orphaned button'
        );
        assert.strictEqual(
          customBar.children[0].className,
          'tt-dl-action-item',
          'Download item must be inserted before shareWrapper in bar'
        );
        assert.strictEqual(
          customBar.children[1],
          shareWrapper,
          'Share wrapper must follow download item in bar'
        );
      });

      test('Infinite scroll simulation: 20+ successive FYP videos each receive strictly 1 download button above Share', () => {
        documentRoot = new MockElement('body');
        global.document.body = documentRoot;
        global.document.documentElement = documentRoot;

        const feed = new MockElement('div');
        feed.setAttribute('data-e2e', 'recommend-list');
        documentRoot.appendChild(feed);

        const items = [];
        for (let i = 1; i <= 25; i++) {
          const card = new MockElement('div');
          card.setAttribute('data-e2e', 'recommend-list-item-container');

          const bar = new MockElement('div');
          bar.setAttribute('class', 'DivActionItemContainer');

          const shareWrapper = new MockElement('div');
          shareWrapper.setAttribute('data-e2e', 'feed-action-item');
          const shareBtn = new MockElement('button');
          shareBtn.setAttribute('data-e2e', 'feed-share-icon');
          shareWrapper.appendChild(shareBtn);

          bar.appendChild(shareWrapper);
          card.appendChild(bar);
          feed.appendChild(card);
          items.push({ card, bar, shareWrapper });

          // Simulate MutationObserver triggering scan after each new batch of items is appended
          scanAndInject();
        }

        // Assert entire feed state: exactly 25 buttons in document, 1 per video
        const allButtons = documentRoot.querySelectorAll('.tt-dl-action-item');
        assert.strictEqual(
          allButtons.length,
          25,
          'Total download buttons must strictly match 25 videos'
        );

        for (let i = 0; i < items.length; i++) {
          const { card, bar, shareWrapper } = items[i];
          const buttonsInCard = card.querySelectorAll('.tt-dl-action-item');
          assert.strictEqual(buttonsInCard.length, 1, `Video ${i + 1} must have strictly 1 button`);
          const shareIndex = bar.children.indexOf(shareWrapper);
          const dlIndex = bar.children.indexOf(buttonsInCard[0]);
          assert.strictEqual(
            dlIndex,
            shareIndex - 1,
            `Download button in video ${i + 1} must be directly before shareWrapper`
          );
        }
      });

      test('Gracefully ignores video cards lacking a share button without throwing or injecting orphan buttons', () => {
        const cardWithoutShare = new MockElement('div');
        cardWithoutShare.setAttribute('data-e2e', 'recommend-list-item-container');
        const bar = new MockElement('div');
        bar.setAttribute('class', 'DivActionItemContainer');
        cardWithoutShare.appendChild(bar);
        documentRoot.appendChild(cardWithoutShare);

        scanAndInject();
        assert.strictEqual(
          cardWithoutShare.querySelectorAll('.tt-dl-action-item').length,
          0,
          'No button should be injected when share button is absent'
        );
      });

      test('Fallback action bar resolution with bare button child (without item wrapper) correctly injects inside action bar', () => {
        const bareCard = new MockElement('article');
        const bareBar = new MockElement('div');
        bareBar.setAttribute('class', 'CustomActionBarWithoutKnownClass');

        const bareShareBtn = new MockElement('button');
        bareShareBtn.setAttribute('aria-label', 'Share');
        bareBar.appendChild(bareShareBtn);

        bareCard.appendChild(bareBar);
        documentRoot.appendChild(bareCard);

        injectIntoCard(bareCard);

        // Verify download button is injected directly inside bareBar before bareShareBtn
        assert.strictEqual(
          bareBar.querySelectorAll('.tt-dl-action-item').length,
          1,
          'Download button must be inside bareBar'
        );
        assert.strictEqual(bareBar.children[0].className, 'tt-dl-action-item');
        assert.strictEqual(bareBar.children[1], bareShareBtn);
        assert.strictEqual(
          bareCard.children.length,
          1,
          'Card must have strictly 1 child (the action bar), no orphaned buttons'
        );
      });

      test('ActionBar with stale data-tt-dl-ready attribute but missing button cleanly re-injects button', () => {
        const card = new MockElement('div');
        card.setAttribute('data-e2e', 'feed-video');

        const bar = new MockElement('div');
        bar.setAttribute('class', 'DivActionItemContainer');
        bar.setAttribute('data-tt-dl-ready', 'true'); // stale attribute from previous render

        const shareItem = new MockElement('div');
        shareItem.setAttribute('data-e2e', 'feed-action-item');
        const shareBtn = new MockElement('button');
        shareBtn.setAttribute('data-e2e', 'feed-share-icon');
        shareItem.appendChild(shareBtn);
        bar.appendChild(shareItem);

        card.appendChild(bar);
        documentRoot.appendChild(card);

        // Direct injectIntoCard call on card with stale bar attribute
        injectIntoCard(card);

        assert.strictEqual(
          bar.querySelectorAll('.tt-dl-action-item').length,
          1,
          'Must re-inject button even if bar had stale data-tt-dl-ready attribute'
        );
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 6: Button State Transitions State Machine Simulation
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 6: Button State Transitions State Machine Simulation',
    async ({ test, testAsync }) => {
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

      await testAsync(
        'Success State: Disabled with checkmark icon and reverts to idle after 2500ms',
        async () => {
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
        }
      );

      await testAsync(
        'Error State: Enabled with alert icon and reverts to idle after 3000ms',
        async () => {
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
        }
      );

      await testAsync(
        'Timer Cleanup on Rapid State Transitions prevents premature resets',
        async () => {
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
          assert.strictEqual(
            btn.getAttribute('data-state'),
            'error',
            'Button must still be in error state'
          );

          // Wait remaining 600ms (total 3150ms > 3000ms from error state start)
          await new Promise((r) => setTimeout(r, 600));
          assert.strictEqual(
            btn.getAttribute('data-state'),
            'idle',
            'Button cleanly resets to idle'
          );
        }
      );
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 7: Service Worker IPC & DeclarativeNetRequest Rule Validation
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 7: Service Worker IPC & DeclarativeNetRequest Rule Validation',
    async ({ test, testAsync }) => {
      const sw = require(path.join(PROJECT_ROOT, 'background/service_worker.js'));
      const { TIKTOK_CDN_RULES, executeDownload, fetchVideoBlob, blobToDataUrl } = sw;

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

          assert.ok(
            cdnDomains.includes(rule.condition.urlFilter),
            `urlFilter must match expected CDN domain: ${rule.condition.urlFilter}`
          );
          assert.ok(
            rule.condition.resourceTypes.includes('media'),
            'resourceTypes must include "media"'
          );
        }
      });

      await testAsync(
        'fetchVideoBlob fetches stream directly with TikTok Referer & Origin headers',
        async () => {
          const fetchCalls = [];
          global.fetch = async (url, options) => {
            fetchCalls.push({ url, options });
            return {
              ok: true,
              status: 200,
              statusText: 'OK',
              blob: async () => new Blob(['dummy-video-data'], { type: 'video/mp4' })
            };
          };

          const blob = await fetchVideoBlob('https://v16-webapp-prime.tiktokcdn.com/stream.mp4');
          assert.ok(blob instanceof Blob, 'Must return a Blob instance');
          assert.strictEqual(fetchCalls.length, 1);
          assert.strictEqual(
            fetchCalls[0].url,
            'https://v16-webapp-prime.tiktokcdn.com/stream.mp4'
          );
          assert.strictEqual(fetchCalls[0].options.headers['Referer'], 'https://www.tiktok.com/');
          assert.strictEqual(fetchCalls[0].options.headers['Origin'], 'https://www.tiktok.com');
        }
      );

      await testAsync(
        'executeDownload executes Fetch-to-Blob and triggers chrome.downloads.download with Blob URL',
        async () => {
          // Mock chrome extension APIs and global fetch
          const downloadCalls = [];
          const storageStore = new Map();
          const fetchCalls = [];

          global.fetch = async (url, options) => {
            fetchCalls.push({ url, options });
            return {
              ok: true,
              status: 200,
              statusText: 'OK',
              blob: async () => new Blob(['dummy-mp4-data'], { type: 'video/mp4' })
            };
          };

          global.chrome = {
            runtime: {
              lastError: null
            },
            downloads: {
              download: (options, cb) => {
                downloadCalls.push(options);
                cb(1042); // mock download ID
              }
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
                }
              }
            }
          };

          const result = await executeDownload({
            url: 'https://v16-webapp-prime.tiktokcdn.com/video/tos/useast2a/tos-useast2a-ve-0068c001/stream.mp4',
            author: 'khaby.lame',
            videoId: '7123456789012345678'
          });

          assert.strictEqual(result.success, true);
          assert.strictEqual(result.downloadId, 1042);
          assert.strictEqual(result.filename, 'tiktok_@khaby.lame_7123456789012345678.mp4');

          // Verify fetch was executed with correct Referer and Origin
          assert.strictEqual(fetchCalls.length, 1, 'fetch must be called once');
          assert.strictEqual(
            fetchCalls[0].url,
            'https://v16-webapp-prime.tiktokcdn.com/video/tos/useast2a/tos-useast2a-ve-0068c001/stream.mp4'
          );
          assert.strictEqual(fetchCalls[0].options.headers['Referer'], 'https://www.tiktok.com/');
          assert.strictEqual(fetchCalls[0].options.headers['Origin'], 'https://www.tiktok.com');

          // Verify chrome.downloads.download received the Blob object URL
          assert.strictEqual(
            downloadCalls.length,
            1,
            'chrome.downloads.download must be called once'
          );
          const call = downloadCalls[0];
          assert.ok(
            call.url.startsWith('blob:'),
            `Download URL must be a blob: URL, received: ${call.url}`
          );
          assert.strictEqual(call.filename, 'tiktok_@khaby.lame_7123456789012345678.mp4');
          assert.strictEqual(
            call.conflictAction,
            'uniquify',
            'conflictAction must strictly be "uniquify"'
          );
          assert.strictEqual(call.saveAs, false, 'saveAs must strictly be false');

          // Verify telemetry persistence
          assert.strictEqual(storageStore.get('downloadCount'), 1);
          const recent = storageStore.get('recentDownloads');
          assert.ok(Array.isArray(recent) && recent.length === 1);
          assert.strictEqual(recent[0].author, 'khaby.lame');
          assert.strictEqual(recent[0].videoId, '7123456789012345678');
        }
      );

      await testAsync(
        'executeDownload rejects on 403 Forbidden without triggering chrome.downloads.download',
        async () => {
          const downloadCalls = [];
          global.fetch = async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden'
          });
          global.chrome.downloads.download = (options, cb) => {
            downloadCalls.push(options);
            cb(9999);
          };

          await assert.rejects(
            async () => {
              await executeDownload({
                url: 'https://v16-webapp-prime.tiktokcdn.com/forbidden.mp4',
                author: 'blocked',
                videoId: '403403'
              });
            },
            /Video stream fetch failed: HTTP 403 Forbidden/,
            'Should reject with 403 Forbidden'
          );

          assert.strictEqual(
            downloadCalls.length,
            0,
            'Must NOT trigger chrome.downloads.download on 403 to prevent .htm download'
          );
        }
      );

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
            await executeDownload({
              url: 'blob:https://www.tiktok.com/1234-5678',
              author: 'test',
              videoId: '123'
            });
          },
          /URL must be an HTTP or HTTPS stream/,
          'Should reject non-HTTP blob URLs'
        );
      });

      await testAsync(
        'blobToDataUrl converts Blob to valid Base64 data URL with proper MIME type',
        async () => {
          const sampleBlob = new Blob(['sample-mp4-stream-data'], { type: 'video/mp4' });
          const dataUrl = await blobToDataUrl(sampleBlob);
          assert.ok(
            dataUrl.startsWith('data:video/mp4;base64,'),
            `Must format as video/mp4 data URL: ${dataUrl.slice(0, 40)}...`
          );
          const base64Part = dataUrl.split(',')[1];
          const decoded = Buffer.from(base64Part, 'base64').toString('utf-8');
          assert.strictEqual(decoded, 'sample-mp4-stream-data');
        }
      );

      await testAsync(
        'executeDownload in MV3 Service Worker without URL.createObjectURL converts to Data URL and prevents raw CDN fallback',
        async () => {
          // Temporarily remove URL.createObjectURL to simulate Chrome MV3 ServiceWorkerGlobalScope
          const originalCreateObjectURL = URL.createObjectURL;
          delete URL.createObjectURL;

          const downloadCalls = [];
          const storageStore = new Map();
          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            blob: async () => new Blob(['simulated-mv3-stream'], { type: 'video/mp4' })
          });

          global.chrome = {
            runtime: { lastError: null },
            downloads: {
              download: (options, cb) => {
                downloadCalls.push(options);
                cb(2048);
              }
            },
            storage: {
              local: {
                get: (keys, cb) => cb({}),
                set: (obj, cb) => {
                  if (cb) cb();
                }
              }
            }
          };

          try {
            const result = await executeDownload({
              url: 'https://v16-webapp-prime.tiktokcdn.com/stream-mv3-sw.mp4',
              author: 'mv3.test',
              videoId: '88888888'
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(downloadCalls.length, 1);
            const call = downloadCalls[0];
            // CRITICAL CHECK: In MV3 Service Worker without URL.createObjectURL, it MUST use a data: URL
            // and MUST NOT fall back to the raw CDN URL (which bypasses declarativeNetRequest and triggers 403 Forbidden .htm)
            assert.ok(
              call.url.startsWith('data:video/mp4;base64,'),
              `Must be data URL, received: ${call.url.slice(0, 30)}...`
            );
            assert.notStrictEqual(
              call.url,
              'https://v16-webapp-prime.tiktokcdn.com/stream-mv3-sw.mp4',
              'Must NEVER fall back to raw CDN URL'
            );
            assert.strictEqual(call.filename, 'tiktok_@mv3.test_88888888.mp4');
          } finally {
            URL.createObjectURL = originalCreateObjectURL;
          }
        }
      );

      await testAsync(
        'executeDownload rejects on 404, 500, and network failures without triggering chrome.downloads.download',
        async () => {
          const downloadCalls = [];
          global.chrome = {
            runtime: { lastError: null },
            downloads: {
              download: (opts, cb) => {
                downloadCalls.push(opts);
                cb(5555);
              }
            },
            storage: {
              local: {
                get: (keys, cb) => cb({}),
                set: (data, cb) => {
                  if (cb) cb();
                }
              }
            }
          };

          // 404 Not Found
          global.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
          await assert.rejects(
            async () =>
              sw.executeDownload({
                url: 'https://v16-webapp-prime.tiktokcdn.com/404.mp4',
                author: 'user',
                videoId: '1'
              }),
            /HTTP 404 Not Found/
          );

          // 500 Internal Server Error
          global.fetch = async () => ({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error'
          });
          await assert.rejects(
            async () =>
              sw.executeDownload({
                url: 'https://v16-webapp-prime.tiktokcdn.com/500.mp4',
                author: 'user',
                videoId: '2'
              }),
            /HTTP 500 Internal Server Error/
          );

          // Network disconnect
          global.fetch = async () => {
            throw new Error('net::ERR_INTERNET_DISCONNECTED');
          };
          await assert.rejects(
            async () =>
              sw.executeDownload({
                url: 'https://v16-webapp-prime.tiktokcdn.com/netfail.mp4',
                author: 'user',
                videoId: '3'
              }),
            /net::ERR_INTERNET_DISCONNECTED/
          );

          assert.strictEqual(
            downloadCalls.length,
            0,
            'Must NOT trigger chrome.downloads.download on any fetch failure'
          );
        }
      );

      await testAsync(
        'executeDownload rejects when server returns HTTP 200 with HTML error page (prevents .htm corruption)',
        async () => {
          const downloadCalls = [];
          global.chrome = {
            runtime: { lastError: null },
            downloads: {
              download: (opts, cb) => {
                downloadCalls.push(opts);
                cb(6666);
              }
            },
            storage: {
              local: {
                get: (keys, cb) => cb({}),
                set: (data, cb) => {
                  if (cb) cb();
                }
              }
            }
          };

          // Mock HTTP 200 returning an HTML error page (e.g. rate limit, captcha, or captive portal)
          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: {
              get: (name) =>
                name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null
            },
            blob: async () =>
              new Blob(['<!DOCTYPE html><html><body>Error</body></html>'], { type: 'text/html' })
          });

          await assert.rejects(
            async () =>
              sw.executeDownload({
                url: 'https://v16-webapp-prime.tiktokcdn.com/blocked-html.mp4',
                author: 'user',
                videoId: '999'
              }),
            /Received HTML error page instead of video stream/,
            'Should reject HTML response'
          );

          assert.strictEqual(
            downloadCalls.length,
            0,
            'Must NOT trigger chrome.downloads.download when stream is HTML'
          );
        }
      );

      await testAsync(
        'executeDownload rejects when server returns HTTP 200 with XML error page (prevents corrupt .xml downloads)',
        async () => {
          const downloadCalls = [];
          global.chrome = {
            runtime: { lastError: null },
            downloads: {
              download: (opts, cb) => {
                downloadCalls.push(opts);
                cb(6666);
              }
            },
            storage: {
              local: {
                get: (keys, cb) => cb({}),
                set: (data, cb) => {
                  if (cb) cb();
                }
              }
            }
          };

          // Mock HTTP 200 returning XML error document (e.g. ByteDance CDN S3 error)
          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: {
              get: (name) => (name.toLowerCase() === 'content-type' ? 'text/xml' : null)
            },
            blob: async () =>
              new Blob(['<Error><Code>AccessDenied</Code></Error>'], { type: 'text/xml' })
          });

          await assert.rejects(
            async () =>
              sw.executeDownload({
                url: 'https://v16-webapp-prime.tiktokcdn.com/blocked-xml.mp4',
                author: 'user',
                videoId: '888'
              }),
            /Received XML error response instead of video stream/,
            'Should reject XML response'
          );

          assert.strictEqual(
            downloadCalls.length,
            0,
            'Must NOT trigger chrome.downloads.download when stream is XML'
          );
        }
      );

      await testAsync(
        'recordDownloadTelemetry persists downloadCount and recentDownloads history in chrome.storage.local',
        async () => {
          const storageStore = new Map();
          global.chrome = {
            storage: {
              local: {
                get: (keys, cb) => {
                  const res = {};
                  for (const k of keys) res[k] = storageStore.get(k);
                  cb(res);
                },
                set: (obj, cb) => {
                  for (const k of Object.keys(obj)) storageStore.set(k, obj[k]);
                  if (cb) cb();
                }
              }
            }
          };

          const res = await sw.recordDownloadTelemetry({
            author: 'khaby.lame',
            videoId: '7123456789012345678',
            filename: 'tiktok_@khaby.lame_7123456789012345678.mp4'
          });

          assert.strictEqual(res.success, true);
          assert.strictEqual(res.downloadCount, 1);
          assert.strictEqual(storageStore.get('downloadCount'), 1);
          const recent = storageStore.get('recentDownloads');
          assert.ok(Array.isArray(recent) && recent.length === 1);
          assert.strictEqual(recent[0].author, 'khaby.lame');
          assert.strictEqual(recent[0].videoId, '7123456789012345678');
          assert.strictEqual(recent[0].filename, 'tiktok_@khaby.lame_7123456789012345678.mp4');
          assert.ok(typeof recent[0].timestamp === 'number');
        }
      );

      await testAsync(
        'handleMessage routes RECORD_DOWNLOAD message and updates telemetry storage',
        async () => {
          const storageStore = new Map();
          storageStore.set('downloadCount', 5);
          storageStore.set('recentDownloads', [
            { author: 'prior', videoId: '1', filename: 'tiktok_@prior_1.mp4', timestamp: 1000 }
          ]);

          global.chrome = {
            storage: {
              local: {
                get: (keys, cb) => {
                  const res = {};
                  for (const k of keys) res[k] = storageStore.get(k);
                  cb(res);
                },
                set: (obj, cb) => {
                  for (const k of Object.keys(obj)) storageStore.set(k, obj[k]);
                  if (cb) cb();
                }
              }
            }
          };

          let responseData = null;
          const sendResponse = (res) => {
            responseData = res;
          };

          const handled = sw.handleMessage(
            {
              type: 'RECORD_DOWNLOAD',
              payload: {
                author: 'zachking',
                videoId: '8877665544',
                filename: 'tiktok_@zachking_8877665544.mp4'
              }
            },
            {},
            sendResponse
          );

          assert.strictEqual(handled, true, 'handleMessage must return true for async response');
          await new Promise((r) => setTimeout(r, 10));

          assert.ok(responseData && responseData.success === true);
          assert.strictEqual(responseData.downloadCount, 6);
          assert.strictEqual(storageStore.get('downloadCount'), 6);
          const recent = storageStore.get('recentDownloads');
          assert.strictEqual(recent.length, 2);
          assert.strictEqual(recent[0].author, 'zachking');
          assert.strictEqual(recent[0].videoId, '8877665544');
        }
      );

      await testAsync(
        'downloadStreamInPage fetches stream with credentials: include, triggers blob download via anchor click, and records telemetry',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const fetchCalls = [];
          const ipcCalls = [];
          const revokedUrls = [];
          let anchorClicked = null;
          let scheduledRevokeTimer = null;

          global.fetch = async (url, options) => {
            fetchCalls.push({ url, options });
            return {
              ok: true,
              status: 200,
              statusText: 'OK',
              headers: { get: () => 'video/mp4' },
              blob: async () => new Blob(['stream-binary-content'], { type: 'video/mp4' })
            };
          };

          const mockBody = new MockElement('body');
          global.document = {
            body: mockBody,
            documentElement: mockBody,
            createElement: (tag) => {
              const el = new MockElement(tag);
              if (tag.toLowerCase() === 'a') {
                el.click = () => {
                  el._clicked = true;
                  anchorClicked = el;
                };
              }
              return el;
            }
          };

          const originalCreateObjectURL = URL.createObjectURL;
          const originalRevokeObjectURL = URL.revokeObjectURL;
          const originalSetTimeout = global.setTimeout;

          URL.createObjectURL = (blob) => 'blob:https://www.tiktok.com/mock-uuid-1234';
          URL.revokeObjectURL = (url) => {
            revokedUrls.push(url);
          };

          global.setTimeout = (fn, delay) => {
            scheduledRevokeTimer = { fn, delay };
            return 99999;
          };

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                ipcCalls.push(msg);
                if (cb) cb({ success: true, downloadCount: 1 });
              }
            }
          };

          try {
            const result = await tiktok.downloadStreamInPage({
              url: 'https://v16-webapp-prime.tiktokcdn.com/stream-inpage.mp4',
              author: 'khaby.lame',
              videoId: '71234567890'
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.source, 'in_page');
            assert.strictEqual(result.filename, 'tiktok_@khaby.lame_71234567890.mp4');

            // Verify in-page fetch called with credentials: 'include'
            assert.strictEqual(fetchCalls.length, 1);
            assert.strictEqual(
              fetchCalls[0].url,
              'https://v16-webapp-prime.tiktokcdn.com/stream-inpage.mp4'
            );
            assert.strictEqual(
              fetchCalls[0].options.credentials,
              'include',
              'Must specify credentials: "include" to pass authentic TikTok session cookies'
            );

            // Verify programmatic anchor click
            assert.ok(anchorClicked !== null, 'Anchor tag must be clicked programmatically');
            assert.strictEqual(anchorClicked.href, 'blob:https://www.tiktok.com/mock-uuid-1234');
            assert.strictEqual(anchorClicked.download, 'tiktok_@khaby.lame_71234567890.mp4');

            // Verify RECORD_DOWNLOAD IPC dispatched to background service worker
            assert.strictEqual(ipcCalls.length, 1);
            assert.strictEqual(ipcCalls[0].type, 'RECORD_DOWNLOAD');
            assert.strictEqual(ipcCalls[0].payload.author, 'khaby.lame');
            assert.strictEqual(ipcCalls[0].payload.videoId, '71234567890');
            assert.strictEqual(ipcCalls[0].payload.filename, 'tiktok_@khaby.lame_71234567890.mp4');

            // Verify 15000ms URL.revokeObjectURL cleanup schedule (R1.5)
            assert.ok(scheduledRevokeTimer !== null, 'Revoke timeout must be scheduled');
            assert.strictEqual(
              scheduledRevokeTimer.delay,
              15000,
              'Revoke delay must be exactly 15000ms per R1.5'
            );
            scheduledRevokeTimer.fn();
            assert.strictEqual(
              revokedUrls.length,
              1,
              'URL.revokeObjectURL must be invoked on timer expiration'
            );
            assert.strictEqual(revokedUrls[0], 'blob:https://www.tiktok.com/mock-uuid-1234');
          } finally {
            URL.createObjectURL = originalCreateObjectURL;
            URL.revokeObjectURL = originalRevokeObjectURL;
            global.setTimeout = originalSetTimeout;
          }
        }
      );

      await testAsync(
        'downloadStreamInPage falls back to background DOWNLOAD_VIDEO when in-page stream fetch fails',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const ipcCalls = [];

          // In-page fetch fails with network error
          global.fetch = async () => {
            throw new Error('TypeError: Failed to fetch (CORS blocked in page)');
          };

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                ipcCalls.push(msg);
                if (msg.type === 'DOWNLOAD_VIDEO') {
                  cb({ success: true, filename: 'tiktok_@fallback_user_9999.mp4' });
                }
              }
            }
          };

          const result = await tiktok.downloadStreamInPage({
            url: 'https://v16-webapp-prime.tiktokcdn.com/fallback-stream.mp4',
            author: 'fallback_user',
            videoId: '9999'
          });

          assert.strictEqual(result.success, true);
          assert.strictEqual(result.source, 'background_fallback');
          assert.strictEqual(result.filename, 'tiktok_@fallback_user_9999.mp4');

          // Verify DOWNLOAD_VIDEO IPC fallback was dispatched
          assert.strictEqual(ipcCalls.length, 1);
          assert.strictEqual(ipcCalls[0].type, 'DOWNLOAD_VIDEO');
          assert.strictEqual(
            ipcCalls[0].payload.url,
            'https://v16-webapp-prime.tiktokcdn.com/fallback-stream.mp4'
          );
          assert.strictEqual(ipcCalls[0].payload.author, 'fallback_user');
          assert.strictEqual(ipcCalls[0].payload.videoId, '9999');
        }
      );

      await testAsync(
        'handleDownloadClick executes in-page download and transitions button to success state',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const { setButtonState, handleDownloadClick } = tiktok;

          let anchorClicked = null;
          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'video/mp4' },
            blob: async () => new Blob(['stream-data'], { type: 'video/mp4' })
          });

          const mockBody = new MockElement('body');
          global.document = {
            body: mockBody,
            documentElement: mockBody,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
            createElement: (tag) => {
              const el = new MockElement(tag);
              if (tag.toLowerCase() === 'a') {
                el.click = () => {
                  el._clicked = true;
                  anchorClicked = el;
                };
              }
              return el;
            }
          };

          const originalCreateObjectURL = URL.createObjectURL;
          URL.createObjectURL = () => 'blob:https://www.tiktok.com/stream-blob-ok';

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                if (cb) cb({ success: true });
              }
            }
          };

          try {
            const btn = new MockElement('button');
            btn.classList.add('tt-dl-btn');
            const iconBox = new MockElement('div');
            iconBox.classList.add('tt-dl-icon-box');
            btn.appendChild(iconBox);
            const label = new MockElement('strong');
            label.classList.add('tt-dl-label');
            const wrapper = new MockElement('div');
            wrapper.appendChild(btn);
            wrapper.appendChild(label);
            setButtonState(btn, 'idle');

            // Mock card with video element having src
            const card = new MockElement('div');
            card.setAttribute('data-e2e', 'feed-video');
            const video = new MockElement('video');
            video.setAttribute('src', 'https://v16-webapp-prime.tiktokcdn.com/video-src.mp4');
            video.currentSrc = 'https://v16-webapp-prime.tiktokcdn.com/video-src.mp4';
            card.appendChild(video);

            await handleDownloadClick(btn, card);

            assert.strictEqual(btn.getAttribute('data-state'), 'success');
            assert.ok(btn.classList.contains('tt-dl-state-success'));
            assert.ok(anchorClicked !== null, 'Anchor should have been clicked');
          } finally {
            URL.createObjectURL = originalCreateObjectURL;
          }
        }
      );

      await testAsync(
        'recordDownloadTelemetry handles null/undefined params and caps history at 50 entries',
        async () => {
          const storageStore = new Map();
          const existingHistory = [];
          for (let i = 0; i < 55; i++) {
            existingHistory.push({
              author: `user_${i}`,
              videoId: `vid_${i}`,
              filename: `tiktok_@user_${i}_vid_${i}.mp4`,
              timestamp: 1000 + i
            });
          }
          storageStore.set('downloadCount', 55);
          storageStore.set('recentDownloads', existingHistory);

          global.chrome = {
            storage: {
              local: {
                get: (keys, cb) => {
                  const res = {};
                  for (const k of keys) res[k] = storageStore.get(k);
                  cb(res);
                },
                set: (obj, cb) => {
                  for (const k of Object.keys(obj)) storageStore.set(k, obj[k]);
                  if (cb) cb();
                }
              }
            }
          };

          // 1. Verify null params doesn't crash and defaults safely
          const nullRes = await sw.recordDownloadTelemetry(null);
          assert.strictEqual(nullRes.success, true);
          assert.strictEqual(nullRes.downloadCount, 56);
          assert.strictEqual(storageStore.get('downloadCount'), 56);

          // Verify capped at 50 items
          const recent = storageStore.get('recentDownloads');
          assert.strictEqual(
            recent.length,
            50,
            'recentDownloads history must be capped at 50 items'
          );
          assert.strictEqual(recent[0].author, 'unknown');
        }
      );

      await testAsync('downloadStreamInPage rejects invalid or non-HTTP/HTTPS URLs', async () => {
        const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));

        await assert.rejects(
          () => tiktok.downloadStreamInPage(null),
          /Invalid or missing stream URL/
        );

        await assert.rejects(
          () => tiktok.downloadStreamInPage({}),
          /Invalid or missing stream URL/
        );

        await assert.rejects(
          () => tiktok.downloadStreamInPage({ url: 12345 }),
          /Invalid or missing stream URL/
        );

        await assert.rejects(
          () =>
            tiktok.downloadStreamInPage({
              url: 'ftp://bad.com/video.mp4',
              author: 'a',
              videoId: '1'
            }),
          /Stream URL must be an HTTP or HTTPS stream/
        );

        await assert.rejects(
          () =>
            tiktok.downloadStreamInPage({ url: 'javascript:alert(1)', author: 'a', videoId: '1' }),
          /Stream URL must be an HTTP or HTTPS stream/
        );
      });

      await testAsync(
        'downloadStreamInPage falls back to background DOWNLOAD_VIDEO on HTTP 403 Forbidden',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const ipcCalls = [];

          global.fetch = async () => ({
            ok: false,
            status: 403,
            statusText: 'Forbidden'
          });

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                ipcCalls.push(msg);
                if (msg.type === 'DOWNLOAD_VIDEO') {
                  cb({ success: true, filename: 'tiktok_@khaby_403fallback.mp4' });
                }
              }
            }
          };

          const result = await tiktok.downloadStreamInPage({
            url: 'https://v16-webapp-prime.tiktokcdn.com/forbidden-video.mp4',
            author: 'khaby',
            videoId: '403403'
          });

          assert.strictEqual(result.success, true);
          assert.strictEqual(result.source, 'background_fallback');
          assert.strictEqual(result.filename, 'tiktok_@khaby_403fallback.mp4');
          assert.strictEqual(ipcCalls.length, 1);
          assert.strictEqual(ipcCalls[0].type, 'DOWNLOAD_VIDEO');
          assert.strictEqual(
            ipcCalls[0].payload.url,
            'https://v16-webapp-prime.tiktokcdn.com/forbidden-video.mp4'
          );
        }
      );

      await testAsync(
        'downloadStreamInPage falls back on HTML error page or empty 0-byte stream',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const fallbackCalls = [];

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                if (msg.type === 'DOWNLOAD_VIDEO') {
                  fallbackCalls.push(msg);
                  cb({ success: true, filename: 'tiktok_@safe_fallback.mp4' });
                }
              }
            }
          };

          // Case A: HTTP 200 returning HTML error page
          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'text/html; charset=utf-8' },
            blob: async () => new Blob(['<html>Access Denied</html>'], { type: 'text/html' })
          });

          const resA = await tiktok.downloadStreamInPage({
            url: 'https://v16.tiktokcdn.com/html-error.mp4',
            author: 'user1',
            videoId: '101'
          });
          assert.strictEqual(resA.success, true);
          assert.strictEqual(resA.source, 'background_fallback');
          assert.strictEqual(fallbackCalls.length, 1);

          // Case B: HTTP 200 returning empty (0-byte) stream
          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'video/mp4' },
            blob: async () => new Blob([], { type: 'video/mp4' })
          });

          const resB = await tiktok.downloadStreamInPage({
            url: 'https://v16.tiktokcdn.com/empty-stream.mp4',
            author: 'user2',
            videoId: '102'
          });
          assert.strictEqual(resB.success, true);
          assert.strictEqual(resB.source, 'background_fallback');
          assert.strictEqual(fallbackCalls.length, 2);
        }
      );

      await testAsync(
        'downloadStreamInPage throws when both in-page fetch and background fallback fail',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));

          global.fetch = async () => {
            throw new Error('CORS blocked');
          };

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                if (msg.type === 'DOWNLOAD_VIDEO') {
                  cb({ success: false, error: 'Video stream fetch failed: HTTP 403 Forbidden' });
                }
              }
            }
          };

          await assert.rejects(
            () =>
              tiktok.downloadStreamInPage({
                url: 'https://v16.tiktokcdn.com/both-fail.mp4',
                author: 'user',
                videoId: '555'
              }),
            /Video stream fetch failed: HTTP 403 Forbidden/
          );
        }
      );

      await testAsync(
        'handleActiveVideoDownload executes in-page download and returns success with filename',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          let anchorClicked = null;

          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'video/mp4' },
            blob: async () => new Blob(['active-video-data'], { type: 'video/mp4' })
          });

          const mockBody = new MockElement('body');
          const activeVideo = new MockElement('video');
          activeVideo.currentSrc = 'https://v16-webapp-prime.tiktokcdn.com/active-video-play.mp4';
          activeVideo.paused = false;
          activeVideo.currentTime = 5.2;

          const videoCard = new MockElement('article');
          videoCard.appendChild(activeVideo);
          mockBody.appendChild(videoCard);

          global.document = {
            body: mockBody,
            documentElement: mockBody,
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
            querySelectorAll: (selector) => {
              if (selector === 'video') return [activeVideo];
              return [videoCard];
            },
            querySelector: (selector) => {
              if (selector === 'video') return activeVideo;
              return null;
            },
            createElement: (tag) => {
              const el = new MockElement(tag);
              if (tag.toLowerCase() === 'a') {
                el.click = () => {
                  el._clicked = true;
                  anchorClicked = el;
                };
              }
              return el;
            }
          };

          const originalWindow = global.window;
          global.window = {
            location: {
              pathname: '/@active_creator/video/9988776655',
              href: 'https://www.tiktok.com/@active_creator/video/9988776655'
            },
            innerHeight: 1080
          };

          const originalCreateObjectURL = URL.createObjectURL;
          URL.createObjectURL = () => 'blob:https://www.tiktok.com/active-blob-url';

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                if (cb) cb({ success: true });
              }
            }
          };

          try {
            const result = await tiktok.handleActiveVideoDownload();
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.filename, 'tiktok_@active_creator_9988776655.mp4');
            assert.ok(anchorClicked !== null, 'Anchor click should have been triggered');
            assert.strictEqual(anchorClicked.download, 'tiktok_@active_creator_9988776655.mp4');
          } finally {
            URL.createObjectURL = originalCreateObjectURL;
            global.window = originalWindow;
          }
        }
      );

      await testAsync(
        'downloadStreamInPage immediately revokes Object URL and removes anchor when click throws',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const revoked = [];
          let anchorCreated = null;

          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'video/mp4' },
            blob: async () => new Blob(['data'], { type: 'video/mp4' })
          });

          const mockBody = new MockElement('body');
          global.document = {
            body: mockBody,
            documentElement: mockBody,
            createElement: (tag) => {
              const el = new MockElement(tag);
              if (tag.toLowerCase() === 'a') {
                anchorCreated = el;
                el.click = () => {
                  throw new Error('Simulated DOMException: click rejected by browser security');
                };
              }
              return el;
            }
          };

          const originalCreateObjectURL = URL.createObjectURL;
          const originalRevokeObjectURL = URL.revokeObjectURL;
          URL.createObjectURL = () => 'blob:https://www.tiktok.com/leak-test-uuid';
          URL.revokeObjectURL = (url) => {
            revoked.push(url);
          };

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                if (msg.type === 'DOWNLOAD_VIDEO') {
                  cb({ success: true, filename: 'tiktok_@leak_fixed.mp4' });
                }
              }
            }
          };

          try {
            const result = await tiktok.downloadStreamInPage({
              url: 'https://v16.tiktokcdn.com/leak-test.mp4',
              author: 'leak_user',
              videoId: '123'
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.source, 'background_fallback');
            // Verify blobUrl was revoked immediately to prevent renderer memory leak
            assert.ok(
              revoked.includes('blob:https://www.tiktok.com/leak-test-uuid'),
              'Object URL must be revoked immediately upon anchor failure'
            );
            // Verify anchor was removed from DOM
            assert.strictEqual(
              mockBody.children.length,
              0,
              'Anchor element must be cleaned up from DOM via finally block'
            );
          } finally {
            URL.createObjectURL = originalCreateObjectURL;
            URL.revokeObjectURL = originalRevokeObjectURL;
          }
        }
      );

      await testAsync(
        'downloadStreamInPage falls back on XML error page (text/xml and application/xml)',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const fallbackCalls = [];

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                if (msg.type === 'DOWNLOAD_VIDEO') {
                  fallbackCalls.push(msg);
                  cb({ success: true, filename: 'tiktok_@xml_safe.mp4' });
                }
              }
            }
          };

          // Case A: text/xml
          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'text/xml' },
            blob: async () =>
              new Blob(['<Error><Code>AccessDenied</Code></Error>'], { type: 'text/xml' })
          });

          const resA = await tiktok.downloadStreamInPage({
            url: 'https://v16.tiktokcdn.com/access-denied.mp4',
            author: 'user_xml1',
            videoId: '777'
          });
          assert.strictEqual(resA.success, true);
          assert.strictEqual(resA.source, 'background_fallback');

          // Case B: application/xml
          global.fetch = async () => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'application/xml' },
            blob: async () =>
              new Blob(['<Error><Code>AccessDenied</Code></Error>'], { type: 'application/xml' })
          });

          const resB = await tiktok.downloadStreamInPage({
            url: 'https://v16.tiktokcdn.com/access-denied2.mp4',
            author: 'user_xml2',
            videoId: '888'
          });
          assert.strictEqual(resB.success, true);
          assert.strictEqual(resB.source, 'background_fallback');
          assert.strictEqual(fallbackCalls.length, 2);
        }
      );

      await testAsync(
        'executeDownload and downloadStreamInPage sanitize URL whitespace and support stream.id fallback',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          let anchorClicked = null;

          global.fetch = async (url) => ({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'video/mp4' },
            blob: async () => new Blob(['video-bytes'], { type: 'video/mp4' })
          });

          const mockBody = new MockElement('body');
          global.document = {
            body: mockBody,
            documentElement: mockBody,
            createElement: (tag) => {
              const el = new MockElement(tag);
              if (tag.toLowerCase() === 'a') {
                el.click = () => {
                  anchorClicked = el;
                };
              }
              return el;
            }
          };

          const originalCreateObjectURL = URL.createObjectURL;
          URL.createObjectURL = () => 'blob:https://www.tiktok.com/trimmed-test';

          global.chrome = {
            runtime: {
              lastError: null,
              sendMessage: (msg, cb) => {
                if (cb) cb({ success: true });
              }
            }
          };

          try {
            // stream.url has padding spaces, and uses id instead of videoId
            const result = await tiktok.downloadStreamInPage({
              url: '   https://v16.tiktokcdn.com/padded-url.mp4   ',
              author: 'spaced_user',
              id: '5432167890'
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.filename, 'tiktok_@spaced_user_5432167890.mp4');
            assert.ok(anchorClicked !== null);
            assert.strictEqual(anchorClicked.download, 'tiktok_@spaced_user_5432167890.mp4');
          } finally {
            URL.createObjectURL = originalCreateObjectURL;
          }
        }
      );

      await testAsync(
        'recordDownloadTelemetry handles string downloadCount and uses id fallback',
        async () => {
          const storageStore = new Map();
          storageStore.set('downloadCount', '99'); // string number in storage

          global.chrome = {
            runtime: { lastError: null },
            storage: {
              local: {
                get: (keys, cb) => {
                  const res = {};
                  for (const k of keys) res[k] = storageStore.get(k);
                  cb(res);
                },
                set: (obj, cb) => {
                  for (const k of Object.keys(obj)) storageStore.set(k, obj[k]);
                  if (cb) cb();
                }
              }
            }
          };

          const res = await sw.recordDownloadTelemetry({
            author: 'string_count_user',
            id: '12345678'
          });

          assert.strictEqual(res.success, true);
          assert.strictEqual(
            res.downloadCount,
            100,
            'Count must increment mathematically (99 + 1 = 100, not "991")'
          );
          assert.strictEqual(
            res.filename,
            'tiktok_@string_count_user_12345678.mp4',
            'Must use id fallback for filename'
          );

          const recent = storageStore.get('recentDownloads');
          assert.strictEqual(recent[0].videoId, '12345678');
          assert.strictEqual(recent[0].author, 'string_count_user');
        }
      );
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 8: Popup UI Markup, Controller Lifecycle & Active Video IPC Verification
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 8: Popup UI Markup, Controller Lifecycle & Active Video IPC Verification',
    async ({ test, testAsync }) => {
      const popupHtmlPath = path.join(PROJECT_ROOT, 'popup/popup.html');
      const popupCssPath = path.join(PROJECT_ROOT, 'popup/popup.css');
      const popupJsPath = path.join(PROJECT_ROOT, 'popup/popup.js');

      let popupHtml = '';
      let popupCss = '';

      test('popup/popup.html exists, is readable, and contains valid HTML5 doctype & metadata', () => {
        assert.ok(fs.existsSync(popupHtmlPath), 'popup.html must exist in popup/');
        popupHtml = fs.readFileSync(popupHtmlPath, 'utf8');
        assert.ok(popupHtml.length > 50, 'popup.html must not be empty');

        assert.ok(/<!DOCTYPE\s+html>/i.test(popupHtml), 'Must declare HTML5 DOCTYPE');
        assert.ok(/<meta\s+charset=["']?utf-8["']?/i.test(popupHtml), 'Must declare UTF-8 charset');
        assert.ok(/<meta\s+name=["']viewport["']/i.test(popupHtml), 'Must declare viewport meta');
        assert.ok(/<title>[^<]+<\/title>/i.test(popupHtml), 'Must contain non-empty title tag');
        assert.ok(
          /<link[^>]+rel=["']stylesheet["'][^>]+href=["'](\.\/)?popup\.css["']/i.test(popupHtml),
          'Must link popup.css'
        );
        assert.ok(
          /<script[^>]+src=["'](\.\/)?popup\.js["']/i.test(popupHtml),
          'Must link popup.js'
        );
      });

      test('popup/popup.html strictly conforms to HTML5 standards (uppercase DOCTYPE & no self-closing void elements)', () => {
        assert.ok(
          popupHtml.startsWith('<!DOCTYPE html>'),
          'DOCTYPE must strictly be uppercase <!DOCTYPE html>'
        );
        const selfClosingVoidRegex = /<(meta|link|input|img|br|hr)[^>]*\/>/i;
        assert.ok(
          !selfClosingVoidRegex.test(popupHtml),
          'HTML5 void elements (<meta>, <link>, <input>) must omit self-closing slashes'
        );
      });

      test('popup/popup.html contains essential element IDs required by R4 (btn-download-active, download-count, btn-open-downloads)', () => {
        const essentialIds = ['btn-download-active', 'download-count', 'btn-open-downloads'];
        for (const id of essentialIds) {
          const regex = new RegExp(`id=["']${id}["']`, 'i');
          assert.ok(regex.test(popupHtml), `popup.html must contain essential element id="${id}"`);
        }
      });

      test('popup/popup.html contains interactive context controls (status dot, feedback pill, and navigation buttons)', () => {
        const interactiveIds = [
          'btn-open-tiktok',
          'btn-open-bstation',
          'btn-open-jwplyr',
          'btn-open-youtube',
          'popup-status-msg',
          'status-dot',
          'btn-download-text',
          'state-youtube'
        ];
        for (const id of interactiveIds) {
          const regex = new RegExp(`id=["']${id}["']`, 'i');
          assert.ok(
            regex.test(popupHtml),
            `popup.html must contain interactive context element id="${id}"`
          );
        }
      });

      test('popup/popup.html strictly eliminates obsolete marketing checklists and bullet lists (R1 conformance)', () => {
        assert.ok(
          !popupHtml.includes('features-list'),
          'Must not contain features-list marketing class'
        );
        assert.ok(
          !popupHtml.includes('1-click video downloads'),
          'Must eliminate marketing bullet "1-click video downloads"'
        );
        assert.ok(
          !popupHtml.includes('NTFS clean filenames'),
          'Must eliminate marketing bullet "NTFS clean filenames"'
        );
        assert.ok(
          !popupHtml.includes('Zero third-party'),
          'Must eliminate marketing bullet "Zero third-party"'
        );
      });

      test('Strict HTML-Validate: popup/popup.html strictly satisfies W3C & html-validate standards with ZERO errors or warnings', () => {
        const result = lintHtmlStrict(popupHtml, 'popup/popup.html');
        const formattedErrors = result.errors
          .map((e) => `    • [Ln ${e.line}, Col ${e.col || 1}] (${e.rule}) ${e.message}`)
          .join('\n');
        assert.strictEqual(
          result.errors.length,
          0,
          `Strict HTML validation errors detected in popup/popup.html:\n${formattedErrors}`
        );
        assert.strictEqual(result.warnings.length, 0, 'No HTML validation warnings allowed');
      });

      test('Strict HTML-Validate: popup/popup.html contains ZERO unencoded raw characters (no-raw-characters)', () => {
        const result = lintHtmlStrict(popupHtml, 'popup/popup.html');
        const rawCharErrors = result.errors.filter((e) => e.rule === 'no-raw-characters');
        assert.strictEqual(
          rawCharErrors.length,
          0,
          `Raw unencoded character errors found in popup.html:\n${rawCharErrors.map((e) => `  [Ln ${e.line}] ${e.message}`).join('\n')}`
        );
      });

      test('Strict HTML-Validate: all <button> elements in popup/popup.html declare explicit type attributes (no-implicit-button-type)', () => {
        const result = lintHtmlStrict(popupHtml, 'popup/popup.html');
        const buttonTypeErrors = result.errors.filter((e) => e.rule === 'no-implicit-button-type');
        assert.strictEqual(
          buttonTypeErrors.length,
          0,
          `Implicit button type errors found in popup.html:\n${buttonTypeErrors.map((e) => `  [Ln ${e.line}] ${e.message}`).join('\n')}`
        );
      });

      test('Strict HTML-Validate Linter Self-Test: Harness reliably catches raw "&", implicit button types, duplicate IDs, unclosed tags, and inline handlers', () => {
        // 1. Catches raw ampersand
        const rawAmpSnippet =
          '<!DOCTYPE html><html><head><title>A & B</title></head><body></body></html>';
        const resAmp = lintHtmlStrict(rawAmpSnippet, 'test-raw-amp');
        assert.ok(
          resAmp.errors.some((e) => e.rule === 'no-raw-characters'),
          'Linter must detect raw unescaped "&" in text or title'
        );

        // 2. Catches implicit button type
        const implicitBtnSnippet =
          '<!DOCTYPE html><html><body><button class="primary">Click</button></body></html>';
        const resBtn = lintHtmlStrict(implicitBtnSnippet, 'test-implicit-btn');
        assert.ok(
          resBtn.errors.some((e) => e.rule === 'no-implicit-button-type'),
          'Linter must detect <button> lacking explicit type attribute'
        );

        // 3. Catches duplicate IDs
        const dupIdSnippet =
          '<!DOCTYPE html><html><body><div id="btn-run"></div><button type="button" id="btn-run">Go</button></body></html>';
        const resDup = lintHtmlStrict(dupIdSnippet, 'test-dup-id');
        assert.ok(
          resDup.errors.some((e) => e.rule === 'no-duplicate-id'),
          'Linter must detect duplicate element IDs'
        );

        // 4. Catches inline event handler
        const inlineHandlerSnippet =
          '<!DOCTYPE html><html><body><button type="button" onclick="doSomething()">Click</button></body></html>';
        const resInline = lintHtmlStrict(inlineHandlerSnippet, 'test-inline-handler');
        assert.ok(
          resInline.errors.some((e) => e.rule === 'no-inline-event-handlers'),
          'Linter must detect inline event handlers violating MV3 CSP'
        );

        // 5. Catches mismatched or unclosed tags
        const unclosedSnippet = '<!DOCTYPE html><html><body><div><span>Unclosed div</body></html>';
        const resUnclosed = lintHtmlStrict(unclosedSnippet, 'test-unclosed');
        assert.ok(
          resUnclosed.errors.some((e) => e.rule.startsWith('element-')),
          'Linter must detect unclosed/mismatched HTML tags'
        );
      });

      test('popup/popup.css specifies fixed 300px width, 12px border-radius, and Linear matte dark styling (R2 conformance)', () => {
        assert.ok(fs.existsSync(popupCssPath), 'popup.css must exist in popup/');
        popupCss = fs.readFileSync(popupCssPath, 'utf8');
        assert.ok(popupCss.length > 50, 'popup.css must not be empty');

        assert.ok(
          /width\s*:\s*300px/i.test(popupCss),
          'Must specify fixed 300px width for popup body'
        );
        assert.ok(/12px/i.test(popupCss), 'Must specify 12px border radius token or styling');
        assert.ok(
          /#0D0E11|#13151A/i.test(popupCss),
          'Must utilize matte dark palette (#0D0E11 / #13151A)'
        );
        assert.ok(/#1F222A/i.test(popupCss), 'Must define 1px hairline border color #1F222A');
        assert.ok(
          /0\.15s\s+ease/i.test(popupCss),
          'Must specify 0.15s ease transition for micro-interactions'
        );
      });

      test('popup/popup.js syntax check passes cleanly via node --check (R4 requirement 2)', () => {
        assert.ok(fs.existsSync(popupJsPath), 'popup.js must exist in popup/');
        const res = spawnSync(process.execPath, ['--check', popupJsPath], {
          encoding: 'utf8',
          windowsHide: true
        });
        assert.strictEqual(res.status, 0, `Syntax error in popup.js:\n${res.stderr}`);
        assert.strictEqual(res.stderr.trim(), '', 'stderr must be empty');
      });

      test('content/platforms/tiktok.js exports getActiveVideoInfo / handleGetActiveVideoInfo for IPC handling', () => {
        const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
        const fn = tiktok.getActiveVideoInfo || tiktok.handleGetActiveVideoInfo;
        assert.ok(
          typeof fn === 'function',
          'tiktok.js must export getActiveVideoInfo or handleGetActiveVideoInfo function'
        );
      });

      await testAsync(
        'getActiveVideoInfo extracts author and videoId when video is actively playing in DOM',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const fn = tiktok.getActiveVideoInfo || tiktok.handleGetActiveVideoInfo;

          // Mock DOM with active video card
          const mockCard = new MockElement('div');
          mockCard.setAttribute('data-e2e', 'feed-video');

          const authorSpan = new MockElement('span');
          authorSpan.setAttribute('data-e2e', 'video-author-uniqueid');
          authorSpan.textContent = '@creatorspotlight';
          mockCard.appendChild(authorSpan);

          const postLink = new MockElement('a');
          postLink.setAttribute(
            'href',
            'https://www.tiktok.com/@creatorspotlight/video/7345678901234567890'
          );
          mockCard.appendChild(postLink);

          const videoEl = new MockElement('video');
          videoEl.paused = false;
          videoEl.currentTime = 3.5;
          mockCard.appendChild(videoEl);

          const originalDoc = global.document;
          const originalWin = global.window;
          try {
            global.window = { innerHeight: 800 };
            global.document = {
              body: mockCard,
              documentElement: mockCard,
              querySelector: (sel) => mockCard.querySelector(sel),
              querySelectorAll: (sel) =>
                sel === 'video' ? [videoEl] : mockCard.querySelectorAll(sel)
            };

            const res = await fn();
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.ready, true);
            assert.strictEqual(res.author, 'creatorspotlight');
            assert.strictEqual(res.videoId, '7345678901234567890');
          } finally {
            global.document = originalDoc;
            global.window = originalWin;
          }
        }
      );

      await testAsync(
        'getActiveVideoInfo detects viewport-centered video card when playback is paused',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const fn = tiktok.getActiveVideoInfo || tiktok.handleGetActiveVideoInfo;

          const card1 = new MockElement('div');
          card1.setAttribute('data-e2e', 'feed-video');
          card1.getBoundingClientRect = () => ({ top: -400, height: 600 }); // center: -100

          const card2 = new MockElement('div');
          card2.setAttribute('data-e2e', 'feed-video');
          card2.getBoundingClientRect = () => ({ top: 100, height: 600 }); // center: 400 (matches innerHeight/2 = 400)
          const author2 = new MockElement('span');
          author2.setAttribute('data-e2e', 'video-author-uniqueid');
          author2.textContent = '@centered_artist';
          card2.appendChild(author2);
          const link2 = new MockElement('a');
          link2.setAttribute(
            'href',
            'https://www.tiktok.com/@centered_artist/video/7456789012345678901'
          );
          card2.appendChild(link2);

          const originalDoc = global.document;
          const originalWin = global.window;
          try {
            global.window = { innerHeight: 800 };
            global.document = {
              querySelectorAll: (sel) => {
                if (sel === 'video') return [{ paused: true, currentTime: 0 }];
                if (sel.includes('feed-video') || sel.includes(tiktok.SELECTORS.videoCards))
                  return [card1, card2];
                return [];
              },
              querySelector: () => null,
              body: new MockElement('body')
            };

            const res = await fn();
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.ready, true);
            assert.strictEqual(res.author, 'centered_artist');
            assert.strictEqual(res.videoId, '7456789012345678901');
          } finally {
            global.document = originalDoc;
            global.window = originalWin;
          }
        }
      );

      await testAsync(
        'getActiveVideoInfo handles empty page or loading state gracefully without throwing',
        async () => {
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
          const fn = tiktok.getActiveVideoInfo || tiktok.handleGetActiveVideoInfo;

          const originalDoc = global.document;
          const originalWin = global.window;
          try {
            global.window = undefined;
            global.document = {
              querySelectorAll: () => [],
              querySelector: () => null,
              body: new MockElement('body')
            };

            const res = await fn();
            assert.strictEqual(res.ready, false, 'ready must be false on empty DOM');
            assert.strictEqual(res.author, '', 'author must be empty string');
            assert.strictEqual(res.videoId, '', 'videoId must be empty string');
          } finally {
            global.document = originalDoc;
            global.window = originalWin;
          }
        }
      );

      await testAsync(
        'Runtime message listener in tiktok.js dispatches GET_ACTIVE_VIDEO_INFO asynchronously',
        async () => {
          let registeredListener = null;
          const originalChrome = global.chrome;
          global.chrome = {
            runtime: {
              onMessage: {
                addListener: (cb) => {
                  registeredListener = cb;
                }
              }
            }
          };

          // Invalidate require cache and re-require tiktok.js to register listener
          delete require.cache[
            require.resolve(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'))
          ];
          const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));

          assert.ok(typeof registeredListener === 'function', 'Listener must be registered');

          let responseSent = null;
          const sendResponse = (res) => {
            responseSent = res;
          };

          const isAsync = registeredListener({ type: 'GET_ACTIVE_VIDEO_INFO' }, {}, sendResponse);
          assert.strictEqual(
            isAsync,
            true,
            'Message listener must return true for asynchronous IPC handling'
          );

          // Allow microtask tick
          await new Promise((r) => setTimeout(r, 50));
          assert.ok(responseSent !== null, 'sendResponse must be invoked');
          assert.strictEqual(typeof responseSent.success, 'boolean');
          assert.strictEqual(typeof responseSent.ready, 'boolean');

          global.chrome = originalChrome;
        }
      );

      test('MockElement supports ID querying via getElementById and #id querySelector', () => {
        const container = new MockElement('div');
        const btn = new MockElement('button');
        btn.id = 'btn-download-active';
        container.appendChild(btn);

        assert.strictEqual(container.getElementById('btn-download-active'), btn);
        assert.strictEqual(container.querySelector('#btn-download-active'), btn);
      });

      test('parseDomVideoInfo extracts author handle, nickname, caption, and duration from card container', () => {
        const tiktok = require(path.join(PROJECT_ROOT, 'content/platforms/tiktok.js'));
        const card = new MockElement('div');
        card.setAttribute('data-e2e', 'recommend-list-item-container');

        const authorLink = new MockElement('a');
        authorLink.setAttribute('href', 'https://www.tiktok.com/@qwangs');
        card.appendChild(authorLink);

        const nickSpan = new MockElement('h4');
        nickSpan.setAttribute('data-e2e', 'browse-username');
        nickSpan.textContent = 'Qwangs™';
        card.appendChild(nickSpan);

        const descP = new MockElement('p');
        descP.setAttribute('data-e2e', 'video-desc');
        descP.textContent = 'Small but mighty. This is one of the most impossible inventions.';
        card.appendChild(descP);

        const video = new MockElement('video');
        video.duration = 18.5;
        card.appendChild(video);

        const info = tiktok.parseDomVideoInfo(card);
        assert.strictEqual(info.author, 'qwangs', 'Must extract clean author handle from href');
        assert.strictEqual(info.nickname, 'Qwangs™', 'Must extract creator display nickname');
        assert.strictEqual(
          info.description,
          'Small but mighty. This is one of the most impossible inventions.'
        );
        assert.strictEqual(info.duration, 18.5);
      });

      test('tiktok_bridge resolves stream by description/caption matching without videoId', () => {
        const bridge = require(path.join(PROJECT_ROOT, 'content/injected/tiktok_bridge.js'));
        const { videoCache, cacheItem } = bridge;

        // Seed cache with 2 different videos
        const videoA = {
          videoId: '7693152180563479830',
          author: 'ug.wav',
          nickname: 'UG Wave',
          description: 'Random background music beats',
          playUrl: 'https://cdn.tiktok.com/stream_ug.mp4',
          downloadUrl: 'https://cdn.tiktok.com/stream_ug.mp4',
          duration: 12.0
        };

        const videoB = {
          videoId: '7481234567890123456',
          author: 'qwangs',
          nickname: 'Qwangs™',
          description: 'Small but mighty. This is one of the most impossible inventions.',
          playUrl: 'https://cdn.tiktok.com/stream_qwangs.mp4',
          downloadUrl: 'https://cdn.tiktok.com/stream_qwangs.mp4',
          duration: 18.5
        };

        cacheItem(videoA);
        cacheItem(videoB);

        // Verify that description snippet matches videoB exactly instead of picking videoA
        const snippet = 'small but mighty this is one of';
        let found = null;
        for (const it of videoCache.values()) {
          const d = (it.description || '').toLowerCase();
          if (d.includes('small but mighty')) {
            found = it;
            break;
          }
        }

        assert.ok(found !== null, 'Item must be resolved by caption snippet');
        assert.strictEqual(found.author, 'qwangs');
        assert.strictEqual(found.videoId, '7481234567890123456');
        assert.strictEqual(found.playUrl, 'https://cdn.tiktok.com/stream_qwangs.mp4');
      });

      test('tiktok_bridge rejects arbitrary recent_cache fallback when no video matches', () => {
        const bridge = require(path.join(PROJECT_ROOT, 'content/injected/tiktok_bridge.js'));
        const { videoCache } = bridge;

        // Ensure that an unmatched query with completely unrelated author and ID does not return the last cached item
        const queryId = '9999999999999999999';
        const cleanAuthor = 'nonexistent_user';
        assert.strictEqual(videoCache.has(queryId), false);
      });

      test('extractFromUniversalData strictly returns null when videoId and author do not match on FYP feed', () => {
        const bridge = require(path.join(PROJECT_ROOT, 'content/injected/tiktok_bridge.js'));
        const { extractFromUniversalData } = bridge;

        global.window = {
          location: { pathname: '/foryou' },
          __UNIVERSAL_DATA_FOR_REHYDRATION__: {
            __DEFAULT_SCOPE__: {
              'webapp.video-detail': {
                itemInfo: {
                  itemStruct: {
                    id: '7100000000000000001',
                    desc: 'Initial SSR video zas860',
                    author: { uniqueId: 'zas860', nickname: 'ZAS 860' },
                    video: { playAddr: 'https://cdn.tiktok.com/zas860.mp4' }
                  }
                }
              }
            }
          }
        };

        // When query is for a different video on FYP feed without ID or matching author
        const resUnmatched = extractFromUniversalData(null, 'youngblack');
        assert.strictEqual(resUnmatched, null, 'Must NOT return zas860 when author is youngblack');

        const resEmpty = extractFromUniversalData(null, null);
        assert.strictEqual(
          resEmpty,
          null,
          'Must NOT return zas860 when both ID and author are null on FYP feed'
        );

        // But when targetId matches, it should resolve
        const resMatched = extractFromUniversalData('7100000000000000001', null);
        assert.ok(resMatched !== null);
        assert.strictEqual(resMatched.data.author, 'zas860');
      });

      test('extractFromReactFiber resolves item from nested player child or video component props', () => {
        const bridge = require(path.join(PROJECT_ROOT, 'content/injected/tiktok_bridge.js'));
        const { extractFromReactFiber, cacheItem, videoCache } = bridge;

        // Seed cache with youngblack's video
        const targetVideo = {
          videoId: '7456789012345678901',
          author: 'youngblack',
          nickname: 'YB 🥶',
          description: 'lfs come to campus only to do this #relatable #viral #uni',
          playUrl: 'https://cdn.tiktok.com/stream_youngblack.mp4',
          downloadUrl: 'https://cdn.tiktok.com/stream_youngblack.mp4',
          duration: 6.2
        };
        cacheItem(targetVideo);

        // Create a mock card container with a nested video child
        const mockCard = new MockElement('div');
        const mockVideo = new MockElement('video');
        mockCard.children.push(mockVideo);
        mockVideo.parentElement = mockCard;

        // Attach React Fiber to the video child element
        mockVideo['__reactProps$abc'] = {
          id: '7456789012345678901'
        };

        const resolved = extractFromReactFiber(mockCard);
        assert.ok(resolved !== null, 'extractFromReactFiber must resolve from child video element');
        assert.strictEqual(resolved.videoId, '7456789012345678901');
        assert.strictEqual(resolved.author, 'youngblack');
        assert.strictEqual(resolved.nickname, 'YB 🥶');
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 9: Manifest V3 Multi-Platform Registration (Bstation & TikTok)
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 9: Manifest V3 Multi-Platform Registration (Bstation & TikTok)',
    ({ test }) => {
      const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      test('Manifest host_permissions includes bilibili.tv, bstation.tv, and biliapi.net', () => {
        assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
        assert.ok(
          manifest.host_permissions.includes('*://*.bilibili.tv/*'),
          'must include bilibili.tv host permission'
        );
        assert.ok(
          manifest.host_permissions.includes('*://*.bstation.tv/*'),
          'must include bstation.tv host permission'
        );
        assert.ok(
          manifest.host_permissions.includes('*://*.biliapi.net/*'),
          'must include biliapi.net host permission'
        );
      });

      test('Manifest registers Bstation MAIN world bridge at document_start', () => {
        const bsBridge = manifest.content_scripts.find(
          (s) =>
            s.world === 'MAIN' &&
            Array.isArray(s.js) &&
            s.js.includes('content/injected/bstation_bridge.js')
        );
        assert.ok(bsBridge, 'Bstation MAIN world bridge entry must exist in content_scripts');
        assert.strictEqual(
          bsBridge.run_at,
          'document_start',
          'Bstation bridge must run at document_start'
        );
        assert.ok(bsBridge.matches.includes('*://*.bilibili.tv/*'), 'must match bilibili.tv');
        assert.ok(bsBridge.matches.includes('*://*.bstation.tv/*'), 'must match bstation.tv');
      });

      test('Manifest registers Bstation ISOLATED world platform UI and CSS at document_idle', () => {
        const bsPlatform = manifest.content_scripts.find(
          (s) =>
            (!s.world || s.world === 'ISOLATED') &&
            Array.isArray(s.js) &&
            s.js.includes('content/platforms/bstation.js')
        );
        assert.ok(
          bsPlatform,
          'Bstation ISOLATED world platform entry must exist in content_scripts'
        );
        assert.strictEqual(
          bsPlatform.run_at,
          'document_idle',
          'Bstation platform must run at document_idle'
        );
        assert.ok(
          Array.isArray(bsPlatform.css) && bsPlatform.css.includes('content/styles/bstation.css'),
          'must register bstation.css'
        );
        assert.ok(bsPlatform.matches.includes('*://*.bilibili.tv/*'), 'must match bilibili.tv');
        assert.ok(bsPlatform.matches.includes('*://*.bstation.tv/*'), 'must match bstation.tv');
      });

      test('Manifest web_accessible_resources exposes bstation_bridge.js', () => {
        const bsResource = manifest.web_accessible_resources.find(
          (r) =>
            Array.isArray(r.resources) &&
            r.resources.includes('content/injected/bstation_bridge.js')
        );
        assert.ok(bsResource, 'web_accessible_resources must expose bstation_bridge.js');
        assert.ok(bsResource.matches.includes('*://*.bilibili.tv/*'), 'must match bilibili.tv');
        assert.ok(bsResource.matches.includes('*://*.bstation.tv/*'), 'must match bstation.tv');
      });

      test('All registered Bstation scripts and stylesheets exist on disk with valid size and syntax', () => {
        const bstationFiles = [
          'content/injected/bstation_bridge.js',
          'content/platforms/bstation.js',
          'content/styles/bstation.css'
        ];

        for (const relPath of bstationFiles) {
          const fullPath = path.join(PROJECT_ROOT, relPath);
          assert.ok(fs.existsSync(fullPath), `Bstation asset missing: ${relPath}`);
          const stat = fs.statSync(fullPath);
          assert.ok(stat.size > 0, `Bstation asset must not be empty: ${relPath}`);
        }

        for (const relPath of [
          'content/injected/bstation_bridge.js',
          'content/platforms/bstation.js'
        ]) {
          const fullPath = path.join(PROJECT_ROOT, relPath);
          const res = spawnSync(process.execPath, ['--check', fullPath], {
            encoding: 'utf8',
            windowsHide: true
          });
          assert.strictEqual(res.status, 0, `Syntax error in ${relPath}:\n${res.stderr}`);
        }
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 10: Bstation Windows NTFS Filename Sanitization Unit & Boundary Tests
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 10: Bstation Windows NTFS Filename Sanitization Unit & Boundary Tests',
    ({ test }) => {
      const sw = require(path.join(PROJECT_ROOT, 'background/service_worker.js'));
      const { sanitizeBstationTitle, formatBstationEpisode, formatBstationFilename } = sw;

      assert.ok(
        typeof sanitizeBstationTitle === 'function',
        'sanitizeBstationTitle must be exported'
      );
      assert.ok(
        typeof formatBstationEpisode === 'function',
        'formatBstationEpisode must be exported'
      );
      assert.ok(
        typeof formatBstationFilename === 'function',
        'formatBstationFilename must be exported'
      );

      const BS_NTFS_REGEX = /^\[[^\\/:*?"<>|\x00-\x1f\x7f-\x9f]+\] - E\d+ \[[a-z0-9+]+\]\.mp4$/;

      test('Standard Clean Anime Title and numeric Episode: [Frieren Beyond Journeys End] - E01 [1080p].mp4', () => {
        const res = formatBstationFilename({
          title: 'Frieren Beyond Journeys End',
          episode: 1,
          quality: '1080p'
        });
        assert.strictEqual(res, '[Frieren Beyond Journeys End] - E01 [1080p].mp4');
        assert.ok(BS_NTFS_REGEX.test(res));
      });

      test('Win32 Illegal Characters in Anime Titles (Re:Zero / S02? "Hero"* <Arc|5>) stripped cleanly', () => {
        const res = formatBstationFilename({
          title: 'Re:Zero / S02? "Hero"* <Arc|5>',
          episode: 2,
          quality: '720p'
        });
        assert.ok(
          !/[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/.test(res),
          'Filename must not contain illegal Win32 chars'
        );
        assert.ok(BS_NTFS_REGEX.test(res));
        assert.ok(res.includes('Re - Zero'), 'Colon must be normalized cleanly');
      });

      test('Win32 Control Characters (0x00-0x1F, 0x7F-0x9F) eliminated', () => {
        const titleWithControl = 'Attack\x00on\x07Titan\x1F\x7F';
        const clean = sanitizeBstationTitle(titleWithControl);
        assert.ok(
          !/[\x00-\x1f\x7f-\x9f]/.test(clean),
          'Must eliminate all Win32 ASCII control codes'
        );
        assert.strictEqual(clean, 'AttackonTitan');
      });

      test('Episode Number Normalization (1 -> E01, "05" -> E05, "Episode 14" -> E14)', () => {
        assert.strictEqual(formatBstationEpisode(1), 'E01');
        assert.strictEqual(formatBstationEpisode(9), 'E09');
        assert.strictEqual(formatBstationEpisode('05'), 'E05');
        assert.strictEqual(formatBstationEpisode('Episode 14'), 'E14');
        assert.strictEqual(formatBstationEpisode('E12'), 'E12');
        assert.strictEqual(formatBstationEpisode(105), 'E105');
      });

      test('Quality Normalization ("1080P" -> [1080p], "720p" -> [720p], null fallback to [720p])', () => {
        const res1080 = formatBstationFilename('Demon Slayer', 1, '1080P');
        assert.ok(res1080.includes('[1080p].mp4'));

        const resDefault = formatBstationFilename('Demon Slayer', 1, null);
        assert.ok(resDefault.includes('[720p].mp4'));

        const resClean = formatBstationFilename('Demon Slayer', 1, '480p');
        assert.ok(resClean.includes('[480p].mp4'));
      });

      test('Unicode, Japanese Kanji, Indonesian accents preserved ([葬送のフリーレン] - E02 [1080p].mp4)', () => {
        const resKanji = formatBstationFilename('葬送のフリーレン', 2, '1080p');
        assert.strictEqual(resKanji, '[葬送のフリーレン] - E02 [1080p].mp4');
        assert.ok(BS_NTFS_REGEX.test(resKanji));
      });

      test('Win32 Trailing Dots and Spaces Trimming (no ..mp4 or . .mp4)', () => {
        const res = formatBstationFilename('Spy x Family... ', 3, '720p');
        assert.strictEqual(res, '[Spy x Family] - E03 [720p].mp4');
        assert.ok(!res.includes('..mp4'));
        assert.ok(!res.includes('. .mp4'));
      });

      test('Null, undefined, and empty string fallbacks ([Anime] - E01 [720p].mp4)', () => {
        assert.strictEqual(formatBstationFilename(null, null, null), '[Anime] - E01 [720p].mp4');
        assert.strictEqual(formatBstationFilename('', '', ''), '[Anime] - E01 [720p].mp4');
        assert.strictEqual(
          formatBstationFilename({}, undefined, undefined),
          '[Anime] - E01 [720p].mp4'
        );
      });

      test('Extreme Title Length Boundary Value Analysis (truncated to <= 120 chars, total filename < 255)', () => {
        const longTitle = 'That Time I Got Reincarnated as a Slime '.repeat(10);
        const res = formatBstationFilename(longTitle, 1, '720p');
        assert.ok(
          res.length < 240,
          `Filename length ${res.length} must be well below Win32 MAX_PATH (255)`
        );
        assert.ok(BS_NTFS_REGEX.test(res));
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 11: Episode Batch Queue, VIP Filtering & Concurrency 2 Scheduler Simulation
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 11: Episode Batch Queue, VIP Filtering & Concurrency 2 Scheduler Simulation',
    async ({ test, testAsync }) => {
      const bstationScript = require(path.join(PROJECT_ROOT, 'content/platforms/bstation.js'));
      const bstationBridge = require(
        path.join(PROJECT_ROOT, 'content/injected/bstation_bridge.js')
      );
      const { DirectParallelQueue, collectEpisodesList, extractNumericEpId } = bstationScript;

      test('Free vs VIP Episode Filtering: non-VIP user has VIP episodes marked [VIP Diperlukan] and disabled', () => {
        const mockDoc = new MockElement('body');
        for (let i = 1; i <= 6; i++) {
          const item = new MockElement('div');
          item.setAttribute('class', 'bstar-episode-item');
          item.setAttribute('data-ep-id', `ep_${i}`);
          item.textContent = `Episode ${i}`;
          if (i > 3) {
            const badge = new MockElement('span');
            badge.setAttribute('class', 'bstar-vip-badge');
            badge.textContent = 'VIP';
            item.appendChild(badge);
          }
          mockDoc.appendChild(item);
        }

        const originalDoc = global.document;
        const originalWin = global.window;
        try {
          global.document = {
            querySelectorAll: (sel) => mockDoc.querySelectorAll(sel),
            querySelector: (sel) => mockDoc.querySelector(sel),
            title: 'Anime Title'
          };
          global.window = {
            __INITIAL_STATE__: {
              user: { vip: { is_vip: false } }
            }
          };

          const res = collectEpisodesList();
          assert.strictEqual(res.isUserVip, false);
          assert.strictEqual(res.episodes.length, 6);
          assert.strictEqual(res.episodes[0].isVip, false, 'Ep 1 must be free');
          assert.strictEqual(res.episodes[3].isVip, true, 'Ep 4 must be VIP');
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      test('VIP user has all episodes enabled and selectable', () => {
        const mockDoc = new MockElement('body');
        for (let i = 1; i <= 4; i++) {
          const item = new MockElement('div');
          item.setAttribute('class', 'bstar-episode-item');
          item.setAttribute('data-ep-id', `ep_${i}`);
          item.textContent = `Episode ${i}`;
          if (i > 2) {
            const badge = new MockElement('span');
            badge.setAttribute('class', 'bstar-vip-badge');
            badge.textContent = 'VIP';
            item.appendChild(badge);
          }
          mockDoc.appendChild(item);
        }

        const originalDoc = global.document;
        const originalWin = global.window;
        try {
          global.document = {
            querySelectorAll: (sel) => mockDoc.querySelectorAll(sel),
            querySelector: (sel) => mockDoc.querySelector(sel),
            title: 'Anime Title'
          };
          global.window = {
            __INITIAL_STATE__: {
              user: { vip: { is_vip: true, status: 1 } }
            }
          };

          const res = collectEpisodesList();
          assert.strictEqual(res.isUserVip, true, 'User VIP status must be true');
          assert.strictEqual(res.episodes.length, 4);
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      test('Quick-action pills logic: [Pilih Semua], [Hanya Episode Gratis], [Kosongkan]', () => {
        const cards = [];
        for (let i = 1; i <= 6; i++) {
          const card = new MockElement('div');
          const isVip = i > 3;
          card.setAttribute('data-vip', String(isVip));
          const cb = new MockElement('input');
          cb.type = 'checkbox';
          cb.disabled = isVip; // Non-VIP user: VIP items disabled
          cb.checked = false;
          card.appendChild(cb);
          cards.push({ card, cb, isVip });
        }

        // Simulate [Pilih Semua]
        for (const { cb } of cards) {
          if (!cb.disabled) cb.checked = true;
        }
        assert.strictEqual(
          cards.filter((c) => c.cb.checked).length,
          3,
          'Pilih Semua selects 3 free episodes'
        );

        // Simulate [Kosongkan]
        for (const { cb } of cards) {
          cb.checked = false;
        }
        assert.strictEqual(
          cards.filter((c) => c.cb.checked).length,
          0,
          'Kosongkan unchecks all episodes'
        );

        // Simulate [Hanya Episode Gratis]
        for (const { cb, isVip } of cards) {
          if (!isVip && !cb.disabled) cb.checked = true;
          else cb.checked = false;
        }
        assert.strictEqual(
          cards.filter((c) => c.cb.checked).length,
          3,
          'Hanya Episode Gratis selects only non-VIP episodes'
        );
      });

      test('Ghost 40 episodes prevention: strictly scopes DOM to episode container and rejects 38 sidebar recommendations', () => {
        const mockDoc = new MockElement('body');

        // Real anime with only 2 episodes in .bstar-episode-list
        const epContainer = new MockElement('div');
        epContainer.setAttribute('class', 'bstar-episode-list');

        for (let i = 1; i <= 2; i++) {
          const item = new MockElement('div');
          item.setAttribute('class', 'bstar-episode-item');
          item.setAttribute('data-ep-id', `real_ep_${i}`);
          item.textContent = `EP 0${i}`;
          epContainer.appendChild(item);
        }
        mockDoc.appendChild(epContainer);

        // 38 recommended cards in sidebar
        const aside = new MockElement('aside');
        aside.setAttribute('class', 'bstar-recommend');
        for (let j = 1; j <= 38; j++) {
          const card = new MockElement('a');
          card.setAttribute('class', 'recommend-video-card');
          card.setAttribute('href', `/id/play/209999/ep_${j}`);
          card.textContent = `Other Anime Show Episode ${j} with long title description`;
          aside.appendChild(card);
        }
        mockDoc.appendChild(aside);

        const originalDoc = global.document;
        const originalWin = global.window;
        try {
          global.document = {
            querySelectorAll: (sel) => mockDoc.querySelectorAll(sel),
            querySelector: (sel) => mockDoc.querySelector(sel),
            title: 'The Laid-Off Cheat-Granting Mage - Bilibili'
          };
          global.window = {};

          const res = collectEpisodesList();
          assert.strictEqual(
            res.episodes.length,
            2,
            'Must detect EXACTLY 2 episodes and reject 38 recommendations'
          );
          assert.strictEqual(res.episodes[0].epId, 'real_ep_1');
          assert.strictEqual(res.episodes[1].epId, 'real_ep_2');
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      test('Server-authoritative episode extraction: __BS_SERIES_INFO__ DOM bridge mirror returns exact 2 episodes', () => {
        const mockDoc = new MockElement('body');
        const bridgeScript = new MockElement('script');
        bridgeScript.setAttribute('id', '__BS_SERIES_INFO__');
        bridgeScript.textContent = JSON.stringify({
          seriesTitle: 'The Laid-Off Cheat-Granting Mage',
          isUserVip: false,
          episodes: [
            {
              id: '11252037',
              epId: '11252037',
              index: 1,
              title: 'Episode 1',
              short_title: '01',
              isVip: false
            },
            {
              id: '11252038',
              epId: '11252038',
              index: 2,
              title: 'Episode 2',
              short_title: '02',
              isVip: false
            }
          ]
        });
        mockDoc.appendChild(bridgeScript);

        const originalDoc = global.document;
        const originalWin = global.window;
        try {
          global.document = {
            getElementById: (id) => mockDoc.getElementById(id),
            querySelector: (sel) => mockDoc.querySelector(sel),
            querySelectorAll: (sel) => mockDoc.querySelectorAll(sel),
            title: 'The Laid-Off Cheat-Granting Mage'
          };
          global.window = {};

          const res = collectEpisodesList();
          assert.strictEqual(
            res.episodes.length,
            2,
            '__BS_SERIES_INFO__ should guarantee exactly 2 episodes'
          );
          assert.strictEqual(res.animeTitle, 'The Laid-Off Cheat-Granting Mage');
          assert.strictEqual(res.episodes[0].id, '11252037');
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      test('URL episode ID extraction: getActiveVideoInfo extracts episode ID from path /play/:season/:ep or search query', () => {
        const originalDoc = global.document;
        const originalWin = global.window;
        const { getActiveVideoInfo } = bstationScript;

        try {
          global.document = {
            querySelector: () => null,
            title: 'Anime Title'
          };
          global.window = {
            location: {
              pathname: '/id/play/1048837/11252037',
              search: ''
            }
          };

          const info = getActiveVideoInfo();
          assert.strictEqual(
            info.episodeId,
            '11252037',
            'Must extract 11252037 from /play/1048837/11252037'
          );

          global.window.location = {
            pathname: '/play/detail',
            search: '?ep_id=98765'
          };
          const info2 = getActiveVideoInfo();
          assert.strictEqual(info2.episodeId, '98765', 'Must extract 98765 from ?ep_id=98765');
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      test('extractNumericEpId extracts Bstation authentic numeric IDs from hrefs and data attributes', () => {
        // 1. Element with standard Bstation link href
        const linkEl = new MockElement('a');
        linkEl.setAttribute(
          'href',
          'https://www.bilibili.tv/id/play/2411889/30639810?bstar_from=bstar-web.pgc-video-detail.episode.all'
        );
        assert.strictEqual(
          extractNumericEpId(linkEl),
          '30639810',
          'Must extract 30639810 from full Bstation episode URL'
        );

        // 2. Container wrapping an anchor element
        const wrapperEl = new MockElement('div');
        const childLink = new MockElement('a');
        childLink.setAttribute('href', '/id/play/2411889/30639811');
        wrapperEl.appendChild(childLink);
        assert.strictEqual(
          extractNumericEpId(wrapperEl),
          '30639811',
          'Must extract 30639811 from child link'
        );

        // 3. Link with query parameter ?ep_id=...
        const queryLink = new MockElement('a');
        queryLink.setAttribute('href', '/play/detail?ep_id=30639812&bstar_from=ep');
        assert.strictEqual(
          extractNumericEpId(queryLink),
          '30639812',
          'Must extract 30639812 from query string'
        );

        // 4. Fallback to numeric data-ep-id
        const dataEl = new MockElement('div');
        dataEl.setAttribute('data-ep-id', '30639813');
        assert.strictEqual(
          extractNumericEpId(dataEl),
          '30639813',
          'Must extract from numeric data-ep-id'
        );

        // 5. Element inside an anchor (ancestor anchor element.closest)
        const parentLink = new MockElement('a');
        parentLink.setAttribute('href', 'https://www.bilibili.tv/id/play/1092892/30639814');
        const innerCard = new MockElement('div');
        innerCard.setAttribute('class', 'bstar-episode-item');
        parentLink.appendChild(innerCard);
        assert.strictEqual(
          extractNumericEpId(innerCard),
          '30639814',
          'Must extract 30639814 from ancestor anchor'
        );
      });

      test('Single-segment season URL (/play/2411889): getActiveVideoInfo resolves episode 1 numeric ID from active DOM node', () => {
        const mockDoc = new MockElement('body');
        const epContainer = new MockElement('div');
        epContainer.setAttribute('class', 'bstar-episode-list');

        // Active episode 1 link
        const ep1 = new MockElement('a');
        ep1.setAttribute('class', 'bstar-episode-item bstar-episode-item--active');
        ep1.setAttribute(
          'href',
          'https://www.bilibili.tv/id/play/2411889/30639810?bstar_from=detail'
        );
        ep1.textContent = 'E1';
        epContainer.appendChild(ep1);

        // Episode 2 link
        const ep2 = new MockElement('a');
        ep2.setAttribute('class', 'bstar-episode-item');
        ep2.setAttribute(
          'href',
          'https://www.bilibili.tv/id/play/2411889/30639811?bstar_from=detail'
        );
        ep2.textContent = 'E2';
        epContainer.appendChild(ep2);

        mockDoc.appendChild(epContainer);

        const originalDoc = global.document;
        const originalWin = global.window;
        const { getActiveVideoInfo } = bstationScript;

        try {
          global.document = {
            querySelector: (sel) => mockDoc.querySelector(sel),
            querySelectorAll: (sel) => mockDoc.querySelectorAll(sel),
            title: 'Kaiju Dara Caramelise'
          };
          // URL has only seasonId (single number segment)
          global.window = {
            location: {
              pathname: '/id/play/2411889',
              search: '?bstar_from=bstar-web.anime-tab.top-hits.all'
            }
          };

          const info = getActiveVideoInfo();
          assert.strictEqual(
            info.episodeId,
            '30639810',
            'Must resolve episode 1 numeric ID 30639810 from active DOM element'
          );
          assert.strictEqual(info.episodeTitle, 'E1');
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      await testAsync(
        'fetchPlayurlOnDemand validates numeric ep_id and refuses to issue 404 requests for dummy strings like ep_1',
        async () => {
          const { fetchPlayurlOnDemand } = bstationBridge;
          let fetchCalled = false;
          const originalFetch = global.fetch;

          try {
            global.fetch = async (url) => {
              fetchCalled = true;
              return { ok: false, status: 404 };
            };

            // When given non-numeric dummy string "ep_1" without valid state resolution, it must return null without calling fetch
            const res = await fetchPlayurlOnDemand({ ep_id: 'ep_1', qn: 32 });
            assert.strictEqual(res, null, 'Must return null for unresolved non-numeric ep_id');
            assert.strictEqual(
              fetchCalled,
              false,
              'Must NOT trigger network request with dummy ep_1 ID (prevents 404)'
            );
          } finally {
            global.fetch = originalFetch;
          }
        }
      );

      await testAsync(
        'Direct Parallel Queue limits active concurrent downloads strictly to 2',
        async () => {
          const queue = new DirectParallelQueue({ concurrency: 2 });
          let maxActiveObserved = 0;
          let activeCount = 0;

          for (let i = 1; i <= 6; i++) {
            queue.add({
              id: `task_${i}`,
              epIndex: i,
              resolveStream: async () => ({ url: `https://cdn.bilibili.tv/ep${i}.mp4` }),
              downloadStream: async () => {
                activeCount++;
                if (activeCount > maxActiveObserved) {
                  maxActiveObserved = activeCount;
                }
                await new Promise((r) => setTimeout(r, 60));
                activeCount--;
              }
            });
          }

          await new Promise((resolve) => {
            queue.onAllComplete = resolve;
            queue.start();
          });

          assert.ok(
            maxActiveObserved <= 2,
            `Active workers must not exceed 2 (observed: ${maxActiveObserved})`
          );
          assert.strictEqual(queue.completedCount, 6, 'All 6 tasks must complete');
          assert.strictEqual(queue.failedCount, 0, 'Zero failures expected');
        }
      );

      await testAsync(
        'Queue lifecycle reports live download progress (current, total, active)',
        async () => {
          const progressUpdates = [];
          const queue = new DirectParallelQueue({
            concurrency: 2,
            onProgress: (p) => {
              progressUpdates.push({ ...p });
            }
          });

          for (let i = 1; i <= 4; i++) {
            queue.add({
              id: `task_${i}`,
              resolveStream: async () => ({ url: `https://cdn.bilibili.tv/ep${i}.mp4` }),
              downloadStream: async () => new Promise((r) => setTimeout(r, 20))
            });
          }

          await new Promise((resolve) => {
            queue.onAllComplete = resolve;
            queue.start();
          });

          assert.ok(progressUpdates.length >= 4, 'Must emit multiple progress events');
          const lastUpdate = progressUpdates[progressUpdates.length - 1];
          assert.strictEqual(lastUpdate.total, 4);
          assert.strictEqual(lastUpdate.done, 4);
          assert.strictEqual(lastUpdate.percent, 100);
        }
      );

      await testAsync(
        'Queue continues gracefully when a single episode download fails without blocking subsequent episodes',
        async () => {
          const queue = new DirectParallelQueue({ concurrency: 2 });

          queue.add({
            id: 'task_1',
            resolveStream: async () => ({ url: 'https://cdn.bilibili.tv/ep1.mp4' }),
            downloadStream: async () => true
          });
          queue.add({
            id: 'task_2',
            resolveStream: async () => {
              throw new Error('HTTP 403 Forbidden: VIP token required');
            },
            downloadStream: async () => true
          });
          queue.add({
            id: 'task_3',
            resolveStream: async () => ({ url: 'https://cdn.bilibili.tv/ep3.mp4' }),
            downloadStream: async () => true
          });

          await new Promise((resolve) => {
            queue.onAllComplete = resolve;
            queue.start();
          });

          assert.strictEqual(queue.completedCount, 2, 'Two tasks must succeed');
          assert.strictEqual(queue.failedCount, 1, 'One task must fail');
          assert.strictEqual(queue.items[1].status, 'failed');
          assert.strictEqual(
            queue.items[2].status,
            'completed',
            'Task 3 must complete despite task 2 failing'
          );
        }
      );
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 12: In-Page Bstation Player UI Injection & Batch Modal Lifecycle
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 12: In-Page Bstation Player UI Injection & Batch Modal Lifecycle',
    ({ test }) => {
      const bstationScript = require(path.join(PROJECT_ROOT, 'content/platforms/bstation.js'));
      const { injectPlayerButton, injectBatchButton, openBatchModal, closeBatchModal } =
        bstationScript;

      test('Player 1-click Download button injected into .bpx-player / .bstar-video-player with Cyber Cyan token', () => {
        const container = new MockElement('div');
        container.className = 'bpx-player-control-bottom-right';

        const btn = injectPlayerButton(container);
        assert.ok(btn, 'injectPlayerButton must return injected button');
        assert.strictEqual(
          container.getAttribute('data-bs-dl-ready'),
          'true',
          'Must set ready attribute on container'
        );
        assert.ok(btn.className.includes('bs-dl-btn'), 'Button must possess bs-dl-btn class');
        assert.ok(container.children.length === 1, 'Container must have exactly 1 action wrapper');
      });

      test('Strict duplicate guard prevents duplicate player buttons on repeated DOM scans', () => {
        const container = new MockElement('div');
        container.className = 'bpx-player-control-bottom-right';

        const firstBtn = injectPlayerButton(container);
        assert.ok(firstBtn);
        assert.strictEqual(container.children.length, 1);

        // Re-scan same container
        injectPlayerButton(container);
        assert.strictEqual(container.children.length, 1, 'Duplicate injection must be prevented');
      });

      test('"Semua episode" Batch Download button injected beside episode list header', () => {
        const header = new MockElement('div');
        header.className = 'bstar-episode-list';
        const title = new MockElement('h2');
        title.textContent = 'Semua episode';
        header.appendChild(title);

        const batchBtn = injectBatchButton(header);
        assert.ok(batchBtn, 'injectBatchButton must return batch button');
        assert.strictEqual(header.getAttribute('data-bs-batch-ready'), 'true');
        assert.ok(batchBtn.className.includes('bs-batch-trigger-btn'));
      });

      test('Batch Modal renders anime title, episode grid, quality selector, and CTA button', () => {
        const docRoot = new MockElement('body');
        const originalDoc = global.document;
        const originalWin = global.window;

        try {
          global.document = {
            body: docRoot,
            documentElement: docRoot,
            createElement: (tag) => new MockElement(tag),
            getElementById: (id) => docRoot.getElementById(id),
            querySelector: (sel) => docRoot.querySelector(sel),
            querySelectorAll: (sel) => docRoot.querySelectorAll(sel),
            addEventListener: () => {},
            removeEventListener: () => {},
            title: 'Frieren - Beyond Journeys End'
          };
          global.window = {
            __INITIAL_STATE__: {
              mediaInfo: { title: 'Frieren - Beyond Journeys End' },
              user: { vip: { is_vip: false } }
            }
          };

          openBatchModal();

          const modalRoot = docRoot.getElementById('bs-batch-modal-root');
          assert.ok(modalRoot, '#bs-batch-modal-root must exist in document.body');
          assert.ok(
            modalRoot.className.includes('bs-modal-open'),
            'Modal must receive bs-modal-open class'
          );

          const titleEl = modalRoot.querySelector('.bs-modal-title');
          assert.ok(titleEl, 'Title element must exist in modal');
          assert.strictEqual(titleEl.textContent, 'Frieren - Beyond Journeys End');

          const qualitySelect = modalRoot.querySelector('#bs-quality-select');
          assert.ok(qualitySelect, 'Quality selector select element must exist');
          assert.strictEqual(
            qualitySelect.value,
            '720p',
            'Free user must default to 720p HD quality'
          );
          const opt1080 = qualitySelect.querySelector('option[value="1080p"]');
          assert.ok(opt1080, '1080p option must exist');
          assert.strictEqual(
            opt1080.disabled,
            false,
            '1080p option must be enabled and unlocked for all users'
          );

          const startBtn = modalRoot.querySelector('#bs-btn-start-batch');
          assert.ok(startBtn, 'Start batch download button must exist');

          const grid = modalRoot.querySelector('#bs-episode-grid');
          assert.ok(grid, 'Episode grid container must exist');
          assert.ok(grid.children.length > 0, 'Grid must contain episode cards');
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      test('Modal toggle lifecycle: opens on click, closes on close button or Escape key', () => {
        const docRoot = new MockElement('body');
        const originalDoc = global.document;
        const originalWin = global.window;

        try {
          global.document = {
            body: docRoot,
            documentElement: docRoot,
            createElement: (tag) => new MockElement(tag),
            getElementById: (id) => docRoot.getElementById(id),
            querySelector: (sel) => docRoot.querySelector(sel),
            querySelectorAll: (sel) => docRoot.querySelectorAll(sel),
            addEventListener: () => {},
            removeEventListener: () => {},
            title: 'Anime Title'
          };
          global.window = {};

          openBatchModal();
          const modalRoot = docRoot.getElementById('bs-batch-modal-root');
          assert.ok(modalRoot.className.includes('bs-modal-open'));

          closeBatchModal();
          assert.ok(
            !modalRoot.className.includes('bs-modal-open'),
            'bs-modal-open class must be removed on close'
          );
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      test('Batch modal button recovery: failure transitions button to Unduh Ulang and checking episode resets to Mulai Unduh', () => {
        const docRoot = new MockElement('body');
        const originalDoc = global.document;
        const originalWin = global.window;

        try {
          global.document = {
            body: docRoot,
            documentElement: docRoot,
            createElement: (tag) => new MockElement(tag),
            getElementById: (id) => docRoot.getElementById(id),
            querySelector: (sel) => docRoot.querySelector(sel),
            querySelectorAll: (sel) => docRoot.querySelectorAll(sel),
            addEventListener: () => {},
            removeEventListener: () => {},
            title: 'Anime Show'
          };
          global.window = {
            __INITIAL_STATE__: {
              mediaInfo: { title: 'Anime Show' },
              user: { vip: { is_vip: true } }
            }
          };

          openBatchModal();

          const modalRoot = docRoot.getElementById('bs-batch-modal-root');
          const startBtn = modalRoot.querySelector('#bs-btn-start-batch');
          const btnText = modalRoot.querySelector('#bs-start-batch-text');
          const pillNone = modalRoot.querySelector('#bs-pill-none');
          const pillAll = modalRoot.querySelector('#bs-pill-all');

          assert.ok(startBtn);
          assert.strictEqual(btnText.textContent, 'Mulai Unduh');

          // Simulate queue completing with failure: res = { completed: 0, failed: 1 }
          btnText.textContent = 'Unduh Ulang';
          assert.strictEqual(
            btnText.textContent,
            'Unduh Ulang',
            'Must show Unduh Ulang when failed'
          );

          // Clicking pillNone unchecks all and updates button to disabled
          pillNone.click();
          assert.strictEqual(btnText.textContent, 'Pilih Episode');
          assert.strictEqual(startBtn.disabled, true);

          // Clicking pillAll re-checks all and resets button to Mulai Unduh and enables it
          pillAll.click();
          assert.strictEqual(
            btnText.textContent,
            'Mulai Unduh',
            'Re-selecting episodes must reset button to Mulai Unduh'
          );
          assert.strictEqual(
            startBtn.disabled,
            false,
            'Start button must be enabled when episodes selected'
          );
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      test('getCanonicalBstationUrl constructs canonical episode playurl from season path and ep_id', () => {
        const { getCanonicalBstationUrl } = bstationScript;
        const originalWin = global.window;

        try {
          global.window = {
            location: {
              href: 'https://www.bilibili.tv/id/play/2431959?bstar_from=bstar-web.anime-tab.top-hits.all',
              pathname: '/id/play/2431959'
            }
          };

          const canonical = getCanonicalBstationUrl({ episodeId: '31508593' });
          assert.strictEqual(
            canonical,
            'https://www.bilibili.tv/id/play/2431959/31508593',
            'Must construct canonical episode playurl with seasonId and episodeId'
          );
        } finally {
          global.window = originalWin;
        }
      });

      test('injectPlayerButton dispatches DOWNLOAD_VIDEO with platform bstation and canonical URL to Service Worker', async () => {
        const { injectPlayerButton } = bstationScript;
        const container = new MockElement('div');
        const originalDoc = global.document;
        const originalWin = global.window;
        const originalChrome = global.chrome;

        let sentMessage = null;

        try {
          global.chrome = {
            runtime: {
              sendMessage: (payload, cb) => {
                sentMessage = payload;
                if (cb) cb({ success: true, filename: 'test.mp4' });
              }
            }
          };

          global.window = {
            location: {
              href: 'https://www.bilibili.tv/id/play/2431959',
              pathname: '/id/play/2431959'
            },
            __INITIAL_STATE__: {
              mediaInfo: { title: 'Reinkarnasi Santa Agung' },
              epInfo: { ep_id: 31508593, short_title: '1' }
            }
          };

          global.document = {
            createElement: (tag) => new MockElement(tag),
            querySelector: () => null
          };

          const btn = injectPlayerButton(container);
          assert.ok(btn, 'injectPlayerButton must create and return button');

          // Trigger click
          btn.click();

          assert.ok(sentMessage, 'Must dispatch runtime message');
          assert.strictEqual(sentMessage.action, 'DOWNLOAD_VIDEO');
          assert.strictEqual(sentMessage.platform, 'bstation');
          assert.strictEqual(
            sentMessage.url,
            'https://www.bilibili.tv/id/play/2431959/31508593',
            'Must pass canonical episode URL for yt-dlp extraction'
          );
          assert.strictEqual(sentMessage.videoId, '31508593');
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
          global.chrome = originalChrome;
        }
      });

      test('Quality menu toggle lifecycle: openQualityMenu adds is-open, closeQualityMenu removes is-open, and close button closes menu', () => {
        const { openQualityMenu, closeQualityMenu } = bstationScript;
        const menuEl = new MockElement('div');
        menuEl.id = 'bs-dl-quality-menu';

        openQualityMenu(menuEl);
        assert.ok(menuEl.className.includes('is-open'), 'Menu must receive is-open class on open');
        assert.strictEqual(menuEl.style.display, 'flex');

        const closeBtn = menuEl.querySelector('.bs-dl-menu-close-btn');
        assert.ok(closeBtn, 'Quality menu header must render a close button');

        // Test clicking close button
        closeBtn.click();
        assert.ok(
          !menuEl.className.includes('is-open'),
          'is-open class must be removed on close button click'
        );
        assert.strictEqual(menuEl.style.display, 'none');

        // Test programmatic open and close
        openQualityMenu(menuEl);
        assert.ok(menuEl.className.includes('is-open'));
        closeQualityMenu(menuEl);
        assert.ok(!menuEl.className.includes('is-open'));
        assert.strictEqual(menuEl.style.display, 'none');
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 13: Multi-Platform Popup Tab Switching & Context Controller Lifecycle
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 13: Multi-Platform Popup Tab Switching & Context Controller Lifecycle',
    ({ test }) => {
      test('Active tab detection identifies TikTok vs Bstation vs generic URLs', () => {
        function detectPlatform(url) {
          if (!url) return 'generic';
          try {
            const parsed = new URL(url);
            const host = parsed.hostname;
            if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
            if (
              host === 'bilibili.tv' ||
              host.endsWith('.bilibili.tv') ||
              host === 'bstation.tv' ||
              host.endsWith('.bstation.tv')
            )
              return 'bstation';
          } catch (_) {}
          return 'generic';
        }

        assert.strictEqual(detectPlatform('https://www.tiktok.com/@creator/video/12345'), 'tiktok');
        assert.strictEqual(detectPlatform('https://m.tiktok.com/v/12345'), 'tiktok');
        assert.strictEqual(
          detectPlatform('https://www.bilibili.tv/id/play/1048837/1000001'),
          'bstation'
        );
        assert.strictEqual(detectPlatform('https://www.bstation.tv/en/play/1048837'), 'bstation');
        assert.strictEqual(detectPlatform('https://www.google.com/search?q=anime'), 'generic');
        assert.strictEqual(detectPlatform('chrome://extensions/'), 'generic');
      });

      test('Bstation tab activates #state-bstation, online dot, and "Unduh Video Aktif" button text', () => {
        const stateTiktok = new MockElement('div');
        const stateBstation = new MockElement('div');
        const stateEmpty = new MockElement('div');
        const statusDot = new MockElement('span');
        const btnDownload = new MockElement('button');
        const btnText = new MockElement('span');

        // Simulate Bstation tab view transition
        statusDot.className = 'status-dot online';
        stateTiktok.style.display = 'none';
        stateBstation.style.display = 'flex';
        stateEmpty.style.display = 'none';
        btnDownload.style.display = 'inline-flex';
        btnText.textContent = 'Unduh Video Aktif';

        assert.strictEqual(stateBstation.style.display, 'flex');
        assert.strictEqual(stateTiktok.style.display, 'none');
        assert.strictEqual(stateEmpty.style.display, 'none');
        assert.strictEqual(statusDot.className, 'status-dot online');
        assert.strictEqual(btnDownload.style.display, 'inline-flex');
        assert.strictEqual(btnText.textContent, 'Unduh Video Aktif');
      });

      test('TikTok tab activates #state-tiktok, online dot, and "Download Video" button text', () => {
        const stateTiktok = new MockElement('div');
        const stateBstation = new MockElement('div');
        const stateEmpty = new MockElement('div');
        const statusDot = new MockElement('span');
        const btnDownload = new MockElement('button');
        const btnText = new MockElement('span');

        // Simulate TikTok tab view transition
        statusDot.className = 'status-dot online';
        stateTiktok.style.display = 'flex';
        stateBstation.style.display = 'none';
        stateEmpty.style.display = 'none';
        btnDownload.style.display = 'inline-flex';
        btnText.textContent = 'Download Video';

        assert.strictEqual(stateTiktok.style.display, 'flex');
        assert.strictEqual(stateBstation.style.display, 'none');
        assert.strictEqual(stateEmpty.style.display, 'none');
        assert.strictEqual(statusDot.className, 'status-dot online');
        assert.strictEqual(btnDownload.style.display, 'inline-flex');
        assert.strictEqual(btnText.textContent, 'Download Video');
      });

      test('Generic tab activates #state-empty with both TikTok and Bstation launcher buttons', () => {
        const stateTiktok = new MockElement('div');
        const stateBstation = new MockElement('div');
        const stateEmpty = new MockElement('div');
        const statusDot = new MockElement('span');
        const btnDownload = new MockElement('button');
        const btnOpenTikTok = new MockElement('button');
        btnOpenTikTok.id = 'btn-open-tiktok';
        const btnOpenBstation = new MockElement('button');
        btnOpenBstation.id = 'btn-open-bstation';
        stateEmpty.appendChild(btnOpenTikTok);
        stateEmpty.appendChild(btnOpenBstation);

        // Simulate Generic tab view transition
        statusDot.className = 'status-dot idle';
        stateTiktok.style.display = 'none';
        stateBstation.style.display = 'none';
        stateEmpty.style.display = 'flex';
        btnDownload.style.display = 'none';

        assert.strictEqual(stateEmpty.style.display, 'flex');
        assert.strictEqual(stateTiktok.style.display, 'none');
        assert.strictEqual(btnDownload.style.display, 'none');
        assert.strictEqual(statusDot.className, 'status-dot idle');
        assert.ok(stateEmpty.querySelector('#btn-open-tiktok'));
        assert.ok(stateEmpty.querySelector('#btn-open-bstation'));
      });

      test('Download counter synchronizes from chrome.storage.local across platforms', () => {
        const counterEl = new MockElement('span');
        function updateCounter(count) {
          const n = Math.max(0, Math.floor(Number(count) || 0));
          counterEl.textContent = String(n);
        }

        updateCounter(7);
        assert.strictEqual(counterEl.textContent, '7');

        updateCounter(18);
        assert.strictEqual(counterEl.textContent, '18');

        updateCounter(null);
        assert.strictEqual(counterEl.textContent, '0');
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 14: Manifest V3 JWPlyr Platform Registration
  // --------------------------------------------------------------------------
  await runSuite('Suite 14: Manifest V3 JWPlyr Platform Registration', ({ test }) => {
    const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    test('Manifest host_permissions includes jwplyr.com and overfetch.video', () => {
      assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
      assert.ok(
        manifest.host_permissions.includes('*://*.jwplyr.com/*'),
        'must include jwplyr.com host permission'
      );
      assert.ok(
        manifest.host_permissions.includes('*://*.overfetch.video/*'),
        'must include overfetch.video host permission'
      );
    });

    test('Manifest registers JWPlyr ISOLATED world platform UI and CSS at document_idle', () => {
      const jwPlatform = manifest.content_scripts.find(
        (s) => Array.isArray(s.js) && s.js.includes('content/platforms/jwplyr.js')
      );
      assert.ok(jwPlatform, 'JWPlyr platform entry must exist in content_scripts');
      assert.strictEqual(
        jwPlatform.run_at,
        'document_idle',
        'JWPlyr platform must run at document_idle'
      );
      assert.ok(
        Array.isArray(jwPlatform.css) && jwPlatform.css.includes('content/styles/jwplyr.css'),
        'must register jwplyr.css'
      );
      assert.ok(jwPlatform.matches.includes('*://*.jwplyr.com/*'), 'must match jwplyr.com');
    });

    test('Manifest web_accessible_resources exposes icons to jwplyr.com', () => {
      const jwResource = manifest.web_accessible_resources.find(
        (r) => Array.isArray(r.matches) && r.matches.includes('*://*.jwplyr.com/*')
      );
      assert.ok(jwResource, 'web_accessible_resources must declare jwplyr.com match');
      assert.ok(jwResource.resources.includes('icons/icon16.png'));
    });

    test('All registered JWPlyr platform scripts and stylesheets exist on disk with valid size and syntax', () => {
      const jwplyrFiles = ['content/platforms/jwplyr.js', 'content/styles/jwplyr.css'];

      for (const relPath of jwplyrFiles) {
        const fullPath = path.join(PROJECT_ROOT, relPath);
        assert.ok(fs.existsSync(fullPath), `JWPlyr asset missing: ${relPath}`);
        const stat = fs.statSync(fullPath);
        assert.ok(stat.size > 0, `JWPlyr asset must not be empty: ${relPath}`);
      }

      const scriptPath = path.join(PROJECT_ROOT, 'content/platforms/jwplyr.js');
      const res = spawnSync(process.execPath, ['--check', scriptPath], {
        encoding: 'utf8',
        windowsHide: true
      });
      assert.strictEqual(
        res.status,
        0,
        `Syntax error in content/platforms/jwplyr.js: ${res.stderr}`
      );
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 15: JWPlyr Windows NTFS Filename Sanitization Unit & Boundary Tests
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 15: JWPlyr Windows NTFS Filename Sanitization Unit & Boundary Tests',
    ({ test }) => {
      const sw = require(path.join(PROJECT_ROOT, 'background/service_worker.js'));
      const jw = require(path.join(PROJECT_ROOT, 'content/platforms/jwplyr.js'));
      const { sanitizeJwplyrFilename } = sw;
      const { sanitizeJwplyrTitle, formatJwplyrFilename } = jw;

      test('Standard Clean JWPlyr Video Title with existing .mp4: preserved without double extension', () => {
        const res1 = sanitizeJwplyrFilename('01 AIKA CANDICE - PoopHD.mp4', '2j6b896shouc');
        const res2 = formatJwplyrFilename('01 AIKA CANDICE - PoopHD.mp4', '2j6b896shouc');
        assert.strictEqual(res1, '01 AIKA CANDICE - PoopHD.mp4');
        assert.strictEqual(res2, '01 AIKA CANDICE - PoopHD.mp4');
      });

      test('JWPlyr Video Title without extension: appends single .mp4', () => {
        const res1 = sanitizeJwplyrFilename('05 Aika candice', 'op6sotokdm5z');
        const res2 = formatJwplyrFilename('05 Aika candice', 'op6sotokdm5z');
        assert.strictEqual(res1, '05 Aika candice.mp4');
        assert.strictEqual(res2, '05 Aika candice.mp4');
      });

      test('Win32 Illegal Characters in Title (colons, slashes, quotes, asterisks, question marks) stripped cleanly', () => {
        const dirty = 'Aika: Candice / Ep? "01"* <HD|720>';
        const res = sanitizeJwplyrFilename(dirty, '123');
        assert.ok(!res.includes(':'), 'No colons');
        assert.ok(!res.includes('/'), 'No slashes');
        assert.ok(!res.includes('"'), 'No quotes');
        assert.ok(!res.includes('?'), 'No question marks');
        assert.ok(!res.includes('*'), 'No asterisks');
        assert.ok(!res.includes('<') && !res.includes('>'), 'No brackets');
        assert.ok(!res.includes('|'), 'No pipe');
        assert.ok(res.endsWith('.mp4'));
      });

      test('Win32 Control Characters (0x00-0x1F, 0x7F-0x9F) eliminated', () => {
        const dirty = 'Aika\x00Candice\x1fVideo\x7fHD.mp4';
        const res = sanitizeJwplyrFilename(dirty, '999');
        assert.strictEqual(res, 'AikaCandiceVideoHD.mp4');
      });

      test('Null, undefined, and empty string fallbacks with ID', () => {
        assert.strictEqual(sanitizeJwplyrFilename('', '2mq5356qiqp'), 'jwplyr_2mq5356qiqp.mp4');
        assert.strictEqual(sanitizeJwplyrFilename(null, 'abc123'), 'jwplyr_abc123.mp4');
        assert.strictEqual(sanitizeJwplyrFilename(undefined, 'xyz789'), 'jwplyr_xyz789.mp4');
      });

      test('Extreme Title Length Boundary Value Analysis (truncated to <= 120 chars, total < 255)', () => {
        const hugeTitle = 'A'.repeat(300);
        const res = sanitizeJwplyrFilename(hugeTitle, 'test');
        assert.ok(res.length <= 130, `Filename must be under 130 chars: ${res.length}`);
        assert.ok(res.endsWith('.mp4'));
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 16: JWPlyr Direct Stream Extraction & 3-Tier Resolution Pipeline Simulation
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 16: JWPlyr Direct Stream Extraction & 3-Tier Resolution Pipeline Simulation',
    async ({ testAsync }) => {
      const jw = require(path.join(PROJECT_ROOT, 'content/platforms/jwplyr.js'));
      const { extractDirectMp4 } = jw;

      await testAsync(
        'extractDirectMp4 cascades through page, iframe, stream.php and resolves overfetch MP4',
        async () => {
          const oldFetch = global.fetch;
          const calls = [];

          global.fetch = async (url, options) => {
            calls.push({ url, options });
            if (url.includes('/d/2j6b896shouc')) {
              return {
                ok: true,
                status: 200,
                text: async () => `
              <html>
              <head><title>01 AIKA CANDICE - PoopHD.mp4</title></head>
              <body>
                <script>var SRC = '/ip129jk?id=63756f687336393862366a32&t=tok123';</script>
              </body>
              </html>
            `
              };
            }
            if (url.includes('/ip129jk')) {
              return {
                ok: true,
                status: 200,
                text: async () => `
              <html>
              <head>
                <link rel="prefetch" href="https://jwplyr.com/stream.php?bucket=vidoycdn&amp;id=2j6b896shouc&amp;t=streamtok">
              </head>
              </html>
            `
              };
            }
            if (url.includes('/stream.php')) {
              return {
                ok: true,
                status: 200,
                text: async () => `
              <video id="player">
                <source src="https://mp4-14.overfetch.video/s/authKey/1792430086/i/video.mp4" />
              </video>
            `
              };
            }
            throw new Error(`Unexpected URL in mock fetch: ${url}`);
          };

          try {
            const result = await extractDirectMp4('2j6b896shouc');
            assert.ok(result, 'Result must be returned');
            assert.strictEqual(result.videoId, '2j6b896shouc');
            assert.strictEqual(result.title, '01 AIKA CANDICE - PoopHD.mp4');
            assert.strictEqual(
              result.mp4Url,
              'https://mp4-14.overfetch.video/s/authKey/1792430086/i/video.mp4'
            );
            assert.strictEqual(
              calls.length,
              3,
              'Must perform exactly 3 sequential resolution hops'
            );
          } finally {
            global.fetch = oldFetch;
          }
        }
      );

      await testAsync(
        'extractDirectMp4 throws descriptive error when iframe SRC is missing',
        async () => {
          const oldFetch = global.fetch;
          global.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '<html><body>No source here</body></html>'
          });

          try {
            await assert.rejects(async () => {
              await extractDirectMp4('missing_src');
            }, /Iframe source configuration not found/);
          } finally {
            global.fetch = oldFetch;
          }
        }
      );
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 17: JWPlyr Batch Downloader Queue (Concurrency 2) & In-Page UI Lifecycle
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 17: JWPlyr Batch Downloader Queue (Concurrency 2) & In-Page UI Lifecycle',
    async ({ test, testAsync }) => {
      const jw = require(path.join(PROJECT_ROOT, 'content/platforms/jwplyr.js'));
      const { DirectParallelQueue, injectCardButtons } = jw;

      await testAsync(
        'DirectParallelQueue processes batch tasks with concurrency capped at 2',
        async () => {
          const queue = new DirectParallelQueue({ concurrency: 2 });
          let maxActive = 0;
          let currentActive = 0;
          const completed = [];

          for (let i = 1; i <= 5; i++) {
            const id = i;
            queue.add({
              task: async () => {
                currentActive++;
                maxActive = Math.max(maxActive, currentActive);
                await new Promise((r) => setTimeout(r, 20));
                currentActive--;
                completed.push(id);
              }
            });
          }

          await new Promise((resolve) => {
            queue.onAllComplete = resolve;
            queue.start();
          });

          assert.strictEqual(maxActive, 2, 'Max concurrent workers must strictly be 2');
          assert.strictEqual(completed.length, 5, 'All 5 tasks must complete');
        }
      );

      test('In-Page Card Injection sets data-jwplyr-ready to prevent duplicate buttons', () => {
        const card = new MockElement('article');
        card.classList.add('drive-file-card');

        const link = new MockElement('a');
        link.attributes.set('href', '/d/2mq5356qiqp');
        link.attributes.set('aria-label', 'Demo Video 1');
        card.appendChild(link);

        const titleEl = new MockElement('a');
        titleEl.classList.add('file-name');
        titleEl.attributes.set('title', 'Demo Video 1');
        card.appendChild(titleEl);

        const oldDoc = global.document;
        global.document = {
          querySelectorAll: (sel) => {
            if (sel.includes('.drive-file-card') && !card.attributes.get('data-jwplyr-ready')) {
              return [card];
            }
            return [];
          },
          createElement: (tag) => new MockElement(tag)
        };

        try {
          injectCardButtons();
          assert.strictEqual(
            card.attributes.get('data-jwplyr-ready'),
            'true',
            'Must mark card as ready'
          );
          const btn = card.querySelector('.jwplyr-card-dl-btn');
          assert.ok(btn, 'Must inject download button into card');

          // Subsequent injection must skip
          const prevCount = card.children.length;
          injectCardButtons();
          assert.strictEqual(card.children.length, prevCount, 'No duplicate buttons injected');
        } finally {
          global.document = oldDoc;
        }
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 18: Multi-Platform Popup Tab Switching & Context Controller Lifecycle for JWPlyr
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 18: Multi-Platform Popup Tab Switching & Context Controller Lifecycle for JWPlyr',
    ({ test }) => {
      test('Popup controller identifies JWPlyr tab and activates #state-jwplyr', () => {
        const tabUrl = 'https://jwplyr.com/f/2mq5356qiqp';
        const parsed = new URL(tabUrl);
        const isJwplyr =
          parsed.hostname === 'jwplyr.com' || parsed.hostname.endsWith('.jwplyr.com');
        assert.strictEqual(isJwplyr, true, 'Must detect jwplyr.com');

        const statusDot = new MockElement('span');
        const stateTiktok = new MockElement('div');
        const stateBstation = new MockElement('div');
        const stateJwplyr = new MockElement('div');
        const stateEmpty = new MockElement('div');
        const btnDownload = new MockElement('button');

        // Simulate JWPlyr active state
        statusDot.className = 'status-dot online';
        stateTiktok.style.display = 'none';
        stateBstation.style.display = 'none';
        stateJwplyr.style.display = 'flex';
        stateEmpty.style.display = 'none';
        btnDownload.style.display = 'inline-flex';

        assert.strictEqual(statusDot.className, 'status-dot online');
        assert.strictEqual(stateJwplyr.style.display, 'flex');
        assert.strictEqual(stateTiktok.style.display, 'none');
        assert.strictEqual(stateBstation.style.display, 'none');
        assert.strictEqual(stateEmpty.style.display, 'none');
        assert.strictEqual(btnDownload.style.display, 'inline-flex');
      });

      test('JWPlyr folder vs video view returns correct metadata payload', () => {
        const jw = require(path.join(PROJECT_ROOT, 'content/platforms/jwplyr.js'));
        const { getActiveVideoInfo } = jw;

        // Mock window on folder page
        const oldWin = global.window;
        const oldDoc = global.document;

        global.window = { location: { pathname: '/f/2mq5356qiqp' } };
        global.document = {
          querySelector: (sel) => {
            if (sel === '.drive-title') return { textContent: 'Aika Candice' };
            return null;
          },
          querySelectorAll: (sel) => {
            if (sel === '.drive-file-card') return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
            return [];
          }
        };

        try {
          const info = getActiveVideoInfo();
          assert.ok(info.ready);
          assert.strictEqual(info.platform, 'jwplyr');
          assert.strictEqual(info.isFolder, true);
          assert.strictEqual(info.title, 'Aika Candice');
          assert.strictEqual(info.count, 11);
          assert.strictEqual(info.folderId, '2mq5356qiqp');
        } finally {
          global.window = oldWin;
          global.document = oldDoc;
        }
      });
    }
  );

  // ==========================================================================
  // SUITE 19: Mode Hemat Kuota & Multi-Codec Prioritization (HEVC / AV1 / H.264)
  // ==========================================================================
  await runSuite(
    'Suite 19: Mode Hemat Kuota & Multi-Codec Prioritization (HEVC / AV1 / H.264)',
    ({ test }) => {
      test('TikTok normalizeItemStruct selects ByteVC1 stream in data_saver mode (hemat ~50-60%)', () => {
        const tiktokBridge = require(path.join(PROJECT_ROOT, 'content/injected/tiktok_bridge.js'));
        const mockItem = {
          id: '7123456789012345678',
          desc: 'Sample TikTok Dance',
          author: { uniqueId: 'tiktok.star' },
          video: {
            bitrateInfo: [
              {
                Bitrate: 2500000,
                CodecType: 'h264',
                GearName: 'normal_1080_0',
                PlayAddr: { UrlList: ['https://v16.tiktokcdn.com/stream_1080p_h264.mp4'] }
              },
              {
                Bitrate: 1100000,
                CodecType: 'bytevc1',
                GearName: 'bytevc1_1080p_0',
                PlayAddr: { UrlList: ['https://v16.tiktokcdn.com/stream_1080p_bytevc1.mp4'] }
              }
            ]
          }
        };

        // 1. In data_saver mode: ByteVC1 prioritized
        const dataSaverItem = tiktokBridge.normalizeItemStruct(mockItem, 'data_saver');
        assert.strictEqual(
          dataSaverItem.playUrl,
          'https://v16.tiktokcdn.com/stream_1080p_bytevc1.mp4'
        );
        assert.strictEqual(dataSaverItem.codec, 'bytevc1');

        // 2. In compatibility mode: H.264 prioritized
        const compatItem = tiktokBridge.normalizeItemStruct(mockItem, 'compatibility');
        assert.strictEqual(compatItem.playUrl, 'https://v16.tiktokcdn.com/stream_1080p_h264.mp4');
        assert.strictEqual(compatItem.codec, 'h264');
      });

      test('Bstation normalizePlayurlResponse selects HEVC / AV1 stream in data_saver mode', () => {
        const bstationBridge = require(
          path.join(PROJECT_ROOT, 'content/injected/bstation_bridge.js')
        );
        const mockPlayurl = {
          code: 0,
          data: {
            ep_id: '123456',
            dash: {
              video: [
                {
                  id: 80,
                  codecid: 7, // AVC
                  baseUrl: 'https://bilivideo.com/stream_1080p_avc.mp4',
                  bandwidth: 3000000
                },
                {
                  id: 80,
                  codecid: 12, // HEVC
                  baseUrl: 'https://bilivideo.com/stream_1080p_hevc.mp4',
                  bandwidth: 1400000
                }
              ],
              audio: [{ baseUrl: 'https://bilivideo.com/audio_hq.m4a' }]
            }
          }
        };

        // 1. Data-saver mode: Selects HEVC codecid: 12
        const dataSaverStream = bstationBridge.normalizePlayurlResponse(mockPlayurl, {
          codecPreference: 'data_saver'
        });
        assert.strictEqual(dataSaverStream.playUrl, 'https://bilivideo.com/stream_1080p_hevc.mp4');
        assert.strictEqual(dataSaverStream.codec, 'hevc');

        // 2. Compatibility mode: Selects AVC codecid: 7
        const compatStream = bstationBridge.normalizePlayurlResponse(mockPlayurl, {
          codecPreference: 'compatibility'
        });
        assert.strictEqual(compatStream.playUrl, 'https://bilivideo.com/stream_1080p_avc.mp4');
        assert.strictEqual(compatStream.codec, 'h264');
      });

      test('Popup UI contains Mode Hemat Kuota toggle switch and default data_saver configuration', () => {
        const popupHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.html'), 'utf8');
        assert.ok(
          popupHtml.includes('id="toggle-data-saver"'),
          'Popup HTML must contain toggle-data-saver element'
        );
        assert.ok(popupHtml.includes('Mode Hemat Kuota'), 'Popup HTML must label Mode Hemat Kuota');
        assert.ok(popupHtml.includes('HEVC / AV1'), 'Popup HTML must mention HEVC / AV1 codecs');

        const popupCss = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.css'), 'utf8');
        assert.ok(popupCss.includes('.toggle-switch'), 'Popup CSS must style .toggle-switch');
        assert.ok(popupCss.includes('.preference-card'), 'Popup CSS must style .preference-card');
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 20: Manifest V3 YouTube Platform Registration & Conformance
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 20: Manifest V3 YouTube Platform Registration & Conformance',
    ({ test }) => {
      const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      test('Manifest host_permissions includes youtube.com and googlevideo.com', () => {
        assert.ok(
          manifest.host_permissions.includes('*://*.youtube.com/*'),
          'Must declare youtube.com origin'
        );
        assert.ok(
          manifest.host_permissions.includes('*://*.googlevideo.com/*'),
          'Must declare googlevideo.com CDN'
        );
        assert.ok(
          manifest.host_permissions.includes('*://*.ytimg.com/*'),
          'Must declare ytimg.com origin'
        );
      });

      test('Manifest registers YouTube MAIN world bridge script at document_start', () => {
        const ytBridge = manifest.content_scripts.find(
          (s) => s.world === 'MAIN' && s.matches.includes('*://*.youtube.com/*')
        );
        assert.ok(ytBridge, 'YouTube MAIN world bridge content script must be registered');
        assert.deepStrictEqual(ytBridge.js, ['content/injected/youtube_bridge.js']);
        assert.strictEqual(ytBridge.run_at, 'document_start');
      });

      test('Manifest registers YouTube ISOLATED world platform UI and CSS at document_idle', () => {
        const ytUI = manifest.content_scripts.find(
          (s) => (!s.world || s.world === 'ISOLATED') && s.matches.includes('*://*.youtube.com/*')
        );
        assert.ok(ytUI, 'YouTube ISOLATED world platform content script must be registered');
        assert.deepStrictEqual(ytUI.js, ['content/platforms/youtube.js']);
        assert.deepStrictEqual(ytUI.css, ['content/styles/youtube.css']);
        assert.strictEqual(ytUI.run_at, 'document_idle');
      });

      test('Manifest web_accessible_resources exposes youtube_bridge.js and icons to youtube.com', () => {
        const war = manifest.web_accessible_resources.find((w) =>
          w.matches.includes('*://*.youtube.com/*')
        );
        assert.ok(war, 'web_accessible_resources entry for youtube.com must exist');
        assert.ok(
          war.resources.includes('content/injected/youtube_bridge.js'),
          'Must expose youtube_bridge.js'
        );
        assert.ok(war.resources.includes('icons/icon16.png'), 'Must expose icon16.png');
      });

      test('All registered YouTube scripts and stylesheets exist on disk with valid size and syntax', () => {
        const files = [
          'content/injected/youtube_bridge.js',
          'content/platforms/youtube.js',
          'content/styles/youtube.css'
        ];
        for (const f of files) {
          const full = path.join(PROJECT_ROOT, f);
          assert.ok(fs.existsSync(full), `File ${f} must exist`);
          assert.ok(fs.statSync(full).size > 100, `File ${f} must not be empty`);
          if (f.endsWith('.js')) {
            const res = spawnSync(process.execPath, ['--check', full], {
              encoding: 'utf8',
              windowsHide: true
            });
            assert.strictEqual(res.status, 0, `Syntax check for ${f} failed: ${res.stderr}`);
          }
        }
      });

      test('youtube.css defines standard line-clamp property alongside -webkit-line-clamp', () => {
        const css = fs.readFileSync(path.join(PROJECT_ROOT, 'content/styles/youtube.css'), 'utf8');
        assert.ok(css.includes('-webkit-line-clamp: 2;'), 'Must define -webkit-line-clamp');
        assert.ok(css.includes('line-clamp: 2;'), 'Must define standard line-clamp property');
      });

      test('Manifest V3 and Service Worker strictly exclude studio.youtube.com & upload.youtube.com from header modification & injection', () => {
        const sw = require(path.join(PROJECT_ROOT, 'background/service_worker.js'));
        const { YOUTUBE_CDN_RULES } = sw;

        // Verify Rule 32 exclusions
        const rule32 = YOUTUBE_CDN_RULES.find((r) => r.id === 32);
        assert.ok(rule32, 'Rule 32 must exist');
        assert.ok(
          rule32.condition.excludedRequestDomains &&
            rule32.condition.excludedRequestDomains.includes('studio.youtube.com') &&
            rule32.condition.excludedRequestDomains.includes('upload.youtube.com'),
          'Rule 32 must exclude studio.youtube.com and upload.youtube.com from requestDomains'
        );
        assert.ok(
          rule32.condition.excludedInitiatorDomains &&
            rule32.condition.excludedInitiatorDomains.includes('studio.youtube.com') &&
            rule32.condition.excludedInitiatorDomains.includes('upload.youtube.com'),
          'Rule 32 must exclude studio.youtube.com and upload.youtube.com from initiatorDomains'
        );

        // Verify Rule 31 exclusions
        const rule31 = YOUTUBE_CDN_RULES.find((r) => r.id === 31);
        assert.ok(rule31, 'Rule 31 must exist');
        assert.ok(
          rule31.condition.excludedInitiatorDomains &&
            rule31.condition.excludedInitiatorDomains.includes('studio.youtube.com'),
          'Rule 31 must exclude studio.youtube.com initiator'
        );

        // Verify Manifest exclude_matches
        const ytBridgeScript = manifest.content_scripts.find(
          (s) => s.world === 'MAIN' && s.matches.includes('*://*.youtube.com/*')
        );
        assert.ok(
          ytBridgeScript.exclude_matches &&
            ytBridgeScript.exclude_matches.includes('*://studio.youtube.com/*'),
          'YouTube bridge must declare exclude_matches for studio.youtube.com'
        );

        const ytPlatformScript = manifest.content_scripts.find(
          (s) => (!s.world || s.world === 'ISOLATED') && s.matches.includes('*://*.youtube.com/*')
        );
        assert.ok(
          ytPlatformScript.exclude_matches &&
            ytPlatformScript.exclude_matches.includes('*://studio.youtube.com/*'),
          'YouTube platform UI must declare exclude_matches for studio.youtube.com'
        );
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 21: YouTube Windows NTFS Filename Sanitization Unit & Boundary Tests
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 21: YouTube Windows NTFS Filename Sanitization Unit & Boundary Tests',
    ({ test }) => {
      const sw = require(path.join(PROJECT_ROOT, 'background/service_worker.js'));
      const { sanitizeYoutubeTitle, sanitizeYoutubeAuthor, formatYoutubeFilename } = sw;

      assert.ok(
        typeof sanitizeYoutubeTitle === 'function',
        'sanitizeYoutubeTitle must be exported'
      );
      assert.ok(
        typeof sanitizeYoutubeAuthor === 'function',
        'sanitizeYoutubeAuthor must be exported'
      );
      assert.ok(
        typeof formatYoutubeFilename === 'function',
        'formatYoutubeFilename must be exported'
      );

      test('Standard Clean YouTube video title and author formatting', () => {
        const filename = formatYoutubeFilename({
          title: 'Learn JavaScript in 1 Hour',
          author: 'CodeMaster',
          videoId: 'dQw4w9WgXcQ'
        });
        assert.strictEqual(
          filename,
          '[YouTube] Learn JavaScript in 1 Hour - CodeMaster (dQw4w9WgXcQ).mp4'
        );
      });

      test('Win32 illegal colons normalized cleanly to spaces and dashes (e.g. Tutorial: Coding -> Tutorial - Coding)', () => {
        const filename = formatYoutubeFilename({
          title: 'Python: Beginner to Pro: Complete Course',
          author: 'Tech:Academy',
          videoId: 'py123'
        });
        assert.ok(!filename.includes(':'), 'Filename must not contain NTFS illegal colon');
        assert.strictEqual(
          filename,
          '[YouTube] Python - Beginner to Pro - Complete Course - Tech_Academy (py123).mp4'
        );
      });

      test('Win32 illegal characters (slashes, quotes, asterisks, question marks, pipe, <>) eliminated', () => {
        const filename = formatYoutubeFilename({
          title: 'What is Web3? / Is it safe? *Must Watch* <HQ> | "Review"',
          author: 'Crypto/Guru',
          videoId: 'w3b456'
        });
        for (const char of ['/', '\\', '*', '?', '"', '<', '>', '|']) {
          assert.ok(
            !filename.includes(char),
            `Filename must not contain illegal character: ${char}`
          );
        }
        assert.ok(filename.endsWith('.mp4'));
      });

      test('Win32 control characters (0x00-0x1F, 0x7F-0x9F) eliminated', () => {
        const filename = formatYoutubeFilename({
          title: 'Secret\x00Code\x07Audio\x1bTrack',
          author: 'Hacker\x1fMan',
          videoId: 'ctrl789'
        });
        assert.ok(
          !/[\x00-\x1f\x7f-\x9f]/.test(filename),
          'Filename must not contain control characters'
        );
      });

      test('Japanese, Korean, Arabic, and Unicode CJK titles preserved safely', () => {
        const filename = formatYoutubeFilename({
          title: '【MV】夜に駆ける / YOASOBI 🎵',
          author: 'YOASOBI',
          videoId: 'yoasobi01'
        });
        assert.ok(
          filename.includes('夜に駆ける'),
          'CJK Japanese characters must be safely preserved'
        );
        assert.ok(!filename.includes('/'), 'Slash must be sanitized');
        assert.ok(filename.endsWith('.mp4'));
      });

      test('Win32 trailing dots and whitespace collapsed to prevent file subsystem lockups', () => {
        const filename = formatYoutubeFilename({
          title: 'Important Video Title....   ',
          author: 'Channel...  ',
          videoId: 'trail99'
        });
        assert.strictEqual(filename, '[YouTube] Important Video Title - Channel (trail99).mp4');
        assert.ok(!filename.includes('...'));
      });

      test('Null, undefined, and empty string fallback safely with valid ID', () => {
        const filename1 = formatYoutubeFilename({});
        assert.ok(
          filename1.startsWith('[YouTube] YouTube_Video - Creator ('),
          'Fallback must provide valid name'
        );
        assert.ok(filename1.endsWith('.mp4'));

        const filename2 = formatYoutubeFilename({
          title: null,
          author: undefined,
          videoId: 'abc123xyz'
        });
        assert.strictEqual(filename2, '[YouTube] YouTube_Video - Creator (abc123xyz).mp4');
      });

      test('Extreme Title Length Boundary Value Analysis (truncated <= 120 chars, total filename < 255 chars)', () => {
        const longTitle = 'A'.repeat(500);
        const filename = formatYoutubeFilename({
          title: longTitle,
          author: 'VeryLongChannelName'.repeat(10),
          videoId: 'longvid'
        });
        assert.ok(
          filename.length < 255,
          `Total filename length (${filename.length}) must strictly satisfy Win32 MAX_PATH < 255`
        );
        assert.ok(filename.endsWith('.mp4'));
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 22: YouTube Direct Stream Extraction, Player API Bridge & Progressive/Adaptive Resolution Pipeline
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 22: YouTube Direct Stream Extraction, Player API Bridge & Progressive/Adaptive Resolution Pipeline',
    ({ test }) => {
      const ytBridge = require(path.join(PROJECT_ROOT, 'content/injected/youtube_bridge.js'));
      const { decipherSignature, parseFormat, selectOptimalStream } = ytBridge;

      assert.ok(typeof decipherSignature === 'function', 'decipherSignature must be exported');
      assert.ok(typeof parseFormat === 'function', 'parseFormat must be exported');
      assert.ok(typeof selectOptimalStream === 'function', 'selectOptimalStream must be exported');

      test('decipherSignature unscrambles signature tokens via reverse, swap, and slice transformations', () => {
        const sig = 'ABCD1234EFGH';
        const deciphered = decipherSignature(sig);
        assert.strictEqual(deciphered, '2H1A3');
      });

      test('parseFormat extracts clean direct progressive URL and metadata from standard format object', () => {
        const rawFormat = {
          itag: 22,
          url: 'https://rr1---sn-4g5edn6e.googlevideo.com/videoplayback?expire=123&itag=22',
          qualityLabel: '720p',
          quality: 'hd720',
          mimeType: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
          width: 1280,
          height: 720,
          bitrate: 1500000,
          audioChannels: 2
        };

        const parsed = parseFormat(rawFormat);
        assert.strictEqual(parsed.itag, 22);
        assert.strictEqual(parsed.qualityLabel, '720p');
        assert.strictEqual(parsed.isProgressive, true);
        assert.strictEqual(parsed.hasAudio, true);
        assert.strictEqual(parsed.url, rawFormat.url);
      });

      test('parseFormat decodes and deciphers cipher / signatureCipher parameters to retrieve direct URL', () => {
        const cipherFormat = {
          itag: 18,
          signatureCipher:
            's=ABCD1234EFGH&sp=sig&url=https%3A%2F%2Frr2---sn-4g5edn6e.googlevideo.com%2Fvideoplayback%3Fitag%3D18',
          qualityLabel: '360p',
          mimeType: 'video/mp4',
          height: 360
        };

        const parsed = parseFormat(cipherFormat);
        assert.strictEqual(parsed.itag, 18);
        assert.strictEqual(parsed.qualityLabel, '360p');
        assert.strictEqual(
          parsed.url,
          'https://rr2---sn-4g5edn6e.googlevideo.com/videoplayback?itag=18&sig=2H1A3&alr=yes'
        );
      });

      test('selectOptimalStream in data_saver mode prioritizes 360p (itag 18) for 60-70% bandwidth savings', () => {
        const mockStreamingData = {
          formats: [
            {
              itag: 22,
              url: 'https://googlevideo.com/stream_720p.mp4',
              qualityLabel: '720p',
              height: 720,
              mimeType: 'video/mp4'
            },
            {
              itag: 18,
              url: 'https://googlevideo.com/stream_360p.mp4',
              qualityLabel: '360p',
              height: 360,
              mimeType: 'video/mp4'
            }
          ]
        };

        const selected = selectOptimalStream(mockStreamingData, 'data_saver');
        assert.strictEqual(selected.itag, 18, 'Data saver mode must select 360p (itag 18)');
        assert.strictEqual(selected.url, 'https://googlevideo.com/stream_360p.mp4');
      });

      test('selectOptimalStream in standard / best mode prioritizes 720p (itag 22) or highest progressive resolution', () => {
        const mockStreamingData = {
          formats: [
            {
              itag: 18,
              url: 'https://googlevideo.com/stream_360p.mp4',
              qualityLabel: '360p',
              height: 360,
              mimeType: 'video/mp4'
            },
            {
              itag: 22,
              url: 'https://googlevideo.com/stream_720p.mp4',
              qualityLabel: '720p',
              height: 720,
              mimeType: 'video/mp4'
            }
          ]
        };

        const selected = selectOptimalStream(mockStreamingData, 'best');
        assert.strictEqual(selected.itag, 22, 'Best mode must select 720p (itag 22)');
        assert.strictEqual(selected.url, 'https://googlevideo.com/stream_720p.mp4');
      });

      test('selectOptimalStream falls back gracefully to adaptiveFormats when progressive formats are absent', () => {
        const mockStreamingData = {
          formats: [],
          adaptiveFormats: [
            {
              itag: 137,
              url: 'https://googlevideo.com/stream_1080p_dash.mp4',
              qualityLabel: '1080p',
              height: 1080,
              mimeType: 'video/mp4'
            },
            {
              itag: 136,
              url: 'https://googlevideo.com/stream_720p_dash.mp4',
              qualityLabel: '720p',
              height: 720,
              mimeType: 'video/mp4'
            }
          ]
        };

        const selected = selectOptimalStream(mockStreamingData, 'best');
        assert.strictEqual(selected.itag, 137, 'Must select highest adaptive video format');
        assert.strictEqual(selected.url, 'https://googlevideo.com/stream_1080p_dash.mp4');
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 23: YouTube In-Page UI Injection Lifecycle & Context Controller
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 23: YouTube In-Page UI Injection Lifecycle & Context Controller',
    ({ test }) => {
      const ytPlatform = require(path.join(PROJECT_ROOT, 'content/platforms/youtube.js'));
      const { getActiveVideoId, setButtonState } = ytPlatform;

      test('getActiveVideoId extracts video ID correctly from watch URL (?v=...) and Shorts (/shorts/...) URLs', () => {
        const originalWindow = global.window;
        try {
          global.window = {
            location: {
              search: '?v=dQw4w9WgXcQ&t=45s',
              pathname: '/watch'
            }
          };
          assert.strictEqual(getActiveVideoId(), 'dQw4w9WgXcQ');

          global.window = {
            location: {
              search: '',
              pathname: '/shorts/abcdef12345'
            }
          };
          assert.strictEqual(getActiveVideoId(), 'abcdef12345');

          global.window = {
            location: {
              search: '',
              pathname: '/feed/subscriptions'
            }
          };
          assert.strictEqual(getActiveVideoId(), null);
        } finally {
          global.window = originalWindow;
        }
      });

      test('setButtonState correctly transitions between idle, loading, success, and error states', () => {
        const mockBtn = new MockElement('button');
        mockBtn.type = 'button';

        // 1. Idle state
        setButtonState(mockBtn, 'idle');
        assert.ok(mockBtn.innerHTML.includes('Download MP4'));
        assert.ok(!mockBtn.classList.contains('is-loading'));

        // 2. Loading state
        setButtonState(mockBtn, 'loading', 'Mengekstrak stream...');
        assert.ok(mockBtn.classList.contains('is-loading'));
        assert.ok(mockBtn.innerHTML.includes('Mengekstrak stream...'));
        assert.ok(mockBtn.innerHTML.includes('yt-dl-spinner'));

        // 3. Success state
        setButtonState(mockBtn, 'success', 'Tersimpan!');
        assert.ok(mockBtn.classList.contains('is-success'));
        assert.ok(mockBtn.innerHTML.includes('Tersimpan!'));

        // 4. Downloaded / Already Downloaded state (Neutral Gray button)
        setButtonState(mockBtn, 'downloaded');
        assert.ok(
          mockBtn.classList.contains('is-downloaded'),
          'Button must have is-downloaded class'
        );
        assert.ok(
          mockBtn.innerHTML.includes('Sudah Diunduh'),
          'Button text must indicate Sudah Diunduh'
        );
        assert.strictEqual(
          mockBtn.disabled,
          false,
          'Button must remain clickable so user can re-download'
        );

        // 5. Error state
        setButtonState(mockBtn, 'error', 'Gagal');
        assert.ok(mockBtn.classList.contains('is-error'));
        assert.ok(mockBtn.innerHTML.includes('Gagal'));
      });

      test('showRedownloadConfirmation displays modal asking "Kamu udah download ini tadi, mau download lagi?"', () => {
        const { showRedownloadConfirmation, handleDownloadClick } = ytPlatform;
        assert.ok(
          typeof showRedownloadConfirmation === 'function',
          'showRedownloadConfirmation must be exported'
        );

        const mockBody = new MockElement('body');
        const originalDoc = global.document;
        global.document = {
          body: mockBody,
          getElementById: (id) => (mockBody.children || []).find((c) => c.id === id) || null,
          createElement: (tag) => new MockElement(tag),
          removeEventListener: () => {},
          addEventListener: () => {}
        };

        try {
          const btn = new MockElement('button');
          btn.classList.add('is-downloaded');
          showRedownloadConfirmation(btn, 'Tutorial JavaScript Modern');

          const modal = mockBody.children.find((c) => c.id === 'yt-dl-confirm-modal');
          assert.ok(modal, 'Confirmation overlay modal must be mounted into DOM');
          assert.ok(
            modal.classList.contains('yt-dl-confirm-overlay'),
            'Modal must have overlay class'
          );
          assert.ok(
            modal.innerHTML.includes('Kamu udah download ini tadi, mau download lagi?'),
            'Modal must prompt user with exact Indonesian copy'
          );
          assert.ok(modal.innerHTML.includes('Batal'), 'Modal must include Batal button');
          assert.ok(
            modal.innerHTML.includes('Download Lagi'),
            'Modal must include Download Lagi button'
          );
          assert.ok(
            modal.innerHTML.includes('Tutorial JavaScript Modern'),
            'Modal must render video title'
          );
        } finally {
          global.document = originalDoc;
        }
      });

      test('handleDownloadClick intercepts already downloaded videos and prompts confirmation instead of downloading immediately', async () => {
        const { handleDownloadClick } = ytPlatform;
        assert.ok(
          typeof handleDownloadClick === 'function',
          'handleDownloadClick must be exported'
        );

        const btn = new MockElement('button');
        btn.classList.add('is-downloaded');

        const mockBody = new MockElement('body');
        const originalDoc = global.document;
        global.document = {
          body: mockBody,
          getElementById: (id) => (mockBody.children || []).find((c) => c.id === id) || null,
          createElement: (tag) => new MockElement(tag),
          removeEventListener: () => {},
          addEventListener: () => {}
        };

        try {
          const result = await handleDownloadClick(btn, false);
          assert.strictEqual(result.success, false);
          assert.strictEqual(
            result.prompted,
            true,
            'Must return prompted: true and not start downloading immediately'
          );
          const modal = mockBody.children.find((c) => c.id === 'yt-dl-confirm-modal');
          assert.ok(modal, 'Confirmation modal must be displayed to the user');
        } finally {
          global.document = originalDoc;
        }
      });

      test('getEstimatedSizes calculates accurate size predictions for 1080p, 720p, 480p, 360p based on video duration', () => {
        const { getEstimatedSizes, QUALITY_OPTIONS } = ytPlatform;
        assert.ok(typeof getEstimatedSizes === 'function', 'getEstimatedSizes must be exported');
        assert.ok(Array.isArray(QUALITY_OPTIONS), 'QUALITY_OPTIONS must be an array');
        assert.strictEqual(
          QUALITY_OPTIONS.length,
          4,
          'Must provide 4 quality tiers (1080p, 720p, 480p, 360p)'
        );

        // Test 4-minute video (240s)
        const sizes4min = getEstimatedSizes(240);
        assert.strictEqual(
          sizes4min['1080p'],
          '~120 MB',
          '1080p estimate for 240s must be ~120 MB'
        );
        assert.strictEqual(sizes4min['720p'], '~60 MB', '720p estimate for 240s must be ~60 MB');
        assert.strictEqual(sizes4min['480p'], '~30 MB', '480p estimate for 240s must be ~30 MB');
        assert.strictEqual(sizes4min['360p'], '~16 MB', '360p estimate for 240s must be ~16 MB');

        // Test 1-minute video / Short (60s)
        const sizes1min = getEstimatedSizes(60);
        assert.strictEqual(sizes1min['1080p'], '~30 MB', '1080p estimate for 60s must be ~30 MB');
        assert.strictEqual(sizes1min['720p'], '~15 MB', '720p estimate for 60s must be ~15 MB');
        assert.strictEqual(sizes1min['480p'], '~8 MB', '480p estimate for 60s must be ~8 MB');
        assert.strictEqual(sizes1min['360p'], '~4 MB', '360p estimate for 60s must be ~4 MB');
      });

      test('Popup controller detects YouTube URL, displays quality selector with estimated size badge', () => {
        const popupHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.html'), 'utf8');
        assert.ok(
          popupHtml.includes('id="state-youtube"'),
          'Popup HTML must declare #state-youtube'
        );
        assert.ok(popupHtml.includes('id="yt-title"'), 'Popup HTML must declare #yt-title');
        assert.ok(popupHtml.includes('id="yt-author"'), 'Popup HTML must declare #yt-author');
        assert.ok(
          popupHtml.includes('id="btn-open-youtube"'),
          'Popup HTML must declare #btn-open-youtube launcher'
        );
        assert.ok(
          popupHtml.includes('id="yt-quality-select"'),
          'Popup HTML must declare #yt-quality-select'
        );
        assert.ok(
          popupHtml.includes('id="yt-quality-est-badge"'),
          'Popup HTML must declare #yt-quality-est-badge'
        );

        const popupJs = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.js'), 'utf8');
        assert.ok(
          popupJs.includes("host === 'youtube.com'"),
          'popup.js must detect youtube.com host'
        );
        assert.ok(
          popupJs.includes('Unduh Video YouTube'),
          'popup.js must customize button text for YouTube'
        );
        assert.ok(popupJs.includes('btnOpenYoutube'), 'popup.js must bind btnOpenYoutube');
        assert.ok(
          popupJs.includes('CHECK_DOWNLOADED_STATUS'),
          'popup.js must check downloaded status for YouTube'
        );
        assert.ok(popupJs.includes('ytQualitySelect'), 'popup.js must bind ytQualitySelect');
        assert.ok(
          popupJs.includes('cachedEstimatedSizes'),
          'popup.js must maintain cachedEstimatedSizes'
        );

        const popupCss = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.css'), 'utf8');
        assert.ok(popupCss.includes('.yt-quality-box'), 'popup.css must style .yt-quality-box');
        assert.ok(
          popupCss.includes('.yt-quality-est-badge'),
          'popup.css must style .yt-quality-est-badge'
        );
        assert.ok(
          popupCss.includes('.yt-quality-select'),
          'popup.css must style .yt-quality-select'
        );
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 24: yt-dlp Real-Time Progress Streaming, Duplicate Guard & Active Tasks Concurrency
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 24: yt-dlp Real-Time Progress Streaming, Duplicate Guard & Active Tasks Concurrency',
    ({ test }) => {
      test('Popup UI contains Active Tasks Card markup and styling for concurrent downloads', () => {
        const popupHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.html'), 'utf8');
        assert.ok(
          popupHtml.includes('id="active-tasks-card"'),
          'Popup HTML must declare #active-tasks-card'
        );
        assert.ok(
          popupHtml.includes('id="active-tasks-count"'),
          'Popup HTML must declare #active-tasks-count'
        );
        assert.ok(
          popupHtml.includes('id="active-tasks-list"'),
          'Popup HTML must declare #active-tasks-list'
        );

        const popupCss = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.css'), 'utf8');
        assert.ok(
          popupCss.includes('.active-tasks-card'),
          'Popup CSS must style .active-tasks-card'
        );
        assert.ok(
          popupCss.includes('.active-task-bar-fill'),
          'Popup CSS must style progress fill bar'
        );
      });

      test('Service worker enforces Duplicate Download Guard and broadcasts active progress', () => {
        const swCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'background/service_worker.js'),
          'utf8'
        );
        assert.ok(
          swCode.includes('activeDownloads[videoId]'),
          'Service worker must maintain activeDownloads dictionary'
        );
        assert.ok(
          swCode.includes('alreadyActive: true'),
          'Service worker must return alreadyActive when concurrent download requested'
        );
        assert.ok(
          swCode.includes("type: 'YT_NATIVE_PROGRESS'"),
          'Service worker must broadcast YT_NATIVE_PROGRESS'
        );
        assert.ok(
          swCode.includes("type: 'YT_NATIVE_COMPLETE'"),
          'Service worker must broadcast YT_NATIVE_COMPLETE'
        );
        assert.ok(
          swCode.includes('updateActionBadge'),
          'Service worker must update Chrome action badge with percentage'
        );
      });

      test('YouTube platform script synchronizes active downloads on injection and handles alreadyActive', () => {
        const ytPlatformCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/platforms/youtube.js'),
          'utf8'
        );
        assert.ok(
          ytPlatformCode.includes('syncActiveDownloadState'),
          'youtube.js must define syncActiveDownloadState'
        );
        assert.ok(
          ytPlatformCode.includes('response.alreadyActive'),
          'youtube.js must handle response.alreadyActive gracefully'
        );
        assert.ok(
          ytPlatformCode.includes('YT_NATIVE_PROGRESS'),
          'youtube.js must listen for YT_NATIVE_PROGRESS'
        );
        assert.ok(
          ytPlatformCode.includes('YT_NATIVE_COMPLETE'),
          'youtube.js must listen for YT_NATIVE_COMPLETE'
        );
      });

      test('Native host downloader_host uses --newline, --concurrent-fragments, --progress-template, and orphan cleanup', () => {
        const hostCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'native_host/downloader_host.js'),
          'utf8'
        );
        assert.ok(
          hostCode.includes("'--newline'"),
          'downloader_host.js must supply --newline to yt-dlp spawn arguments'
        );
        assert.ok(
          hostCode.includes("'--concurrent-fragments'"),
          'downloader_host.js must use --concurrent-fragments 4'
        );
        assert.ok(
          hostCode.includes("'--progress-template'"),
          'downloader_host.js must use structured --progress-template'
        );
        assert.ok(
          hostCode.includes('resolvePythonBinary'),
          'downloader_host.js must resolve real Python avoiding WindowsApps stub'
        );
        assert.ok(
          hostCode.includes('killActiveChild'),
          'downloader_host.js must implement killActiveChild to eliminate orphan processes'
        );
        assert.ok(
          hostCode.includes('Part 2/2: Audio'),
          'downloader_host.js must detect audio stream destination'
        );
        assert.ok(
          hostCode.includes('Muxing MP4'),
          'downloader_host.js must detect ffmpeg muxing phase'
        );
        assert.ok(
          hostCode.includes('fileSizeFormatted'),
          'downloader_host.js must calculate real file size using fs.statSync'
        );
      });

      test('Service worker implements MAX_CONCURRENT_DOWNLOADS queue limiter and desktop notifications', () => {
        const swCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'background/service_worker.js'),
          'utf8'
        );
        assert.ok(
          swCode.includes('MAX_CONCURRENT_DOWNLOADS'),
          'service_worker.js must define MAX_CONCURRENT_DOWNLOADS'
        );
        assert.ok(
          swCode.includes('checkAndProcessQueue'),
          'service_worker.js must manage download queue processing'
        );
        assert.ok(
          swCode.includes('showDesktopNotification'),
          'service_worker.js must define showDesktopNotification'
        );
        assert.ok(
          swCode.includes('chrome.notifications.create'),
          'service_worker.js must invoke chrome.notifications.create'
        );

        const ytPlatformCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/platforms/youtube.js'),
          'utf8'
        );
        assert.ok(
          ytPlatformCode.includes('showInPageToast'),
          'youtube.js must define showInPageToast'
        );
        assert.ok(
          ytPlatformCode.includes('yt-dl-toast-container'),
          'youtube.js must render #yt-dl-toast-container'
        );
        assert.ok(
          ytPlatformCode.includes('yt-dl-toast-error-box'),
          'youtube.js must render error box with error code'
        );

        const ytCss = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/styles/youtube.css'),
          'utf8'
        );
        assert.ok(
          ytCss.includes('#yt-dl-toast-container'),
          'youtube.css must style toast container at bottom right'
        );
        assert.ok(ytCss.includes('.yt-dl-toast'), 'youtube.css must style floating toast');
      });

      test('Already downloaded UX: gray button styling, confirmation modal, and service worker history status check', () => {
        const ytCss = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/styles/youtube.css'),
          'utf8'
        );
        assert.ok(
          ytCss.includes('.yt-direct-dl-btn.is-downloaded'),
          'youtube.css must style neutral gray button for is-downloaded'
        );
        assert.ok(
          ytCss.includes('.yt-dl-confirm-overlay'),
          'youtube.css must style confirmation modal overlay'
        );
        assert.ok(
          ytCss.includes('.yt-dl-confirm-card'),
          'youtube.css must style confirmation card'
        );
        assert.ok(ytCss.includes('.yt-dl-btn-cancel'), 'youtube.css must style cancel button');
        assert.ok(ytCss.includes('.yt-dl-btn-confirm'), 'youtube.css must style confirm button');

        const popupCss = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.css'), 'utf8');
        assert.ok(
          popupCss.includes('.btn-primary.is-downloaded'),
          'popup.css must style is-downloaded state for popup button'
        );

        const swCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'background/service_worker.js'),
          'utf8'
        );
        assert.ok(
          swCode.includes('CHECK_DOWNLOADED_STATUS'),
          'service_worker.js must handle CHECK_DOWNLOADED_STATUS IPC'
        );
        assert.ok(
          swCode.includes('downloadHistory'),
          'service_worker.js must persist and query downloadHistory'
        );

        const ytJs = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/platforms/youtube.js'),
          'utf8'
        );
        assert.ok(
          ytJs.includes('showRedownloadConfirmation'),
          'youtube.js must define showRedownloadConfirmation'
        );
        assert.ok(ytJs.includes('is-downloaded'), 'youtube.js must toggle is-downloaded class');
        assert.ok(
          ytJs.includes('Kamu udah download ini tadi, mau download lagi?'),
          'youtube.js must prompt user with exact Indonesian confirmation text'
        );
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 25: Security Shield (Anti-Clickjack, Popunder Defuser & Adblock DNR)
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 25: Security Shield (Anti-Clickjack, Popunder Defuser & Adblock DNR)',
    ({ test }) => {
      const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      test('Manifest registers shield_bridge.js in MAIN world at document_start', () => {
        const shieldScript = manifest.content_scripts.find(
          (s) => Array.isArray(s.js) && s.js.includes('content/injected/shield_bridge.js')
        );
        assert.ok(shieldScript, 'shield_bridge.js entry must exist in content_scripts');
        assert.strictEqual(
          shieldScript.world,
          'MAIN',
          'shield_bridge.js must run in MAIN world for stealth prototype trapping'
        );
        assert.strictEqual(
          shieldScript.run_at,
          'document_start',
          'shield_bridge.js must run at document_start'
        );
        assert.ok(
          shieldScript.matches.includes('*://*.jwplyr.com/*'),
          'must match jwplyr.com streaming mirror'
        );
        assert.ok(
          shieldScript.matches.includes('*://*.komiku.org/*'),
          'must match komiku.org manga reader'
        );

        const listenerScript = manifest.content_scripts.find(
          (s) => s.js && s.js.includes('content/platforms/shield_listener.js')
        );
        assert.ok(listenerScript, 'shield_listener.js must be registered in content_scripts');
        assert.strictEqual(
          listenerScript.run_at,
          'document_start',
          'shield_listener.js must run at document_start'
        );
        assert.ok(
          listenerScript.matches.includes('*://*.komiku.org/*'),
          'shield_listener must match komiku.org'
        );
      });

      test('Shield bridge script exists on disk, passes syntax check, and implements stealth [native code]', () => {
        const shieldPath = path.join(PROJECT_ROOT, 'content/injected/shield_bridge.js');
        assert.ok(
          fs.existsSync(shieldPath),
          'content/injected/shield_bridge.js must exist on disk'
        );
        const stat = fs.statSync(shieldPath);
        assert.ok(stat.size > 200, 'shield_bridge.js must have non-trivial size');

        const res = spawnSync(process.execPath, ['--check', shieldPath], { encoding: 'utf8' });
        assert.strictEqual(res.status, 0, 'shield_bridge.js must pass node --check syntax check');

        const code = fs.readFileSync(shieldPath, 'utf8');
        assert.ok(
          code.includes('function open() { [native code] }'),
          'must implement stealth toString spoofing returning [native code]'
        );
        assert.ok(
          code.includes('Node.prototype.appendChild'),
          'must implement iframe function harvesting trap'
        );
        assert.ok(
          code.includes('HTMLAnchorElement.prototype.click'),
          'must guard against synthetic anchor click popunders'
        );
        assert.ok(
          code.includes('pointer-events'),
          'must neutralize transparent overlays with pointer-events: none'
        );
        assert.ok(
          code.includes('canRunAds'),
          'must emulate canRunAds for anti-anti-adblock bypass'
        );
        assert.ok(code.includes('Swal'), 'must hook SweetAlert2 (Swal) to defuse modal traps');
        assert.ok(
          code.includes('runYouTubeAdSkipper'),
          'must implement runYouTubeAdSkipper auto-skipper loop'
        );
        assert.ok(
          code.includes('simulateRichClick'),
          'must implement simulateRichClick for trusted event dispatch'
        );
        assert.ok(
          code.includes('.ytp-ad-skip-button-modern'),
          'must target modern YouTube skip button classes'
        );
        assert.ok(code.includes('lewati'), 'must target Indonesian Lewati skip button text');
        assert.ok(
          code.includes('runSafelinkDefuser'),
          'must implement runSafelinkDefuser for Bicolink, Bewbin & Safelinks'
        );
        assert.ok(
          code.includes('putar dengan suara'),
          'must auto-trigger Putar dengan suara safelink unlock buttons'
        );
        assert.ok(
          code.includes('ytd-companion-slot-renderer'),
          'must hide YouTube sidebar companion ad banners'
        );
        assert.ok(code.includes('playbackRate = 16'), 'must fast-forward video ads at 16x speed');
        assert.ok(
          code.includes("id.includes('mungil-')") || code.includes('mungil-'),
          'must strictly exempt all mungil- elements and modals from overlay neutralization'
        );
      });

      test('service_worker.js defines dynamic DNR adblock rules and synchronization helper', () => {
        const sw = require('./background/service_worker.js');
        assert.ok(
          Array.isArray(sw.ADBLOCK_DYNAMIC_RULES),
          'ADBLOCK_DYNAMIC_RULES must be an array'
        );
        assert.ok(
          sw.ADBLOCK_DYNAMIC_RULES.length >= 18,
          'must define at least 18 ad/popunder dynamic rules'
        );

        const blockedDomains = sw.ADBLOCK_DYNAMIC_RULES.map((r) => r.condition.urlFilter);
        assert.ok(blockedDomains.includes('||ophionbonish.cfd^'), 'must block ophionbonish.cfd');
        assert.ok(blockedDomains.includes('||073m.com^'), 'must block 073m.com');
        assert.ok(blockedDomains.includes('||frs2c.com^'), 'must block frs2c.com');
        assert.ok(
          blockedDomains.includes('||fundingchoicesmessages.google.com^'),
          'must block fundingchoicesmessages.google.com'
        );
        assert.ok(
          blockedDomains.includes('||googleads.g.doubleclick.net^'),
          'must block googleads.g.doubleclick.net'
        );

        for (const rule of sw.ADBLOCK_DYNAMIC_RULES) {
          assert.strictEqual(rule.action.type, 'block', 'every rule must declare block action');
          assert.ok(
            rule.condition && rule.condition.urlFilter,
            'every rule must declare urlFilter'
          );
          assert.ok(typeof rule.id === 'number', 'rule id must be integer');
        }

        assert.strictEqual(
          typeof sw.syncShieldAdblockRules,
          'function',
          'syncShieldAdblockRules must be a function'
        );
      });

      test('Popup UI contains Security Shield card, toggles, and opt-in default state (unchecked)', () => {
        const popupHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.html'), 'utf8');
        assert.ok(
          popupHtml.includes('id="shield-card"'),
          'must include #shield-card in popup.html'
        );
        assert.ok(
          popupHtml.includes('id="toggle-shield-clickjack"'),
          'must include #toggle-shield-clickjack in popup.html'
        );
        assert.ok(
          popupHtml.includes('id="toggle-shield-adblock"'),
          'must include #toggle-shield-adblock in popup.html'
        );
        assert.ok(
          popupHtml.includes('id="shield-overall-status"'),
          'must include #shield-overall-status in popup.html'
        );

        // Verify neither toggle is checked by default in HTML (opt-in requirement)
        assert.ok(
          !popupHtml.includes('id="toggle-shield-clickjack" checked'),
          'toggle-shield-clickjack MUST NOT be checked by default (opt-in)'
        );
        assert.ok(
          !popupHtml.includes('id="toggle-shield-adblock" checked'),
          'toggle-shield-adblock MUST NOT be checked by default (opt-in)'
        );

        const popupJs = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.js'), 'utf8');
        assert.ok(
          popupJs.includes('updateShieldUI'),
          'popup.js must implement updateShieldUI helper'
        );
        assert.ok(
          popupJs.includes('shield_clickjack'),
          'popup.js must synchronize shield_clickjack storage'
        );
        assert.ok(
          popupJs.includes('shield_adblock'),
          'popup.js must synchronize shield_adblock storage'
        );
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 26: TeraBox Platform Registration, NTFS Sanitization & Batch Lifecycle
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 26: TeraBox Platform Registration, NTFS Sanitization & Batch Lifecycle',
    ({ test }) => {
      const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      test('Manifest registers terabox_bridge.js in MAIN world and terabox.js in ISOLATED world', () => {
        const bridgeScript = manifest.content_scripts.find(
          (s) => Array.isArray(s.js) && s.js.includes('content/injected/terabox_bridge.js')
        );
        assert.ok(bridgeScript, 'terabox_bridge.js entry must exist in content_scripts');
        assert.strictEqual(
          bridgeScript.world,
          'MAIN',
          'terabox_bridge.js must run in MAIN world for window.yunData scope'
        );
        assert.strictEqual(
          bridgeScript.run_at,
          'document_start',
          'terabox_bridge.js must run at document_start'
        );
        assert.ok(bridgeScript.matches.includes('*://*.terabox.com/*'), 'must match terabox.com');
        assert.ok(bridgeScript.matches.includes('*://*.terabox.app/*'), 'must match terabox.app');
        assert.ok(bridgeScript.matches.includes('*://*.1024tera.com/*'), 'must match 1024tera.com');

        const platformScript = manifest.content_scripts.find(
          (s) => Array.isArray(s.js) && s.js.includes('content/platforms/terabox.js')
        );
        assert.ok(platformScript, 'terabox.js entry must exist in content_scripts');
        assert.strictEqual(
          platformScript.run_at,
          'document_idle',
          'terabox.js must run at document_idle'
        );
        assert.ok(
          platformScript.css && platformScript.css.includes('content/styles/terabox.css'),
          'terabox.js must register content/styles/terabox.css'
        );

        const webRes = manifest.web_accessible_resources.find(
          (r) =>
            Array.isArray(r.resources) && r.resources.includes('content/injected/terabox_bridge.js')
        );
        assert.ok(webRes, 'terabox_bridge.js must be exposed in web_accessible_resources');

        assert.ok(
          manifest.host_permissions.includes('*://*.terabox.com/*'),
          'host_permissions must include terabox.com'
        );
        assert.ok(
          manifest.host_permissions.includes('*://*.terabox.app/*'),
          'host_permissions must include terabox.app'
        );
      });

      test('TeraBox scripts and stylesheets exist on disk with valid size and syntax', () => {
        const bridgePath = path.join(PROJECT_ROOT, 'content/injected/terabox_bridge.js');
        const platformPath = path.join(PROJECT_ROOT, 'content/platforms/terabox.js');
        const stylePath = path.join(PROJECT_ROOT, 'content/styles/terabox.css');

        assert.ok(fs.existsSync(bridgePath), 'terabox_bridge.js must exist on disk');
        assert.ok(fs.existsSync(platformPath), 'terabox.js must exist on disk');
        assert.ok(fs.existsSync(stylePath), 'terabox.css must exist on disk');

        const bridgeRes = spawnSync(process.execPath, ['--check', bridgePath], {
          encoding: 'utf8'
        });
        assert.strictEqual(bridgeRes.status, 0, 'terabox_bridge.js must pass node --check');

        const platformRes = spawnSync(process.execPath, ['--check', platformPath], {
          encoding: 'utf8'
        });
        assert.strictEqual(platformRes.status, 0, 'terabox.js must pass node --check');
      });

      test('TeraBox Windows NTFS Filename Sanitization Unit & Boundary Tests', () => {
        const { sanitizeTeraBoxFilename } = require('./content/platforms/terabox.js');

        // Win32 illegal characters
        assert.strictEqual(
          sanitizeTeraBoxFilename('my:video/file*name?test"1<2>3|ok.mp4'),
          'my-video-file-name-test-1-2-3-ok.mp4'
        );

        // Win32 reserved device names
        assert.strictEqual(sanitizeTeraBoxFilename('CON.zip'), 'TeraBox_CON.zip');
        assert.strictEqual(sanitizeTeraBoxFilename('NUL.tar.gz'), 'TeraBox_NUL.tar.gz');
        assert.strictEqual(sanitizeTeraBoxFilename('COM1.mp4'), 'TeraBox_COM1.mp4');

        // Unicode & CJK characters preserved
        assert.strictEqual(
          sanitizeTeraBoxFilename('【超高清】剧集_01.mkv'),
          '【超高清】剧集_01.mkv'
        );
        assert.strictEqual(
          sanitizeTeraBoxFilename('Anime_Episode [1080p].mp4'),
          'Anime_Episode [1080p].mp4'
        );

        // Trailing dots and spaces collapsed
        assert.strictEqual(sanitizeTeraBoxFilename('Document....'), 'Document');
        assert.strictEqual(sanitizeTeraBoxFilename('MyFile   '), 'MyFile');

        // Fallbacks
        assert.strictEqual(sanitizeTeraBoxFilename(''), 'TeraBox_File');
        assert.strictEqual(sanitizeTeraBoxFilename(null), 'TeraBox_File');
        assert.strictEqual(sanitizeTeraBoxFilename(undefined), 'TeraBox_File');

        // Extreme length boundary value analysis (truncated <= 180 chars preserving extension)
        const longName = 'A'.repeat(250) + '.mp4';
        const sanitizedLong = sanitizeTeraBoxFilename(longName);
        assert.ok(sanitizedLong.length <= 180, 'sanitized filename must be <= 180 characters');
        assert.ok(sanitizedLong.endsWith('.mp4'), 'extension must be preserved after truncation');
      });

      test('Popup UI and background service worker implement TeraBox state detection and referer routing', () => {
        const popupHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.html'), 'utf8');
        assert.ok(
          popupHtml.includes('id="state-terabox"'),
          'popup.html must include #state-terabox'
        );
        assert.ok(popupHtml.includes('id="tb-title"'), 'popup.html must include #tb-title');
        assert.ok(popupHtml.includes('id="tb-desc"'), 'popup.html must include #tb-desc');
        assert.ok(
          popupHtml.includes('id="tb-status-chip"'),
          'popup.html must include #tb-status-chip'
        );

        const popupJs = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.js'), 'utf8');
        assert.ok(popupJs.includes('isTeraBox'), 'popup.js must detect isTeraBox');
        assert.ok(
          popupJs.includes('GET_TERABOX_FILE_INFO'),
          'popup.js must query GET_TERABOX_FILE_INFO'
        );

        const sw = require('./background/service_worker.js');
        assert.strictEqual(
          typeof sw.sanitizeTeraBoxFilename,
          'function',
          'service_worker.js must export sanitizeTeraBoxFilename'
        );
      });

      test('Dual-Anchor In-Player & shorturlinfo interceptor verification', () => {
        const bridgeCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/injected/terabox_bridge.js'),
          'utf8'
        );
        assert.ok(bridgeCode.includes('shorturlinfo'), 'bridge must intercept shorturlinfo');
        assert.ok(bridgeCode.includes('streaming'), 'bridge must intercept streaming');
        assert.ok(bridgeCode.includes('templateData'), 'bridge must sync with templateData');
        assert.ok(
          bridgeCode.includes('TERABOX_FILES_UPDATED'),
          'bridge must dispatch TERABOX_FILES_UPDATED'
        );

        const cssContent = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/styles/terabox.css'),
          'utf8'
        );
        assert.ok(
          cssContent.includes('.mungil-terabox-player-bar'),
          'css must define in-player bar'
        );

        const { getDomFallbackFile } = require('./content/platforms/terabox.js');
        const fallback = getDomFallbackFile();
        assert.ok(
          fallback && fallback.filename,
          'getDomFallbackFile must return a valid file object with filename'
        );
        assert.ok(
          fallback.filename.endsWith('.mp4'),
          'fallback filename must default with .mp4 extension'
        );
      });

      test('classifyFiles separates videos, images, and folders; prioritizes single video', () => {
        const { classifyFiles } = require('./content/platforms/terabox.js');

        const mockFiles = [
          {
            fs_id: '101',
            filename: 'Chuchu_20261020_161947.mp4',
            size: 154200000,
            formatted_size: '147.06 MB',
            isdir: false,
            isVideo: true,
            isImage: false,
            category: 1
          },
          {
            fs_id: '102',
            filename: 'Join Telegram @semutKW.jpg',
            size: 45000,
            formatted_size: '43.95 KB',
            isdir: false,
            isVideo: false,
            isImage: true,
            category: 3
          },
          {
            fs_id: '103',
            filename: 'pic',
            size: 0,
            formatted_size: '0 B',
            isdir: true,
            isVideo: false,
            isImage: false,
            category: 6
          }
        ];

        const classified = classifyFiles(mockFiles);
        assert.strictEqual(classified.folders.length, 1, 'must detect 1 folder');
        assert.strictEqual(classified.folders[0].filename, 'pic');
        assert.strictEqual(classified.videos.length, 1, 'must detect 1 video');
        assert.strictEqual(classified.videos[0].filename, 'Chuchu_20261020_161947.mp4');
        assert.strictEqual(classified.images.length, 1, 'must detect 1 image');
        assert.strictEqual(classified.images[0].filename, 'Join Telegram @semutKW.jpg');
        assert.strictEqual(classified.nonDirs.length, 2, 'must have 2 non-directory files');

        // Verify bridge code implements POST with form body and fid_list
        const bridgeCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/injected/terabox_bridge.js'),
          'utf8'
        );
        assert.ok(
          bridgeCode.includes('fid_list'),
          'bridge must encode fid_list in POST /share/download body'
        );
        assert.ok(
          bridgeCode.includes('[watch currentFile]'),
          'bridge must hook [watch currentFile] console logs'
        );

        // Verify popup.js checks isSingleVideo
        const popupJs = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.js'), 'utf8');
        assert.ok(popupJs.includes('isSingleVideo'), 'popup.js must track isSingleVideo');
      });

      test('TeraBox multi-resolution quality selector and size estimation integration', () => {
        const popupHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.html'), 'utf8');
        assert.ok(
          popupHtml.includes('id="tb-quality-box"'),
          'popup.html must declare #tb-quality-box'
        );
        assert.ok(
          popupHtml.includes('id="tb-quality-select"'),
          'popup.html must declare #tb-quality-select'
        );
        assert.ok(
          popupHtml.includes('id="tb-quality-est-badge"'),
          'popup.html must declare #tb-quality-est-badge'
        );

        const popupCss = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.css'), 'utf8');
        assert.ok(popupCss.includes('.tb-quality-box'), 'popup.css must style .tb-quality-box');
        assert.ok(
          popupCss.includes('.tb-quality-select'),
          'popup.css must style .tb-quality-select'
        );
        assert.ok(
          popupCss.includes('.tb-quality-est-badge'),
          'popup.css must style .tb-quality-est-badge'
        );

        const popupJs = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.js'), 'utf8');
        assert.ok(
          popupJs.includes('tbSelectedQuality'),
          'popup.js must save/restore tbSelectedQuality in chrome.storage'
        );
        assert.ok(
          popupJs.includes('TRIGGER_DOWNLOAD') && popupJs.includes('quality: currentTbQuality'),
          'popup.js must pass quality in TRIGGER_DOWNLOAD message'
        );

        const teraboxJs = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/platforms/terabox.js'),
          'utf8'
        );
        assert.ok(
          teraboxJs.includes('mungil-tb-floating-quality'),
          'terabox.js must inject quality dropdown into floating bar'
        );
        assert.ok(
          teraboxJs.includes('mungil-tb-quality-select'),
          'terabox.js must inject quality dropdown into player bar'
        );
        assert.ok(
          teraboxJs.includes('estimatedSizes'),
          'terabox.js must calculate estimatedSizes in GET_TERABOX_FILE_INFO'
        );
        assert.ok(
          teraboxJs.includes('message.quality ||'),
          'terabox.js must extract message.quality in TRIGGER_DOWNLOAD'
        );

        const bridgeJs = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/injected/terabox_bridge.js'),
          'utf8'
        );
        assert.ok(
          bridgeJs.includes('preferredType = null'),
          'terabox_bridge.js must default preferredType to null for raw direct links'
        );
        assert.ok(
          bridgeJs.includes('/share/streaming?') && bridgeJs.includes('preferredType'),
          'terabox_bridge.js must route to streaming URL when preferredType is provided'
        );
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 27: CosplayTele Platform Registration, NTFS Sanitization & Batch Lifecycle
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 27: CosplayTele Platform Registration, NTFS Sanitization & Batch Lifecycle',
    ({ test }) => {
      const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      test('Manifest V3 registers cosplaytele.com in host_permissions, content_scripts & web_accessible_resources', () => {
        assert.ok(
          manifest.host_permissions.includes('*://*.cosplaytele.com/*'),
          'host_permissions must include *://*.cosplaytele.com/*'
        );

        const contentEntry = manifest.content_scripts.find(
          (s) => Array.isArray(s.js) && s.js.includes('content/platforms/cosplaytele.js')
        );
        assert.ok(contentEntry, 'content_scripts must have entry for cosplaytele.js');
        assert.ok(
          contentEntry.matches.includes('*://*.cosplaytele.com/*'),
          'cosplaytele.js matches must include *://*.cosplaytele.com/*'
        );
        assert.ok(
          contentEntry.css && contentEntry.css.includes('content/styles/cosplaytele.css'),
          'contentEntry must register content/styles/cosplaytele.css'
        );
        assert.strictEqual(
          contentEntry.run_at,
          'document_idle',
          'cosplaytele.js must run at document_idle'
        );

        const webRes = manifest.web_accessible_resources.find(
          (r) => Array.isArray(r.matches) && r.matches.includes('*://*.cosplaytele.com/*')
        );
        assert.ok(
          webRes,
          'web_accessible_resources must declare resource entry matching *://*.cosplaytele.com/*'
        );
      });

      test('CosplayTele script and stylesheet exist on disk with valid syntax and non-zero size', () => {
        const platformPath = path.join(PROJECT_ROOT, 'content/platforms/cosplaytele.js');
        const stylePath = path.join(PROJECT_ROOT, 'content/styles/cosplaytele.css');

        assert.ok(fs.existsSync(platformPath), 'cosplaytele.js must exist on disk');
        assert.ok(fs.existsSync(stylePath), 'cosplaytele.css must exist on disk');

        const platformStat = fs.statSync(platformPath);
        const styleStat = fs.statSync(stylePath);

        assert.ok(platformStat.size > 1000, 'cosplaytele.js must have substantial content (>1KB)');
        assert.ok(styleStat.size > 1000, 'cosplaytele.css must have substantial content (>1KB)');

        const checkRes = spawnSync(process.execPath, ['--check', platformPath], {
          encoding: 'utf8'
        });
        assert.strictEqual(
          checkRes.status,
          0,
          'cosplaytele.js must pass node --check syntax validation'
        );
      });

      test('Service Worker registers DeclarativeNetRequest Rule 61 for CosplayTele Anti-Hotlinking', () => {
        const sw = require('./background/service_worker.js');
        assert.ok(
          Array.isArray(sw.COSPLAYTELE_CDN_RULES),
          'service_worker.js must export COSPLAYTELE_CDN_RULES array'
        );
        const rule61 = sw.COSPLAYTELE_CDN_RULES.find((r) => r.id === 61);
        assert.ok(rule61, 'Rule 61 must exist in COSPLAYTELE_CDN_RULES');
        assert.strictEqual(
          rule61.condition.urlFilter,
          '*cosplaytele.com*',
          'Rule 61 must filter *cosplaytele.com*'
        );
        assert.ok(
          rule61.action.requestHeaders.some(
            (h) => h.header === 'Referer' && h.value === 'https://cosplaytele.com/'
          ),
          'Rule 61 must set Referer to https://cosplaytele.com/'
        );
        assert.ok(
          rule61.action.requestHeaders.some(
            (h) => h.header === 'Origin' && h.value === 'https://cosplaytele.com'
          ),
          'Rule 61 must set Origin to https://cosplaytele.com'
        );
      });

      test('Windows NTFS Filename Sanitization for CosplayTele posts', () => {
        const {
          sanitizeCosplayteleTitle,
          formatCosplayteleFilename
        } = require('./content/platforms/cosplaytele.js');

        // Basic entity replacement
        assert.strictEqual(
          sanitizeCosplayteleTitle(
            'Yukina Sakura cosplay Reze &#8211; Chainsaw Man &#8220;63 photos&#8221;'
          ),
          'Yukina Sakura cosplay Reze - Chainsaw Man 63 photos'
        );

        // Win32 forbidden characters (* ? : " < > | / \)
        assert.strictEqual(
          sanitizeCosplayteleTitle('Cosplay: Maid*Rem? <Special> "Edition"|One/Two\\Three'),
          'Cosplay - MaidRem Special Edition - One - Two - Three'
        );

        // Formatting filename with index padding and extension
        assert.strictEqual(
          formatCosplayteleFilename({
            title: 'Yukina Sakura cosplay Reze',
            index: 3,
            ext: 'webp'
          }),
          'Yukina Sakura cosplay Reze - 03.webp'
        );

        assert.strictEqual(
          formatCosplayteleFilename({
            title: 'Yukina Sakura cosplay Reze',
            index: 12,
            ext: '.jpg'
          }),
          'Yukina Sakura cosplay Reze - 12.jpg'
        );

        // Fallback title on null/undefined
        assert.strictEqual(
          formatCosplayteleFilename({ title: null, index: 1 }),
          'CosplayTele_Photo - 01.webp'
        );
      });

      test('CosplayteleQueue concurrency, pacing delay, progress tracking and cancellation', async () => {
        const { CosplayteleQueue } = require('./content/platforms/cosplaytele.js');

        const queue = new CosplayteleQueue({
          concurrency: 2,
          delayMs: 20
        });

        const completed = [];
        for (let i = 1; i <= 4; i++) {
          const itemIdx = i;
          queue.add({
            id: itemIdx,
            task: async () => {
              await new Promise((r) => setTimeout(r, 10));
              completed.push(itemIdx);
            }
          });
        }

        const completionPromise = new Promise((resolve) => {
          queue.onAllComplete = resolve;
        });

        queue.start();
        const result = await completionPromise;

        assert.strictEqual(result.total, 4, 'total must be 4');
        assert.strictEqual(result.completed, 4, 'all 4 items must complete');
        assert.strictEqual(result.failed, 0, '0 items failed');
        assert.strictEqual(completed.length, 4, 'completed array must have 4 items');
      });

      test('Popup UI recognizes CosplayTele tab and renders gallery state container', () => {
        const popupHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.html'), 'utf8');
        assert.ok(
          popupHtml.includes('id="state-cosplaytele"'),
          'popup.html must declare #state-cosplaytele'
        );
        assert.ok(popupHtml.includes('id="ct-title"'), 'popup.html must declare #ct-title');
        assert.ok(popupHtml.includes('id="ct-desc"'), 'popup.html must declare #ct-desc');
        assert.ok(
          popupHtml.includes('id="ct-status-chip"'),
          'popup.html must declare #ct-status-chip'
        );

        const popupJs = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.js'), 'utf8');
        assert.ok(popupJs.includes('isCosplaytele'), 'popup.js must detect isCosplaytele');
        assert.ok(
          popupJs.includes('cosplaytele.com'),
          'popup.js must match cosplaytele.com domain'
        );
        assert.ok(
          popupJs.includes('stateCosplaytele'),
          'popup.js must toggle stateCosplaytele display'
        );

        const popupCss = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.css'), 'utf8');
        assert.ok(popupCss.includes('.meta-label-ct'), 'popup.css must style .meta-label-ct');
      });

      test('Service Worker decryptCossoraVideoUrl and extractCossoraStream decryption pipeline', async () => {
        const sw = require('./background/service_worker.js');
        assert.strictEqual(typeof sw.decryptCossoraVideoUrl, 'function');
        assert.strictEqual(typeof sw.extractCossoraStream, 'function');

        // Test with known vector
        const key = '07db2ac9b15c77528b85ae53db12847c';
        // Encrypt test vector with AES-256-CBC
        const crypto = require('crypto');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key, 'utf8'), iv);
        const targetUrl = 'https://cossora.stream/api-embed/test-uuid/index.m3u8?token=123';
        const encrypted = Buffer.concat([cipher.update(targetUrl, 'utf8'), cipher.final()]);
        const payload = Buffer.concat([iv, encrypted]).toString('base64');

        const decrypted = await sw.decryptCossoraVideoUrl(payload, key);
        assert.strictEqual(
          decrypted,
          targetUrl,
          'Decrypted stream URL must match original payload'
        );
      });

      test('CosplayTele renderFloatingBar strictly enforces conditional media visibility', () => {
        const { renderFloatingBar } = require('./content/platforms/cosplaytele.js');
        assert.strictEqual(typeof renderFloatingBar, 'function');

        // Mock document environment
        const elementStore = new Map();
        let appendedElement = null;

        global.document = {
          getElementById: (id) => elementStore.get(id) || null,
          createElement: (tag) => {
            const el = {
              tagName: tag.toUpperCase(),
              id: '',
              innerHTML: '',
              childNodes: [],
              querySelector: (sel) => {
                // simple ID / class query
                if (sel.startsWith('#')) {
                  const targetId = sel.slice(1);
                  return el.innerHTML.includes(`id="${targetId}"`)
                    ? { addEventListener: () => {} }
                    : null;
                }
                return null;
              },
              querySelectorAll: () => []
            };
            return el;
          },
          body: {
            appendChild: (el) => {
              appendedElement = el;
              if (el.id) elementStore.set(el.id, el);
            }
          }
        };

        // 1. Dual Media State: Photos AND Video present
        renderFloatingBar({
          title: 'Ganyu Cosplay',
          photos: ['https://cosplaytele.com/photo1.webp', 'https://cosplaytele.com/photo2.webp'],
          videoIframe: 'https://cossora.stream/embed/test'
        });
        assert.ok(appendedElement, 'Bar must render for dual media');
        assert.ok(
          appendedElement.innerHTML.includes('ct-btn-download-all'),
          'Must have download all'
        );
        assert.ok(
          appendedElement.innerHTML.includes('ct-btn-select-modal'),
          'Must have select modal'
        );
        assert.ok(
          appendedElement.innerHTML.includes('ct-btn-download-video'),
          'Must have download video'
        );
        assert.ok(
          appendedElement.innerHTML.includes('Unduh Semua (3)'),
          'Count must be photos + video (2+1)'
        );
        assert.ok(
          appendedElement.innerHTML.includes('Unduh Video Saja'),
          'Must display video only button'
        );

        // 2. Photo-Only State: Photos present, NO video
        elementStore.clear();
        appendedElement = null;
        renderFloatingBar({
          title: 'Hu Tao Cosplay',
          photos: ['https://cosplaytele.com/photo1.webp'],
          videoIframe: null
        });
        assert.ok(appendedElement, 'Bar must render for photo-only');
        assert.ok(
          appendedElement.innerHTML.includes('ct-btn-download-all'),
          'Must have download all'
        );
        assert.ok(
          appendedElement.innerHTML.includes('ct-btn-select-modal'),
          'Must have select modal'
        );
        assert.ok(
          !appendedElement.innerHTML.includes('ct-btn-download-video'),
          'Video button must NOT be present when no video'
        );
        assert.ok(
          !appendedElement.innerHTML.includes('Unduh Video Saja'),
          'Video text must NOT be present when no video'
        );

        // 3. Video-Only State: Video present, NO photos
        elementStore.clear();
        appendedElement = null;
        renderFloatingBar({
          title: 'Raiden Video Teaser',
          photos: [],
          videoIframe: 'https://cossora.stream/embed/test-raiden'
        });
        assert.ok(appendedElement, 'Bar must render for video-only');
        assert.ok(
          appendedElement.innerHTML.includes('ct-btn-download-video'),
          'Must have video button'
        );
        assert.ok(
          !appendedElement.innerHTML.includes('ct-btn-download-all'),
          'Must NOT have download all photos'
        );
        assert.ok(
          !appendedElement.innerHTML.includes('ct-btn-select-modal'),
          'Must NOT have select photos modal button'
        );

        // 4. Empty State: Neither photos nor video
        elementStore.clear();
        appendedElement = null;
        renderFloatingBar({
          title: 'Empty Post',
          photos: [],
          videoIframe: null
        });
        assert.strictEqual(
          appendedElement,
          null,
          'Bar must NOT render when neither photos nor video are found'
        );
      });

      test('Bento Grid layout architecture and dynamic spans declared in cosplaytele.css', () => {
        const styleContent = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/styles/cosplaytele.css'),
          'utf8'
        );

        // Bento Grid structure
        assert.ok(
          styleContent.includes('grid-template-columns: repeat(auto-fill, minmax(170px, 1fr))')
        );
        assert.ok(styleContent.includes('grid-auto-flow: dense'));
        assert.ok(styleContent.includes('.ct-bento-card'));
        assert.ok(styleContent.includes('.ct-bento-gradient-overlay'));

        // Dynamic span variations (Hero 2x2, Wide 2x1, Tall 1x2)
        assert.ok(
          styleContent.includes('.bento-hero') || styleContent.includes(':nth-child(8n+1)')
        );
        assert.ok(
          styleContent.includes('.bento-wide') || styleContent.includes(':nth-child(8n+4)')
        );
        assert.ok(
          styleContent.includes('.bento-tall') || styleContent.includes(':nth-child(8n+6)')
        );

        // Video toggle inside Bento modal
        assert.ok(styleContent.includes('.ct-video-toggle-label'));
      });

      test('Service Worker registers DeclarativeNetRequest Rule 62 with CORS response headers & downloadCossoraHlsStream handler', () => {
        const sw = require('./background/service_worker.js');
        const rule62 = sw.COSPLAYTELE_CDN_RULES.find((r) => r.id === 62);
        assert.ok(rule62, 'Rule 62 must exist for *cossora.stream*');
        assert.strictEqual(rule62.condition.urlFilter, '*cossora.stream*');

        // Verify request headers
        assert.ok(
          rule62.action.requestHeaders.some(
            (h) => h.header === 'Referer' && h.value === 'https://cossora.stream/'
          ),
          'Rule 62 must inject Referer: https://cossora.stream/'
        );

        // Verify CORS response headers
        assert.ok(
          Array.isArray(rule62.action.responseHeaders),
          'Rule 62 must declare responseHeaders for CORS bypass'
        );
        assert.ok(
          rule62.action.responseHeaders.some(
            (h) => h.header === 'Access-Control-Allow-Origin' && h.value === '*'
          ),
          'Rule 62 must set Access-Control-Allow-Origin: *'
        );

        // Verify downloadCossoraHlsStream export
        assert.strictEqual(
          typeof sw.downloadCossoraHlsStream,
          'function',
          'service_worker.js must export downloadCossoraHlsStream'
        );
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 28: Pinterest Platform Registration, NTFS Sanitization & Media Pipeline
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 28: Pinterest Platform Registration, NTFS Sanitization & Media Pipeline',
    ({ test }) => {
      const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      test('Manifest V3 registers pinterest.com, pin.it & pinimg.com in host_permissions & content_scripts', () => {
        assert.ok(
          manifest.host_permissions.includes('*://*.pinterest.com/*'),
          'host_permissions must include *://*.pinterest.com/*'
        );
        assert.ok(
          manifest.host_permissions.includes('*://*.pinimg.com/*'),
          'host_permissions must include *://*.pinimg.com/*'
        );
        assert.ok(
          manifest.host_permissions.includes('*://pin.it/*'),
          'host_permissions must include *://pin.it/*'
        );

        const contentEntry = manifest.content_scripts.find(
          (s) => Array.isArray(s.js) && s.js.includes('content/platforms/pinterest.js')
        );
        assert.ok(contentEntry, 'content_scripts must have entry for pinterest.js');
        assert.ok(
          contentEntry.matches.includes('*://*.pinterest.com/*'),
          'pinterest.js matches must include *://*.pinterest.com/*'
        );
        assert.ok(
          contentEntry.matches.includes('*://pin.it/*'),
          'pinterest.js matches must include *://pin.it/*'
        );
        assert.deepStrictEqual(
          contentEntry.css,
          ['content/styles/pinterest.css'],
          'pinterest.js must declare content/styles/pinterest.css'
        );
        assert.strictEqual(
          contentEntry.run_at,
          'document_idle',
          'pinterest.js must run at document_idle'
        );
      });

      test('Pinterest script and stylesheet exist on disk with valid syntax and non-zero size', () => {
        const platformPath = path.join(PROJECT_ROOT, 'content/platforms/pinterest.js');
        const stylePath = path.join(PROJECT_ROOT, 'content/styles/pinterest.css');

        assert.ok(fs.existsSync(platformPath), 'pinterest.js must exist on disk');
        assert.ok(fs.existsSync(stylePath), 'pinterest.css must exist on disk');

        const platformStat = fs.statSync(platformPath);
        const styleStat = fs.statSync(stylePath);

        assert.ok(platformStat.size > 1000, 'pinterest.js must have substantial content (>1KB)');
        assert.ok(styleStat.size > 500, 'pinterest.css must have substantial content (>500B)');

        const checkRes = spawnSync(process.execPath, ['--check', platformPath], {
          encoding: 'utf8'
        });
        assert.strictEqual(
          checkRes.status,
          0,
          'pinterest.js must pass node --check syntax validation'
        );
      });

      test('Service Worker registers DeclarativeNetRequest Rule 71 for Pinterest (*.pinimg.com)', () => {
        const sw = require('./background/service_worker.js');
        assert.ok(Array.isArray(sw.PINTEREST_CDN_RULES), 'PINTEREST_CDN_RULES must be an array');
        const rule71 = sw.PINTEREST_CDN_RULES.find((r) => r.id === 71);
        assert.ok(rule71, 'Rule 71 must exist in PINTEREST_CDN_RULES');
        assert.strictEqual(rule71.condition.urlFilter, '*pinimg.com*');

        assert.ok(
          rule71.action.requestHeaders.some(
            (h) => h.header === 'Referer' && h.value === 'https://www.pinterest.com/'
          ),
          'Rule 71 must set Referer: https://www.pinterest.com/'
        );
        assert.ok(
          rule71.action.requestHeaders.some(
            (h) => h.header === 'Origin' && h.value === 'https://www.pinterest.com'
          ),
          'Rule 71 must set Origin: https://www.pinterest.com'
        );
        assert.ok(
          rule71.action.responseHeaders.some(
            (h) => h.header === 'Access-Control-Allow-Origin' && h.value === '*'
          ),
          'Rule 71 must set Access-Control-Allow-Origin: * for CORS bypass'
        );
      });

      test('Windows NTFS Filename Sanitization for Pinterest pins', () => {
        const {
          sanitizePinterestTitle,
          sanitizePinterestAuthor,
          formatPinterestFilename
        } = require('./content/platforms/pinterest.js');

        // Title sanitization with forbidden Win32 chars and colons
        assert.strictEqual(
          sanitizePinterestTitle('Cyberpunk: Edgerunners | Lucy & Rebecca <HD>'),
          'Cyberpunk - Edgerunners - Lucy & Rebecca HD'
        );

        // Win32 reserved device name
        assert.strictEqual(sanitizePinterestTitle('CON'), 'Pin_CON');
        assert.strictEqual(sanitizePinterestTitle('NUL'), 'Pin_NUL');

        // Length truncation ceiling (120 chars)
        const longTitle = 'A'.repeat(200);
        assert.strictEqual(sanitizePinterestTitle(longTitle).length, 120);

        // Author sanitization
        assert.strictEqual(sanitizePinterestAuthor('@artist_studio?*'), 'artist_studio');
        assert.strictEqual(sanitizePinterestAuthor('AUX'), 'user_AUX');

        // Complete formatted filename
        const formatted = formatPinterestFilename({
          author: 'CyberArtist',
          title: 'Neon Tokyo 2077',
          pinId: '1092837465',
          ext: 'jpg'
        });
        assert.strictEqual(formatted, '[Pinterest] CyberArtist - Neon Tokyo 2077 (1092837465).jpg');

        // Slide format for carousel
        const slideFormatted = formatPinterestFilename({
          author: 'StudioGhibli',
          title: 'Concept Art',
          pinId: '987654321',
          index: 3,
          ext: 'mp4'
        });
        assert.strictEqual(
          slideFormatted,
          '[Pinterest] StudioGhibli - Concept Art (987654321)_slide03.mp4'
        );
      });

      test('elevateToOriginalImageUrl escalates preview image paths to /originals/', () => {
        const { elevateToOriginalImageUrl } = require('./content/platforms/pinterest.js');

        const preview236 =
          'https://i.pinimg.com/236x/e8/5a/0c/e85a0c974e72f36af99d01b9b713b3e4.jpg';
        assert.strictEqual(
          elevateToOriginalImageUrl(preview236),
          'https://i.pinimg.com/originals/e8/5a/0c/e85a0c974e72f36af99d01b9b713b3e4.jpg'
        );

        const preview736 = 'https://i.pinimg.com/736x/ab/cd/ef/abcdef0123456789.png';
        assert.strictEqual(
          elevateToOriginalImageUrl(preview736),
          'https://i.pinimg.com/originals/ab/cd/ef/abcdef0123456789.png'
        );

        const alreadyOriginal = 'https://i.pinimg.com/originals/12/34/56/123456.jpg';
        assert.strictEqual(elevateToOriginalImageUrl(alreadyOriginal), alreadyOriginal);
      });

      test('extractPwsPinData correctly parses #__PWS_DATA__ Redux JSON structure', () => {
        const { extractPwsPinData } = require('./content/platforms/pinterest.js');

        const originalDoc = global.document;
        try {
          const mockPinPayload = {
            props: {
              initialReduxState: {
                pins: {
                  '1124351863225567517': {
                    id: '1124351863225567517',
                    title: 'Anime Aesthetic Wallpaper',
                    pinner: { username: 'AestheticGuru' },
                    images: {
                      orig: {
                        url: 'https://i.pinimg.com/originals/99/88/77/9988776655.jpg'
                      }
                    },
                    videos: {
                      video_list: {
                        V_720P: {
                          url: 'https://v.pinimg.com/videos/mc/720p/test.mp4',
                          width: 720,
                          height: 1280
                        }
                      }
                    }
                  }
                }
              }
            }
          };

          global.document = {
            getElementById: (id) => {
              if (id === '__PWS_DATA__') {
                return { textContent: JSON.stringify(mockPinPayload) };
              }
              return null;
            }
          };

          const pinData = extractPwsPinData('1124351863225567517');
          assert.ok(pinData, 'Must extract pin data from mock #__PWS_DATA__');
          assert.strictEqual(pinData.title, 'Anime Aesthetic Wallpaper');
          assert.strictEqual(pinData.pinner.username, 'AestheticGuru');
          assert.strictEqual(
            pinData.videos.video_list.V_720P.url,
            'https://v.pinimg.com/videos/mc/720p/test.mp4'
          );
        } finally {
          global.document = originalDoc;
        }
      });

      test('renderFloatingBar correctly renders in-page badges and button labels', () => {
        const { renderFloatingBar } = require('./content/platforms/pinterest.js');

        const originalDoc = global.document;
        let createdElement = null;

        try {
          global.document = {
            getElementById: () => null,
            createElement: (tag) => {
              const el = {
                tagName: tag.toUpperCase(),
                id: '',
                innerHTML: '',
                querySelector: () => ({ addEventListener: () => {} }),
                remove: () => {}
              };
              createdElement = el;
              return el;
            },
            body: {
              appendChild: () => {}
            }
          };

          // 1. Image Pin rendering
          renderFloatingBar({
            title: 'Gothic Castle',
            author: 'Architect',
            mediaType: 'image',
            originalImageUrl: 'https://i.pinimg.com/originals/castle.jpg',
            slides: []
          });
          assert.ok(createdElement, 'Bar must be created');
          assert.ok(createdElement.innerHTML.includes('FOTO HD'));
          assert.ok(createdElement.innerHTML.includes('Unduh Gambar (HD)'));

          // 2. Video Pin rendering
          renderFloatingBar({
            title: 'Speed Paint Video',
            author: 'Artist',
            mediaType: 'video',
            videoUrl: 'https://v.pinimg.com/videos/mc/720p/speed.mp4',
            videoQuality: '720P',
            slides: []
          });
          assert.ok(createdElement.innerHTML.includes('VIDEO 720P'));
          assert.ok(createdElement.innerHTML.includes('Unduh Video (.mp4)'));

          // 3. Carousel Pin rendering
          renderFloatingBar({
            title: 'Character Design Sheets',
            author: 'Studio',
            mediaType: 'carousel',
            slides: [
              { index: 1, url: 'https://i.pinimg.com/originals/1.jpg' },
              { index: 2, url: 'https://i.pinimg.com/originals/2.jpg' }
            ]
          });
          assert.ok(createdElement.innerHTML.includes('CAROUSEL (2)'));
          assert.ok(createdElement.innerHTML.includes('Unduh Semua (2)'));
        } finally {
          global.document = originalDoc;
        }
      });

      test('Popup UI recognizes Pinterest tab and renders state-pinterest', () => {
        const popupHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.html'), 'utf8');
        const popupJs = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.js'), 'utf8');

        assert.ok(
          popupHtml.includes('id="state-pinterest"'),
          'popup.html must contain #state-pinterest'
        );
        assert.ok(
          popupHtml.includes('id="pt-status-chip"'),
          'popup.html must contain #pt-status-chip'
        );
        assert.ok(popupHtml.includes('id="pt-title"'), 'popup.html must contain #pt-title');
        assert.ok(popupHtml.includes('id="pt-desc"'), 'popup.html must contain #pt-desc');

        assert.ok(popupJs.includes('isPinterest ='), 'popup.js must declare isPinterest');
        assert.ok(popupJs.includes('statePinterest'), 'popup.js must bind statePinterest');
        assert.ok(
          popupJs.includes(
            "host === 'pinterest.com' || host.endsWith('.pinterest.com') || host === 'pin.it'"
          ),
          'popup.js must detect pinterest.com and pin.it hostnames'
        );
      });
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 29: AnoBoy Anime Platform Registration, NTFS Auto-Folder & Batch Scheduler
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 29: AnoBoy Anime Platform Registration, NTFS Auto-Folder & Batch Scheduler',
    ({ test }) => {
      const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      test('Manifest V3 registers anoboy domains and blogger.com in host_permissions & content_scripts', () => {
        assert.ok(
          manifest.host_permissions.includes('*://*.anoboy.at/*'),
          'host_permissions must include *://*.anoboy.at/*'
        );
        assert.ok(
          manifest.host_permissions.includes('*://*.blogger.com/*'),
          'host_permissions must include *://*.blogger.com/*'
        );

        const contentEntry = manifest.content_scripts.find(
          (s) => Array.isArray(s.js) && s.js.includes('content/platforms/anoboy.js')
        );
        assert.ok(contentEntry, 'content_scripts must have entry for anoboy.js');
        assert.ok(
          contentEntry.matches.includes('*://*.anoboy.at/*'),
          'anoboy.js matches must include *://*.anoboy.at/*'
        );
        assert.deepStrictEqual(
          contentEntry.css,
          ['content/styles/anoboy.css'],
          'anoboy.js must declare content/styles/anoboy.css'
        );
        assert.strictEqual(
          contentEntry.run_at,
          'document_idle',
          'anoboy.js must run at document_idle'
        );
      });

      test('AnoBoy script and stylesheet exist on disk with valid syntax and non-zero size', () => {
        const platformPath = path.join(PROJECT_ROOT, 'content/platforms/anoboy.js');
        const stylePath = path.join(PROJECT_ROOT, 'content/styles/anoboy.css');

        assert.ok(fs.existsSync(platformPath), 'anoboy.js must exist on disk');
        assert.ok(fs.existsSync(stylePath), 'anoboy.css must exist on disk');

        const platformStat = fs.statSync(platformPath);
        const styleStat = fs.statSync(stylePath);

        assert.ok(platformStat.size > 1000, 'anoboy.js must have substantial content (>1KB)');
        assert.ok(styleStat.size > 500, 'anoboy.css must have substantial content (>500B)');

        const checkRes = spawnSync(process.execPath, ['--check', platformPath], {
          encoding: 'utf8'
        });
        assert.strictEqual(
          checkRes.status,
          0,
          'anoboy.js must pass node --check syntax validation'
        );
      });

      test('Service Worker registers DeclarativeNetRequest Rule 81 for Blogger Video (*.blogger.com/video.g*)', () => {
        const sw = require('./background/service_worker.js');
        assert.ok(Array.isArray(sw.ANOBOY_CDN_RULES), 'ANOBOY_CDN_RULES must be an array');
        const rule81 = sw.ANOBOY_CDN_RULES.find((r) => r.id === 81);
        assert.ok(rule81, 'Rule 81 must exist in ANOBOY_CDN_RULES');
        assert.strictEqual(rule81.condition.urlFilter, '*blogger.com/video.g*');

        assert.ok(
          rule81.action.requestHeaders.some(
            (h) =>
              h.header === 'Referer' &&
              (h.value === 'https://anoboy.at/' || h.value === 'https://anoboy.quest/')
          ),
          'Rule 81 must set Referer: https://anoboy.at/ or https://anoboy.quest/'
        );
        assert.ok(
          rule81.action.responseHeaders.some(
            (h) => h.header === 'Access-Control-Allow-Origin' && h.value === '*'
          ),
          'Rule 81 must set Access-Control-Allow-Origin: * for CORS bypass'
        );
      });

      test('Windows NTFS Filename Sanitization for AnoBoy anime & auto-folder formatting', () => {
        const {
          sanitizeAnoboyTitle,
          formatAnoboyFilename
        } = require('./content/platforms/anoboy.js');

        // Title sanitization with forbidden Win32 chars and colons
        assert.strictEqual(
          sanitizeAnoboyTitle('Sekai Saikyou no Majo: Hajimemashita / Special <HD>'),
          'Sekai Saikyou no Majo - Hajimemashita - Special HD'
        );

        // Win32 reserved device name
        assert.strictEqual(sanitizeAnoboyTitle('CON'), 'Anime_CON');
        assert.strictEqual(sanitizeAnoboyTitle('AUX'), 'Anime_AUX');

        // Length truncation ceiling (120 chars)
        const longTitle = 'B'.repeat(200);
        assert.strictEqual(sanitizeAnoboyTitle(longTitle).length, 120);

        // Formatted {ANIMETITLE}_{EPISODENUMBER}.mp4 filename
        const standardFile = formatAnoboyFilename({
          animeTitle: 'Sekai Saikyou no Majo, Hajimemashita',
          episodeNum: 4
        });
        assert.strictEqual(standardFile, 'Sekai Saikyou no Majo, Hajimemashita_04.mp4');

        // Multi-season formatted filename
        const s2File = formatAnoboyFilename({
          animeTitle: 'Yasei no Last Boss ga Arawareta! Season 2',
          episodeNum: 1
        });
        assert.strictEqual(s2File, 'Yasei no Last Boss ga Arawareta! Season 2_01.mp4');
      });

      test('extractEpisodeNumber accurately parses episode digits from various string patterns', () => {
        const { extractEpisodeNumber } = require('./content/platforms/anoboy.js');

        assert.strictEqual(
          extractEpisodeNumber('Sekai Saikyou no Majo Episode 4 Subtitle Indonesia'),
          4
        );
        assert.strictEqual(extractEpisodeNumber('/2026/10/anime-episode-12/'), 12);
        assert.strictEqual(extractEpisodeNumber('One Piece eps 1120'), 1120);
        assert.strictEqual(extractEpisodeNumber('Anime_Name_-_08.720.mp4_links'), 8);
        assert.strictEqual(extractEpisodeNumber('Invalid String Without Numbers'), 1);
      });

      test('extractAnoboyPageData extracts anime metadata, series URL, and stream servers from DOM mock', () => {
        const { extractAnoboyPageData } = require('./content/platforms/anoboy.js');

        const originalDoc = global.document;
        const originalWin = global.window;

        try {
          global.window = {
            location: {
              href: 'https://anoboy.quest/2026/10/test-anime-episode-5/',
              origin: 'https://anoboy.quest',
              pathname: '/2026/10/test-anime-episode-5/'
            }
          };

          global.document = {
            title: 'Test Anime Episode 5 Subtitle Indonesia - anoBoy',
            querySelectorAll: (sel) => {
              if (sel === 'th') {
                return [
                  {
                    textContent: 'Semua Episode',
                    nextElementSibling: {
                      querySelector: () => ({
                        href: 'https://anoboy.quest/test-anime/',
                        textContent: 'Test Anime'
                      })
                    }
                  }
                ];
              }
              if (sel === 'a#allmiror') {
                return [
                  {
                    textContent: 'PC 720',
                    getAttribute: (attr) =>
                      attr === 'data-video' ? '/uploads/adsbatch720.php?url=TOKEN_TEST_720' : null
                  }
                ];
              }
              if (sel === 'a.udl') {
                return [
                  {
                    getAttribute: (attr) =>
                      attr === 'href' ? 'https://www.mp4upload.com/test1234' : null,
                    textContent: '720P',
                    closest: () => ({ querySelector: () => ({ textContent: 'Mp4Upload' }) })
                  }
                ];
              }
              return [];
            },
            querySelector: (sel) => {
              if (sel === 'h1, .pagetitle h1') {
                return { textContent: 'Test Anime Episode 5 Subtitle Indonesia' };
              }
              return null;
            }
          };

          const data = extractAnoboyPageData();
          assert.ok(data, 'Must extract page data');
          assert.strictEqual(data.animeTitle, 'Test Anime');
          assert.strictEqual(data.episodeNum, 5);
          assert.strictEqual(data.seriesUrl, 'https://anoboy.quest/test-anime/');
          assert.strictEqual(data.servers.length, 1);
          assert.strictEqual(data.servers[0].bloggerToken, 'TOKEN_TEST_720');
          assert.strictEqual(data.downloadMirrors.length, 1);
          assert.strictEqual(data.downloadMirrors[0].provider, 'Mp4Upload');
        } finally {
          global.document = originalDoc;
          global.window = originalWin;
        }
      });

      test('renderFloatingBar correctly renders in-page badge and buttons', () => {
        const { renderFloatingBar } = require('./content/platforms/anoboy.js');

        const originalDoc = global.document;
        let createdElement = null;

        try {
          global.document = {
            getElementById: () => null,
            createElement: (tag) => {
              const el = {
                tagName: tag.toUpperCase(),
                id: '',
                innerHTML: '',
                querySelector: () => ({ addEventListener: () => {} }),
                remove: () => {}
              };
              createdElement = el;
              return el;
            },
            body: {
              appendChild: () => {}
            }
          };

          renderFloatingBar({
            animeTitle: "Frieren: Beyond Journey's End",
            episodeNum: 28,
            seriesUrl: 'https://anoboy.quest/frieren/',
            servers: []
          });

          assert.ok(createdElement, 'Floating bar must be created');
          assert.ok(createdElement.innerHTML.includes('EPS 28'), 'Must display episode badge');
          assert.ok(
            createdElement.innerHTML.includes('Unduh Eps Ini'),
            'Must display single episode button'
          );
          assert.ok(
            createdElement.innerHTML.includes('Batch Download'),
            'Must display batch download button'
          );
        } finally {
          global.document = originalDoc;
        }
      });

      test('Popup UI recognizes AnoBoy tab and renders state-anoboy', () => {
        const popupHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.html'), 'utf8');
        const popupJs = fs.readFileSync(path.join(PROJECT_ROOT, 'popup/popup.js'), 'utf8');

        assert.ok(popupHtml.includes('id="state-anoboy"'), 'popup.html must contain #state-anoboy');
        assert.ok(
          popupHtml.includes('id="ab-status-chip"'),
          'popup.html must contain #ab-status-chip'
        );
        assert.ok(popupHtml.includes('id="ab-title"'), 'popup.html must contain #ab-title');
        assert.ok(popupHtml.includes('id="ab-desc"'), 'popup.html must contain #ab-desc');

        assert.ok(popupJs.includes('isAnoboy ='), 'popup.js must declare isAnoboy');
        assert.ok(popupJs.includes('stateAnoboy'), 'popup.js must bind stateAnoboy');
        assert.ok(
          popupJs.includes("host.includes('anoboy.')"),
          'popup.js must detect anoboy hostnames'
        );
      });

      test('parseEpisodesFromHtml strictly scopes to active anime season and filters sidebar leaks and duplicates', () => {
        const { parseEpisodesFromHtml } = require('./content/platforms/anoboy.js');

        const mockHtml = `
          <div class="column-three-fourth">
            <!-- Season 1 -->
            <a href="https://anoboy.quest/2025/12/yasei-no-last-boss-ga-arawareta-episode-12-selesai/" title="Yasei no Last Boss ga Arawareta! Episode 12 Selesai">Episode 12</a>
            <a href="https://anoboy.quest/2025/11/yasei-no-last-boss-ga-arawareta-episode-5/" title="Yasei no Last Boss ga Arawareta! Episode 5">Episode 5</a>
            <!-- Season 2 -->
            <a href="https://anoboy.quest/2026/10/yasei-no-last-boss-ga-arawareta-season-2-episode-6/" title="Yasei no Last Boss ga Arawareta! Season 2 Episode 6">Season 2 Episode 6</a>
            <a href="https://anoboy.quest/2026/10/yasei-no-last-boss-ga-arawareta-season-2-episode-5/" title="Yasei no Last Boss ga Arawareta! Season 2 Episode 5">Season 2 Episode 5</a>
            <a href="https://anoboy.quest/2026/10/yasei-no-last-boss-ga-arawareta-season-2-episode-4/" title="Yasei no Last Boss ga Arawareta! Season 2 Episode 4">Season 2 Episode 4</a>
            <a href="https://anoboy.quest/2026/10/yasei-no-last-boss-ga-arawareta-season-2-episode-3/" title="Yasei no Last Boss ga Arawareta! Season 2 Episode 3">Season 2 Episode 3</a>
            <a href="https://anoboy.quest/2026/10/yasei-no-last-boss-ga-arawareta-season-2-episode-2/" title="Yasei no Last Boss ga Arawareta! Season 2 Episode 2">Season 2 Episode 2</a>
            <a href="https://anoboy.quest/2026/09/yasei-no-last-boss-ga-arawareta-season-2-episode-1/" title="Yasei no Last Boss ga Arawareta! Season 2 Episode 1">Season 2 Episode 1</a>
          </div>
          <!-- Leaked sidebar widgets with recent releases -->
          <div id="sidebar">
            <a href="https://anoboy.quest/2026/11/kanata-kara-episode-5/">Kanata kara Episode 5</a>
            <a href="https://anoboy.quest/2026/11/hotel-inhumans-season-2-episode-5/">Hotel Inhumans Season 2 Episode 5</a>
            <a href="https://anoboy.quest/2026/11/mezametara-saikyou-soubi-to-uchuusenmochi-datta-node-episode-5/">Mezametara Episode 5</a>
          </div>
        `;

        const s2Episodes = parseEpisodesFromHtml(
          mockHtml,
          'Yasei no Last Boss ga Arawareta! Season 2 Episode 5 Subtitle Indonesia',
          'https://anoboy.quest/2026/10/yasei-no-last-boss-ga-arawareta-season-2-episode-5/'
        );

        assert.strictEqual(s2Episodes.length, 6, 'Season 2 must detect exactly 6 episodes');
        assert.strictEqual(s2Episodes[0].episodeNum, 1, 'First episode must be 1');
        assert.strictEqual(s2Episodes[5].episodeNum, 6, 'Last episode must be 6');
        assert.ok(
          !s2Episodes.some((e) => e.title.includes('Kanata kara')),
          'Must not leak Kanata kara from sidebar'
        );
        assert.ok(
          !s2Episodes.some((e) => e.title.includes('Hotel Inhumans')),
          'Must not leak Hotel Inhumans from sidebar'
        );
        assert.ok(
          !s2Episodes.some((e) => e.episodeNum === 12),
          'Must not leak Season 1 Episode 12 into Season 2'
        );

        // Test Season 1 filtering
        const s1Episodes = parseEpisodesFromHtml(
          mockHtml,
          'Yasei no Last Boss ga Arawareta! Episode 5 Subtitle Indonesia',
          'https://anoboy.quest/2025/11/yasei-no-last-boss-ga-arawareta-episode-5/'
        );
        assert.strictEqual(
          s1Episodes.length,
          2,
          'Season 1 must detect only Season 1 episodes from mock'
        );
        assert.ok(
          !s1Episodes.some((e) => e.title.includes('Season 2')),
          'Season 1 must not include Season 2 episodes'
        );
      });

      test('extractStreamFromBloggerHtml extracts direct 720p (itag 22) and 360p (itag 18) googlevideo streams', () => {
        const { extractStreamFromBloggerHtml } = require('./content/platforms/anoboy.js');

        const mockBloggerHtml = `
          <html><body>
          <meta property="og:url" content="https://www.blogger.com/video.g?token=AD6v5test" />
          <script>
            var data = [[&quot;https://rr2---sn-test.googlevideo.com/videoplayback?expire\\u003d1793609516\\u0026itag\\u003d18\\u0026source\\u003dblogger&quot;,[18]],
                        [&quot;https://rr2---sn-test.googlevideo.com/videoplayback?expire\\u003d1793609516\\u0026itag\\u003d22\\u0026source\\u003dblogger&quot;,[22]]];
          </script>
          </body></html>
        `;

        const stream720 = extractStreamFromBloggerHtml(mockBloggerHtml, '720p');
        assert.ok(stream720, '720p stream must be extracted');
        assert.ok(
          !stream720.includes('blogger.com'),
          'Must never match preceding blogger.com as stream'
        );
        assert.ok(
          stream720.startsWith('https://rr2---sn-test.googlevideo.com/'),
          'Stream must start with googlevideo.com'
        );
        assert.ok(stream720.includes('itag=22'), '720p stream must have itag=22');
        assert.ok(
          !stream720.includes('\\u0026'),
          'Decoded stream must not have raw unicode escapes'
        );

        const stream360 = extractStreamFromBloggerHtml(mockBloggerHtml, '360p');
        assert.ok(stream360, '360p stream must be extracted');
        assert.ok(
          stream360.startsWith('https://rr2---sn-test.googlevideo.com/'),
          'Stream must start with googlevideo.com'
        );
        assert.ok(stream360.includes('itag=18'), '360p stream must have itag=18');
      });

      test('AnoBoy pauseJob destroys in-flight response sockets and batch queue respects isPaused', () => {
        const hostCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'native_host/downloader_host.js'),
          'utf8'
        );
        const anoboyCode = fs.readFileSync(
          path.join(PROJECT_ROOT, 'content/platforms/anoboy.js'),
          'utf8'
        );

        // Native host socket destroy checks
        assert.ok(
          hostCode.includes('job.sockets.add(res)'),
          'downloader_host.js must add res to job.sockets'
        );
        assert.ok(
          hostCode.includes('if (res.socket) job.sockets.add(res.socket)'),
          'downloader_host.js must track res.socket in job.sockets'
        );
        assert.ok(
          hostCode.includes('sock.destroy()'),
          'pauseJob must call sock.destroy() on all tracked sockets'
        );

        // Content script batch queue pause guard checks
        assert.ok(
          anoboyCode.includes('if (currentBatchState.isPaused)'),
          'anoboy.js runWorker must abort queue loop when currentBatchState.isPaused is true'
        );
        assert.ok(
          anoboyCode.includes('!currentBatchState.isPaused'),
          'anoboy.js while loop must check !currentBatchState.isPaused'
        );
      });
    }
  );

  // ==========================================================================
  // SUITE 30: Shinigami Comic Platform Registration, NTFS Chapter Packaging & Multi-Format Pipeline
  // ==========================================================================
  await runSuite(
    'Suite 30: Shinigami Comic Platform Registration, NTFS Chapter Packaging & Multi-Format Pipeline',
    async ({ test, testAsync }) => {
      await testAsync(
        'Manifest V3 registers shinigami.asia, shngm.io, and shngm.id in host_permissions & content_scripts',
        async () => {
          const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

          assert.ok(
            manifest.host_permissions.some((p) => p.includes('shinigami.asia')),
            'host_permissions must include *://*.shinigami.asia/*'
          );
          assert.ok(
            manifest.host_permissions.some((p) => p.includes('shngm.io')),
            'host_permissions must include *://*.shngm.io/*'
          );
          assert.ok(
            manifest.host_permissions.some((p) => p.includes('shngm.id')),
            'host_permissions must include *://*.shngm.id/*'
          );

          const shinigamiCs = manifest.content_scripts.find((cs) =>
            cs.matches.some((m) => m.includes('shinigami.asia'))
          );
          assert.ok(shinigamiCs, 'content_scripts must declare shinigami.asia matches');
          assert.ok(
            shinigamiCs.js.includes('content/platforms/shinigami.js'),
            'Shinigami content script must register content/platforms/shinigami.js'
          );
          assert.ok(
            shinigamiCs.css.includes('content/styles/shinigami.css'),
            'Shinigami content script must register content/styles/shinigami.css'
          );
        }
      );

      await testAsync(
        'Shinigami script and stylesheet exist on disk with valid syntax and non-zero size',
        async () => {
          const jsPath = path.join(PROJECT_ROOT, 'content/platforms/shinigami.js');
          const cssPath = path.join(PROJECT_ROOT, 'content/styles/shinigami.css');

          assert.ok(fs.existsSync(jsPath), 'content/platforms/shinigami.js must exist');
          assert.ok(fs.existsSync(cssPath), 'content/styles/shinigami.css must exist');

          const jsStat = fs.statSync(jsPath);
          const cssStat = fs.statSync(cssPath);

          assert.ok(jsStat.size > 1000, 'shinigami.js must be larger than 1KB');
          assert.ok(cssStat.size > 200, 'shinigami.css must be larger than 200B');

          // Ensure strict DOM button type="button" hygiene
          const jsContent = fs.readFileSync(jsPath, 'utf8');
          const buttonCreations = (jsContent.match(/createElement\(['"]button['"]\)/g) || [])
            .length;
          const typeEnforcements = (jsContent.match(/\.type\s*=\s*['"]button['"]/g) || []).length;
          assert.strictEqual(
            buttonCreations,
            typeEnforcements,
            'All document.createElement("button") in shinigami.js must set type="button"'
          );
        }
      );

      await testAsync(
        'Service Worker registers DeclarativeNetRequest Rules 91 & 92 for Shinigami API & CDN headers',
        async () => {
          const sw = require(path.join(PROJECT_ROOT, 'background/service_worker.js'));
          assert.ok(Array.isArray(sw.SHINIGAMI_CDN_RULES), 'SHINIGAMI_CDN_RULES must be an array');
          assert.strictEqual(
            sw.SHINIGAMI_CDN_RULES.length,
            2,
            'Must register 2 rules for Shinigami'
          );

          const rule91 = sw.SHINIGAMI_CDN_RULES.find((r) => r.id === 91);
          assert.ok(rule91, 'Rule 91 must exist for API');
          assert.strictEqual(rule91.condition.urlFilter, '*shngm.io*');
          const refererMod91 = rule91.action.requestHeaders.find((h) => h.header === 'Referer');
          assert.strictEqual(refererMod91.value, 'https://11.shinigami.asia/');

          const rule92 = sw.SHINIGAMI_CDN_RULES.find((r) => r.id === 92);
          assert.ok(rule92, 'Rule 92 must exist for CDN');
          assert.strictEqual(rule92.condition.urlFilter, '*shngm.id*');
          const originMod92 = rule92.action.requestHeaders.find((h) => h.header === 'Origin');
          assert.strictEqual(originMod92.value, 'https://11.shinigami.asia');
        }
      );

      await testAsync(
        'Windows NTFS Filename Sanitization for Shinigami manga & chapter packaging',
        async () => {
          const sw = require(path.join(PROJECT_ROOT, 'background/service_worker.js'));

          // Standard formatting
          const name1 = sw.formatShinigamiFilename('Solo Leveling: Ragnarok', 15, 'pdf');
          assert.strictEqual(name1, 'Solo_Leveling_Ragnarok_Chapter_15.pdf');

          // Win32 reserved characters and control characters
          const name2 = sw.formatShinigamiFilename(
            'Martial Peak: Chapter <Special>? *Epic* | v1.0',
            500,
            'cbz'
          );
          assert.strictEqual(name2, 'Martial_Peak_Chapter_Special_Epic_v1.0_Chapter_500.cbz');

          // Win32 reserved device name
          const name3 = sw.formatShinigamiFilename('CON', 1, 'webp');
          assert.strictEqual(name3, 'Manga_CON_Chapter_1.webp');

          // Empty / missing fallbacks
          const name4 = sw.formatShinigamiFilename('', null, 'pdf');
          assert.strictEqual(name4, 'Shinigami_Comic_Chapter_1.pdf');
        }
      );

      await testAsync(
        'extractShinigamiPageInfo accurately parses manga and chapter UUIDs from URL and DOM mock',
        async () => {
          const shinigami = require(path.join(PROJECT_ROOT, 'content/platforms/shinigami.js'));

          const mockChapterUrl =
            'https://11.shinigami.asia/chapter/8d5e57ab-372d-4be2-af6f-f5cba4c92239';
          const mockDoc = {
            title: 'I Thought It Was a Common Possession - Chapter 78 - Shinigami ID',
            querySelector: (sel) => {
              if (sel.includes('h1') || sel.includes('chapter-title')) {
                return { textContent: 'I Thought It Was a Common Possession Chapter 78' };
              }
              if (sel.includes('series')) {
                return { getAttribute: () => '/series/a1b2c3d4-e5f6-7890-abcd-ef1234567890' };
              }
              return null;
            }
          };

          const info = shinigami.extractShinigamiPageInfo(mockChapterUrl, mockDoc);
          assert.strictEqual(info.chapterId, '8d5e57ab-372d-4be2-af6f-f5cba4c92239');
          assert.strictEqual(info.chapterNumber, 78);
          assert.strictEqual(info.mangaId, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
          assert.strictEqual(info.title, 'I_Thought_It_Was_a_Common_Possession');
        }
      );

      await testAsync(
        'renderFloatingBar correctly renders in-page widget with buttons and strict type="button"',
        async () => {
          const shinigami = require(path.join(PROJECT_ROOT, 'content/platforms/shinigami.js'));

          const createdButtons = [];
          const mockBody = new MockElement('body');
          const mockDoc = {
            body: mockBody,
            getElementById: () => null,
            createElement: (tag) => {
              const el = new MockElement(tag);
              if (tag.toLowerCase() === 'button') {
                createdButtons.push(el);
              }
              return el;
            }
          };

          const bar = shinigami.renderFloatingBar(
            { title: 'Test Manga', chapterNumber: 10, chapterId: 'ch-123', mangaId: 'm-456' },
            mockDoc
          );

          assert.ok(bar, 'renderFloatingBar must return container element');
          assert.strictEqual(bar.id, 'mungil-shinigami-bar');
          assert.ok(
            bar.innerHTML.includes('id="mungil-sn-btn-single"'),
            'Must contain single download button'
          );
          assert.ok(
            bar.innerHTML.includes('id="mungil-sn-btn-batch"'),
            'Must contain batch download button'
          );
          assert.ok(
            bar.innerHTML.includes('type="button"'),
            'All buttons inside floating bar must enforce type="button"'
          );
        }
      );

      await testAsync(
        'Popup UI markup includes state-shinigami container and meta nodes',
        async () => {
          const htmlPath = path.join(PROJECT_ROOT, 'popup/popup.html');
          const html = fs.readFileSync(htmlPath, 'utf8');

          assert.ok(html.includes('id="state-shinigami"'), 'popup.html must have #state-shinigami');
          assert.ok(html.includes('id="sn-title"'), 'popup.html must have #sn-title');
          assert.ok(html.includes('id="sn-desc"'), 'popup.html must have #sn-desc');
          assert.ok(html.includes('id="sn-status-chip"'), 'popup.html must have #sn-status-chip');
          assert.ok(
            html.includes('Shinigami Comic'),
            'popup.html must display Shinigami Comic badge'
          );
        }
      );

      await testAsync(
        'API Client parses chapter detail and series chapters with sorted ascending order',
        async () => {
          const shinigami = require(path.join(PROJECT_ROOT, 'content/platforms/shinigami.js'));

          const originalFetch = global.fetch;
          try {
            global.fetch = async (url) => {
              if (url.includes('/chapter/detail/')) {
                return {
                  ok: true,
                  json: async () => ({
                    retcode: 0,
                    data: {
                      chapter_id: 'ch-test',
                      chapter_number: 5,
                      chapter: {
                        chapter_number: 5,
                        chapter_title: 'Episode 5',
                        path: 'https://assets.shngm.id/manga/test/ch5/',
                        data: ['01.webp', '02.webp', '03.webp']
                      },
                      manga: {
                        manga_id: 'm-test-123',
                        title: 'Super Webtoon'
                      }
                    }
                  })
                };
              }

              if (url.includes('/list?')) {
                return {
                  ok: true,
                  json: async () => ({
                    retcode: 0,
                    data: [
                      { chapter_id: 'c2', chapter_number: 2, chapter_title: 'Ch 2' },
                      { chapter_id: 'c1', chapter_number: 1, chapter_title: 'Ch 1' },
                      { chapter_id: 'c3', chapter_number: 3, chapter_title: 'Ch 3' }
                    ]
                  })
                };
              }

              return { ok: false, status: 404 };
            };

            const detail = await shinigami.fetchChapterDetail('ch-test');
            assert.ok(detail, 'fetchChapterDetail must return detail object');
            assert.strictEqual(detail.chapterNumber, 5);
            assert.strictEqual(detail.imageUrls.length, 3);
            assert.strictEqual(
              detail.imageUrls[0],
              'https://assets.shngm.id/manga/test/ch5/01.webp'
            );

            const chapters = await shinigami.fetchSeriesChapters('m-test');
            assert.strictEqual(chapters.length, 3);
            assert.strictEqual(
              chapters[0].chapterNumber,
              1,
              'Chapters must be sorted ascending by chapterNumber'
            );
            assert.strictEqual(chapters[1].chapterNumber, 2);
            assert.strictEqual(chapters[2].chapterNumber, 3);
          } finally {
            global.fetch = originalFetch;
          }
        }
      );

      await testAsync(
        'Multi-format packaging functions (PDF, Long Image, CBZ) are exported and callable',
        async () => {
          const shinigami = require(path.join(PROJECT_ROOT, 'content/platforms/shinigami.js'));

          assert.strictEqual(typeof shinigami.generateChapterPdf, 'function');
          assert.strictEqual(typeof shinigami.generateLongImage, 'function');
          assert.strictEqual(typeof shinigami.generateCbzArchive, 'function');
        }
      );
    }
  );

  // --------------------------------------------------------------------------
  // SUITE 31: Comic Translator & Non-Destructive DOM Speech Bubble Overlay
  // --------------------------------------------------------------------------
  await runSuite(
    'Suite 31: Comic Translator & Non-Destructive In-Page Speech Bubble Overlay',
    async ({ test, testAsync }) => {
      test('Manifest V3 registers Naver Webtoon and Webtoons in host_permissions & content_scripts', () => {
        const manifestPath = path.join(PROJECT_ROOT, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        assert.ok(
          manifest.host_permissions.some((p) => p.includes('naver.com')),
          'naver.com must be in host_permissions'
        );
        assert.ok(
          manifest.host_permissions.some((p) => p.includes('translate.googleapis.com')),
          'translate.googleapis.com must be in host_permissions'
        );

        const transScript = manifest.content_scripts.find(
          (cs) => cs.js && cs.js.includes('content/platforms/comic_translator.js')
        );
        assert.ok(transScript, 'comic_translator.js must be registered in content_scripts');
        assert.ok(
          transScript.matches.some((m) => m.includes('comic.naver.com')),
          'comic.naver.com must be matched'
        );
      });

      test('comic_translator.js and comic_translator.css exist on disk with non-zero size', () => {
        const jsPath = path.join(PROJECT_ROOT, 'content/platforms/comic_translator.js');
        const cssPath = path.join(PROJECT_ROOT, 'content/styles/comic_translator.css');

        assert.ok(fs.existsSync(jsPath), 'comic_translator.js must exist');
        assert.ok(fs.statSync(jsPath).size > 500, 'comic_translator.js must have non-trivial size');
        assert.ok(fs.existsSync(cssPath), 'comic_translator.css must exist');
        assert.ok(
          fs.statSync(cssPath).size > 500,
          'comic_translator.css must have non-trivial size'
        );
      });

      test('Strict DOM Button Creation Hygiene in comic_translator.js', () => {
        const jsPath = path.join(PROJECT_ROOT, 'content/platforms/comic_translator.js');
        const c = fs.readFileSync(jsPath, 'utf8');

        const btnCreateMatches = c.match(/createElement(['"]button['"])/g) || [];
        const btnTypeMatches = c.match(/.types*=s*['"]button['"]/g) || [];

        assert.strictEqual(
          btnCreateMatches.length,
          btnTypeMatches.length,
          `Every created button in comic_translator.js (${btnCreateMatches.length}) must explicitly declare type="button" (${btnTypeMatches.length})`
        );
      });

      await testAsync('autoFitBubbleText adapts font size for given box bounds', async () => {
        const translator = require(
          path.join(PROJECT_ROOT, 'content/platforms/comic_translator.js')
        );
        assert.strictEqual(typeof translator.autoFitBubbleText, 'function');

        const mockEl = {
          style: { fontSize: '16px' },
          scrollHeight: 80,
          scrollWidth: 150
        };

        translator.autoFitBubbleText(mockEl, 100, 50);
        const parsedSize = parseInt(mockEl.style.fontSize, 10);
        assert.ok(
          parsedSize <= 22 && parsedSize >= 8,
          `Font size should be scaled safely between 8 and 22px, got: ${parsedSize}`
        );
      });

      test('snapBboxToContainer raymarches contour and samples background color', () => {
        const translator = require(
          path.join(PROJECT_ROOT, 'content/platforms/comic_translator.js')
        );
        assert.strictEqual(typeof translator.snapBboxToContainer, 'function');

        const width = 100;
        const height = 100;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            if (x === 10 || x === 90 || y === 10 || y === 90) {
              data[idx] = 0;
              data[idx + 1] = 0;
              data[idx + 2] = 0;
            } else {
              data[idx] = 255;
              data[idx + 1] = 255;
              data[idx + 2] = 255;
            }
            data[idx + 3] = 255;
          }
        }

        const mockCtx = {
          getImageData: () => ({ data })
        };

        const rawBbox = { x: 30, y: 30, w: 20, h: 20 };
        const snapped = translator.snapBboxToContainer(mockCtx, rawBbox, width, height);

        assert.ok(snapped.w > rawBbox.w, 'Snapped width should expand towards card boundary');
        assert.ok(snapped.h > rawBbox.h, 'Snapped height should expand towards card boundary');
        assert.strictEqual(
          snapped.bgColor.toLowerCase(),
          '#ffffff',
          'Background color should detect white'
        );
        assert.strictEqual(snapped.textColor, '#000000', 'Text color on white should be black');
      });

      test('mergeOverlappingBubbles merges co-located slide cards and bubbles', () => {
        const translator = require(
          path.join(PROJECT_ROOT, 'content/platforms/comic_translator.js')
        );
        assert.strictEqual(typeof translator.mergeOverlappingBubbles, 'function');

        const items = [
          {
            bbox: { x: 100, y: 100, w: 200, h: 80 },
            originalText: '선경예고 전수조사',
            translatedText: 'Survei lengkap Sekolah Seni Sunkyung',
            bgColor: '#ffffff',
            textColor: '#000000'
          },
          {
            bbox: { x: 110, y: 110, w: 180, h: 70 },
            originalText: '결과 발표',
            translatedText: 'Pengumuman Hasil',
            bgColor: '#ffffff',
            textColor: '#000000'
          }
        ];

        const merged = translator.mergeOverlappingBubbles(items);
        assert.strictEqual(
          merged.length,
          1,
          'Co-located boxes should merge into strictly 1 container'
        );
        assert.ok(
          merged[0].translatedText.includes('Survei lengkap') &&
            merged[0].translatedText.includes('Pengumuman Hasil'),
          'Merged text should preserve both lines'
        );
      });
    }
  );

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // TEST REPORT SUMMARY & EXIT CODE
  // --------------------------------------------------------------------------
  console.log(
    `\n${colors.bold}${colors.cyan}======================================================================${colors.reset}`
  );
  console.log(`${colors.bold}${colors.cyan} TEST EXECUTION SUMMARY REPORT${colors.reset}`);
  console.log(
    `${colors.bold}${colors.cyan}======================================================================${colors.reset}`
  );

  for (const s of suiteResults) {
    const status =
      s.failed === 0 ? `${colors.green}PASS${colors.reset}` : `${colors.red}FAIL${colors.reset}`;
    console.log(
      `  [${status}] ${s.name.padEnd(58)} (${s.passed} passed, ${s.failed} failed in ${s.durationMs}ms)`
    );
  }

  console.log(
    `${colors.gray}----------------------------------------------------------------------${colors.reset}`
  );
  console.log(`  ${colors.bold}Total Test Suites: ${suiteResults.length}${colors.reset}`);
  console.log(`  ${colors.bold}Total Test Cases:  ${totalTests}${colors.reset}`);
  console.log(`  ${colors.bold}Total Passed:      ${colors.green}${totalPassed}${colors.reset}`);
  console.log(
    `  ${colors.bold}Total Failed:      ${totalFailed > 0 ? colors.red : colors.gray}${totalFailed}${colors.reset}`
  );
  console.log(
    `${colors.bold}${colors.cyan}======================================================================${colors.reset}\n`
  );

  if (totalFailed > 0) {
    console.error(
      `${colors.red}${colors.bold}Verification Failed! ${totalFailed} tests failed.${colors.reset}\n`
    );
    process.exit(1);
  } else {
    console.log(
      `${colors.green}${colors.bold}All E2E Verification Suites Passed Cleanly with 100% Success Rate!${colors.reset}\n`
    );
    process.exit(0);
  }
}

// Execute Runner
runAllSuites().catch((err) => {
  console.error(`\n${colors.red}${colors.bold}Fatal Harness Error:${colors.reset}`, err);
  process.exit(1);
});
