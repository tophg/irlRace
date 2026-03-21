#!/usr/bin/env node
// Stitch individual tile images into 4096×4096 facade atlas
// Usage: node scripts/stitch-atlas.mjs <input-dir> <output-file>
//
// Input directory should contain files named: r{row}_c{col}.png (e.g., r0_c0.png)
// Tiles are resized from their original square dimensions to 512×819 (non-square)
// to fill the 8×5 grid within the 4096×4096 POT canvas.

import sharp from 'sharp';
import { readdir } from 'fs/promises';
import { join } from 'path';

const inputDir = process.argv[2];
const outputFile = process.argv[3];
const gridCols = 8;
const gridRows = 5;

// IMPORTANT: Atlas must be power-of-2 dimensions for WebGPU mipmap generation.
// 8 cols × 5 rows into 4096×4096 → each cell is 512×819 (non-square).
// Using square tiles would produce 4096×2560 (NPOT) which crashes WebGPU.
const atlasW = 4096;
const atlasH = 4096;
const tileW = Math.floor(atlasW / gridCols);  // 512
const tileH = Math.floor(atlasH / gridRows);  // 819

if (!inputDir || !outputFile) {
  console.error('Usage: node scripts/stitch-atlas.mjs <input-dir> <output-file>');
  process.exit(1);
}

const files = await readdir(inputDir);
const tileFiles = files.filter(f => /^r\d+_c\d+\.png$/.test(f));

console.log(`Found ${tileFiles.length} tile images in ${inputDir}`);
console.log(`Assembling ${gridCols}×${gridRows} atlas at ${atlasW}×${atlasH} (${tileW}×${tileH} per tile)`);

const composites = [];
for (const file of tileFiles) {
  const match = file.match(/^r(\d+)_c(\d+)\.png$/);
  if (!match) continue;
  const row = parseInt(match[1], 10);
  const col = parseInt(match[2], 10);
  if (row >= gridRows || col >= gridCols) {
    console.warn(`Skipping ${file}: out of bounds (${gridRows}×${gridCols} grid)`);
    continue;
  }

  const resized = await sharp(join(inputDir, file))
    .resize(tileW, tileH, { kernel: sharp.kernel.lanczos3 })
    .toBuffer();

  composites.push({
    input: resized,
    left: col * tileW,
    top: row * tileH,
  });
  console.log(`  ${file} → (${col * tileW}, ${row * tileH})`);
}

// Create atlas
await sharp({
  create: {
    width: atlasW,
    height: atlasH,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 255 },
  },
})
  .composite(composites)
  .png({ compressionLevel: 6 })
  .toFile(outputFile);

console.log(`✅ Atlas saved: ${outputFile} (${atlasW}×${atlasH})`);
