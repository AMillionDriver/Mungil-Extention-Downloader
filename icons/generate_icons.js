/**
 * Programmatic Zero-Dependency PNG Icon Generator
 * Generates RFC 2083 compliant RGBA PNG icons (16x16, 48x48, 128x128)
 * for the TikTok Direct Downloader Chrome Extension using Node.js built-in zlib.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Precomputed CRC32 lookup table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  typeBuf.copy(chunk, 4);
  data.copy(chunk, 8);
  const toCrc = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(toCrc);
  chunk.writeUInt32BE(crcVal, 8 + len);
  return chunk;
}

function createPng(width, height, drawFn) {
  // Standard 8-byte PNG header
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk (13 bytes)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth: 8
  ihdrData[9] = 6; // Color type: 6 (RGBA)
  ihdrData[10] = 0; // Compression method: 0
  ihdrData[11] = 0; // Filter method: 0
  ihdrData[12] = 0; // Interlace method: 0
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Raw image scanlines with Filter 0 (None)
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawFn(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  // Compress IDAT scanline stream
  const compressedData = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Pixel renderer creating a circular dark badge with TikTok Cyan/Crimson accents and download arrow.
 */
function drawIconPixel(x, y, width, height) {
  const nx = (x + 0.5) / width;
  const ny = (y + 0.5) / height;

  const dx = nx - 0.5;
  const dy = ny - 0.5;
  const dist = Math.hypot(dx, dy);

  // Outside outer boundary
  if (dist > 0.49) {
    return [0, 0, 0, 0];
  }

  // Antialiased edge
  let alpha = 1.0;
  if (dist > 0.46) {
    alpha = (0.49 - dist) / 0.03;
  }

  // Gradient rim: Cyan (#25F4EE) on left, Crimson (#FE2C55) on right
  const isRim = dist >= 0.41 && dist <= 0.47;

  // Arrow shaft: centered vertical rectangle
  const isArrowShaft = (nx >= 0.44 && nx <= 0.56 && ny >= 0.22 && ny <= 0.50);

  // Arrow head: downward triangle
  // Tip at (0.5, 0.66), base at ny = 0.48, width spans from 0.30 to 0.70
  let isArrowHead = false;
  if (ny >= 0.48 && ny <= 0.66) {
    const halfWidth = (0.66 - ny) * 1.1;
    if (Math.abs(nx - 0.5) <= halfWidth) {
      isArrowHead = true;
    }
  }

  // Tray / bracket at bottom: horizontal bar and two small vertical ears
  const isTrayBottom = (ny >= 0.73 && ny <= 0.81 && nx >= 0.26 && nx <= 0.74);
  const isTrayLeft = (ny >= 0.63 && ny <= 0.81 && nx >= 0.26 && nx <= 0.34);
  const isTrayRight = (ny >= 0.63 && ny <= 0.81 && nx >= 0.66 && nx <= 0.74);
  const isTray = isTrayBottom || isTrayLeft || isTrayRight;

  const isGlyph = isArrowShaft || isArrowHead || isTray;

  if (isGlyph) {
    // Crisp white foreground for arrow glyph
    return [255, 255, 255, Math.round(255 * alpha)];
  }

  if (isRim) {
    // Smooth transition from TikTok Cyan (left) to Crimson (right)
    const factor = (nx - 0.1) / 0.8;
    const clamped = Math.max(0, Math.min(1, factor));
    const r = Math.round(37 * (1 - clamped) + 254 * clamped);
    const g = Math.round(244 * (1 - clamped) + 44 * clamped);
    const b = Math.round(238 * (1 - clamped) + 85 * clamped);
    return [r, g, b, Math.round(255 * alpha)];
  }

  // Inner background: sleek dark surface (#161823)
  return [22, 24, 35, Math.round(255 * alpha)];
}

function generateAllIcons(outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const buffer = createPng(size, size, drawIconPixel);
    const targetPath = path.join(outputDir, `icon${size}.png`);
    fs.writeFileSync(targetPath, buffer);
    console.log(`Generated: ${targetPath} (${buffer.length} bytes)`);
  }
}

if (require.main === module) {
  const iconsDir = path.join(__dirname);
  generateAllIcons(iconsDir);
}

module.exports = { createPng, generateAllIcons };
