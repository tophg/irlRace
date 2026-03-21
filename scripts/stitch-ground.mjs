#!/usr/bin/env node
// Stitch 4 ground tiles horizontally into 1024×256 atlas
import sharp from 'sharp';

const TILE = 256;
const tiles = [
  '/tmp/gaza_ground/t0.png',
  '/tmp/gaza_ground/t1.png',
  '/tmp/gaza_ground/t2.png',
  '/tmp/gaza_ground/t3.png',
];

const composites = [];
for (let i = 0; i < tiles.length; i++) {
  const buf = await sharp(tiles[i]).resize(TILE, TILE, { kernel: sharp.kernel.lanczos3 }).toBuffer();
  composites.push({ input: buf, left: i * TILE, top: 0 });
}

await sharp({ create: { width: TILE * 4, height: TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } } })
  .composite(composites)
  .png({ compressionLevel: 6 })
  .toFile('/Users/devnull/irlRace/public/ground/ground_atlas_gaza.png');

console.log('✅ ground_atlas_gaza.png (1024×256)');
