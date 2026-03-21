#!/usr/bin/env node
// Stitch 8 ground tiles horizontally into 2048×256 atlas
// Usage: node scripts/stitch-ground.mjs <tiles_dir> <output_file>
//
// Input directory should contain 8 tile images named t0.png through t7.png
// (or any 8 .png files — they're sorted alphabetically and placed left-to-right).
// Layout: [ShoulderA][ShoulderB][UrbanA][UrbanB][OpenA][OpenB][FarA][FarB]

import sharp from 'sharp';
import { readdir } from 'fs/promises';
import { join } from 'path';

const inputDir = process.argv[2];
const outputFile = process.argv[3];

if (!inputDir || !outputFile) {
  console.error('Usage: node scripts/stitch-ground.mjs <tiles_dir> <output_file>');
  console.error('  e.g. node scripts/stitch-ground.mjs /tmp/ground_tiles/shanghai public/ground/ground_atlas_shanghai.png');
  process.exit(1);
}

const TILE = 256;
const TILE_COUNT = 8;

// Find tile images (sorted alphabetically)
const files = await readdir(inputDir);
const tileFiles = files.filter(f => /\.png$/i.test(f)).sort();

if (tileFiles.length < TILE_COUNT) {
  console.error(`Expected ${TILE_COUNT} .png files in ${inputDir}, found ${tileFiles.length}`);
  process.exit(1);
}

console.log(`Stitching ${TILE_COUNT} tiles from ${inputDir} → ${outputFile}`);

const composites = [];
for (let i = 0; i < TILE_COUNT; i++) {
  const filePath = join(inputDir, tileFiles[i]);
  const buf = await sharp(filePath).resize(TILE, TILE, { kernel: sharp.kernel.lanczos3 }).toBuffer();
  composites.push({ input: buf, left: i * TILE, top: 0 });
  console.log(`  [${i}] ${tileFiles[i]}`);
}

await sharp({
  create: { width: TILE * TILE_COUNT, height: TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } },
})
  .composite(composites)
  .png({ compressionLevel: 6 })
  .toFile(outputFile);

console.log(`✅ ${outputFile} (${TILE * TILE_COUNT}×${TILE})`);
