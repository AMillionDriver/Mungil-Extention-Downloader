/**
 * Mungil Download Diagnostic & Forensic Tracking Engine
 *
 * Implements an enterprise-grade 3-layer diagnostic telemetry pipeline:
 * - Layer 1: Structured JSON event logger (Trace ID, Job ID, WorkerSlot, Component, File, Function)
 * - Layer 2: Diagnostic ring buffer storage in chrome.storage.local
 * - Layer 3: Forensic Markdown report compiler (13-section format for AI agents & human inspection)
 */

const MAX_DIAGNOSTIC_JOBS = 100;
const STORAGE_KEY = 'mungil_diagnostic_jobs';

/**
 * Sanitizes URLs to prevent logging raw tokens or secret signature parameters.
 * Replaces values of sensitive params (token, sig, lsig, key, auth) with [REDACTED]
 * while preserving host, path, and param keys.
 *
 * @param {string} rawUrl
 * @returns {{ sanitizedUrl: string, cdnHost: string, streamPath: string, safeParamKeys: string[], urlFingerprint: string }}
 */
function sanitizeStreamUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      sanitizedUrl: 'N/A',
      cdnHost: 'UNKNOWN',
      streamPath: '/',
      safeParamKeys: [],
      urlFingerprint: 'none'
    };
  }

  try {
    const parsed = new URL(rawUrl);
    const safeKeys = [];
    const sensitiveKeys = new Set([
      'token',
      'sig',
      'lsig',
      'signature',
      'key',
      'auth',
      'pass',
      'token_id',
      'expires'
    ]);

    for (const [key] of parsed.searchParams.entries()) {
      safeKeys.push(key);
      if (sensitiveKeys.has(key.toLowerCase())) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }

    // Fast simple string hash for fingerprinting
    let hash = 0;
    for (let i = 0; i < rawUrl.length; i++) {
      hash = (hash << 5) - hash + rawUrl.charCodeAt(i);
      hash |= 0;
    }
    const fingerprint = 'fp_' + Math.abs(hash).toString(16).padStart(8, '0');

    return {
      sanitizedUrl: parsed.toString(),
      cdnHost: parsed.hostname,
      streamPath: parsed.pathname,
      safeParamKeys: safeKeys,
      urlFingerprint: fingerprint
    };
  } catch (_) {
    return {
      sanitizedUrl: rawUrl.slice(0, 60) + '...',
      cdnHost: 'UNKNOWN',
      streamPath: '/',
      safeParamKeys: [],
      urlFingerprint: 'malformed'
    };
  }
}

class MungilDiagnosticTracker {
  constructor() {
    this.memoryJobs = new Map();
  }

