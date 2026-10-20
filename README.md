# Mungil Extension Downloader — Chrome Extension (Manifest V3)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests Passing](https://img.shields.io/badge/Tests-182%2F182_Passing-brightgreen.svg)](test_extension.js)
[![ESLint](https://img.shields.io/badge/ESLint-Strict_Zero_Warnings-4B32C3.svg)](eslint.config.mjs)
[![Prettier](https://img.shields.io/badge/Code_Style-Prettier-F7B93E.svg)](.prettierrc)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows_|_Chromium-informational.svg)](native_host/)

Ekstensi browser Google Chrome modern berbasis **Manifest V3** untuk mengunduh video dan anime secara langsung, cepat, dan tanpa batas (_zero 403 Forbidden errors_) dari **YouTube (Watch & Shorts)**, **TikTok**, **Bstation (Bilibili TV)**, dan **JWPlyr** dengan format standar universal **H.264 (AVC) + AAC MP4** yang dapat langsung diputar di seluruh pemutar media bawaan sistem operasi (Windows Media Player, QuickTime, Android, iPhone, TV) tanpa aplikasi pihak ketiga.

---

## 🌟 Fitur Utama (Key Features)

### 1. 📺 YouTube Direct & Native Downloader (Watch & Shorts)

- **Pemilih Kualitas Fleksibel**: Pilih resolusi **1080p (Full HD)**, **720p (HD)**, **480p (Standar)**, atau **360p (Hemat Kuota)** langsung dari baris aksi video atau popup ekstensi.
- **Estimasi Ukuran File Real-Time**: Menampilkan perkiraan ukuran file secara dinamis (`~120 MB`, `~60 MB`, dll.) berdasarkan durasi video aktif.
- **Format Universal H.264 (AVC) + AAC**: Menghindari masalah layar hitam _"AV1 format not supported"_ pada Windows Media Player. Hasil unduhan dijamin langsung berputar lancar dengan audio jernih.
- **Integrasi Native Host (yt-dlp + FFmpeg)**: Mengunduh dan menggabungkan (_lossless stream remux_) video dan audio dalam hitungan detik tanpa membebani CPU/GPU pengguna.
- **Deteksi Duplikat & Tombol Abu-Abu**: Video yang telah selesai diunduh akan ditandai dengan tombol abu-abu _"✓ Sudah Diunduh"_. Jika diklik kembali, muncul dialog konfirmasi _"Kamu udah download ini tadi, mau download lagi?"_.
- **Active SPA Navigation Watcher**: Deteksi otomatis perpindahan video rekomendasi/sidebar di YouTube Polymer SPA dalam 350ms, seketika mereset tombol ke mode siap unduh.

### 2. 🎵 TikTok Direct Downloader

- **1-Click Download Button**: Tombol melayang disuntikkan rapi tepat di atas tombol Share pada FYP, modal, dan profil kreator.
- **Zero Re-encoding**: Mengambil file asli MP4 beresolusi penuh langsung dari CDN ByteDance tanpa watermark.
- **Mode Hemat Kuota**: Prioritisasi otomatis codec ByteVC1 (HEVC) untuk menghemat bandwidth 50-60%.

### 3. 🎬 Bstation (Bilibili TV) Anime & Video Downloader

- **In-Player Control Button**: Tombol unduh menyatu dengan bar kontrol player video.
- **Batch Episode Downloader**: Dialog unduh banyak episode anime sekaligus secara paralel (_Concurrency: 2_) dengan filter episode VIP otomatis.
- **Sesi Otentik**: Menggunakan kredensial sesi pengguna asli untuk mengakses kualitas tertinggi yang tersedia.

### 4. 📁 JWPlyr Folder & Video Downloader

- **Folder View Batch Downloader**: Unduh seluruh isi folder video (`/f/...`) dalam 1 klik dengan antrean paralel.
- **Single Player Floating Action**: Tombol unduh instan pada pemutar video (`/d/...` atau `/e/...`).

---

## 🏛️ Arsitektur Keamanan & Mutu Kode (4-Layer Framework)

Proyek ini dirancang menggunakan standar _enterprise-grade engineering_ dengan pengawasan otomatis pada 3 titik eksekusi (**Editor**, **Husky Pre-commit**, dan **GitHub Actions CI**):

1. **Lapis 1 — Strict Code Hygiene (ESLint v9 Flat Config)**:
   - Menjamin penanganan _asynchronous_ yang aman, scoping leksikal blok, dan penamaan variabel terstandarisasi.
2. **Lapis 2 — Application Security (SAST)**:
   - Mengintegrasikan `eslint-plugin-security` untuk memitigasi ReDoS, prototype pollution, dan eksekusi non-literal.
   - `eslint-plugin-no-unsanitized` untuk mencegah celah keamanan DOM XSS.
   - **Windows NTFS Sanitization**: Semua nama file dibersihkan dari karakter terlarang Win32 (`\ / : * ? " < > |`) dan _control characters_ (`0x00-0x1F`).
3. **Lapis 3 — Memory Leak & DOM Hygiene**:
   - Pembersihan listener berkala, pelepasan memori `URL.revokeObjectURL`, dan pencegahan _orphan elements_.
4. **Lapis 4 — CI/CD & Automated Gates**:
   - Menegakkan kebijakan **`--max-warnings 0`** pada ESLint dan Prettier di GitHub Actions serta Git Hook lokal.

---

## 🚀 Panduan Instalasi Cepat (Quick Start)

### 1. Pasang Ekstensi di Google Chrome

1. Buka browser Google Chrome dan kunjungi alamat `chrome://extensions/`.
2. Aktifkan **"Mode Pengembang (Developer mode)"** di pojok kanan atas.
3. Klik tombol **"Muat yang belum dibongkar (Load unpacked)"**.
4. Arahkan dan pilih folder repositori ini.
5. Ekstensi **Mungil Downloader** akan langsung aktif di toolbar Chrome.

### 2. Pasang Native Messaging Host (Khusus YouTube 1080p/720p)

Agar fitur download YouTube dengan FFmpeg dan yt-dlp berjalan maksimal di Windows:

1. Buka folder `native_host/` di File Explorer.
2. Klik kanan file **`install_host.bat`** lalu pilih **"Run as administrator"** (atau klik dua kali).
3. Script otomatis mendaftarkan manifest Native Host ke Windows Registry dan menyiapkan binary FFmpeg mandiri.
4. Reload tab Chrome Anda (`F5`), dan fitur download YouTube siap digunakan!

---

## 🛠️ Perintah Pengembangan (Development Commands)

```bash
# Menjalankan seluruh 24 suite test (182 test cases)
npm test

# Menjalankan test ketahanan adversarial Bstation
npm run test:adversarial

# Memeriksa kepatuhan linter dengan zero-warning policy
npm run lint

# Memeriksa kepatuhan format kode Prettier
npm run format:check

# Merapikan seluruh file secara otomatis dengan Prettier
npm run format
```

---

## 📂 Struktur Repositori

```text
Mungil-Extention-Downloader/
├── .github/workflows/ci.yml       # GitHub Actions CI pipeline
├── .husky/pre-commit              # Git pre-commit hook (lint-staged + test)
├── .prettierrc                    # Konfigurasi formatting Prettier
├── .gitignore                     # Git ignore komprehensif
├── eslint.config.mjs              # ESLint v9 flat config (Security & Quality)
├── package.json                   # Dependensi dev, metadata, scripts
├── CONTRIBUTING.md                # Panduan kontribusi dan PR checklist
├── README.md                      # Dokumentasi utama proyek
├── manifest.json                  # Manifest V3 deklarasi ekstensi
├── background/
│   └── service_worker.js          # MV3 Service worker, DNR rules, queue limiter
├── content/
│   ├── platforms/                 # Content scripts (TikTok, Bstation, JWPlyr, YouTube)
│   ├── injected/                  # Bridge scripts MAIN world
│   └── styles/                    # Stylesheet antarmuka in-page
├── native_host/
│   ├── downloader_host.js         # Node.js native host IPC listener
│   ├── downloader_host.json       # Host registry declaration
│   ├── install_host.bat           # Installer otomatis Native Host Windows
│   └── uninstall_host.bat         # Uninstaller Native Host
├── popup/                         # Antarmuka popup toolbar Chrome
└── test_extension.js              # Test suite (24 suites, 182 test cases)
```

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah lisensi [MIT](LICENSE).
