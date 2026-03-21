#!/usr/bin/env node
// Stitch individual 1024×1024 tile images into 4096×4096 atlas
// Usage: node scripts/stitch-atlas.mjs <input-dir> <output-file> [tile-size]
//
// Input directory should contain files named: r{row}_c{col}.png (e.g., r0_c0.png)
// tile-size defaults to 512 (tiles downscaled from 1024 to 512 for 8×8 = 4096)

import sharp from 'sharp';
import { readdir } from 'fs/promises';
import { join } from 'path';

const inputDir = process.argv[2];
const outputFile = process.argv[3];
const tileSize = parseInt(process.argv[4] || '512', 10);
const gridCols = 8;
const gridRows = 5;

if (!inputDir || !outputFile) {
  console.error('Usage: node scripts/stitch-atlas.mjs <input-dir> <output-file> [tile-size]');
  process.exit(1);
}

const atlasW = gridCols * tileSize;
const atlasH = gridRows * tileSize;

async function main() {
  const files = await readdir(inputDir);
  const tileFiles = files.filter(f => /^r\d+_c\d+\.png$/.test(f));

  console.log(`Found ${tileFiles.length} tile images in ${inputDir}`);
  console.log(`Assembling ${gridCols}×${gridRows} atlas at ${atlasW}×${atlasH} (${tileSize}px per tile)`);

  // Process each tile: resize to tileSize × tileSize
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
      .resize(tileSize, tileSize, { kernel: sharp.kernel.lanczos3 })
      .toBuffer();

    composites.push({
      input: resized,
      left: col * tileSize,
      top: row * tileSize,
    });
    console.log(`  ${file} → (${col * tileSize}, ${row * tileSize})`);
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
}

main().catch(err => { console.error(err); process.exit(1); });
