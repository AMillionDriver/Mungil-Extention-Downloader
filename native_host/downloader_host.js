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
const net = require('net');
const { spawn, execSync } = require('child_process');

// Dedicated persistent HTTP / HTTPS agent pool for range chunk socket reuse
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 60000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 60000
});

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
const activeJobs = new Map();

function pauseJob(taskId) {
  const job = activeJobs.get(taskId);
  if (!job || job.status !== 'downloading') return false;
  job.status = 'paused';
  for (const sock of job.sockets) {
    try {
      if (typeof sock.destroy === 'function') {
        sock.destroy();
      }
    } catch (_) {}
  }
  job.sockets.clear();
  if (Array.isArray(job.chunks)) {
    for (const c of job.chunks) {
      c.inFlight = false;
    }
  }
  job.activeWorkers = 0;
  if (typeof job.saveMeta === 'function') {
    job.saveMeta();
  }
  sendMessage({
    type: 'PROGRESS',
    status: 'paused',
    part: `Turbo Chunker (${job.chunkCount}x)`,
    percent: Math.min(99, Math.round((job.totalDownloaded / job.totalSize) * 100)),
    totalSize: formatBytes(job.totalSize),
    speed: 'Dijeda',
    eta: '',
    videoId: job.msg.videoId,
    title: job.msg.title
  });
  return true;
}

function resumeJob(taskId) {
  const job = activeJobs.get(taskId);
  if (!job || job.status !== 'paused') return false;
  job.status = 'downloading';
  if (Array.isArray(job.chunks)) {
    for (const c of job.chunks) {
      c.inFlight = false;
    }
  }
  job.activeWorkers = 0;
  sendMessage({
    type: 'PROGRESS',
    status: 'downloading',
    part: `Turbo Chunker (${job.chunkCount}x)`,
    percent: Math.min(99, Math.round((job.totalDownloaded / job.totalSize) * 100)),
    totalSize: formatBytes(job.totalSize),
    speed: 'Melanjutkan...',
    eta: '',
    videoId: job.msg.videoId,
    title: job.msg.title
  });
  if (typeof job.startWorkers === 'function') {
    job.startWorkers();
  }
  return true;
}

function cancelJob(taskId) {
  const job = activeJobs.get(taskId);
  if (!job) return false;
  job.status = 'cancelled';
  for (const sock of job.sockets) {
    try {
      sock.destroy();
    } catch (_) {}
  }
  job.sockets.clear();
  if (job.fd !== null) {
    try {
      fs.closeSync(job.fd);
    } catch (_) {}
    job.fd = null;
  }
  try {
    if (job.partPath && fs.existsSync(job.partPath)) {
      fs.unlinkSync(job.partPath);
    }
  } catch (_) {}
  try {
    if (job.metaPath && fs.existsSync(job.metaPath)) {
      fs.unlinkSync(job.metaPath);
    }
  } catch (_) {}
  try {
    if (job.finalDestPath && fs.existsSync(job.finalDestPath)) {
      const st = fs.statSync(job.finalDestPath);
      if (st.size < job.totalSize) {
        fs.unlinkSync(job.finalDestPath);
      }
    }
  } catch (_) {}
  activeJobs.delete(taskId);
  sendMessage({
    type: 'PROGRESS',
    status: 'cancelled',
    part: 'Turbo Chunker',
    percent: 0,
    speed: 'Dibatalkan',
    videoId: job.msg.videoId,
    title: job.msg.title
  });
  return true;
}

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
  for (const [taskId] of activeJobs) {
    try {
      cancelJob(taskId);
    } catch (_) {}
  }
  activeJobs.clear();
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
  if (activeFilePath) {
    try {
      if (fs.existsSync(activeFilePath)) {
        fs.unlinkSync(activeFilePath);
      }
    } catch (_) {}
    activeFilePath = null;
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

  // 2b. Granular Fast Range Chunker Pause/Resume/Cancel
  if (action === 'PAUSE_FAST_DOWNLOAD' || action === 'PAUSE_DOWNLOAD') {
    const taskId = msg.taskId || msg.videoId;
    const ok = pauseJob(taskId);
    return sendMessage({
      success: ok,
      action: 'PAUSE_FAST_DOWNLOAD',
      taskId,
      videoId: msg.videoId
    });
  }

  if (action === 'RESUME_FAST_DOWNLOAD' || action === 'RESUME_DOWNLOAD') {
    const taskId = msg.taskId || msg.videoId;
    const ok = resumeJob(taskId);
    return sendMessage({
      success: ok,
      action: 'RESUME_FAST_DOWNLOAD',
      taskId,
      videoId: msg.videoId
    });
  }

  if (action === 'CANCEL_FAST_DOWNLOAD') {
    const taskId = msg.taskId || msg.videoId;
    const ok = cancelJob(taskId);
    return sendMessage({
      success: ok,
      action: 'CANCEL_FAST_DOWNLOAD',
      taskId,
      videoId: msg.videoId
    });
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

  // 5. Smart History & File Lifecycle Tracker Actions
  if (action === 'AUDIT_FILE_STATUS_BATCH') {
    return handleAuditFileStatusBatch(msg);
  }

  if (action === 'OPEN_FILE_LOCATION') {
    return handleOpenFileLocation(msg);
  }

  if (action === 'PLAY_VIDEO_FILE') {
    return handlePlayVideoFile(msg);
  }

  if (action === 'OPEN_RECYCLE_BIN') {
    return handleOpenRecycleBin(msg);
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

/**
 * Security Gatekeeper: Validate that an IP or hostname is not targeting
 * loopback, link-local, cloud metadata, or private RFC 1918 CIDRs (SSRF prevention).
 */
function isDisallowedHostOrIp(hostname) {
  if (!hostname || typeof hostname !== 'string') return true;
  const cleanHost = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');

  if (cleanHost === 'localhost' || cleanHost.endsWith('.localhost') || cleanHost === '0.0.0.0') {
    return true;
  }

  // Check numeric IP addresses
  if (net.isIP(cleanHost)) {
    if (cleanHost === '127.0.0.1' || cleanHost === '::1' || cleanHost === '::') {
      return true;
    }

    // IPv4 checks
    if (net.isIPv4(cleanHost)) {
      const parts = cleanHost.split('.').map((p) => parseInt(p, 10));
      if (parts.length !== 4 || parts.some(isNaN)) return true;
      if (parts[0] === 127) return true; // 127.0.0.0/8 Loopback
      if (parts[0] === 10) return true; // 10.0.0.0/8 Private
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12 Private
      if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16 Private
      if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16 Link-Local / Cloud Metadata
      if (parts[0] === 0) return true; // 0.0.0.0/8 Current network
      if (parts[0] >= 224) return true; // Multicast & Reserved
    }

    // IPv6 checks
    if (net.isIPv6(cleanHost)) {
      const lower = cleanHost.toLowerCase();
      if (lower === '::1' || lower === '::') return true;
      if (lower.startsWith('fe80:')) return true; // Link-local
      if (lower.startsWith('fc00:') || lower.startsWith('fd00:')) return true; // Unique local
      if (lower.startsWith('::ffff:')) {
        // IPv4-mapped IPv6
        const v4Part = lower.slice(7);
        return isDisallowedHostOrIp(v4Part);
      }
    }
  }

  return false;
}

/**
 * Validates that a target URL is safe for transport:
 * 1. Must use http: or https:
 * 2. Cannot downgrade from https: to http:
 * 3. Cannot target localhost, private IPs, or cloud metadata
 */
function validateSafeUrl(targetUrl, originalUrl = null) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('Invalid URL string provided');
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (_err) {
    throw new Error(`Malformed URL rejected: ${targetUrl}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Insecure or unsupported protocol rejected: ${parsed.protocol}`);
  }

  if (originalUrl) {
    let orig = null;
    try {
      orig = new URL(originalUrl);
    } catch (_) {}
    if (orig && orig.protocol === 'https:' && parsed.protocol === 'http:') {
      throw new Error(`Insecure protocol downgrade forbidden: ${orig.href} -> ${parsed.href}`);
    }
  }

  if (isDisallowedHostOrIp(parsed.hostname)) {
    throw new Error(`SSRF blocked: Disallowed destination host/IP: ${parsed.hostname}`);
  }

  return parsed;
}

/**
 * Sanitizes header keys and values:
 * 1. Strips CRLF (\r, \n) to prevent HTTP Request Splitting.
 * 2. Removes forbidden browser/client-managed headers (Host, Connection, Transfer-Encoding, Content-Length).
 */
function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const cleaned = {};
  const forbiddenHeaders = new Set([
    'host',
    'connection',
    'keep-alive',
    'proxy-connection',
    'transfer-encoding',
    'content-length',
    'upgrade'
  ]);

  for (const [rawKey, rawVal] of Object.entries(headers)) {
    if (!rawKey || typeof rawKey !== 'string') continue;
    const cleanKey = rawKey.replace(/[\r\n]/g, '').trim();
    if (!cleanKey) continue;
    if (forbiddenHeaders.has(cleanKey.toLowerCase())) continue;

    let cleanVal = '';
    if (typeof rawVal === 'string') {
      cleanVal = rawVal.replace(/[\r\n]/g, '').trim();
    } else if (rawVal !== null && rawVal !== undefined) {
      cleanVal = String(rawVal)
        .replace(/[\r\n]/g, '')
        .trim();
    }
    cleaned[cleanKey] = cleanVal;
  }
  return cleaned;
}

/**
 * Strips sensitive credentials (Cookie, Authorization, Proxy-Authorization)
 * if following a redirect across origins.
 */
function isolateHeadersOnRedirect(headers, currentUrl, nextUrl) {
  if (!headers || typeof headers !== 'object') return {};
  const sanitized = sanitizeHeaders(headers);

  try {
    const curOrigin = new URL(currentUrl).origin;
    const nextOrigin = new URL(nextUrl).origin;
    if (curOrigin === nextOrigin) {
      return sanitized;
    }
  } catch (_) {
    // If URL parsing fails, fail closed by treating as cross-origin
  }

  // Cross-origin: strip sensitive authentication tokens and cookies
  const isolated = {};
  const sensitiveNames = new Set([
    'cookie',
    'cookie2',
    'authorization',
    'proxy-authorization',
    'x-auth-token',
    'token'
  ]);

  for (const [key, val] of Object.entries(sanitized)) {
    if (!sensitiveNames.has(key.toLowerCase())) {
      isolated[key] = val;
    }
  }
  return isolated;
}

/**
 * Slices total file size into granular 2MB–4MB chunks for dynamic work pooling.
 */
function generateGranularChunks(totalSize, defaultBlockSize = 2 * 1024 * 1024) {
  if (!totalSize || totalSize <= 0) return [];
  let blockSize = defaultBlockSize;
  if (totalSize > 64 * 1024 * 1024) {
    blockSize = 4 * 1024 * 1024;
  }
  const chunkCount = Math.max(4, Math.ceil(totalSize / blockSize));
  const actualBlockSize = Math.ceil(totalSize / chunkCount);

  const chunks = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * actualBlockSize;
    const end = i === chunkCount - 1 ? totalSize - 1 : (i + 1) * actualBlockSize - 1;
    chunks.push({
      index: i,
      start,
      end,
      written: 0,
      length: end - start + 1,
      inFlight: false
    });
  }
  return chunks;
}

