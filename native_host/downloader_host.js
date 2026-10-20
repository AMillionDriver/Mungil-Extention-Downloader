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

// Active child process reference to eliminate orphan processes on disconnect
let activeChildProcess = null;

function killActiveChild() {
  if (activeChildProcess && !activeChildProcess.killed) {
    try {
      activeChildProcess.kill('SIGKILL');
    } catch (_) {}
    activeChildProcess = null;
  }
}

// Ensure orphan processes are destroyed if Chrome closes or crashes
process.stdin.on('end', () => {
  killActiveChild();
  process.exit(0);
});

process.on('SIGINT', () => {
  killActiveChild();
  process.exit(0);
});

process.on('SIGTERM', () => {
  killActiveChild();
  process.exit(0);
});

process.on('exit', () => {
  killActiveChild();
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

  sendMessage({ success: false, error: 'Unknown action: ' + action });
}
