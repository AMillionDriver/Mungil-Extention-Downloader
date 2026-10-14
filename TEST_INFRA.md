# E2E Test Infrastructure & Test Suite Specification (TEST_INFRA.md)

**Project:** TikTok Direct Downloader Chrome Extension (Manifest V3)  
**Author:** test_writer_1 (E2E Testing Specialist)  
**Integrity Mode:** Development & Verification  
**Standard:** Manifest V3, Pure Vanilla JavaScript (ES6+), Zero Build Step, Zero npm Runtime Dependencies  

---

## 1. Testing Methodology Overview

The testing harness and verification framework for the TikTok Direct Downloader follows a rigorous, multi-layered quality assurance methodology composed of four primary paradigms:

1. **Category-Partition Method**: Systematically categorizes input domains (e.g., manifest configurations, filenames, URLs, DOM mutation batches, IPC payloads) into disjoint equivalence partitions and selects representative test vectors from each partition (valid, invalid, edge, and adversarial).
2. **Boundary Value Analysis (BVA)**: Targets extreme limits, edge transitions, and boundary conditions (e.g., 0 chars, 1 char, 63/64 char length bounds, 255/260 char filesystem limits, 0ms, 249ms, 250ms, 251ms debounce thresholds, 2500ms and 3000ms state transition timers, control characters `0x00`-`0x1F`, `0x7F`-`0x9F`).
3. **Pairwise Combinatorial Testing**: Evaluates multi-dimensional interactions between input vectors (e.g., author names with reserved characters combined with numeric IDs, missing URLs, long strings, unicode/emojis, and DOM container variations).
4. **Real-World Workloads & DOM Simulation**: Simulates dynamic feed mutations (rapid DOM node additions during infinite scrolling), SPA client-side routing (`history.pushState`), asynchronous bridge resolution, and background service worker lifecycle restarts.

---

## 2. Test Architecture Tiers (Tiers 1 - 4)

| Test Tier | Focus Area | Execution Mode | Scope & Target Modules |
|---|---|---|---|
| **Tier 1: Static Conformance & Schema Integrity** | Manifest V3 schema validity, file structure presence, asset integrity (PNG magic bytes), and JavaScript syntax validation. | Synchronous CLI (`node --check`, `JSON.parse`, `fs.stat`, binary buffer slicing) | `manifest.json`, `icons/*`, `background/*`, `content/*`, `popup/*` |
| **Tier 2: Unit Boundaries & Deterministic Algorithms** | Filename sanitization against Windows NTFS restrictions, Win32 reserved device names, control characters, URL regex extraction, and length truncation. | Pure deterministic algorithmic unit tests using Node's `node:assert` | NTFS filename sanitizer, DOM URL extractors, data normalizers |
| **Tier 3: Asynchronous Lifecycle & State Machine Simulation** | Debounced MutationObserver coalescing, duplicate injection guards, self-healing reconciliation, and 4-state visual state machine lifecycle timers. | Virtualized time simulation & async timer assertions (`setTimeout`, microtask queues) | `TikTokDOMObserver`, `setButtonState`, button lifecycle |
| **Tier 4: IPC Protocol & Chrome API Mock Verification** | Runtime IPC message passing (`DOWNLOAD_VIDEO`), Chrome Downloads API parameter options (`conflictAction: 'uniquify'`), and DeclarativeNetRequest dynamic rule validation. | Sandboxed mock Chrome extension runtime (`chrome.runtime`, `chrome.downloads`, `chrome.declarativeNetRequest`) | `background/service_worker.js`, `content/injected/tiktok_bridge.js`, `popup/popup.js` |

---

## 3. Comprehensive Feature Mapping Matrix (F1 — F19)