/**
 * Dynamic Work-Stealing: When no idle chunks remain in queue, finds an in-flight
 * chunk with >= 2MB remaining unwritten and splits its remaining byte range in half.
 */
function stealWork(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return null;

  let bestCandidate = null;
  let maxRemaining = 0;

  for (const c of chunks) {
    if (c.inFlight) {
      const curPos = c.start + (c.written || 0);
      const remaining = c.end - curPos + 1;
      if (remaining >= 2 * 1024 * 1024 && remaining > maxRemaining) {
        maxRemaining = remaining;
        bestCandidate = c;
      }
    }
  }

  if (!bestCandidate) return null;

  const curPos = bestCandidate.start + (bestCandidate.written || 0);
  const halfRemaining = Math.floor(maxRemaining / 2);
  const splitPoint = curPos + halfRemaining - 1;

  const oldEnd = bestCandidate.end;
  bestCandidate.end = splitPoint;
  bestCandidate.length = bestCandidate.end - bestCandidate.start + 1;

  const stolenChunk = {
    index: chunks.length,
    start: splitPoint + 1,
    end: oldEnd,
    written: 0,
    length: oldEnd - (splitPoint + 1) + 1,
    inFlight: false
  };

  chunks.push(stolenChunk);
  return stolenChunk;
}

/**
 * Adaptive AIMD Concurrency Controller for multi-connection HTTP chunking.
 * Scales workers up (+1) on accelerating throughput and cuts concurrency (x0.75) on errors / 429.
 */
class AIMDConcurrencyController {
  constructor(initial = 6, min = 2, max = 16) {
    this.concurrency = initial;
    this.min = min;
    this.max = max;
    this.lastThroughput = 0;
    this.consecutiveSuccesses = 0;
  }

  recordError() {
    this.concurrency = Math.max(this.min, Math.floor(this.concurrency * 0.75));
    this.consecutiveSuccesses = 0;
    return this.concurrency;
  }

  evaluateThroughput(currentThroughputBps) {
    if (currentThroughputBps > 0) {
      if (this.lastThroughput > 0 && currentThroughputBps > this.lastThroughput * 1.05) {
        this.consecutiveSuccesses++;
        if (this.consecutiveSuccesses >= 2 && this.concurrency < this.max) {
          this.concurrency = Math.min(this.max, this.concurrency + 1);
          this.consecutiveSuccesses = 0;
        }
      } else {
        this.consecutiveSuccesses = 0;
      }
      this.lastThroughput = currentThroughputBps;
    }
    return this.concurrency;
  }
}

