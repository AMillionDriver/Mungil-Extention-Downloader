# Security Policy & Threat Model

## 1. Supported Versions

| Version   | Supported          | Notes                                |
| :-------- | :----------------- | :----------------------------------- |
| `1.2.x`   | :white_check_mark: | Active development & current release |
| `< 1.2.0` | :x:                | Deprecated                           |

---

## 2. Security Architecture & Threat Vectors

The extension operates under Chromium's **Manifest V3** security model, enforcing strict sandboxing and content security policies:

### A. SSRF (Server-Side Request Forgery) Defense

- All resolved media and chunk URLs are validated before being passed to `chrome.downloads.download()` or fetch streams.
- Private network ranges (RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback addresses (`127.0.0.1`, `localhost`), and link-local addresses (`169.254.0.0/16`) are blocked from download resolution pipelines.

### B. Header Isolation & Declarative Net Request (DNR)

- Third-party CDN referrers (e.g., Bilibili, Blogger, TikTok) require custom `Referer` and `Origin` headers to prevent `403 Forbidden` responses.
- Referrer modifications are strictly scoped to specific target domains via `chrome.declarativeNetRequest` rules and automatically cleaned up upon download completion.
- Credentials and authentication cookies are never forwarded to untrusted third-party hosts during stream resolution.

### C. NTFS & Cross-Platform Path Sanitization

- Filenames extracted from web page titles or video metadata are sanitized against OS path injection and directory traversal attacks (`../`, `..\`).
- Forbidden Win32 characters (`< > : " / \ | ? *`) and control characters (`0x00`-`0x1F`) are stripped.
- Filenames exceeding `MAX_PATH` limits are safely truncated while preserving the target file extension.

### D. CRLF Injection Mitigation

- Filenames and header values are sanitized against carriage return (`\r`) and line feed (`\n`) characters to prevent HTTP response splitting and download attribute smuggling.

### E. Zero External Runtime Dependencies

- The extension runtime executes pure vanilla JavaScript without third-party npm packages, eliminating the risk of software supply-chain poisoning.

---

## 3. Reporting a Vulnerability

If you discover a security vulnerability within this project:

1. **Do not create a public GitHub issue.**
2. Send an email describing the issue, reproducible steps, and potential impact to the project maintainer at `mungil.driver@gmail.com` or open a private advisory on GitHub Security Advisories.
3. You will receive an initial response within 48 hours.
4. Once verified, a fix will be developed and released promptly with proper attribution.