| Feature ID | Feature Name | Mapped Tier | Input Partitions & Test Boundaries | Authoritative Expected Output | Test Suite |
|---|---|---|---|---|---|
| **F1** | Declarative Manifest V3 Specification | Tier 1 | Valid JSON; manifest_version=3; required keys (`name`, `version`, `background`, `content_scripts`, `web_accessible_resources`, `action`, `icons`). | Strict MV3 schema conformity; zero deprecated MV2 keys (`browser_action`, background scripts array). | Suite 1 |
| **F2** | Scoped Minimal Permissions | Tier 1 | `permissions` array; `host_permissions` array. | Exact minimal set: `["downloads", "declarativeNetRequest", "storage"]`; hosts: TikTok web and ByteDance CDNs (`*.tiktok.com`, `*.tiktokcdn.com`, `*.byteoversea.com`, `*.ibytedtos.com`). | Suite 1 |
| **F3** | DeclarativeNetRequest ByteDance CDN Referer Protection | Tier 4 | Dynamic rules structure; headers modified; urlFilter patterns. | Dynamic rules set `Referer: https://www.tiktok.com/` and `Origin: https://www.tiktok.com` for `*tiktokcdn.com*`, `*byteoversea.com*`, `*ibytedtos.com*`. | Suite 7 |
| **F4** | Background Service Worker IPC Dispatcher | Tier 4 | Message `{ action: 'DOWNLOAD_VIDEO', payload }` or `{ type: 'DOWNLOAD_VIDEO' }`. | Listener returns `true` for async handling; dispatches response `{ success: true, downloadId, filename }` or `{ success: false, error }`. | Suite 7 |
| **F5** | Windows NTFS Filename Sanitization | Tier 2 | Forbidden characters (`\ / : * ? " < > \|`), control chars (`0x00-0x1F`, `0x7F`), trailing dots/spaces, empty/null, reserved names (`CON`, `NUL`), emoji/unicode, length > 255. | Output pattern strictly matches: `^tiktok_@[^\\/:*?"<>\|\x00-\x1f\x7f-\x9f]+_[a-zA-Z0-9_-]+\.mp4$`; no forbidden characters; bounded to safe length. | Suite 4 |
| **F6** | Chrome Downloads API Invocation | Tier 4 | Valid stream URL + sanitized filename. | Invokes `chrome.downloads.download` with `{ url, filename, conflictAction: 'uniquify', saveAs: false }`. | Suite 7 |
| **F7** | In-Page Action Bar UI Injection | Tier 3 | Video container DOM element without existing button. | Creates and mounts `.tt-dl-action-item` with 48px circular button and label into action container. | Suite 5 |
| **F8** | 250ms Debounced MutationObserver | Tier 3 | Rapid bursts of DOM mutations (0ms, 50ms, 100ms, 150ms, 200ms). | Scans are coalesced; single execution occurs after 250ms quiet period. | Suite 5 |
| **F9** | Duplicate Injection Prevention | Tier 3 | Repeated scans on same container; container with `data-tt-dl-ready="true"`. | Exactly 1 download button injected per video card; secondary scans early-return. | Suite 5 |
| **F10** | Circular Native-Styled Action Button & SVG Icons | Tier 1, 3 | Action button rendering in DOM. | Button has class `tt-dl-btn`, dimensions 48x48px, SVG icon child, and accessible label. | Suite 5, 6 |
| **F11** | Primary Stream Extraction (MAIN World) | Tier 4 | Global window hydration state (`__UNIVERSAL_DATA_FOR_REHYDRATION__`, `SIGI_STATE`). | Extracts `playAddr` or highest bitrate stream, `author`, and `videoId`. | Suite 7 |
| **F12** | MAIN World Bridge Script | Tier 1, 4 | Registration in manifest (`world: "MAIN"`, `run_at: "document_start"`); CustomEvent contract. | Injected script listens for `TT_BRIDGE_REQUEST` and returns `TT_BRIDGE_RESPONSE`. | Suite 1, 7 |
| **F13** | Fallback HTML5 `<video>` Extraction | Tier 2 | Active `<video>` element with `currentSrc` (direct CDN vs `blob:`) + page URL. | Direct CDN URL returned; `blob:` rejected with fallback cascade; author parsed from URL regex `/@([^/?#]+)/video/(\d+)`. | Suite 4, 7 |
| **F14** | Interactive Button State Transitions | Tier 3 | User click -> extraction start -> download complete (or error). | Transitions: `Idle` -> `Loading` (disabled=true, spinner) -> `Success` (2500ms timer, checkmark) -> `Idle`; or `Error` (3000ms timer, alert) -> `Idle`. Cleans up existing timers on rapid clicks. | Suite 6 |
| **F15** | Extension Toolbar Popup | Tier 1, 4 | `popup/popup.html`, `popup.css`, `popup.js`; active tab query. | Renders TikTok dark theme; detects whether active tab is `tiktok.com`; displays status badge and action buttons. | Suite 1, 2, 3 |
| **F16** | Local Metrics & Telemetry Persistence | Tier 4 | Completed download event. | Updates `downloadCount` (+1) and prepends to `recentDownloads` (max 50) in `chrome.storage.local`. | Suite 7 |
| **F17** | Standalone PNG Icon Generator | Tier 1 | `icons/generate_icons.js`; binary output buffer. | Generates standard RGBA PNG files for 16x16, 48x48, 128x128 with valid PNG magic bytes `89 50 4E 47 0D 0A 1A 0A`. | Suite 2 |
| **F18** | Project Documentation & Installation Guide | Tier 1 | `README.md` file presence and structure. | Contains installation guide, developer mode loading instructions, and architecture breakdown. | Suite 2 |
| **F19** | Automated Test Verification Harness | All Tiers | Full suite execution via `node test_extension.js`. | Standalone runner executes Suites 1-7 in pure Node.js, yielding 100% pass rate and exit code 0. | All Suites |