function downloadChunkTask(urlStr, chunk, headers, fd, onBytes, job = null, retries = 5) {
  return new Promise((resolve, reject) => {
    function attempt(retryCount) {
      if (job && job.status !== 'downloading') {
        return reject(new Error('PAUSED_OR_CANCELLED'));
      }

      const activeUrl = job?.url || urlStr;
      let parsed;
      try {
        parsed = validateSafeUrl(activeUrl);
      } catch (secErr) {
        return reject(secErr);
      }

      const client = parsed.protocol === 'http:' ? http : https;
      const curStart = chunk.start + chunk.written;
      if (curStart > chunk.end) return resolve();

      const sanitizedInputHeaders = sanitizeHeaders(headers);
      const reqHeaders = Object.assign(
        {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        },
        sanitizedInputHeaders,
        {
          Range: `bytes=${curStart}-${chunk.end}`
        }
      );

      const req = client.request(
        parsed,
        {
          method: 'GET',
          headers: reqHeaders,
          family: 4,
          agent: client === https ? httpsAgent : httpAgent
        },
        (res) => {
          if (job && job.status !== 'downloading') {
            try {
              res.destroy();
            } catch (_) {}
            try {
              if (res.socket) res.socket.destroy();
            } catch (_) {}
            try {
              req.destroy();
            } catch (_) {}
            return reject(new Error('PAUSED_OR_CANCELLED'));
          }

          if (job) {
            job.sockets.add(res);
            if (res.socket) job.sockets.add(res.socket);
            res.on('close', () => {
              job.sockets.delete(res);
              if (res.socket) job.sockets.delete(res.socket);
            });
          }
          activeSockets.add(res);
          if (res.socket) activeSockets.add(res.socket);
          res.on('close', () => {
            activeSockets.delete(res);
            if (res.socket) activeSockets.delete(res.socket);
          });

          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextLoc;
            try {
              nextLoc = new URL(res.headers.location, activeUrl).href;
              validateSafeUrl(nextLoc, activeUrl);
            } catch (redirErr) {
              res.resume();
              return reject(redirErr);
            }
            res.resume();
            const safeRedirectHeaders = isolateHeadersOnRedirect(
              sanitizedInputHeaders,
              activeUrl,
              nextLoc
            );
            return downloadChunkTask(
              nextLoc,
              chunk,
              safeRedirectHeaders,
              fd,
              onBytes,
              job,
              retryCount
            ).then(resolve, reject);
          }

          // If token expired (403 or 410), refresh URL from episodeUrl or bloggerToken
          if (res.statusCode === 403 || res.statusCode === 410) {
            res.resume();
            if (retryCount > 0 && (!job || job.status === 'downloading')) {
              (async () => {
                let freshUrl = null;
                if (job?.msg?.bloggerToken) {
                  freshUrl = await resolveBloggerStreamInNode(
                    job.msg.bloggerToken,
                    headers['Referer'],
                    headers['User-Agent'],
                    job.msg.resolution || '720p'
                  );
                }
                if (!freshUrl && job?.msg?.episodeUrl) {
                  freshUrl = await resolveFromEpisodeUrlInNode(
                    job.msg.episodeUrl,
                    headers['Referer'],
                    headers['User-Agent'],
                    job.msg.resolution || '720p'
                  );
                }
                if (freshUrl && job) {
                  job.url = freshUrl;
                }
                const backoffDelay = Math.min(
                  8000,
                  Math.pow(2, 5 - retryCount) * 1000 + Math.floor(Math.random() * 500)
                );
                setTimeout(() => attempt(retryCount - 1), backoffDelay);
              })();
              return;
            }
            return reject(
              new Error(`Chunk ${chunk.index} HTTP ${res.statusCode} (Expired/Forbidden)`)
            );
          }

          // If rate limited (429), trigger AIMD multiplicative decrease and backoff
          if (res.statusCode === 429) {
            res.resume();
            if (job && job.aimd) job.aimd.recordError();
            if (retryCount > 0 && (!job || job.status === 'downloading')) {
              const backoffDelay = Math.min(
                12000,
                Math.pow(2, 5 - retryCount) * 1500 + Math.floor(Math.random() * 500)
              );
              return setTimeout(() => attempt(retryCount - 1), backoffDelay);
            }
            return reject(new Error(`Chunk ${chunk.index} HTTP 429 (Rate Limited by CDN)`));
          }

          // Strict 206 Partial Content Check: Reject HTTP 200 to prevent silent offset overwrite corruption
          if (res.statusCode === 200) {
            res.resume();
            return reject(
              new Error(
                `Server returned HTTP 200 OK for Range request on chunk ${chunk.index}. Aborted to prevent chunk corruption.`
              )
            );
          }

          if (res.statusCode !== 206) {
            res.resume();
            if (retryCount > 0 && (!job || job.status === 'downloading')) {
              const backoffDelay = Math.min(
                8000,
                Math.pow(2, 5 - retryCount) * 1000 + Math.floor(Math.random() * 500)
              );
              return setTimeout(() => attempt(retryCount - 1), backoffDelay);
            }
            return reject(new Error(`Chunk ${chunk.index} HTTP ${res.statusCode}`));
          }

          // Content-Range boundary verification
          const cr = res.headers['content-range'];
          if (cr) {
            const m = cr.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
            if (m) {
              const rStart = parseInt(m[1], 10);
              if (rStart !== curStart) {
                res.resume();
                return reject(
                  new Error(
                    `Content-Range offset mismatch on chunk ${chunk.index}: requested ${curStart}, got ${rStart}`
                  )
                );
              }
            }
          }

          res.on('data', (buf) => {
            if (job && job.status !== 'downloading') {
              try {
                res.destroy();
              } catch (_) {}
              try {
                if (res.socket) res.socket.destroy();
              } catch (_) {}
              try {
                req.destroy();
              } catch (_) {}
              return;
            }
            const writeOffset = chunk.start + chunk.written;
            try {
              fs.writeSync(fd, buf, 0, buf.length, writeOffset);
              chunk.written += buf.length;
              onBytes(buf.length);
            } catch (writeErr) {
              try {
                res.destroy(writeErr);
              } catch (_) {}
              try {
                if (res.socket) res.socket.destroy(writeErr);
              } catch (_) {}
              req.destroy(writeErr);
            }
          });

          res.on('end', () => {
            if (chunk.written >= chunk.length) {
              resolve();
            } else if (job && job.status !== 'downloading') {
              reject(new Error('PAUSED_OR_CANCELLED'));
            } else if (retryCount > 0) {
              const backoffDelay = Math.min(
                8000,
                Math.pow(2, 5 - retryCount) * 1000 + Math.floor(Math.random() * 500)
              );
              setTimeout(() => attempt(retryCount - 1), backoffDelay);
            } else {
              reject(
                new Error(`Incomplete chunk ${chunk.index}: ${chunk.written}/${chunk.length}`)
              );
            }
          });

          res.on('error', (err) => {
            if (job && job.status !== 'downloading') {
              return reject(new Error('PAUSED_OR_CANCELLED'));
            }
            if (retryCount > 0) {
              const backoffDelay = Math.min(
                8000,
                Math.pow(2, 5 - retryCount) * 1000 + Math.floor(Math.random() * 500)
              );
              setTimeout(() => attempt(retryCount - 1), backoffDelay);
            } else {
              reject(err);
            }
          });
        }
      );

      req.on('error', (err) => {
        if (job && job.status !== 'downloading') {
          return reject(new Error('PAUSED_OR_CANCELLED'));
        }
        if (retryCount > 0) {
          const backoffDelay = Math.min(
            8000,
            Math.pow(2, 5 - retryCount) * 1000 + Math.floor(Math.random() * 500)
          );
          setTimeout(() => attempt(retryCount - 1), backoffDelay);
        } else {
          reject(err);
        }
      });

      // Set socket timeout for slow/stalled connections (45 seconds)
      req.setTimeout(45000, () => {
        try {
          req.destroy(new Error('Socket timeout (Slow connection)'));
        } catch (_) {}
      });

      req.on('socket', (sock) => {
        if (job) job.sockets.add(sock);
        activeSockets.add(sock);
        sock.on('close', () => {
          if (job) job.sockets.delete(sock);
          activeSockets.delete(sock);
        });
      });

      if (job) {
        job.sockets.add(req);
        req.on('close', () => job.sockets.delete(req));
      }
      activeSockets.add(req);
      req.on('close', () => activeSockets.delete(req));
      req.end();
    }

    attempt(retries);
  });
}

