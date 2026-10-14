# Project: TikTok Direct Downloader Chrome Extension (Manifest V3)

## Architecture
- **Pattern**: Dual Track (Implementation Track + E2E Testing Track)
- **Zero-Build Vanilla Architecture**: Pure ES6+ JavaScript, CSS3, and HTML5 with zero bundler or compilation step. Direct load via `chrome://extensions/` Developer Mode -> "Load unpacked".
- **Module & Context Boundaries**:
  1. `background/service_worker.js`: Ephemeral MV3 service worker handling IPC `DOWNLOAD_VIDEO`, NTFS filename sanitization, `chrome.downloads.download({ conflictAction: 'uniquify' })`, `declarativeNetRequest` CDN rules, and `chrome.storage.local` telemetry.
  2. `content/injected/tiktok_bridge.js`: MAIN world script (`world: "MAIN"`, `run_at: "document_start"`) accessing `window.__UNIVERSAL_DATA_FOR_REHYDRATION__`, `window.SIGI_STATE`, and hooking `window.fetch`. Communicates with content script via `CustomEvent` (`TT_BRIDGE_REQUEST` / `TT_BRIDGE_RESPONSE`) on `document`.
  3. `content/platforms/tiktok.js`: ISOLATED world content script with 250ms debounced `MutationObserver`, target video container detection, duplicate injection prevention (`data-tt-dl-ready="true"`), 4-state button lifecycle, and fallback HTML5 `<video>` extraction.
  4. `content/styles/tiktok.css`: In-page action bar styling, 48px circular button, backdrop blur, SVG iconography, spinning loader animation, and hover effects.
  5. `popup/popup.html`, `popup.css`, `popup.js`: Extension toolbar popup with active tab detection, download statistics, and quick navigation.
  6. `icons/`: 16x16, 48x48, 128x128 RGBA PNG icons generated via zero-dependency script `icons/generate_icons.js`.
  7. `test_extension.js`: Zero-dependency automated test runner and verification harness.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Declarative Manifest V3 Specification | Validated MV3 schema declaring background service worker, permissions, host permissions, content scripts, and web accessible resources | M1 | ORIGINAL_REQUEST.md § R1 |
| F2 | Scoped Minimal Permissions | Requests only `downloads`, `declarativeNetRequest`, and `storage` | M1 | ORIGINAL_REQUEST.md § R1 |
| F3 | DeclarativeNetRequest ByteDance CDN Referer Protection | Dynamic rules injected on installation setting `Referer: https://www.tiktok.com/` for CDN media requests | M2 | ORIGINAL_REQUEST.md § R1, R2 |
| F4 | Background Service Worker IPC Dispatcher | Listens for `DOWNLOAD_VIDEO` messages via `chrome.runtime.onMessage` and responds asynchronously | M2 | ORIGINAL_REQUEST.md § R2 |
| F5 | Windows NTFS Filename Sanitization | Strips forbidden NTFS characters (`\ / : * ? " < > |`), control characters, trims dots and spaces, enforcing `tiktok_@[author]_[id].mp4` | M2 | ORIGINAL_REQUEST.md § R2 |
| F6 | Chrome Downloads API Invocation | Downloads video asset using `chrome.downloads.download` with `conflictAction: "uniquify"` and `saveAs: false` | M2 | ORIGINAL_REQUEST.md § R2 |
| F7 | In-Page Action Bar UI Injection | Injects circular native-styled download button into TikTok video action bar alongside Like, Comment, and Share | M4 | ORIGINAL_REQUEST.md § R3 |
| F8 | 250ms Debounced MutationObserver | Observes DOM mutations on FYP feed (`recommend-list-item-container`) and modal detail dialogs with 250ms debounce | M4 | ORIGINAL_REQUEST.md § R3 |
| F9 | Duplicate Injection Prevention | Sets `data-tt-dl-ready="true"` on processed video containers to prevent redundant button injection | M4 | ORIGINAL_REQUEST.md § R3 |
| F10 | Circular Native-Styled Action Button & SVG Icons | 48px circular button with SVG icons matching TikTok action bar aesthetics | M4 | ORIGINAL_REQUEST.md § R3, R5 |
| F11 | Primary Stream Extraction (MAIN World) | Reads `playAddr`, `downloadAddr`, `author`, and `videoId` from `window.__UNIVERSAL_DATA_FOR_REHYDRATION__` or `SIGI_STATE` | M3 | ORIGINAL_REQUEST.md § R4 |
| F12 | MAIN World Bridge Script | Standalone bridge script `content/injected/tiktok_bridge.js` communicating with ISOLATED world via `CustomEvent` | M3 | ORIGINAL_REQUEST.md § R4 |
| F13 | Fallback HTML5 `<video>` Extraction | Reads `currentSrc` or `src` from active `<video>` element, parses author/ID from URL pathname (`/@([^/]+)/video/(\d+)`) or DOM links | M3 | ORIGINAL_REQUEST.md § R4 |
| F14 | Interactive Button State Transitions | State machine managing Idle, Loading (spinner), Success (green checkmark for 2.5s), Error (red warning alert for 3s) | M4 | ORIGINAL_REQUEST.md § R5 |
| F15 | Extension Toolbar Popup | Clean dark-themed popup displaying extension status, active TikTok tab detection, and lifetime download counter | M5 | ORIGINAL_REQUEST.md § R6 |
| F16 | Local Metrics & Telemetry Persistence | Stores lifetime download count and last 50 downloads in `chrome.storage.local` | M2, M5 | ORIGINAL_REQUEST.md § R6 |
| F17 | Standalone Zero-Dependency PNG Icon Generator | Generates standard 16x16, 48x48, and 128x128 RGBA PNG icons using Node standard `zlib` | M1 | ORIGINAL_REQUEST.md § R6 |
| F18 | Project Documentation & Installation Guide | Comprehensive setup, installation, and testing instructions in `README.md` | M1, M5 | ORIGINAL_REQUEST.md § R6 |
| F19 | Automated Test Verification Harness | Standalone Node.js script `test_extension.js` verifying manifest schema, file integrity, syntax, sanitization edge cases, and IPC logic | M-TEST | ORIGINAL_REQUEST.md Acceptance Criteria |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M-TEST | E2E Testing Track: Test Infrastructure & Suites | F19: `test_extension.js`, `TEST_INFRA.md`, `TEST_READY.md` (Tiers 1-4) | none | DONE |
| M1 | Manifest V3 Foundation, Project Packaging & Icons | F1, F2, F17, F18: `manifest.json`, `icons/generate_icons.js`, PNG icons, `README.md` skeleton | none | DONE |
| M2 | Background Service Worker & Downloader Engine | F3, F4, F5, F6, F16: `background/service_worker.js` | M1 | DONE |
| M3 | MAIN-World Bridge & Multi-Tier Stream Extraction | F11, F12, F13: `content/injected/tiktok_bridge.js`, bridge client in `content/platforms/tiktok.js` | M1 | DONE |
| M4 | In-Page UI Injection & Button State Transitions | F7, F8, F9, F10, F14: `content/platforms/tiktok.js` (UI & Observer), `content/styles/tiktok.css` | M2, M3 | DONE |
| M5 | Extension Toolbar Popup & Final Documentation | F15, F16, F18: `popup/popup.html`, `popup.css`, `popup.js`, `README.md` | M1, M2 | DONE |
| M6 | Final Verification: 100% E2E Test Pass & Adversarial Hardening | Phase 1 (100% pass on Tiers 1-4) + Phase 2 (Adversarial Tier 5 coverage audit) | M-TEST, M1, M2, M3, M4, M5 | DONE |