---

## 4. Test Suites Detailed Specifications

### Suite 1: Manifest V3 Conformance & Schema Validation
- **Objective**: Validate that `manifest.json` conforms strictly to Chrome Manifest V3 specifications (Chrome 114+).
- **Assertions**:
  1. `manifest_version` strictly equals `3`.
  2. `name`, `version`, `description` are non-empty strings.
  3. `permissions` contains strictly required permissions: `downloads`, `declarativeNetRequest`, `storage`.
  4. `host_permissions` includes `*://*.tiktok.com/*` and ByteDance media hosts:
     - `*://*.tiktokcdn.com/*`
     - `*://*.byteoversea.com/*`
     - `*://*.ibytedtos.com/*`
  5. `background.service_worker` is declared and points to `background/service_worker.js`.
  6. `content_scripts` array declares injection for `*://*.tiktok.com/*` with `content/platforms/tiktok.js` and `content/styles/tiktok.css`.
  7. `web_accessible_resources` array correctly matches MV3 object structure (`resources` array + `matches` array) exposing `content/injected/tiktok_bridge.js` and icon assets.
  8. `action.default_popup` points to `popup/popup.html`.
  9. `icons` object declares 16, 48, and 128 resolutions.

### Suite 2: File Structure & Asset Integrity Validation
- **Objective**: Ensure all project deliverables exist, are non-empty, and binary assets adhere to standard formats.
- **Assertions**:
  1. All 12 required project files exist with file size > 0:
     - `manifest.json`
     - `background/service_worker.js`
     - `content/platforms/tiktok.js`
     - `content/styles/tiktok.css`
     - `content/injected/tiktok_bridge.js`
     - `popup/popup.html`
     - `popup/popup.css`
     - `popup/popup.js`
     - `icons/generate_icons.js`
     - `icons/icon16.png`
     - `icons/icon48.png`
     - `icons/icon128.png`
     - `README.md`
  2. PNG Magic Byte Header Verification: Read first 8 bytes of `icon16.png`, `icon48.png`, and `icon128.png`. Verify they strictly equal:
     `0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A` (`\x89PNG\r\n\x1a\n`).

### Suite 3: JavaScript Syntax Check (`node --check`)
- **Objective**: Guarantee zero compilation/syntax errors across all JavaScript modules without transpilation.
- **Assertions**:
  - Execute `node --check` via `child_process.spawnSync` / `execSync` on:
    - `background/service_worker.js`
    - `content/platforms/tiktok.js`
    - `content/injected/tiktok_bridge.js`
    - `popup/popup.js`
    - `icons/generate_icons.js`
    - `test_extension.js`
  - Assert exit status code equals `0` and stderr is empty.

