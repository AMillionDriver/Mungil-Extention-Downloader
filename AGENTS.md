# AGENTS.md

> Machine-executable operational constraints and codebase invariants for autonomous coding agents (Antigravity, Cursor, Codex, Gemini Jules, Aider, Claude Code).

---

## 1. Ground Rules & Runtime Invariants

1. **Zero External Runtime Dependencies**:
   - `package.json` **MUST** keep `"dependencies"` empty (`{}`).
   - All runtime code in `background/`, `content_scripts/`, `popup/`, and `extractors/` must execute as pure vanilla JavaScript within the Chromium Manifest V3 sandbox.
   - Do NOT introduce external npm packages (`axios`, `lodash`, `cheerio`, `buffer`, etc.) into the extension runtime.
   - `devDependencies` are strictly reserved for developer tooling (`eslint`, `prettier`, `husky`, `lint-staged`).

2. **Windows NTFS & Cross-Platform Path Sanitization**:
   - When generating or sanitizing file paths for `chrome.downloads.download()`, always pass filenames through the NTFS sanitizer:
     - Strip forbidden characters: `< > : " / \ | ? *`
     - Strip control characters (`0x00` - `0x1F`)
     - Enforce `MAX_PATH` safety (< 260 characters)
     - Strip trailing periods and whitespace (`filename.trim().replace(/[. ]+$/, '')`)
     - Preserve valid extensions (`.mp4`, `.zip`, `.mp3`, `.png`, `.jpg`).

3. **DOM Element & UI Hygiene**:
   - Every `<button>` element created in HTML templates, content scripts, or popups **MUST** explicitly declare `type="button"` unless specifically intended as a form submit button.
   - Prevents accidental form submissions and unexpected page reloads in host SPA pages.

4. **100% Test Passing Contract**:
   - Any refactoring, feature addition, or bug fix **MUST** pass all suites in `test_extension.js` before completion.
   - Current baseline: **38 Test Suites (298 assertions)**.
   - Command: `node test_extension.js` must exit with code `0`.
   - Never remove or weaken existing assertions; add new test cases or suites when modifying logic.

---

## 2. Chrome Extension Manifest V3 Invariants

1. **Service Worker Lifetime & State**:
   - `background/service_worker.js` runs as a short-lived event-driven Service Worker.
   - Never rely on long-lived in-memory global variables across separate tasks; persist operational state in `chrome.storage.local`.
   - Never call `window`, `document`, or DOM APIs inside `service_worker.js`.

2. **Message Passing Protocol**:
   - All runtime messaging uses `chrome.runtime.sendMessage` and `chrome.runtime.onMessage`.
   - Message payloads adhere to the standard schema:
     ```json
     {
       "action": "ACTION_NAME",
       "url": "https://...",
       "filename": "video.mp4",
       "options": {}
     }
     ```
   - Listeners returning asynchronous promises must return `true` synchronously to keep the messaging channel open.

3. **Declarative Net Request (DNR) Rules**:
   - Referrer spoofing and origin headers must be managed dynamically or statically via `chrome.declarativeNetRequest`.
   - Ensure dynamic rule IDs do not collide; reserve discrete ID ranges per platform (e.g., Bstation: 1000-1999, AnoBoy: 2000-2999).

4. **Security & Transport**:
   - SSRF Protection: All resolved media URLs must be validated to prevent SSRF against RFC 1918 private IPs (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) or loopback (`127.0.0.1`, `localhost`).
   - CRLF Injection: Filenames must never contain carriage returns (`\r`) or line feeds (`\n`).

---

## 3. Directory Layout & Roles

| Path                           | Role                                                          | Execution Context               |
| :----------------------------- | :------------------------------------------------------------ | :------------------------------ |
| `background/service_worker.js` | Central coordinator, download dispatcher, native host router  | Chrome Service Worker (MV3)     |
| `downloader_host.js`           | Turbo Chunker (16x parallel range requests, dynamic AIMD)     | Node.js / Service Worker module |
| `content_scripts/`             | DOM injectors, page extractors, floating action buttons       | Web Page Isolated World         |
| `popup/`                       | Extension browser action UI (popup dialog, quality dropdowns) | Chrome Extension Popup          |
| `extractors/`                  | Platform-specific stream resolution engines                   | Shared / Injected               |
| `test_extension.js`            | Native Node.js test harness (38 suites, 297 tests)            | Node.js Test Runner             |

---

## 4. Verification Workflow

Run these commands before concluding any agent modification turn:

```bash
# 1. Verify zero test regressions
node test_extension.js

# 2. Check code hygiene and zero warnings
npm run lint

# 3. Ensure consistent formatting
npx prettier --write .
```
