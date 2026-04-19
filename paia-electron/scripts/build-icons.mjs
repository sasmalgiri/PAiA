#!/usr/bin/env node
//
// Generates the platform-specific icon files electron-builder needs from
// the source SVG at assets/icon.svg.
//
// Outputs:
//   assets/icon.png   (1024×1024 — Linux + universal fallback)
//   assets/icon.ico   (Windows multi-size)
//   assets/icon.icns  (macOS multi-size)
//
// Run with:  node scripts/build-icons.mjs
// Run automatically: this script is invoked by `npm run build:icons` and
// by the GitHub Actions release pipeline before electron-builder kicks in.

import sharp from 'sharp';
import png2icons from 'png2icons';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'assets', 'icon.svg');
const outPng = path.join(root, 'assets', 'icon.png');
const outIco = path.join(root, 'assets', 'icon.ico');
const outIcns = path.join(root, 'assets', 'icon.icns');

async function main() {
  const svg = await fs.readFile(svgPath);
  console.log('Rasterising SVG → 1024×1024 PNG');

  // Build the master 1024×1024 PNG. electron-builder uses this directly
  // for Linux and as the base for the platform conversions below.
  const pngBuffer = await sharp(svg)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await fs.writeFile(outPng, pngBuffer);
  console.log('  →', path.relative(root, outPng), `(${pngBuffer.length} bytes)`);

  console.log('Building Windows .ico');
  const ico = png2icons.createICO(pngBuffer, png2icons.BICUBIC, 0, false, true);
  if (!ico) throw new Error('png2icons failed to build .ico');
  await fs.writeFile(outIco, ico);
  console.log('  →', path.relative(root, outIco), `(${ico.length} bytes)`);

  console.log('Building macOS .icns');
  const icns = png2icons.createICNS(pngBuffer, png2icons.BICUBIC, 0);
  if (!icns) throw new Error('png2icons failed to build .icns');
  await fs.writeFile(outIcns, icns);
  console.log('  →', path.relative(root, outIcns), `(${icns.length} bytes)`);

  console.log('done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