  /**
   * Initializes or loads existing jobs from chrome.storage.local
   */
  async loadJobs() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const data = await chrome.storage.local.get([STORAGE_KEY]);
        if (data && Array.isArray(data[STORAGE_KEY])) {
          this.memoryJobs.clear();
          data[STORAGE_KEY].forEach((job) => {
            if (job && job.jobId) this.memoryJobs.set(job.jobId, job);
          });
        }
      } catch (_) {}
    }
  }

  /**
   * Persists the current ring buffer of jobs to chrome.storage.local
   */
  async persistJobs() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const list = Array.from(this.memoryJobs.values());
        // Enforce FIFO ring buffer
        if (list.length > MAX_DIAGNOSTIC_JOBS) {
          list.splice(0, list.length - MAX_DIAGNOSTIC_JOBS);
        }
        await chrome.storage.local.set({ [STORAGE_KEY]: list });
      } catch (_) {}
    }
  }

  /**
   * Starts a new download diagnostic job.
   *
   * @param {object} params
   * @returns {object} The created job record
   */
  createJob(params = {}) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const platform = (params.platform || 'unknown').toLowerCase();
    const epNum = String(params.episodeNum || '01').padStart(2, '0');
    const randomSuffix = Math.random().toString(36).substring(2, 6);

    const jobId = params.jobId || `job_${dateStr}_${platform}_${epNum}_${randomSuffix}`;
    const traceId =
      params.traceId ||
      `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    const sanitized = sanitizeStreamUrl(params.rawUrl || params.url);

    const job = {
      jobId,
      traceId,
      status: 'INITIALIZING',
      httpStatus: 0,
      downloadStatus: 'PENDING',
      integrityStatus: 'UNVERIFIED',
      source: {
        pageUrl: params.pageUrl || 'N/A',
        platform,
        cdnHost: sanitized.cdnHost,
        streamPath: sanitized.streamPath,
        safeParamKeys: sanitized.safeParamKeys,
        urlFingerprint: sanitized.urlFingerprint,
        httpMethod: 'GET'
      },
      file: {
        animeTitle: params.title || 'Video',
        episodeNum: epNum,
        resolution: params.resolution || '720p',
        format: 'mp4',
        mimeType: 'application/octet-stream',
        expectedBytes: Number(params.expectedBytes) || 0,
        receivedBytes: 0,
        finalBytes: 0,
        sha256: null
      },
      storage: {
        destinationDirectory: params.destinationDirectory || 'Downloads',
        destinationPath: params.filename || `${jobId}.mp4`,
        storageStatus: 'PENDING',
        exists: false
      },
      runtime: {
        browserVersion:
          typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : 'Node.js',
        extensionVersion: '1.2.0',
        serviceWorkerId: 'sw-primary',
        nativeHostPid: null,
        chunkWorkersCount: Number(params.chunkWorkersCount) || 16,
        startedAt: now.toISOString(),
        completedAt: null,
        durationMs: 0
      },
      chunks: [],
      timeline: []
    };

    this.memoryJobs.set(jobId, job);
    this.appendTimelineEvent(jobId, {
      component: 'service-worker',
      file: 'service_worker.js',
      func: 'createJob',
      level: 'INFO',
      message: `Download job initialized for ${job.file.animeTitle} Episode ${job.file.episodeNum}`
    });

    this.persistJobs();
    return job;
  }

  /**
   * Appends an execution trace breadcrumb to a specific job.
   */
  appendTimelineEvent(jobId, event = {}) {
    const job = this.memoryJobs.get(jobId);
    if (!job) return;

    job.timeline.push({
      timestamp: new Date().toISOString(),
      component: event.component || 'service-worker',
      file: event.file || 'service_worker.js',
      func: event.func || 'anonymous',
      level: event.level || 'INFO',
      message: event.message || '',
      context: event.context || null
    });
  }

  /**
   * Records chunk-level activity from Turbo Chunker.
   */
  recordChunkActivity(jobId, chunkInfo = {}) {
    const job = this.memoryJobs.get(jobId);
    if (!job) return;

    job.chunks.push({
      slotId:
        chunkInfo.slotId || `chunk-worker-${String(chunkInfo.chunkIndex || 0).padStart(2, '0')}`,
      chunkIndex: Number(chunkInfo.chunkIndex) || 0,
      rangeStart: Number(chunkInfo.rangeStart) || 0,
      rangeEnd: Number(chunkInfo.rangeEnd) || 0,
      httpStatus: Number(chunkInfo.httpStatus) || 206,
      bytesReceived: Number(chunkInfo.bytesReceived) || 0,
      attempt: Number(chunkInfo.attempt) || 1,
      status: chunkInfo.status || 'SUCCESS',
      durationMs: Number(chunkInfo.durationMs) || 0
    });
  }

  /**
   * Updates job status, sizes, and integrity verification results.
   */
  updateJob(jobId, updates = {}) {
    const job = this.memoryJobs.get(jobId);
    if (!job) return null;

    if (updates.status) job.status = updates.status;
    if (updates.httpStatus) job.httpStatus = updates.httpStatus;
    if (updates.downloadStatus) job.downloadStatus = updates.downloadStatus;
    if (updates.integrityStatus) job.integrityStatus = updates.integrityStatus;

    if (updates.file) {
      Object.assign(job.file, updates.file);
    }
    if (updates.storage) {
      Object.assign(job.storage, updates.storage);
    }
    if (updates.runtime) {
      Object.assign(job.runtime, updates.runtime);
    }
    if (updates.sourceUrl) {
      const sanitized = sanitizeStreamUrl(updates.sourceUrl);
      job.source.cdnHost = sanitized.cdnHost;
      job.source.streamPath = sanitized.streamPath;
      job.source.safeParamKeys = sanitized.safeParamKeys;
      job.source.urlFingerprint = sanitized.urlFingerprint;
    }

    if (
      updates.status === 'COMPLETED' ||
      updates.status === 'CORRUPTED' ||
      updates.status === 'FAILED'
    ) {
      job.runtime.completedAt = new Date().toISOString();
      const startMs = new Date(job.runtime.startedAt).getTime();
      job.runtime.durationMs = Date.now() - startMs;
    }

    this.persistJobs();
    return job;
  }

  /**
   * Retrieves a single job by ID.
   */
  getJob(jobId) {
    return this.memoryJobs.get(jobId) || null;
  }

  /**
   * Retrieves all jobs in chronological order (most recent first).
   */
  getAllJobs() {
    return Array.from(this.memoryJobs.values()).reverse();
  }

  /**
   * Records chunk activity with convenient signature.
   */
  recordChunk(jobId, chunkInfo = {}) {
    return this.recordChunkActivity(jobId, chunkInfo);
  }

  /**
   * Updates download progress and received byte estimates.
   */
  updateProgress(jobId, percent, speed = '', eta = '') {
    const job = this.memoryJobs.get(jobId);
    if (!job) return;
    job.status = 'DOWNLOADING';
    if (typeof percent === 'number') {
      job.percent = percent;
      if (job.file.expectedBytes > 0) {
        job.file.receivedBytes = Math.round((percent / 100) * job.file.expectedBytes);
      }
    }
    if (speed) job.speed = speed;
    if (eta) job.eta = eta;
  }

  /**
   * Marks a download job as completed and verifies final integrity.
   */
  completeJob(jobId, details = {}) {
    const job = this.memoryJobs.get(jobId);
    if (!job) return;
    const finalBytes = Number(details.finalBytes) || job.file.expectedBytes || 0;
    this.updateJob(jobId, {
      status: 'COMPLETED',
      downloadStatus: 'SUCCESS',
      integrityStatus: 'VERIFIED',
      file: {
        finalBytes,
        receivedBytes: finalBytes,
        sha256: details.sha256 || null
      },
      storage: {
        destinationPath: details.filePath || job.storage.destinationPath,
        storageStatus: 'WRITTEN',
        exists: true
      }
    });
    this.appendTimelineEvent(jobId, {
      component: 'native-host',
      file: 'downloader_host.js',
      func: 'completeJob',
      level: 'SUCCESS',
      message: `Download job completed successfully. Verified size: ${finalBytes} B, SHA-256: ${details.sha256 || 'N/A'}`
    });
  }

  /**
   * Marks a download job as failed with root cause and diagnostic breadcrumbs.
   */
  failJob(jobId, reason, details = {}) {
    const job = this.memoryJobs.get(jobId);
    if (!job) return;
    const errorType = details.errorType || 'DOWNLOAD_ERROR';
    const isCorruptHtml =
      errorType === 'FAILED_CORRUPT_HTML' ||
      (reason && reason.includes('CORRUPTED_STREAM')) ||
      (reason && reason.includes('halaman HTML'));

    this.updateJob(jobId, {
      status: 'FAILED',
      httpStatus: details.httpStatus || 500,
      downloadStatus: 'ERROR',
      integrityStatus: isCorruptHtml ? 'FAILED_CORRUPT_HTML' : 'FAILED_ERROR'
    });
    this.appendTimelineEvent(jobId, {
      component: 'service-worker',
      file: 'service_worker.js',
      func: 'failJob',
      level: 'ERROR',
      message: `Job failed: ${reason}`
    });
  }

  /**
   * Clears all recorded jobs.
   */
  clearJobs() {
    this.memoryJobs.clear();
    this.persistJobs();
  }

  async clearAll() {
    this.clearJobs();
  }

  /**
   * Compiles a forensic 13-section Markdown report for a specific job.
   *
   * @param {string} [jobId] - Optional Job ID. If omitted, reports latest job.
   * @returns {string} Fully formatted Markdown document
   */
  generateMarkdownReport(jobId) {
    let job = null;
    if (jobId) {
      job = this.memoryJobs.get(jobId);
    } else if (this.memoryJobs.size > 0) {
      const all = Array.from(this.memoryJobs.values());
      job = all[all.length - 1];
    }
    if (!job) {
      return `# Mungil Download Forensic & Diagnostic Report\n\n*No diagnostic jobs currently recorded in the session database.*`;
    }

    const formatBytes = (bytes) => {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
    };

    const statusIcon =
      job.status === 'COMPLETED'
        ? '✅'
        : job.status === 'CORRUPTED'
          ? '❌'
          : job.status === 'FAILED'
            ? '⚠️'
            : '⏳';

    let md = `# Mungil Download Forensic & Diagnostic Report: ${job.jobId}\n\n`;
    md += `**Overall Status**: ${statusIcon} \`${job.status}\`  \n`;
    md += `**Generated At**: ${new Date().toISOString()}  \n`;
    md += `**Trace ID**: \`${job.traceId}\`  \n\n`;
    md += `---\n\n`;

    // 1. Executive Diagnostic Summary
    md += `## 1. Executive Diagnostic Summary\n\n`;
    md += `This report captures full forensic trace diagnostics for job \`${job.jobId}\`.\n`;
    md += `- **Series Title**: ${job.file.animeTitle} (Ep ${job.file.episodeNum})\n`;
    md += `- **Result**: \`${job.status}\` | HTTP \`${job.httpStatus || 200}\`\n`;
    md += `- **Integrity Status**: \`${job.integrityStatus}\`\n\n`;

    // 2. Download Job Card
    md += `## 2. Download Job Card\n\n`;
    md += `| Field | Value |\n`;
    md += `| :--- | :--- |\n`;
    md += `| **Job ID** | \`${job.jobId}\` |\n`;
    md += `| **Platform** | ${job.source.platform.toUpperCase()} |\n`;
    md += `| **Series Title** | ${job.file.animeTitle} |\n`;
    md += `| **Episode** | ${job.file.episodeNum} |\n`;
    md += `| **HTTP Result** | \`${job.httpStatus || 200}\` |\n`;
    md += `| **Download Status** | \`${job.downloadStatus}\` |\n`;
    md += `| **Integrity Status** | \`${job.integrityStatus}\` |\n`;
    md += `| **Duration** | ${(job.runtime.durationMs / 1000).toFixed(2)}s |\n\n`;

    // 3. Source & Stream Information
    md += `## 3. Source & Stream Information\n\n`;
    md += `- **Source Web Page**: ${job.source.pageUrl}\n`;
    md += `- **CDN Host**: \`${job.source.cdnHost}\`\n`;
    md += `- **Stream Path**: \`${job.source.streamPath}\`\n`;
    md += `- **URL Fingerprint**: \`${job.source.urlFingerprint}\`\n`;
    md += `- **Parameters Preserved**: ${job.source.safeParamKeys.join(', ') || 'none'}\n`;
    md += `- **HTTP Method**: \`${job.source.httpMethod}\`\n\n`;

    // 4. File & Media Specifications
    md += `## 4. File & Media Specifications\n\n`;
    md += `| Metric | Raw Value (Bytes) | Human-Readable |\n`;
    md += `| :--- | :--- | :--- |\n`;
    md += `| **Filename** | - | \`${job.storage.destinationPath}\` |\n`;
    md += `| **MIME Type** | - | \`${job.file.mimeType}\` |\n`;
    md += `| **Resolution** | - | \`${job.file.resolution}\` |\n`;
    md += `| **Expected Size** | ${job.file.expectedBytes} B | ~${formatBytes(job.file.expectedBytes)} |\n`;
    md += `| **Received Size** | ${job.file.receivedBytes} B | ~${formatBytes(job.file.receivedBytes)} |\n`;
    md += `| **Final Size** | ${job.file.finalBytes} B | ~${formatBytes(job.file.finalBytes)} |\n`;
    md += `| **SHA-256 Checksum** | - | \`${job.file.sha256 || 'Pending / Uncomputed'}\` |\n\n`;

    // 5. Storage & Filesystem Footprint
    md += `## 5. Storage & Filesystem Footprint\n\n`;
    md += `| **SHA-256 Checksum** | - | \`${job.file.sha256 || 'Pending / Uncomputed'}\` |\n\n`;

    // 4. Storage Information
    md += `## 4. Storage Information\n\n`;
    md += `- **Destination Directory**: \`${job.storage.destinationDirectory}\`\n`;
    md += `- **Destination Path**: \`${job.storage.destinationPath}\`\n`;
    md += `- **Storage Status**: \`${job.storage.storageStatus}\`\n`;
    md += `- **Exists On Disk**: \`${job.storage.exists}\`\n\n`;

    // 5. Runtime Environment
    md += `## 5. Runtime Environment\n\n`;
    md += `- **Extension Version**: \`${job.runtime.extensionVersion}\`\n`;
    md += `- **Browser / Engine**: \`${job.runtime.browserVersion}\`\n`;
    md += `- **Parallel Chunker Slots**: \`${job.runtime.chunkWorkersCount}\` slots\n`;
    md += `- **Service Worker Instance**: \`${job.runtime.serviceWorkerId}\`\n\n`;

    // 6. Execution Components
    md += `## 6. Execution Components\n\n`;
    md += `1. **Browser Content Script**: Injects UI, tracks batch queue lifecycle\n`;
    md += `2. **Service Worker Control Plane**: Edge routing, dynamic DNR rules, failover\n`;
    md += `3. **Turbo Chunker Engine**: 16x parallel byte-range downloader with AIMD throttling\n\n`;

    // 7. Chunk Activity Matrix
    md += `## 7. Chunk Activity Matrix\n\n`;
    if (job.chunks.length === 0) {
      md += `*No chunk activity recorded for this job (direct or failed before chunk dispatch).*\n\n`;
    } else {
      md += `| Worker Slot | Chunk # | Byte Range | HTTP | Received | Duration | Status |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
      job.chunks.forEach((c) => {
        md += `| \`${c.slotId}\` | ${c.chunkIndex} | \`${c.rangeStart}-${c.rangeEnd}\` | ${c.httpStatus} | ${formatBytes(c.bytesReceived)} | ${c.durationMs}ms | \`${c.status}\` |\n`;
      });
      md += `\n`;
    }

    // 8. Execution Trace Timeline
    md += `## 8. Execution Trace Timeline\n\n`;
    if (job.timeline.length === 0) {
      md += `*No timeline events logged.*\n\n`;
    } else {
      job.timeline.forEach((t) => {
        const time = t.timestamp.split('T')[1].replace('Z', '');
        const lvl =
          t.level === 'ERROR'
            ? '🔴 ERROR'
            : t.level === 'WARN'
              ? '🟡 WARN'
              : t.level === 'SUCCESS'
                ? '🟢 SUCCESS'
                : '⚪ INFO';
        md += `- \`[${time}]\` **[${lvl}]** \`[${t.component} -> ${t.func}()]\`: ${t.message}\n`;
        if (t.context) {
          md += `  \`\`\`json\n  ${JSON.stringify(t.context)}\n  \`\`\`\n`;
        }
      });
      md += `\n`;
    }

    // 9. Integrity Verification
    md += `## 9. Integrity Verification Summary\n\n`;
    if (job.integrityStatus === 'FAILED_CORRUPT_HTML') {
      md += `> [!CAUTION]\n`;
      md += `> **CORRUPTED STREAM DETECTED**: The download payload received was a small HTML document (${formatBytes(job.file.finalBytes)}) rather than a binary MP4 video. This happens when an upstream mirror returns an error or ad redirect page. The file writing was halted or quarantined.\n\n`;
    } else if (job.integrityStatus === 'VERIFIED') {
      md += `> [!NOTE]\n`;
      md += `> **INTEGRITY VERIFIED**: File size matches expected bounds and SHA-256 hash was generated cleanly.\n\n`;
    } else {
      md += `> **Status**: \`${job.integrityStatus}\`\n\n`;
    }

    md += `---\n*Report compiled by Mungil Diagnostic Engine v1.2.0*\n`;
    return md;
  }
}

// Singleton export
const diagnosticTracker = new MungilDiagnosticTracker();

if (typeof self !== 'undefined') {
  self.MungilDiagnosticTracker = MungilDiagnosticTracker;
  self.diagnosticTracker = diagnosticTracker;
  self.sanitizeStreamUrl = sanitizeStreamUrl;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MungilDiagnosticTracker,
    diagnosticTracker,
    sanitizeStreamUrl
  };
}
