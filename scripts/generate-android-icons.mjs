#!/usr/bin/env node
/**
 * Extracts the highest-resolution frame from public/favicon.ico and generates
 * Capacitor Android icon + splash assets in ./assets/ for @capacitor/assets.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const icoPath = existsSync(path.join(root, 'public', 'favicon.ico'))
  ? path.join(root, 'public', 'favicon.ico')
  : path.join(root, 'favicon.ico');

if (!existsSync(icoPath)) {
  console.error('! Could not find public/favicon.ico or favicon.ico');
  process.exit(1);
}

function extractBestIcoFrame(icoBuffer) {
  const count = icoBuffer.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const w = icoBuffer[off] || 256;
    const h = icoBuffer[off + 1] || 256;
    const size = icoBuffer.readUInt32LE(off + 8);
    const dataOff = icoBuffer.readUInt32LE(off + 12);
    const area = w * h;
    if (!best || area > best.area) {
      best = { w, h, area, buf: icoBuffer.subarray(dataOff, dataOff + size) };
    }
  }
  if (!best) throw new Error('No icon frames found in ICO');

  // Check for PNG signature (\x89PNG)
  if (
    best.buf[0] === 0x89 &&
    best.buf[1] === 0x50 &&
    best.buf[2] === 0x4e &&
    best.buf[3] === 0x47
  ) {
    return sharp(best.buf);
  }

  // Otherwise decode 32-bit DIB/BMP (BITMAPINFOHEADER)
  const hdrSize = best.buf.readUInt32LE(0);
  const width = best.buf.readInt32LE(4);
  const height = Math.floor(best.buf.readInt32LE(8) / 2);
  const bpp = best.buf.readUInt16LE(14);
  if (bpp !== 32) {
    throw new Error(`Unsupported ICO BMP bit depth: ${bpp}`);
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = hdrSize + (height - 1 - y) * width * 4;
    const dstRow = y * width * 4;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      rgba[d] = best.buf[s + 2];     // R
      rgba[d + 1] = best.buf[s + 1]; // G
      rgba[d + 2] = best.buf[s];     // B
      rgba[d + 3] = best.buf[s + 3]; // A
    }
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } });
}

async function main() {
  const icoBuffer = readFileSync(icoPath);
  const source = extractBestIcoFrame(icoBuffer);

  const assetsDir = path.join(root, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  // 1. icon-only.png (1024x1024) for legacy square & round launcher icons
  const legacyLogo = await source
    .clone()
    .resize(780, 780, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: legacyLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(assetsDir, 'icon-only.png'));

  // 2. icon-background.png (1024x1024 solid #000000) for Android Adaptive Icon
  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toFile(path.join(assetsDir, 'icon-background.png'));

  // 3. icon-foreground.png (1024x1024) with logo scaled into Android Adaptive
  //    Icon safe zone (~64% of 1024px) and black background keyed to alpha so
  //    the white Easvarafy emblem floats cleanly over icon-background.
  const { data: rawFg, info: fgInfo } = await source
    .clone()
    .resize(660, 660, { kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < rawFg.length; i += 4) {
    const lum = Math.max(rawFg[i], rawFg[i + 1], rawFg[i + 2]);
    const origAlpha = rawFg[i + 3] / 255;
    rawFg[i + 3] = Math.round(lum * origAlpha);
  }

  const fgLogo = await sharp(rawFg, {
    raw: { width: fgInfo.width, height: fgInfo.height, channels: 4 },
  })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: fgLogo, gravity: 'center' }])
    .png()
    .toFile(path.join(assetsDir, 'icon-foreground.png'));

  // 4. splash.png & splash-dark.png (2732x2732)
  const splashLogo = await source
    .clone()
    .resize(780, 780, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  for (const name of ['splash.png', 'splash-dark.png']) {
    await sharp({
      create: {
        width: 2732,
        height: 2732,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([{ input: splashLogo, gravity: 'center' }])
      .png()
      .toFile(path.join(assetsDir, name));
  }

  console.log('✓ Generated Capacitor Android icon & splash assets from', path.relative(root, icoPath));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
