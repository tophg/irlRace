#!/usr/bin/env node
// Stitch 8 ground tiles horizontally into 2048×256 atlas
// Layout: [ShoulderA][ShoulderB][UrbanA][UrbanB][OpenA][OpenB][FarA][FarB]
import sharp from 'sharp';

const TILE = 256;
const tiles = [
  '/tmp/gaza_ground_v3/t0a.png',  // Shoulder A
  '/tmp/gaza_ground_v3/t0b.png',  // Shoulder B
  '/tmp/gaza_ground_v3/t1a.png',  // Urban A
  '/tmp/gaza_ground_v3/t1b.png',  // Urban B
  '/tmp/gaza_ground_v3/t2a.png',  // Open A
  '/tmp/gaza_ground_v3/t2b.png',  // Open B
  '/tmp/gaza_ground_v3/t3a.png',  // Far A
  '/tmp/gaza_ground_v3/t3b.png',  // Far B
];

const composites = [];
for (let i = 0; i < tiles.length; i++) {
  const buf = await sharp(tiles[i]).resize(TILE, TILE, { kernel: sharp.kernel.lanczos3 }).toBuffer();
  composites.push({ input: buf, left: i * TILE, top: 0 });
}

await sharp({ create: { width: TILE * 8, height: TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } } })
  .composite(composites)
  .png({ compressionLevel: 6 })
  .toFile('/Users/devnull/irlRace/public/ground/ground_atlas_gaza.png');

console.log('✅ ground_atlas_gaza.png (2048×256)');