### Suite 4: Windows NTFS Filename Sanitization Unit & Boundary Tests
- **Objective**: Thoroughly test filename sanitization using Category-Partition and BVA against Win32 / NTFS constraints.
- **Partitions & Test Cases**:
  1. *Standard Clean Input*: `author = 'khaby.lame'`, `id = '7123456789'` -> `tiktok_@khaby.lame_7123456789.mp4`.
  2. *Illegal NTFS Characters Partition*: `\ / : * ? " < > |` embedded in author and ID -> all replaced with `_`.
  3. *Control Characters Partition*: ASCII `0x00` through `0x1F` and `0x7F` through `0x9F` -> stripped or replaced.
  4. *Repeated '@' Prefix*: `@@@charlidamelio` -> normalized to single `@charlidamelio` in prefix pattern `tiktok_@charlidamelio_[id].mp4`.
  5. *Surrounding Dots & Spaces (Win32 Trimming)*: `...bellapoarch...   ` -> stripped leading/trailing dots/spaces to avoid Win32 filesystem errors.
  6. *Reserved Device Names Partition*: `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9` -> safe prefix `tiktok_@` prevents device conflicts.
  7. *Unicode / Emoji Partition*: `日本語ユーザー`, `🔥creator🔥`, `مرحبا` -> valid Unicode preserved, forbidden symbols sanitized.
  8. *Null / Undefined / Empty Input Fallback*: `null`, `undefined`, `""` -> falls back to `unknown` for author and numeric timestamp for videoId.
  9. *Extreme Length (BVA)*: 300-char author string -> truncated to max 64 chars, ensuring total filename < 255 chars.
  10. *Master Regex Conformance*: Output must strictly match:
      `^tiktok_@[^\\/:*?"<>|\x00-\x1f\x7f-\x9f]+_[a-zA-Z0-9_-]+\.mp4$`

### Suite 5: In-Page UI Injection & Debounce Simulation
- **Objective**: Verify that dynamic DOM observation, 250ms debouncer coalescing, duplicate injection prevention, and self-healing reconciliation function correctly under high-frequency updates.
- **Assertions**:
  1. *Debounce Coalescing*: Dispatching 10 rapid mutation triggers over 100ms results in exactly 1 consolidated scan invocation at 250ms.
  2. *Duplicate Injection Guard*: Scanning a DOM video container twice produces exactly 1 injected button; subsequent scans detect `data-tt-dl-ready="true"` and skip.
  3. *Self-Healing Reconciliation*: When a video card container has `data-tt-dl-ready="true"` but its inner action button was removed by React DOM recycling, the scanner resets the ready flag and re-injects the button.

### Suite 6: Button State Transitions State Machine Simulation
- **Objective**: Verify the 4-state visual state machine lifecycle, disabled attributes, and auto-reversion timers.
- **Assertions**:
  1. *Initial State*: State is `'idle'`; button is enabled (`disabled === false`); icon is download arrow.
  2. *Loading State*: Calling `setButtonState(btn, 'loading')` disables button (`disabled === true`) and sets spinner icon.
  3. *Success State*: Calling `setButtonState(btn, 'success')` displays checkmark icon; button remains disabled; automatically reverts to `'idle'` after exactly 2500ms.
  4. *Error State*: Calling `setButtonState(btn, 'error')` displays warning icon; button is re-enabled; automatically reverts to `'idle'` after exactly 3000ms.
  5. *Rapid Click Timer Cleanup*: Transitioning from Success to Error or Idle before 2500ms clears the pending timer, preventing timer collisions or premature resets.

### Suite 7: Service Worker IPC & DeclarativeNetRequest Rule Validation
- **Objective**: Validate background runtime message handling, Chrome Downloads invocation options, and declarativeNetRequest rule structures.
- **Assertions**:
  1. *IPC Contract*: Message `{ action: 'DOWNLOAD_VIDEO', url: 'https://...', author: 'user', videoId: '123' }` triggers `chrome.downloads.download`.
  2. *Conflict Action Uniquify*: The download options object explicitly contains `conflictAction: 'uniquify'` and `saveAs: false`.
  3. *DeclarativeNetRequest Rules Structure*: Dynamic rules declare `id`, `priority: 1`, `action.type: 'modifyHeaders'`, adding `Referer: https://www.tiktok.com/` for CDN hosts (`tiktokcdn.com`, `byteoversea.com`, `ibytedtos.com`).
  4. *Storage Telemetry Update*: Completed downloads trigger telemetry updates in `chrome.storage.local`.

---

## 5. Verification Execution Command

To execute the test suite across all 7 suites:

```powershell
node test_extension.js
```

### Authoritative Verification Criteria:
- All 7 test suites must report `PASS`.
- Total test count >= 40 individual assertions.
- Zero uncaught exceptions or unhandled promise rejections.
- Process exit code must be `0`.