function computeFileSha256(filePath) {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(filePath)) return resolve(null);
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', () => resolve(null));
    } catch (_) {
      resolve(null);
    }
  });
}

function downloadSingleStream(urlStr, destPath, headers, totalSize, msg) {
  return new Promise((resolve, reject) => {
    const cleanUrl = urlStr.replace(/\\+$/, '').trim();
    let parsed;
    try {
      parsed = validateSafeUrl(cleanUrl);
    } catch (secErr) {
      return reject(secErr);
    }
    const client = parsed.protocol === 'http:' ? http : https;
    const cleanHeaders = sanitizeHeaders(headers);
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
          cleanHeaders
        ),
        family: 4
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          try {
            outStream.close();
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            const redirectUrl = new URL(res.headers.location, cleanUrl).href;
            validateSafeUrl(redirectUrl, cleanUrl);
            const isolated = isolateHeadersOnRedirect(cleanHeaders, cleanUrl, redirectUrl);
            res.resume();
            return downloadSingleStream(redirectUrl, destPath, isolated, totalSize, msg).then(
              resolve,
              reject
            );
          } catch (redirErr) {
            res.resume();
            return reject(redirErr);
          }
        }

        if (res.statusCode >= 400) {
          try {
            outStream.close();
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          } catch (_) {}
          return reject(new Error(`Download stream failed with HTTP ${res.statusCode}`));
        }

        // Strict Content-Type check: Reject HTML or plain text error pages pretending to be video
        const ct = (res.headers['content-type'] || '').toLowerCase();
        if (
          ct.includes('text/html') ||
          ct.includes('application/xhtml') ||
          ct.includes('text/plain')
        ) {
          try {
            outStream.close();
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          } catch (_) {}
          return reject(
            new Error(
              `CORRUPTED_STREAM: Server mengembalikan dokumen web (${ct}) bukan video stream MP4`
            )
          );
        }

        activeSockets.add(res);
        if (res.socket) activeSockets.add(res.socket);
        res.on('close', () => {
          activeSockets.delete(res);
          if (res.socket) activeSockets.delete(res.socket);
        });

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
        outStream.on('finish', async () => {
          activeFilePath = null;
          if (downloaded === 0) {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            } catch (_) {}
            return reject(new Error('Downloaded file is empty (0 bytes)'));
          }
          if (downloaded < 100 * 1024 && destPath.toLowerCase().endsWith('.mp4')) {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            } catch (_) {}
            return reject(
              new Error(
                `CORRUPTED_STREAM: Ukuran file (${Math.round(downloaded / 1024)} KB) terlalu kecil untuk sebuah video MP4. Ditolak untuk mencegah file corrupt.`
              )
            );
          }
          if (downloaded < 1024) {
            let errorText = '';
            try {
              if (fs.existsSync(destPath)) {
                errorText = fs.readFileSync(destPath, 'utf8').trim();
                fs.unlinkSync(destPath);
              }
            } catch (_) {}
            return reject(
              new Error(
                `Server mengembalikan pesan error alih-alih video (${downloaded} B): ${errorText || 'Respon tidak valid'}`
              )
            );
          }
          if (totalSize > 0 && downloaded !== totalSize) {
            try {
              if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            } catch (_) {}
            return reject(
              new Error(`Stream terputus prematur: baru ${downloaded}/${totalSize} byte`)
            );
          }
          const hashHex = await computeFileSha256(destPath);
          sendMessage({
            success: true,
            status: 'complete',
            filename: path.basename(destPath),
            folder: path.dirname(destPath),
            size: formatBytes(downloaded),
            rawBytes: downloaded,
            sha256: hashHex,
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

function isValidAnoBoyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const clean = token.trim().toLowerCase();
  return (
    clean !== 'none' &&
    clean !== 'null' &&
    clean !== 'undefined' &&
    clean !== 'false' &&
    clean.length >= 10
  );
}

function extractAnoBoyCandidateTokens(html, preferredRes = '720p') {
  if (!html || typeof html !== 'string') return [];
  const isHd = !preferredRes || preferredRes.includes('720') || preferredRes.includes('1080');

  // 1. Parse all <a ... id="allmiror" ...> elements
  const mirrorRegex =
    /<a[^>]*id=["']allmiror["'][^>]*data-video=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  const mirrors = [];
  while ((m = mirrorRegex.exec(html)) !== null) {
    const videoData = m[1];
    const label = m[2].trim();
    const tokenM =
      videoData.match(/url=([^&"'>\s]+)/i) || videoData.match(/token=([a-zA-Z0-9_-]+)/i);
    if (tokenM && isValidAnoBoyToken(tokenM[1])) {
      mirrors.push({ label, token: tokenM[1], videoData });
    }
  }

  const candidateTokens = [];

  // 2. If HD requested, prioritize mirrors matching 720 / HD with valid token
  if (isHd) {
    const m720 = mirrors.filter((x) => /720|hd/i.test(x.label));
    m720.forEach((item) => {
      if (!candidateTokens.includes(item.token)) candidateTokens.push(item.token);
    });
  }

  // 3. Add 360 / SD mirrors
  const m360 = mirrors.filter((x) => /360|sd/i.test(x.label));
  m360.forEach((item) => {
    if (!candidateTokens.includes(item.token)) candidateTokens.push(item.token);
  });

  // 4. Add any remaining mirrors with valid tokens
  mirrors.forEach((item) => {
    if (!candidateTokens.includes(item.token)) candidateTokens.push(item.token);
  });

  // 5. Check iframe #mediaplayer fallback
  const mediaplayerMatch = html.match(/id=["']mediaplayer["'][^>]*src=["'][^"']*url=([^&"'>\s]+)/i);
  if (mediaplayerMatch && isValidAnoBoyToken(mediaplayerMatch[1])) {
    if (!candidateTokens.includes(mediaplayerMatch[1])) {
      candidateTokens.push(mediaplayerMatch[1]);
    }
  }

  // 6. Check adsbatch fallback
  const generalMatch = html.match(/adsbatch(?:720)?\.php\?url=([^&"'>\s]+)/i);
  if (generalMatch && isValidAnoBoyToken(generalMatch[1])) {
    if (!candidateTokens.includes(generalMatch[1])) {
      candidateTokens.push(generalMatch[1]);
    }
  }

  return candidateTokens;
}

function extractAnoBoyTokenFromHtml(html, preferredRes = '720p') {
  const tokens = extractAnoBoyCandidateTokens(html, preferredRes);
  return tokens.length > 0 ? tokens[0] : null;
}

async function resolveBloggerStreamInNode(token, referer, userAgent, preferredRes = '720p') {
  if (!isValidAnoBoyToken(token)) return null;
  const ua =
    userAgent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  try {
    const res = await fetch(`https://www.blogger.com/video.g?token=${token}`, {
      headers: {
        Referer: referer || 'https://anoboy.at/',
        'User-Agent': ua
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const re =
      /https?:\/\/(?:[a-zA-Z0-9.\-_]+\.)?googlevideo\.com(?:\/|\\\/)videoplayback[^"'\s<>&;]+/g;
    let match;
    const streams = [];
    while ((match = re.exec(html)) !== null) {
      const decoded = match[0]
        .replace(/\\\\u0026|\\u0026/g, '&')
        .replace(/\\\\u003d|\\u003d/g, '=')
        .replace(/\\\\\//g, '/')
        .replace(/\\\//g, '/')
        .replace(/\\+$/, '')
        .trim();
      const itagMatch = decoded.match(/itag=(\d+)/);
      const itag = itagMatch ? parseInt(itagMatch[1], 10) : 0;
      if (itag > 0) streams.push({ itag, url: decoded });
    }
    if (streams.length === 0) return null;
    if (preferredRes && (preferredRes.includes('1080') || preferredRes.includes('720'))) {
      const s720 = streams.find((s) => s.itag === 22);
      if (s720) return s720.url;
    }
    if (preferredRes && preferredRes.includes('360')) {
      const s360 = streams.find((s) => s.itag === 18);
      if (s360) return s360.url;
    }
    const s720 = streams.find((s) => s.itag === 22);
    if (s720) return s720.url;
    const s360 = streams.find((s) => s.itag === 18);
    if (s360) return s360.url;
    streams.sort((a, b) => b.itag - a.itag);
    return streams[0].url;
  } catch (_) {
    return null;
  }
}

async function resolveFromEpisodeUrlInNode(episodeUrl, referer, userAgent, preferredRes = '720p') {
  if (!episodeUrl) return null;
  const ua =
    userAgent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  try {
    const pageRes = await fetch(episodeUrl, {
      headers: { 'User-Agent': ua, Referer: referer || 'https://anoboy.at/' }
    });
    if (!pageRes.ok) return null;
    const pageHtml = await pageRes.text();
    const candidateTokens = extractAnoBoyCandidateTokens(pageHtml, preferredRes);
    for (const token of candidateTokens) {
      const stream = await resolveBloggerStreamInNode(token, referer, userAgent, preferredRes);
      if (stream) return stream;
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function downloadWithRangeChunks(msg) {
  let targetUrl = (msg.url || '').replace(/\\+$/, '').trim();
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

  const taskId =
    msg.taskId ||
    msg.videoId ||
    'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  if (activeJobs.has(taskId)) {
    try {
      cancelJob(taskId);
    } catch (_) {}
  }

  const partPath = finalDestPath + '.part';
  const metaPath = finalDestPath + '.part.meta';

  const job = {
    id: taskId,
    status: 'downloading',
    sockets: new Set(),
    fd: null,
    finalDestPath,
    partPath,
    metaPath,
    saveMeta: () => {},
    chunks: [],
    totalSize: 0,
    totalDownloaded: 0,
    chunkCount: 0,
    msg,
    url: targetUrl,
    activeWorkers: 0,
    startWorkers: null
  };
  activeJobs.set(taskId, job);

  function requestFollow(urlStr, options, maxRedir = 5) {
    return new Promise((resolve, reject) => {
      if (job.status !== 'downloading') {
        return reject(new Error('PAUSED_OR_CANCELLED'));
      }
      if (maxRedir <= 0) return reject(new Error('Too many redirects'));

      let parsed;
      try {
        parsed = validateSafeUrl(urlStr);
      } catch (urlErr) {
        return reject(urlErr);
      }

      const client = parsed.protocol === 'http:' ? http : https;
      const cleanOptionsHeaders = sanitizeHeaders(options.headers || {});
      const defaultUa =
        cleanOptionsHeaders['User-Agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
      const headers = Object.assign(
        {
          'User-Agent': defaultUa
        },
        cleanOptionsHeaders
      );

      const req = client.request(
        parsed,
        {
          method: options.method || 'GET',
          headers,
          family: 4
        },
        (res) => {
          if (job.status !== 'downloading') {
            res.resume();
            req.destroy();
            return reject(new Error('PAUSED_OR_CANCELLED'));
          }
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let redirectUrl;
            try {
              redirectUrl = new URL(res.headers.location, urlStr).href;
              validateSafeUrl(redirectUrl, urlStr);
            } catch (redirErr) {
              res.resume();
              return reject(redirErr);
            }
            res.resume();
            const safeRedirectHeaders = isolateHeadersOnRedirect(headers, urlStr, redirectUrl);
            const redirectOptions = Object.assign({}, options, { headers: safeRedirectHeaders });
            return requestFollow(redirectUrl, redirectOptions, maxRedir - 1).then(resolve, reject);
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
      job.sockets.add(req);
      req.on('close', () => job.sockets.delete(req));
      activeSockets.add(req);
      req.on('close', () => activeSockets.delete(req));
      req.end();
    });
  }

  const customHeaders = Object.assign({}, msg.headers || {});
  if (msg.userAgent) customHeaders['User-Agent'] = msg.userAgent;
  if (msg.referer) customHeaders['Referer'] = msg.referer;
  if (!customHeaders['Referer'] && targetUrl.includes('googlevideo.com')) {
    customHeaders['Referer'] = 'https://anoboy.at/';
  }

  // Pre-resolve: If targetUrl is an embed or token is provided, resolve fresh stream in Node
  let initialBloggerToken = msg.bloggerToken;
  if (!initialBloggerToken && targetUrl.includes('blogger.com/video.g?token=')) {
    const tm = targetUrl.match(/token=([a-zA-Z0-9_-]+)/);
    if (tm) initialBloggerToken = tm[1];
  }
  if (initialBloggerToken) {
    const freshStream = await resolveBloggerStreamInNode(
      initialBloggerToken,
      customHeaders['Referer'],
      customHeaders['User-Agent']
    );
    if (freshStream) targetUrl = freshStream;
  }

  async function probeAndStart() {
    let probedRes = null;
    let probedUrl = targetUrl;

    try {
      const probeResult = await requestFollow(targetUrl, {
        method: 'GET',
        headers: Object.assign({}, customHeaders, { Range: 'bytes=0-0' })
      });
      probedRes = probeResult.res;
      probedUrl = probeResult.url;
    } catch (_probeErr) {
      // If probe failed or returned error, try re-resolving in Node via episodeUrl or token
      probedRes = { statusCode: 500, headers: {}, resume: () => {} };
    }

    // If HTTP 403 or failure, recover using Node-resolved fresh stream
    if (!probedRes || probedRes.statusCode >= 400) {
      if (probedRes && typeof probedRes.resume === 'function') probedRes.resume();

      let recoveredUrl = null;
      if (msg.bloggerToken) {
        recoveredUrl = await resolveBloggerStreamInNode(
          msg.bloggerToken,
          customHeaders['Referer'],
          customHeaders['User-Agent'],
          msg.resolution || '720p'
        );
      }
      if (!recoveredUrl && msg.episodeUrl) {
        recoveredUrl = await resolveFromEpisodeUrlInNode(
          msg.episodeUrl,
          customHeaders['Referer'],
          customHeaders['User-Agent'],
          msg.resolution || '720p'
        );
      }

      if (recoveredUrl) {
        targetUrl = recoveredUrl;
        const retryProbe = await requestFollow(targetUrl, {
          method: 'GET',
          headers: Object.assign({}, customHeaders, { Range: 'bytes=0-0' })
        });
        probedRes = retryProbe.res;
        probedUrl = retryProbe.url;
      }
    }

    const probedEtag = (probedRes.headers && probedRes.headers['etag']) || null;
    const probedLastModified = (probedRes.headers && probedRes.headers['last-modified']) || null;

    return { res: probedRes, url: probedUrl, etag: probedEtag, lastModified: probedLastModified };
  }

  probeAndStart()
    .then(({ res, url: probedUrl, etag: probedEtag, lastModified: probedLastModified }) => {
      if (job.status !== 'downloading') {
        if (res && typeof res.resume === 'function') res.resume();
        return;
      }

      let totalSize = 0;
      let supportsRange = false;

      if (res.statusCode >= 400) {
        throw new Error(`Probe failed with HTTP ${res.statusCode}`);
      }

      // Strict Integrity Guard: Content-Type & Minimum Video File Size
      const contentType = (res.headers['content-type'] || '').toLowerCase();
      if (
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml') ||
        contentType.includes('text/plain')
      ) {
        throw new Error(
          `CORRUPTED_STREAM: Server mengembalikan dokumen web (${contentType}) bukan video stream MP4`
        );
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

      if (totalSize > 0 && totalSize < 100 * 1024 && finalDestPath.toLowerCase().endsWith('.mp4')) {
        throw new Error(
          `CORRUPTED_STREAM: Ukuran file (${Math.round(totalSize / 1024)} KB) terlalu kecil untuk sebuah video MP4. Ditolak untuk mencegah file corrupt.`
        );
      }

      if (!supportsRange || totalSize < 2 * 1024 * 1024) {
        if (totalSize > 0 && totalSize < 1024) {
          throw new Error(
            `Ukuran file tidak valid untuk video (${totalSize} B). Kemungkinan token ditolak oleh server.`
          );
        }
        return downloadSingleStream(probedUrl, finalDestPath, customHeaders, totalSize, msg);
      }

      let fd = null;
      let chunks = [];
      let totalDownloaded = 0;
      let isResuming = false;

      // Check if we can resume from existing .part and .part.meta
      if (fs.existsSync(partPath) && fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          const etagMismatch = meta.etag && probedEtag && meta.etag !== probedEtag;
          if (
            !etagMismatch &&
            meta.totalSize === totalSize &&
            Array.isArray(meta.chunks) &&
            meta.chunks.length > 0
          ) {
            chunks = meta.chunks.map((c) => ({
              index: c.index,
              start: c.start,
              end: c.end,
              written: c.written || 0,
              length: c.length,
              inFlight: false
            }));
            totalDownloaded = chunks.reduce((acc, c) => acc + (c.written || 0), 0);
            fd = fs.openSync(partPath, 'r+');
            isResuming = true;
          } else if (etagMismatch) {
            // ETag mismatch: Resource changed on server! Discard old chunks to prevent corruption
            try {
              if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
              if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
            } catch (_) {}
            isResuming = false;
          }
        } catch (_) {
          isResuming = false;
        }
      }

      if (!isResuming) {
        fd = fs.openSync(partPath, 'w+');
        fs.ftruncateSync(fd, totalSize);
        chunks = generateGranularChunks(totalSize);
      }

      const aimd = new AIMDConcurrencyController(6, 2, 16);
      job.aimd = aimd;

      activeFd = fd;
      activeFilePath = partPath;

      const saveMeta = () => {
        try {
          const metaObj = {
            version: 1,
            taskId,
            videoId: msg.videoId,
            filename: safeFilename,
            totalSize,
            etag: probedEtag || null,
            lastModified: probedLastModified || null,
            chunkCount: chunks.length,
            chunks: chunks.map((c) => ({
              index: c.index,
              start: c.start,
              end: c.end,
              written: c.written,
              length: c.length
            }))
          };
          fs.writeFileSync(metaPath, JSON.stringify(metaObj, null, 2), 'utf8');
        } catch (_) {}
      };
      saveMeta();

      let lastProgressTime = Date.now();
      let lastMetaSaveTime = Date.now();
      let bytesSinceLastProgress = 0;
      let isFinished = false;

      job.fd = fd;
      job.chunks = chunks;
      job.totalSize = totalSize;
      job.totalDownloaded = totalDownloaded;
      job.chunkCount = chunks.length;
      job.url = probedUrl;
      job.saveMeta = saveMeta;

      const initialPct = Math.min(99, Math.round((totalDownloaded / totalSize) * 100));
      sendMessage({
        type: 'PROGRESS',
        status: 'downloading',
        part: `Turbo Chunker (${chunks.length}x)`,
        percent: initialPct,
        totalSize: formatBytes(totalSize),
        speed: isResuming ? 'Melanjutkan...' : 'Memulai...',
        eta: '',
        videoId: msg.videoId,
        taskId,
        title: msg.title
      });

      const reportProgress = () => {
        if (job.status !== 'downloading') return;
        const now = Date.now();
        if (now - lastMetaSaveTime >= 2000) {
          saveMeta();
          lastMetaSaveTime = now;
        }
        const deltaSec = (now - lastProgressTime) / 1000;
        if (deltaSec >= 0.35) {
          const speedBytes = bytesSinceLastProgress / deltaSec;
          if (job.aimd) {
            job.aimd.evaluateThroughput(speedBytes);
          }
          const pct = Math.min(99, Math.round((totalDownloaded / totalSize) * 100));
          const remBytes = totalSize - totalDownloaded;
          const etaSec = speedBytes > 0 ? Math.round(remBytes / speedBytes) : 0;
          const currentConcurrency = job.aimd ? job.aimd.concurrency : Math.min(chunks.length, 16);

          sendMessage({
            type: 'PROGRESS',
            status: 'downloading',
            part: `Turbo Chunker (${currentConcurrency}x Adaptive)`,
            concurrency: currentConcurrency,
            percent: pct,
            totalSize: formatBytes(totalSize),
            speed: `${formatBytes(speedBytes)}/s`,
            eta: formatDuration(etaSec),
            videoId: msg.videoId,
            taskId,
            title: msg.title
          });

          bytesSinceLastProgress = 0;
          lastProgressTime = now;
          if (job.startWorkers) job.startWorkers();
        }
      };

      return new Promise((resolveAll, rejectAll) => {
        function startNextWorker() {
          if (isFinished || job.status !== 'downloading') return;

          let incompleteChunk = chunks.find((c) => !c.inFlight && c.written < c.length);
          if (!incompleteChunk) {
            // Dynamic Work-Stealing: Split unwritten range of largest in-flight chunk
            incompleteChunk = stealWork(chunks);
          }
          if (!incompleteChunk) {
            if (job.activeWorkers === 0) {
              const allDone = chunks.every((c) => c.written >= c.length);
              if (allDone) {
                isFinished = true;
                job.status = 'done';
                resolveAll();
                return;
              }
              // Self-healing anti-deadlock: reset any orphaned inFlight chunks and resume
              const pending = chunks.filter((c) => c.written < c.length);
              if (pending.length > 0) {
                for (const c of pending) {
                  c.inFlight = false;
                }
                incompleteChunk = pending[0];
              } else {
                return;
              }
            } else {
              return;
            }
          }

          incompleteChunk.inFlight = true;
          job.activeWorkers++;

          downloadChunkTask(
            job.url || probedUrl,
            incompleteChunk,
            customHeaders,
            fd,
            (bytes) => {
              totalDownloaded += bytes;
              job.totalDownloaded = totalDownloaded;
              bytesSinceLastProgress += bytes;
              reportProgress();
            },
            job
          )
            .then(() => {
              incompleteChunk.inFlight = false;
              if (job.activeWorkers > 0) job.activeWorkers--;
              startNextWorker();
            })
            .catch((err) => {
              incompleteChunk.inFlight = false;
              if (job.activeWorkers > 0) job.activeWorkers--;
              if (err.message === 'PAUSED_OR_CANCELLED' || job.status === 'paused') {
                saveMeta();
                return;
              }
              if (job.status === 'cancelled') {
                isFinished = true;
                return rejectAll(new Error('DOWNLOAD_CANCELLED'));
              }
              // Transient chunk error during download: save progress, do not kill whole job
              if (job.status === 'downloading') {
                saveMeta();
                setTimeout(() => {
                  if (job.status === 'downloading') startNextWorker();
                }, 1000);
                return;
              }
              isFinished = true;
              rejectAll(err);
            });
        }

        job.startWorkers = () => {
          if (isFinished || job.status !== 'downloading') return;
          const maxConcurrency = job.aimd ? job.aimd.concurrency : Math.min(chunks.length, 16);
          const needed = maxConcurrency - job.activeWorkers;
          for (let i = 0; i < needed; i++) {
            if (i === 0) {
              startNextWorker();
            } else {
              setTimeout(() => {
                if (!isFinished && job.status === 'downloading') {
                  startNextWorker();
                }
              }, i * 50);
            }
          }
        };

        job.startWorkers();
      }).then(async () => {
        activeJobs.delete(taskId);
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch (_) {}
        }
        if (activeFd === fd) activeFd = null;
        activeFilePath = null;

        // Strict Pre-Rename Integrity Guard
        const allChunksDone = chunks.every((c) => c.written >= c.length);
        if (!allChunksDone) {
          throw new Error('Incomplete download: beberapa chunk belum selesai');
        }
        if (fs.existsSync(partPath)) {
          const stat = fs.statSync(partPath);
          if (totalSize > 0 && stat.size !== totalSize) {
            throw new Error(
              `Integrity check failed: ${stat.size} bytes (expected ${totalSize} bytes)`
            );
          }
          // Atomic rename .part -> finalDestPath
          if (fs.existsSync(finalDestPath)) {
            try {
              fs.unlinkSync(finalDestPath);
            } catch (_) {}
          }
          try {
            fs.renameSync(partPath, finalDestPath);
          } catch (_) {
            fs.copyFileSync(partPath, finalDestPath);
            fs.unlinkSync(partPath);
          }
        }

        // Clean up companion .part.meta
        try {
          if (fs.existsSync(metaPath)) {
            fs.unlinkSync(metaPath);
          }
        } catch (_) {}

        const hashHex = await computeFileSha256(finalDestPath);

        sendMessage({
          success: true,
          status: 'complete',
          filename: safeFilename,
          folder: targetSubdir,
          size: formatBytes(totalSize),
          rawBytes: totalSize,
          sha256: hashHex,
          videoId: msg.videoId,
          taskId,
          title: msg.title,
          author: msg.author,
          timestamp: Date.now(),
          message: 'Video berhasil diunduh dengan Turbo Chunker!'
        });
      });
    })
    .catch((err) => {
      const isPaused = activeJobs.get(taskId)?.status === 'paused';
      if (isPaused) {
        return;
      }

      const isCancelled =
        err.message === 'DOWNLOAD_CANCELLED' || activeJobs.get(taskId)?.status === 'cancelled';
      activeJobs.delete(taskId);
      if (activeFd !== null) {
        try {
          fs.closeSync(activeFd);
        } catch (_) {}
        activeFd = null;
      }
      activeFilePath = null;

      if (isCancelled) {
        try {
          const partPath = finalDestPath + '.part';
          const metaPath = finalDestPath + '.part.meta';
          if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
          if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
        } catch (_) {}
        return;
      }

      sendMessage({
        success: false,
        status: 'error',
        error: err.message || 'Unduhan Turbo Chunker gagal',
        errorCode: 'ERR_TURBO_CHUNK_FAIL',
        videoId: msg.videoId,
        taskId
      });
    });
}

// =========================================================================
// 5. Smart History & File Lifecycle Tracker Helpers
// =========================================================================

function findMovedFile(filename, sizeBytes, originalPath, customRoots = null) {
  if (!filename) return null;
  const candidateRoots =
    Array.isArray(customRoots) && customRoots.length > 0
      ? customRoots
      : [
          'D:\\Anime',
          'D:\\',
          'C:\\Anime',
          path.join(os.homedir(), 'Downloads'),
          path.join(os.homedir(), 'Videos'),
          path.join(os.homedir(), 'Desktop'),
          path.join(os.homedir(), 'Documents')
        ];

  for (const root of candidateRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const direct = path.join(root, filename);
      if (direct !== originalPath && fs.existsSync(direct)) {
        const st = fs.statSync(direct);
        if (!sizeBytes || Math.abs(st.size - sizeBytes) < 4096) {
          return { path: direct, size: st.size };
        }
      }
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const subPath = path.join(root, ent.name, filename);
          if (subPath !== originalPath && fs.existsSync(subPath)) {
            const st = fs.statSync(subPath);
            if (!sizeBytes || Math.abs(st.size - sizeBytes) < 4096) {
              return { path: subPath, size: st.size };
            }
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

function getRecycleBinFilenames() {
  try {
    const cmd = `powershell -NoProfile -NonInteractive -Command "(New-Object -ComObject Shell.Application).Namespace(10).Items() | ForEach-Object { $_.Name }"`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 4000, windowsHide: true });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

function auditSingleFile(item, binFiles = [], customRoots = null) {
  if (!item || typeof item !== 'object') {
    return {
      status: 'PERMANENTLY_DELETED',
      state: 'PERMANENTLY_DELETED',
      fileStatus: 'PERMANENTLY_DELETED',
      currentPath: null,
      originalPath: null,
      sizeBytes: 0,
      lastChecked: Date.now()
    };
  }

  const originalPath =
    item.originalPath ||
    item.filePath ||
    (item.folder && item.filename ? path.join(item.folder, item.filename) : null);
  const filename = item.filename || (originalPath ? path.basename(originalPath) : '');
  const sizeBytes = typeof item.sizeBytes === 'number' ? item.sizeBytes : null;

  // 1. Check if file still exists in original location
  if (originalPath && fs.existsSync(originalPath)) {
    try {
      const st = fs.statSync(originalPath);
      return {
        id: item.id,
        status: 'EXISTS_ORIGINAL',
        state: 'EXISTS_ORIGINAL',
        fileStatus: 'EXISTS_ORIGINAL',
        inRecycleBin: false,
        currentPath: originalPath,
        originalPath,
        sizeBytes: st.size,
        lastChecked: Date.now()
      };
    } catch (_) {}
  }

  // 2. Check if file was moved elsewhere on drive
  const moved = findMovedFile(filename, sizeBytes, originalPath, customRoots);
  if (moved) {
    return {
      id: item.id,
      status: 'MOVED',
      state: 'MOVED',
      fileStatus: 'MOVED',
      inRecycleBin: false,
      currentPath: moved.path,
      originalPath,
      sizeBytes: moved.size,
      lastChecked: Date.now()
    };
  }

  // 3. Check if file is in Windows Recycle Bin
  const binArr = Array.isArray(binFiles)
    ? binFiles
    : binFiles instanceof Set
      ? Array.from(binFiles)
      : binFiles && typeof binFiles[Symbol.iterator] === 'function'
        ? Array.from(binFiles)
        : [];

  const lowerName = filename.toLowerCase();
  const lowerBaseNoExt = path.parse(filename).name.toLowerCase();
  const isInBin = binArr.some((bf) => {
    const s = String(bf).toLowerCase();
    return s === lowerName || s === lowerBaseNoExt || s.includes(lowerBaseNoExt);
  });

  if (isInBin) {
    return {
      id: item.id,
      status: 'IN_RECYCLE_BIN',
      state: 'IN_RECYCLE_BIN',
      fileStatus: 'IN_RECYCLE_BIN',
      inRecycleBin: true,
      currentPath: null,
      originalPath,
      sizeBytes,
      lastChecked: Date.now()
    };
  }

  // 4. File is permanently deleted or missing
  return {
    id: item.id,
    status: 'PERMANENTLY_DELETED',
    state: 'PERMANENTLY_DELETED',
    fileStatus: 'PERMANENTLY_DELETED',
    inRecycleBin: false,
    currentPath: null,
    originalPath,
    sizeBytes,
    lastChecked: Date.now()
  };
}

function handleAuditFileStatusBatch(msg) {
  const items = Array.isArray(msg.items) ? msg.items : [];
  let binFiles = [];
  const hasPotentiallyMissing = items.some((it) => {
    const p =
      it.originalPath ||
      it.filePath ||
      (it.folder && it.filename ? path.join(it.folder, it.filename) : null);
    return !p || !fs.existsSync(p);
  });

  if (hasPotentiallyMissing) {
    binFiles = getRecycleBinFilenames();
  }

  const results = items.map((it) => auditSingleFile(it, binFiles));
  sendMessage({
    success: true,
    action: 'AUDIT_FILE_STATUS_BATCH',
    results
  });
}

function handleOpenFileLocation(msg) {
  const targetPath = msg.filePath || msg.path || msg.currentPath || msg.originalPath;
  if (!targetPath || !fs.existsSync(targetPath)) {
    return sendMessage({
      success: false,
      action: 'OPEN_FILE_LOCATION',
      error: 'File tidak ditemukan di disk: ' + (targetPath || '')
    });
  }

  try {
    const cleanPath = path.normalize(targetPath);
    spawn('explorer.exe', ['/select,', cleanPath], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    }).unref();
    sendMessage({ success: true, action: 'OPEN_FILE_LOCATION', path: cleanPath });
  } catch (err) {
    sendMessage({ success: false, action: 'OPEN_FILE_LOCATION', error: err.message });
  }
}

function handlePlayVideoFile(msg) {
  const targetPath = msg.filePath || msg.path || msg.currentPath || msg.originalPath;
  if (!targetPath || !fs.existsSync(targetPath)) {
    return sendMessage({
      success: false,
      action: 'PLAY_VIDEO_FILE',
      error: 'File video tidak ditemukan di disk: ' + (targetPath || '')
    });
  }

  try {
    const cleanPath = path.normalize(targetPath);
    spawn('cmd.exe', ['/c', 'start', '""', cleanPath], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    }).unref();
    sendMessage({ success: true, action: 'PLAY_VIDEO_FILE', path: cleanPath });
  } catch (err) {
    sendMessage({ success: false, action: 'PLAY_VIDEO_FILE', error: err.message });
  }
}

function handleOpenRecycleBin() {
  try {
    spawn('explorer.exe', ['shell:RecycleBinFolder'], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    }).unref();
    sendMessage({ success: true, action: 'OPEN_RECYCLE_BIN' });
  } catch (err) {
    sendMessage({ success: false, action: 'OPEN_RECYCLE_BIN', error: err.message });
  }
}

// Node export for unit tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    findMovedFile,
    getRecycleBinFilenames,
    auditSingleFile,
    handleAuditFileStatusBatch,
    handleOpenFileLocation,
    handlePlayVideoFile,
    handleOpenRecycleBin,
    isDisallowedHostOrIp,
    validateSafeUrl,
    sanitizeHeaders,
    isolateHeadersOnRedirect,
    generateGranularChunks,
    stealWork,
    AIMDConcurrencyController,
    httpAgent,
    httpsAgent,
    isValidAnoBoyToken,
    extractAnoBoyCandidateTokens,
    resolveBloggerStreamInNode,
    extractAnoBoyTokenFromHtml,
    resolveFromEpisodeUrlInNode
  };
}
