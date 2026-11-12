# Panduan Kontribusi (Contributing Guidelines)

Terima kasih telah tertarik untuk berkontribusi pada **Mungil Extension Downloader**! Dokumen ini berisi standar kode, arsitektur keamanan bertingkat (_multi-layer security & quality_), serta alur kerja kontribusi untuk menjaga stabilitas dan performa ekstensi.

---

## 🏗️ 4-Tier Security & Quality Framework

Ekstensi ini menerapkan pengawasan kode otomatis pada 3 tingkatan (Editor, Git Pre-commit, dan GitHub Actions CI) dengan aturan **`--max-warnings 0`**:

### Lapis 1: Strict Code Hygiene (ESLint Flat Config)

- Aturan asinkron ketat: mencegah _unhandled promise rejections_ dan _floating promises_.
- Strict scoping: deklarasi leksikal dalam `switch-case` harus berada di dalam blok kurung kurawal `{ }`.
- Konvensi parameter tidak terpakai: argumen callback wajib diawali prefix underscore (misal `_tabId`, `_err`).

### Lapis 2: Keamanan Aplikasi (Application Security & SAST)

- **`eslint-plugin-security`**: Mendeteksi pola ReDoS (_Regular Expression Denial of Service_), _prototype pollution_, `eval()`, dan eksekusi non-literal.
- **`eslint-plugin-no-unsanitized`**: Memvalidasi manipulasi DOM untuk mencegah injeksi XSS. Dilarang menggunakan `document.write` atau `insertAdjacentHTML` yang tidak tersanitasi.
- **Windows NTFS Path Sanitizer**: Semua nama file yang disimpan ke OS wajib melalui filter sanitasi NTFS Win32 (menghapus karakter ilegal `\ / : * ? " < > |` dan _control characters_ `0x00-0x1F`).
- **SSRF & CRLF Protection**: URL media divalidasi terhadap rentang IP privat RFC 1918 / loopback, dan header filename dibersihkan dari CRLF.

### Lapis 3: Pencegahan Kebocoran Memori (Memory Leak & DOM Hygiene)

- **Event Listener Cleanup**: Setiap listener sementara (`setTimeout`, DOM event) wajib memiliki mekanisme pembersihan (_cleanup function_ / `removeEventListener`).
- **Object URL Revocation**: `URL.createObjectURL(blob)` wajib dicabut (`URL.revokeObjectURL`) segera setelah _download_ dipicu atau jika proses _catch_ terjadi.
- **Button Element Hygiene**: Seluruh elemen `<button>` wajib secara eksplisit mendefinisikan `type="button"`.
- **Active Navigation Watcher**: Deteksi navigasi SPA (Single Page Application) YouTube dan Bstation wajib mereset status tombol kembali ke `idle` untuk mencegah status lama tertinggal di video baru.

### Lapis 4: Otomasi Git Hook & CI/CD

- **Husky + lint-staged**: Setiap kali Anda menjalankan `git commit`, hook lokal otomatis memverifikasi formatting via Prettier dan linting via ESLint.
- **GitHub Actions**: Setiap _Pull Request_ dan _Push_ ke branch `main` wajib lolos 100% pada suite pengujian otomatis (**38 Suites, 298 Tests**).

---

## 💻 Alur Pengembangan Lokal (Local Setup)

### 1. Prasyarat

- **Node.js** >= 20.x atau 22.x
- **Python** >= 3.10 (dibutuhkan untuk modul Native Host `yt-dlp`)
- **Google Chrome** atau browser berbasis Chromium (Edge, Brave)

### 2. Instalasi Dependensi & Git Hooks

```bash
git clone https://github.com/AMillionDriver/Mungil-Extention-Downloader.git
cd Mungil-Extention-Downloader
npm install
```

_Perintah `npm install` akan otomatis mengaktifkan Husky pre-commit hooks._

### 3. Menjalankan Suite Pengujian

Sebelum melakukan commit, pastikan seluruh pengujian lulus:

```bash
# Menjalankan 38 suite test (298 test cases)
npm test

# Menjalankan pengujian ketahanan adversarial Bstation
npm run test:adversarial
```

### 4. Menjalankan Linter & Formatter

```bash
# Memeriksa linting dengan zero-warning policy
npm run lint

# Memperbaiki formatting otomatis via Prettier
npm run format

# Memeriksa konsistensi formatting
npm run format:check
```

### 5. Memasang Ekstensi di Chrome (Developer Mode)

1. Buka browser Chrome dan navigasikan ke `chrome://extensions/`.
2. Aktifkan **"Developer mode"** di pojok kanan atas.
3. Klik tombol **"Load unpacked"** (Muat yang belum dibongkar).
4. Pilih folder root repositori ini.
5. Jalankan script installer native host untuk mengaktifkan download YouTube kualitas tinggi:
   ```cmd
   native_host\install_host.bat
   ```

---

## 📝 Konvensi Pesan Commit (Conventional Commits)

Kami menggunakan format pesan commit konvensional:

- `feat: ...` — Penambahan fitur atau platform baru
- `fix: ...` — Perbaikan bug atau resolusi error
- `docs: ...` — Pembaruan dokumentasi atau panduan
- `test: ...` — Penambahan atau pembaruan test cases
- `refactor: ...` — Restrukturisasi kode tanpa mengubah fungsionalitas
- `chore: ...` — Pembaruan dependensi, linter, atau konfigurasi build

Contoh:

```bash
git commit -m "feat(anoboy): add dynamic estimated batch file size badge and footer calculator"
git commit -m "fix(anoboy): resolve 720p/1080p stream degradation from blogger cdn"
```

---

## 🚀 Alur Kerja Pull Request (PR Checklist)

Sebelum membuat Pull Request ke branch `main`, pastikan:

- [ ] Menambahkan branch baru dari `main` (misal `git checkout -b feat/nama-fitur`).
- [ ] `npm run lint` menghasilkan **0 error dan 0 warning**.
- [ ] `npm run format:check` lolos tanpa ada file yang belum terformat.
- [ ] `npm test` lulus **100% (38 Suites, 298/298 passed)**.
- [ ] Mematuhi aturan operasional di [`AGENTS.md`](AGENTS.md) dan [`SECURITY.md`](SECURITY.md).
- [ ] Tidak menyertakan binary berukuran besar (`*.exe`, `ffmpeg.exe`, `node_modules/`) ke dalam git.
- [ ] Menjelaskan secara singkat masalah yang diselesaikan dan solusi yang diimplementasikan pada deskripsi PR.
