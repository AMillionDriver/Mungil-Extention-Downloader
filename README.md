# TikTok Direct Downloader — Chrome Extension (Manifest V3)

A modular, zero-build Google Chrome Extension built in pure Vanilla JavaScript (ES6+), HTML5, and CSS3 that enables direct, in-page 1-click downloading of TikTok videos without third-party downloader websites or ads.

---

## Features

- **Direct In-Page 1-Click Downloading**: Injects a native circular action button into the video action bar alongside Like, Comment, Bookmark, and Share on both the FYP feed and video modal dialogs.
- **Interactive 4-State Lifecycle**:
  - **Idle**: Clean native-styled button with SVG download icon.
  - **Loading**: High-contrast spinning animation while resolving stream metadata and enqueuing download; prevents rapid duplicate clicks.
  - **Success**: Green checkmark icon for 2.5 seconds upon successful download initiation.
  - **Error**: Crimson alert icon for 3.0 seconds if video stream extraction fails, then gracefully resets.
- **Multi-Tier Stream Extraction Engine**:
  - **Tier 1 (MAIN World)**: Standalone bridge script hooks `window.__UNIVERSAL_DATA_FOR_REHYDRATION__` and `window.SIGI_STATE`, and intercepts `window.fetch` to extract unwatermarked playback streams at the highest available bitrate.
  - **Tier 2 (Fallback)**: Inspects the active HTML5 `<video>` element (`currentSrc` / `src`) and parses creator handles and video IDs from DOM links and URL paths.
- **Strict Windows NTFS Filename Sanitization**: Automatically cleans author handles and video IDs, stripping forbidden Win32 characters (`\ / : * ? " < > |`), ASCII control codes, repeated `@` prefixes, and trailing dots/whitespace to enforce the standardized pattern:
  ```
  tiktok_@[author]_[id].mp4
  ```
- **DeclarativeNetRequest CDN Referer Protection**: Injects dynamic request header rules ensuring all media requests to ByteDance CDNs (`*.tiktokcdn.com`, `*.byteoversea.com`, `*.ibytedtos.com`) carry valid `Referer: https://www.tiktok.com/` headers to prevent HTTP 403 Forbidden hotlink rejections.
- **Extension Toolbar Popup**: Sleek TikTok-dark themed toolbar popup showing active tab detection, lifetime download statistics from `chrome.storage.local`, and one-click access to the Downloads folder.
- **Zero-Build Vanilla Architecture**: Pure standard web technologies. No bundlers (Webpack, Vite, Rollup), zero runtime npm dependencies. Directly loadable in Chrome Developer Mode.

---

## Project Structure

```
tiktok-direct-downloader-extension/
├── manifest.json                  # Extension Manifest V3 configuration
├── background/
│   └── service_worker.js          # Ephemeral SW: IPC dispatcher, NTFS sanitization, DNR rules
├── content/
│   ├── platforms/
│   │   └── tiktok.js              # Content script: 250ms debounced observer, UI injection, fallback
│   ├── styles/
│   │   └── tiktok.css             # Native-styled circular download button, animations, & themes
│   └── injected/
│       └── tiktok_bridge.js       # MAIN-world bridge script for hydration state & fetch hook
├── popup/
│   ├── popup.html                 # Extension toolbar popup layout
│   ├── popup.css                  # Popup dark theme styling
│   └── popup.js                   # Popup telemetry and active tab detection
├── icons/
│   ├── generate_icons.js          # Standalone pure Node.js PNG generator using zlib.deflateSync
│   ├── icon16.png                 # 16x16 extension icon
│   ├── icon48.png                 # 48x48 extension icon
│   └── icon128.png                # 128x128 extension icon
├── test_extension.js              # Automated E2E verification test harness
├── PROJECT.md                     # Architectural specifications and interface contracts
└── README.md                      # Complete installation and user guide
```

---

## Installation Guide (Developer Mode)

1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in the address bar.
3. Enable the **Developer mode** toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left toolbar.
5. Select the project directory:
   ```
   C:\Users\flami\.gemini\antigravity\scratch\tiktok-direct-downloader-extension
   ```
6. The extension **TikTok Direct Downloader** will now appear in your extensions list.
7. Click the Puzzle icon in Chrome's toolbar and pin **TikTok Direct Downloader** for quick access.

---

## How to Use

1. Navigate to **[tiktok.com](https://www.tiktok.com/)** in Google Chrome.
2. Scroll through the **For You Page (FYP)**, user profiles, or click any video to open the modal detail view.
3. Locate the circular **Download** button in the vertical action bar (beneath Share).
4. Click **Download**:
   - The button will display a spinning animation (`Fetching...`).
   - The video stream is resolved and downloaded to your default Chrome Downloads directory.
   - The button shows a green checkmark (`Saved!`) for 2.5 seconds before returning to Idle.
5. Click the extension toolbar icon anytime to view total lifetime downloads or jump directly to your Downloads folder.

---

## Verification & Testing

### Automated Test Suite
Run the automated test verification suite from the project root:
```powershell
node test_extension.js
```
The test suite validates:
- Manifest V3 schema and permission definitions
- Complete file structure integrity and PNG magic headers
- JavaScript syntax across all source files (`node --check`)
- Windows NTFS filename sanitization across all edge cases (reserved device names, trailing dots, illegal characters, emojis, length bounds)
- Runtime IPC message formats and contracts

### Standalone Syntax Verification
```powershell
node --check background/service_worker.js
node --check content/platforms/tiktok.js
node --check content/injected/tiktok_bridge.js
node --check popup/popup.js
node --check icons/generate_icons.js
```

### Regenerate Extension Icons
To regenerate the 16x16, 48x48, and 128x128 PNG icons using the built-in zero-dependency generator:
```powershell
node icons/generate_icons.js
```

---

## License
MIT License. Built for personal, educational, and content creation workflows.