---

## Interface Contracts

### 1. Bridge IPC Contract (`content/platforms/tiktok.js` ↔ `content/injected/tiktok_bridge.js`)
- **Channel**: `CustomEvent` dispatched on `document`
- **Request (`TT_BRIDGE_REQUEST`)**:
  ```javascript
  {
    source: 'TT_CONTENT_ISOLATED',
    requestId: string,
    videoId: string | null,
    url: string
  }
  ```
- **Response (`TT_BRIDGE_RESPONSE`)**:
  ```javascript
  {
    source: 'TT_BRIDGE_MAIN',
    requestId: string,
    success: boolean,
    tier: 'universal_data' | 'sigi_state' | 'fetch_cache' | 'none',
    data: {
      videoId: string,
      author: string,
      nickname: string,
      description: string,
      playUrl: string,
      downloadUrl: string,
      bitrate: number,
      quality: string,
      duration: number
    } | null,
    error: string | null
  }
  ```

### 2. Runtime IPC Contract (`content/platforms/tiktok.js` ↔ `background/service_worker.js`)
- **Channel**: `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`
- **Request**:
  ```javascript
  {
    type: 'DOWNLOAD_VIDEO', // or action: 'DOWNLOAD_VIDEO'
    payload: {
      url: string,
      author: string,
      videoId: string,
      title?: string
    }
  }
  ```
- **Response**:
  ```javascript
  {
    success: boolean,
    downloadId?: number,
    filename?: string,
    error?: string,
    message?: string
  }
  ```

### 3. Windows NTFS Filename Sanitization Contract
- **Input**: `author: string`, `videoId: string`
- **Sanitization Rules**:
  - Author: Strip leading `@`, remove forbidden `[\\/:*?"<>|\x00-\x1f\x7f-\x9f]`, collapse whitespace to `_`, trim trailing `.` and `_`, truncate to max 64 chars. Fallback to `unknown`.
  - Video ID: Sanitize to `[a-zA-Z0-9_-]`, max 64 chars. Fallback to timestamp.
- **Output Pattern**: `tiktok_@[author]_[id].mp4` strictly matching regex:
  `^tiktok_@[^\\/:*?"<>|\x00-\x1f\x7f-\x9f]+_[a-zA-Z0-9_-]+\.mp4$`

---

## Code Layout
```
tiktok-direct-downloader-extension/
├── manifest.json                  # Extension Manifest V3 declaration
├── background/
│   └── service_worker.js          # Background service worker & downloader
├── content/
│   ├── platforms/
│   │   └── tiktok.js              # TikTok content script (injection, state machine, fallback)
│   ├── styles/
│   │   └── tiktok.css             # Native-styled download button CSS
│   └── injected/
│       └── tiktok_bridge.js       # MAIN-world bridge script for hydration state
├── popup/
│   ├── popup.html                 # Extension toolbar popup interface
│   ├── popup.css                  # Popup dark theme styling
│   └── popup.js                   # Popup telemetry and tab detection
├── icons/
│   ├── generate_icons.js          # Programmatic zero-dependency PNG generator
│   ├── icon16.png                 # 16x16 icon
│   ├── icon48.png                 # 48x48 icon
│   └── icon128.png                # 128x128 icon
├── test_extension.js              # Automated E2E verification test harness
├── TEST_INFRA.md                  # Test architecture & feature coverage matrix
├── TEST_READY.md                  # Test suite ready indicator & coverage summary
├── PROJECT.md                     # Master project index & contracts
└── README.md                      # Complete installation & user guide
```
