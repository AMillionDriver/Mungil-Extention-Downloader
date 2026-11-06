#!/usr/bin/env node
/**
 * Direct Downloader - Chrome Native Messaging Host
 *
 * Interfaces with Google Chrome via 32-bit length-prefixed stdio messages.
 * Executes local yt-dlp with FFmpeg integration to download 1080p/720p YouTube videos
 * directly to the user's Downloads folder with zero 403 Forbidden errors.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

// Locate FFmpeg binary on Windows
function findFfmpegBin() {
  // Check common WinGet installation directory
  const wingetBase = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(wingetBase)) {
    try {
      const entries = fs.readdirSync(wingetBase);
      for (const entry of entries) {
        if (entry.includes('Gyan.FFmpeg')) {
          const candidateBin = path.join(wingetBase, entry, 'ffmpeg-9.0.1-essentials_build', 'bin');
          if (fs.existsSync(path.join(candidateBin, 'ffmpeg.exe'))) {
            return candidateBin;
          }
          // Search subdirs 1 level deep
          const subEntries = fs.readdirSync(path.join(wingetBase, entry));
          for (const sub of subEntries) {
            const subBin = path.join(wingetBase, entry, sub, 'bin');
            if (fs.existsSync(path.join(subBin, 'ffmpeg.exe'))) {
              return subBin;
            }
          }
        }
      }
    } catch (_) {}
  }

  // Check local bin folder inside native_host
  const localBin = path.join(__dirname, 'bin');
  if (fs.existsSync(path.join(localBin, 'ffmpeg.exe'))) {
    return localBin;
  }

  return null;
}

const ffmpegBinPath = findFfmpegBin();

// Resolve real Python / yt-dlp binary avoiding WindowsApps stub
function resolvePythonBinary() {
  const candidates = [
    path.join(os.homedir(), 'AppData', 'Local', 'Python', 'bin', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Python', 'bin', 'pythonw.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'python';
}

const pythonBinPath = resolvePythonBinary();

// Active child process and temp cookie reference to eliminate orphan processes/files on disconnect
let activeChildProcess = null;
let activeTempCookiePath = null;
const activeSockets = new Set();
let activeFd = null;
let activeFilePath = null;

function cleanupActiveTempCookie() {
  if (activeTempCookiePath) {
    try {
      if (fs.existsSync(activeTempCookiePath)) {
        fs.unlinkSync(activeTempCookiePath);
      }
    } catch (_) {}
    activeTempCookiePath = null;
  }
}

function cancelAllActive() {
  cleanupActiveTempCookie();
  if (activeChildProcess && !activeChildProcess.killed) {
    try {
      activeChildProcess.kill('SIGKILL');
    } catch (_) {}
    activeChildProcess = null;
  }
  for (const sock of activeSockets) {
    try {
      sock.destroy();
    } catch (_) {}
  }
  activeSockets.clear();
  if (activeFd !== null) {
    try {
      fs.closeSync(activeFd);
    } catch (_) {}
    activeFd = null;
  }
}

function killActiveChild() {
  cancelAllActive();
}

// Ensure orphan processes are destroyed if Chrome closes or crashes
process.stdin.on('end', () => {
  cancelAllActive();
  process.exit(0);
});

process.on('SIGINT', () => {
  cancelAllActive();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cancelAllActive();
  process.exit(0);
});

process.on('exit', () => {
  cancelAllActive();
});

// Standard Chrome Native Messaging Stdio Framing
let inputBuffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const msgLen = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length >= 4 + msgLen) {
      const msgBytes = inputBuffer.slice(4, 4 + msgLen);
      inputBuffer = inputBuffer.slice(4 + msgLen);
      try {
        const msg = JSON.parse(msgBytes.toString('utf-8'));
        handleIncomingMessage(msg);
      } catch (err) {
        sendMessage({ success: false, error: 'JSON Parse Error: ' + err.message });
      }
    } else {
      break;
    }
  }
});

function sendMessage(obj) {
  try {
    const jsonStr = JSON.stringify(obj);
    const jsonBuf = Buffer.from(jsonStr, 'utf-8');
    const headerBuf = Buffer.alloc(4);
    headerBuf.writeUInt32LE(jsonBuf.length, 0);
    process.stdout.write(headerBuf);
    process.stdout.write(jsonBuf);
  } catch (err) {
    console.error('Error writing to stdout:', err);
  }
}

/**
 * Handles incoming JSON messages from Chrome Extension.
 * @param {object} msg
 */
function handleIncomingMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    return sendMessage({ success: false, error: 'Invalid message payload' });
  }

  const action = msg.action || msg.type;

  // 1. Healthcheck / Ping
  if (action === 'PING') {
    return sendMessage({
      success: true,
      status: 'ready',
      version: '1.2.0',
      pythonBinary: pythonBinPath,
      ffmpegLocated: Boolean(ffmpegBinPath),
      ffmpegPath: ffmpegBinPath || 'PATH'
    });
  }

  // 2. Explicit Cancel Action
  if (action === 'CANCEL') {
    killActiveChild();
    return sendMessage({ success: true, message: 'Download cancelled successfully' });
  }

  // 3. Download YouTube Video via yt-dlp + FFmpeg
  if (action === 'DOWNLOAD') {
    const url = msg.url || (msg.videoId ? `https://www.youtube.com/watch?v=${msg.videoId}` : null);
    if (!url) {
      return sendMessage({ success: false, error: 'Missing video URL or videoId' });
    }

    const downloadDir = path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(downloadDir)) {
      try {
        fs.mkdirSync(downloadDir, { recursive: true });
      } catch (_) {}
    }

    // Smart Format Selection: User explicit choice takes priority over dataSaver flag
    const explicitQuality = msg.quality ? String(msg.quality).toLowerCase() : null;
    const reqQuality = explicitQuality || (msg.dataSaver ? '360p' : '1080p');
    let formatSelector;
    let isSingleStream = false;

    // Universal Compatibility: Prioritize H.264 (AVC) video + AAC audio so Windows Media Player plays natively without AV1/HEVC extensions
    if (reqQuality.includes('360')) {
      formatSelector =
        'bestvideo[height<=360][vcodec^=avc]+bestaudio[acodec^=mp4a]/b[height<=360][vcodec^=avc]/bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/b[height<=360]/best[height<=360]/bestvideo+bestaudio/best';
      isSingleStream = false;
    } else if (reqQuality.includes('480')) {
      formatSelector =
        'bestvideo[height<=480][vcodec^=avc]+bestaudio[acodec^=mp4a]/b[height<=480][vcodec^=avc]/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/b[height<=480]/best[height<=480]/bestvideo+bestaudio/best';
      isSingleStream = false;
    } else if (reqQuality.includes('720')) {
      formatSelector =
        'bestvideo[height<=720][vcodec^=avc]+bestaudio[acodec^=mp4a]/b[height<=720][vcodec^=avc]/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/b[height<=720]/best[height<=720]/bestvideo+bestaudio/best';
      isSingleStream = false;
    } else {
      // 1080p: Full HD AVC priority
      formatSelector =
        'bestvideo[height<=1080][vcodec^=avc]+bestaudio[acodec^=mp4a]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/b[height<=1080]/bestvideo+bestaudio/best';
      isSingleStream = false;
    }

    let outputTemplate = '%(title)s [%(id)s].%(ext)s';
    if (msg.filename && typeof msg.filename === 'string') {
      const cleanName = msg.filename.replace(/\.[a-zA-Z0-9]+$/, '').trim();
      if (cleanName) {
        outputTemplate = `${cleanName}.%(ext)s`;
      }
    }

    // Build optimized arguments: --concurrent-fragments 4, structured --progress-template, unbuffered --newline
    const args = [
      '-m',
      'yt_dlp',
      '--newline',
      '--concurrent-fragments',
      '4',
      '--progress-template',
      'download:PROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_estimate_str)s',
      '--js-runtimes',
      'node',
      '-f',
      formatSelector,
      '--merge-output-format',
      'mp4',
      '--no-playlist',
      '--windows-filenames',
      '-o',
      outputTemplate,
      '-P',
      downloadDir
    ];

    if (ffmpegBinPath) {
      args.push('--ffmpeg-location', ffmpegBinPath);
    }

    // Pass authenticated session cookies from extension if provided
    cleanupActiveTempCookie();
    if (msg.cookiesText && typeof msg.cookiesText === 'string' && msg.cookiesText.length > 30) {
      try {
        const tempPath = path.join(
          os.tmpdir(),
          `ytdlp_cookie_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`
        );
        fs.writeFileSync(tempPath, msg.cookiesText, { encoding: 'utf-8' });
        activeTempCookiePath = tempPath;
        args.push('--cookies', tempPath);
      } catch (_) {}
    }

    args.push(url);

    let lastReportedPercent = -1;
    let finalFilename = '';
    let currentPart = isSingleStream ? 'Video (Progressive)' : 'Part 1/2: Video';

    // Terminate any previous child before starting new one
    killActiveChild();

    const child = spawn(pythonBinPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    activeChildProcess = child;

    child.stdout.on('data', (data) => {
      const text = data.toString('utf-8');
      const lines = text.split(/\r?\n/);

      for (const line of lines) {
        if (!line) continue;

        // Structured progress template: PROG| 45.2%| 3.50MiB/s| 01:15| 500.00MiB
        if (line.startsWith('PROG|')) {
          const parts = line.split('|');
          const rawPct = (parts[1] || '').trim().replace('%', '');
          const percent = parseFloat(rawPct);
          const speed = (parts[2] || '').trim();
          const eta = (parts[3] || '').trim();
          const totalSize = (parts[4] || '').trim();

          if (!isNaN(percent) && (Math.abs(percent - lastReportedPercent) >= 2 || percent >= 99)) {
            lastReportedPercent = percent;
            sendMessage({
              type: 'PROGRESS',
              status: 'downloading',
              part: currentPart,
              percent,
              totalSize: totalSize || '',
              speed: speed || '',
              eta: eta || '',
              videoId: msg.videoId,
              title: msg.title
            });
          }
          continue;
        }

        // Detect destination filename and part transition
        const destMatch = line.match(/Destination:\s+(.+)/i);
        if (destMatch && destMatch[1]) {
          const dest = destMatch[1].trim();
          finalFilename = path.basename(dest);
          if (
            dest.includes('.f140.') ||
            dest.includes('.f251.') ||
            dest.includes('.m4a') ||
            dest.includes('.opus')
          ) {
            currentPart = 'Part 2/2: Audio';
            lastReportedPercent = -1; // Reset progress reporting for audio track
          } else if (dest.includes('.mp4') || dest.includes('.webm')) {
            currentPart = isSingleStream ? 'Video (Progressive)' : 'Part 1/2: Video';
            lastReportedPercent = -1;
          }
          continue;
        }

        // Detect merging phase
        if (line.includes('[Merger]') || line.includes('Merging formats into')) {
          currentPart = 'Muxing MP4';
          const mergeMatch = line.match(/Merging formats into "(.+)"/i);
          if (mergeMatch && mergeMatch[1]) {
            finalFilename = path.basename(mergeMatch[1].trim());
          }
          sendMessage({
            type: 'PROGRESS',
            status: 'merging',
            part: 'Muxing MP4',
            percent: 99,
            speed: '',
            message: 'Menggabungkan Audio & Video...',
            videoId: msg.videoId,
            title: msg.title
          });
          continue;
        }
      }
    });

    let stderrOutput = '';
    child.stderr.on('data', (data) => {
      // Bound stderr buffer to avoid memory leaks
      stderrOutput = (stderrOutput + data.toString('utf-8')).slice(-2048);
    });

    child.on('close', (code) => {
      activeChildProcess = null;
      cleanupActiveTempCookie();
      if (code === 0) {
        let fileSizeFormatted = '';
        const resolvedName =
          finalFilename ||
          msg.filename ||
          `${(msg.title || 'Video').replace(/[*?"<>|/\\:]/g, '_')}.mp4`;
        try {
          const fullFilePath = path.join(downloadDir, resolvedName);
          if (fs.existsSync(fullFilePath)) {
            const stats = fs.statSync(fullFilePath);
            const bytes = stats.size;
            if (bytes >= 1024 * 1024 * 1024) {
              fileSizeFormatted = (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
            } else if (bytes >= 1024 * 1024) {
              fileSizeFormatted = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
            } else if (bytes >= 1024) {
              fileSizeFormatted = (bytes / 1024).toFixed(0) + ' KB';
            } else {
              fileSizeFormatted = bytes + ' B';
            }
          }
        } catch (_) {}

        sendMessage({
          success: true,
          status: 'complete',
          filename: resolvedName,
          folder: downloadDir,
          size: fileSizeFormatted,
          videoId: msg.videoId,
          title: msg.title,
          author: msg.author,
          timestamp: Date.now(),
          message: 'Video tersimpan di folder Downloads!'
        });
      } else {
        const errorCode = `ERR_YTDLP_EXIT_${code}`;
        sendMessage({
          success: false,
          error: stderrOutput.slice(-300) || `yt-dlp exited with code ${code}`,
          errorCode: errorCode,
          videoId: msg.videoId,
          title: msg.title,
          author: msg.author,
          timestamp: Date.now()
        });
      }
    });

    child.on('error', (err) => {
      activeChildProcess = null;
      sendMessage({
        success: false,
        error: 'Failed to launch python / yt-dlp: ' + err.message,
        errorCode: 'ERR_HOST_SPAWN_FAIL',
        videoId: msg.videoId,
        title: msg.title,
        author: msg.author,
        timestamp: Date.now()
      });
    });

    return;
  }

  // 4. Fast Range Chunker for Direct Video Streams (Google Video, Blogger, AnoBoy)
  if (action === 'FAST_RANGE_DOWNLOAD' || action === 'DOWNLOAD_CHUNKS') {
    return downloadWithRangeChunks(msg);
  }

  sendMessage({ success: false, error: 'Unknown action: ' + action });
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function formatDuration(sec) {
  if (sec <= 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function downloadChunkTask(urlStr, chunk, headers, fd, onBytes, retries = 3) {
  return new Promise((resolve, reject) => {
    function attempt(retryCount) {
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'http:' ? http : https;
      const curStart = chunk.start + chunk.written;
      if (curStart > chunk.end) return resolve();

      const reqHeaders = Object.assign({}, headers, {
        Range: `bytes=${curStart}-${chunk.end}`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      });

      const req = client.request(
        parsed,
        {
          method: 'GET',
          headers: reqHeaders
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const nextLoc = new URL(res.headers.location, urlStr).href;
            res.resume();
            return downloadChunkTask(nextLoc, chunk, headers, fd, onBytes, retryCount).then(
              resolve,
              reject
            );
          }

          if (res.statusCode !== 206 && res.statusCode !== 200) {
            res.resume();
            if (retryCount > 0) {
              return setTimeout(() => attempt(retryCount - 1), 600);
            }
            return reject(new Error(`Chunk ${chunk.index} HTTP ${res.statusCode}`));
          }

          res.on('data', (buf) => {
            const writeOffset = chunk.start + chunk.written;
            try {
              fs.writeSync(fd, buf, 0, buf.length, writeOffset);
              chunk.written += buf.length;
              onBytes(buf.length);
            } catch (writeErr) {
              req.destroy(writeErr);
            }
          });

          res.on('end', () => {
            if (chunk.written >= chunk.length) {
              resolve();
            } else if (retryCount > 0) {
              setTimeout(() => attempt(retryCount - 1), 500);
            } else {
              reject(
                new Error(`Incomplete chunk ${chunk.index}: ${chunk.written}/${chunk.length}`)
              );
            }
          });

          res.on('error', (err) => {
            if (retryCount > 0) {
              setTimeout(() => attempt(retryCount - 1), 600);
            } else {
              reject(err);
            }
          });
        }
      );

      req.on('error', (err) => {
        if (retryCount > 0) {
          setTimeout(() => attempt(retryCount - 1), 600);
        } else {
          reject(err);
        }
      });

      activeSockets.add(req);
      req.on('close', () => activeSockets.delete(req));
      req.end();
    }

    attempt(retries);
  });
}

function downloadSingleStream(urlStr, destPath, headers, totalSize, msg) {
  return new Promise((resolve, reject) => {
    const cleanUrl = urlStr.replace(/\\+$/, '').trim();
    const parsed = new URL(cleanUrl);
    const client = parsed.protocol === 'http:' ? http : https;
    const outStream = fs.createWriteStream(destPath);
    activeFilePath = destPath;

    const req = client.request(
      parsed,
      {
        method: 'GET',
        headers: Object.assign(
          {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
          },
          headers
        )
      },
      (res) => {
        if (res.statusCode >= 400) {
          try {
            outStream.close();
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          } catch (_) {}
          return reject(new Error(`Download stream failed with HTTP ${res.statusCode}`));
        }

        let downloaded = 0;
        let lastReport = Date.now();
        let lastBytes = 0;

        res.on('data', (buf) => {
          downloaded += buf.length;
          const now = Date.now();
          if (now - lastReport >= 400) {
            const deltaSec = (now - lastReport) / 1000;
            const speed = (downloaded - lastBytes) / deltaSec;
            const pct =
              totalSize > 0 ? Math.min(99, Math.round((downloaded / totalSize) * 100)) : 0;
            sendMessage({
              type: 'PROGRESS',
              status: 'downloading',
              part: 'Single Stream',
              percent: pct,
              totalSize: totalSize > 0 ? formatBytes(totalSize) : '',
              speed: `${formatBytes(speed)}/s`,
              eta: '',
              videoId: msg.videoId,
              title: msg.title
            });
            lastBytes = downloaded;
            lastReport = now;
          }
        });

        res.pipe(outStream);
        outStream.on('finish', () => {
          activeFilePath = null;
          if (downloaded === 0) {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            } catch (_) {}
            return reject(new Error('Downloaded file is empty (0 bytes)'));
          }
          sendMessage({
            success: true,
            status: 'complete',
            filename: path.basename(destPath),
            folder: path.dirname(destPath),
            size: formatBytes(downloaded),
            videoId: msg.videoId,
            title: msg.title,
            message: 'Video berhasil diunduh!'
          });
          resolve();
        });
        outStream.on('error', reject);
      }
    );

    req.on('error', reject);
    activeSockets.add(req);
    req.on('close', () => activeSockets.delete(req));
    req.end();
  });
}

function downloadWithRangeChunks(msg) {
  const targetUrl = (msg.url || '').replace(/\\+$/, '').trim();
  if (!targetUrl) {
    return sendMessage({ success: false, error: 'Missing download URL' });
  }

  const downloadDir = path.join(os.homedir(), 'Downloads');
  let targetSubdir = downloadDir;
  let rawFilename = msg.filename || `Video_${Date.now()}.mp4`;

  if (rawFilename.includes('/') || rawFilename.includes('\\')) {
    const parts = rawFilename.split(/[/\\]/);
    const subFolder = parts.slice(0, -1).join(path.sep);
    targetSubdir = path.join(downloadDir, subFolder);
    rawFilename = parts[parts.length - 1];
  }

  if (!fs.existsSync(targetSubdir)) {
    try {
      fs.mkdirSync(targetSubdir, { recursive: true });
    } catch (_) {}
  }

  const safeFilename =
    rawFilename.replace(/[*?"<>|/\\:]/g, '_').trim() || `video_${Date.now()}.mp4`;
  const finalDestPath = path.join(targetSubdir, safeFilename);

  cancelAllActive();

  function requestFollow(urlStr, options, maxRedir = 5) {
    return new Promise((resolve, reject) => {
      if (maxRedir <= 0) return reject(new Error('Too many redirects'));
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'http:' ? http : https;
      const headers = Object.assign(
        {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        },
        options.headers || {}
      );

      const req = client.request(
        parsed,
        {
          method: options.method || 'GET',
          headers
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, urlStr).href;
            res.resume();
            return requestFollow(redirectUrl, options, maxRedir - 1).then(resolve, reject);
          }
          resolve({ res, url: urlStr });
        }
      );

      req.on('error', reject);
      if (options.timeout) {
        req.setTimeout(options.timeout, () => {
          req.destroy(new Error('Request timeout'));
        });
      }
      activeSockets.add(req);
      req.on('close', () => activeSockets.delete(req));
      req.end();
    });
  }

  const customHeaders = Object.assign({}, msg.headers || {});
  if (msg.referer) customHeaders['Referer'] = msg.referer;
  if (!customHeaders['Referer'] && targetUrl.includes('googlevideo.com')) {
    customHeaders['Referer'] = 'https://anoboy.at/';
  }

  requestFollow(targetUrl, {
    method: 'GET',
    headers: Object.assign({}, customHeaders, { Range: 'bytes=0-0' })
  })
    .then(({ res, url: probedUrl }) => {
      let totalSize = 0;
      let supportsRange = false;

      if (res.statusCode >= 400) {
        throw new Error(`Probe failed with HTTP ${res.statusCode}`);
      }

      const cr = res.headers['content-range'];
      if (cr) {
        const m = cr.match(/\/(\d+)$/);
        if (m) {
          totalSize = parseInt(m[1], 10);
          supportsRange = true;
        }
      } else if (res.headers['content-length']) {
        totalSize = parseInt(res.headers['content-length'], 10);
        supportsRange = res.headers['accept-ranges'] === 'bytes' || res.statusCode === 206;
      }
      res.resume();

      if (!supportsRange || totalSize < 2 * 1024 * 1024) {
        return downloadSingleStream(probedUrl, finalDestPath, customHeaders, totalSize, msg);
      }

      const fd = fs.openSync(finalDestPath, 'w');
      activeFd = fd;
      activeFilePath = finalDestPath;
      fs.ftruncateSync(fd, totalSize);

      const chunkCount = Math.min(16, Math.max(4, Math.floor(totalSize / (2 * 1024 * 1024))));
      const chunkSize = Math.ceil(totalSize / chunkCount);
      const chunks = [];
      for (let i = 0; i < chunkCount; i++) {
        const start = i * chunkSize;
        const end = i === chunkCount - 1 ? totalSize - 1 : (i + 1) * chunkSize - 1;
        chunks.push({ index: i, start, end, written: 0, length: end - start + 1 });
      }

      let totalDownloaded = 0;
      let lastProgressTime = Date.now();
      let bytesSinceLastProgress = 0;
      let isFinished = false;

      sendMessage({
        type: 'PROGRESS',
        status: 'downloading',
        part: `Turbo Chunker (${chunkCount}x)`,
        percent: 0,
        totalSize: formatBytes(totalSize),
        speed: 'Memulai...',
        eta: '',
        videoId: msg.videoId,
        title: msg.title
      });

      const reportProgress = () => {
        const now = Date.now();
        const deltaSec = (now - lastProgressTime) / 1000;
        if (deltaSec >= 0.35) {
          const speedBytes = bytesSinceLastProgress / deltaSec;
          const pct = Math.min(99, Math.round((totalDownloaded / totalSize) * 100));
          const remBytes = totalSize - totalDownloaded;
          const etaSec = speedBytes > 0 ? Math.round(remBytes / speedBytes) : 0;

          sendMessage({
            type: 'PROGRESS',
            status: 'downloading',
            part: `Turbo Chunker (${chunkCount}x)`,
            percent: pct,
            totalSize: formatBytes(totalSize),
            speed: `${formatBytes(speedBytes)}/s`,
            eta: formatDuration(etaSec),
            videoId: msg.videoId,
            title: msg.title
          });

          bytesSinceLastProgress = 0;
          lastProgressTime = now;
        }
      };

      let activeWorkers = 0;
      let nextChunkIdx = 0;

      return new Promise((resolveAll, rejectAll) => {
        function startNextWorker() {
          if (isFinished) return;
          if (nextChunkIdx >= chunks.length) {
            if (activeWorkers === 0) {
              isFinished = true;
              resolveAll();
            }
            return;
          }

          const chunk = chunks[nextChunkIdx++];
          activeWorkers++;

          downloadChunkTask(probedUrl, chunk, customHeaders, fd, (bytes) => {
            totalDownloaded += bytes;
            bytesSinceLastProgress += bytes;
            reportProgress();
          })
            .then(() => {
              activeWorkers--;
              startNextWorker();
            })
            .catch((err) => {
              isFinished = true;
              rejectAll(err);
            });
        }

        const maxConcurrency = Math.min(chunkCount, 16);
        for (let i = 0; i < maxConcurrency; i++) {
          startNextWorker();
        }
      }).then(() => {
        if (activeFd !== null) {
          try {
            fs.closeSync(activeFd);
          } catch (_) {}
          activeFd = null;
        }
        activeFilePath = null;

        sendMessage({
          success: true,
          status: 'complete',
          filename: safeFilename,
          folder: targetSubdir,
          size: formatBytes(totalSize),
          videoId: msg.videoId,
          title: msg.title,
          author: msg.author,
          timestamp: Date.now(),
          message: 'Video berhasil diunduh dengan Turbo Chunker!'
        });
      });
    })
    .catch((err) => {
      cancelAllActive();
      try {
        if (fs.existsSync(finalDestPath)) {
          const st = fs.statSync(finalDestPath);
          if (st.size === 0) {
            fs.unlinkSync(finalDestPath);
          }
        }
      } catch (_) {}
      sendMessage({
        success: false,
        error: 'Turbo Chunker error: ' + err.message,
        errorCode: 'ERR_TURBO_CHUNK_FAIL',
        videoId: msg.videoId,
        title: msg.title
      });
    });
}
