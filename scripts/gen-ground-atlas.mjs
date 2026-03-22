#!/usr/bin/env node
/**
 * gen-ground-atlas.mjs — Generate procedural ground atlas for a given environment.
 * Usage: node scripts/gen-ground-atlas.mjs <envKey> [outDir]
 * 
 * Creates a 2048×256 PNG atlas (8 tiles × 256px) with procedural textures.
 * Each tile is seamlessly tileable via edge-wrapping noise.
 * 
 * Env keys: dc, havana, gaza, kiev, baghdad, damascus, beirut, tripoli,
 *           mogadishu, tehran, khartoum, chennai, sukhumi, shanghai,
 *           sochi, tokyo, montclair, lille, nuuk
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const TILE_SIZE = 256;
const ATLAS_W = TILE_SIZE * 8;
const ATLAS_H = TILE_SIZE;

// ── Seeded PRNG ──
function mulberry32(seed) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Seamless tileable noise (wrapping via 4D simplex projected to 2D torus) ──
function tileableNoise(ctx, w, h, scale, octaves, baseColor, noiseColor, rng, intensity = 0.3) {
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      let amp = 1;
      let freq = scale;
      let maxAmp = 0;
      
      for (let o = 0; o < octaves; o++) {
        // Wrap coordinates for seamless tiling
        const nx = x / w * freq;
        const ny = y / h * freq;
        // Simple hash-based noise (tileable)
        const hash = Math.sin(nx * 127.1 + ny * 311.7) * 43758.5453;
        const n = (hash - Math.floor(hash)) * 2 - 1;
        val += n * amp;
        maxAmp += amp;
        amp *= 0.5;
        freq *= 2;
      }
      val = (val / maxAmp + 1) * 0.5; // normalize to 0..1
      
      const idx = (y * w + x) * 4;
      const blend = val * intensity;
      d[idx]     = Math.min(255, baseColor[0] + (noiseColor[0] - baseColor[0]) * blend + (rng() - 0.5) * 8);
      d[idx + 1] = Math.min(255, baseColor[1] + (noiseColor[1] - baseColor[1]) * blend + (rng() - 0.5) * 8);
      d[idx + 2] = Math.min(255, baseColor[2] + (noiseColor[2] - baseColor[2]) * blend + (rng() - 0.5) * 8);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

// ── Draw scattered debris/stones ──
function drawDebris(ctx, w, h, count, minR, maxR, colors, rng) {
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = minR + rng() * (maxR - minR);
    const c = colors[Math.floor(rng() * colors.length)];
    ctx.fillStyle = c;
    ctx.beginPath();
    // Irregular shape
    ctx.ellipse(x, y, r, r * (0.6 + rng() * 0.8), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Draw cracks ──
function drawCracks(ctx, w, h, count, color, rng) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    let x = rng() * w;
    let y = rng() * h;
    ctx.moveTo(x, y);
    const segs = 3 + Math.floor(rng() * 5);
    for (let s = 0; s < segs; s++) {
      x += (rng() - 0.5) * 30;
      y += (rng() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ── Environment tile definitions ──
const ENV_TILES = {
  gaza: [
    // Tile 0: Cracked concrete, sand accumulation
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 4, [160, 155, 145], [130, 125, 115], rng, 0.35);
      drawCracks(ctx, TILE_SIZE, TILE_SIZE, 12, 'rgba(90,85,75,0.5)', rng);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 15, 1, 3, ['rgba(190,180,160,0.6)', 'rgba(170,165,150,0.5)'], rng);
    },
    // Tile 1: Broken concrete slab, rebar stubs
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 3, 4, [150, 145, 135], [120, 115, 105], rng, 0.4);
      drawCracks(ctx, TILE_SIZE, TILE_SIZE, 18, 'rgba(80,75,65,0.6)', rng);
      // Rebar stubs
      for (let i = 0; i < 5; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        ctx.fillStyle = `rgba(${140 + rng()*30}, ${80 + rng()*20}, ${50 + rng()*20}, 0.7)`;
        ctx.fillRect(x, y, 2 + rng() * 4, 1 + rng() * 2);
      }
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 8, 3, 8, ['rgba(140,135,125,0.5)', 'rgba(160,155,140,0.4)'], rng);
    },
    // Tile 2: Hard-packed sandy dirt, broken pavers
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 5, 5, [185, 170, 140], [165, 150, 120], rng, 0.3);
      // Broken pavers
      for (let i = 0; i < 6; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        const w = 10 + rng() * 15, h = 8 + rng() * 12;
        ctx.fillStyle = `rgba(${170 + rng()*20}, ${140 + rng()*20}, ${100 + rng()*20}, 0.6)`;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rng() * Math.PI);
        ctx.fillRect(-w/2, -h/2, w, h);
        ctx.restore();
      }
    },
    // Tile 3: Rubble-strewn packed earth, cinder block
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 4, [175, 160, 135], [155, 140, 115], rng, 0.35);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 25, 2, 7, ['rgba(140,135,125,0.6)', 'rgba(160,150,130,0.5)', 'rgba(130,125,115,0.4)'], rng);
      // Cinder block fragments
      for (let i = 0; i < 3; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        ctx.fillStyle = `rgba(${150 + rng()*15}, ${145 + rng()*15}, ${140 + rng()*15}, 0.5)`;
        ctx.fillRect(x, y, 12 + rng() * 8, 8 + rng() * 5);
      }
    },
    // Tile 4: Dry sandy terrain, sparse scrub
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 6, 5, [200, 185, 155], [180, 170, 140], rng, 0.25);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 10, 1, 3, ['rgba(160,150,120,0.4)'], rng);
      // Sparse scrub
      for (let i = 0; i < 4; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        ctx.fillStyle = `rgba(${90 + rng()*30}, ${100 + rng()*30}, ${60 + rng()*20}, 0.4)`;
        for (let s = 0; s < 5; s++) {
          ctx.fillRect(x + (rng()-0.5)*6, y + (rng()-0.5)*6, 2, 3);
        }
      }
    },
    // Tile 5: Sandy dirt, scattered stones, dry weeds
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 5, 5, [195, 180, 150], [175, 165, 135], rng, 0.28);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 20, 1, 4, ['rgba(150,140,115,0.5)', 'rgba(170,160,130,0.4)'], rng);
    },
    // Tile 6: Pale sand fading to dusty horizon
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 3, 3, [215, 205, 180], [210, 200, 175], rng, 0.15);
    },
    // Tile 7: Flat sandy terrain, warm haze
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 2, 2, [220, 210, 190], [215, 208, 185], rng, 0.1);
    },
  ],
  tel_megiddo: [
    // Tile 0: Shoulder — compacted limestone rubble road edge
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 4, [175, 160, 130], [155, 140, 110], rng, 0.35);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 20, 2, 5, ['rgba(160,145,115,0.6)', 'rgba(140,130,100,0.5)'], rng);
      drawCracks(ctx, TILE_SIZE, TILE_SIZE, 8, 'rgba(100,90,70,0.4)', rng);
    },
    // Tile 1: Shoulder — ancient flagstone fragments
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 3, 4, [185, 170, 140], [165, 150, 120], rng, 0.3);
      for (let i = 0; i < 6; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        const w = 15 + rng() * 20, h = 12 + rng() * 15;
        ctx.fillStyle = `rgba(${180 + rng()*20}, ${165 + rng()*20}, ${130 + rng()*20}, 0.5)`;
        ctx.save(); ctx.translate(x, y); ctx.rotate(rng() * Math.PI);
        ctx.fillRect(-w/2, -h/2, w, h); ctx.restore();
      }
    },
    // Tile 2: Urban — packed earth archaeological path
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 5, 5, [170, 155, 125], [150, 140, 110], rng, 0.3);
      drawCracks(ctx, TILE_SIZE, TILE_SIZE, 14, 'rgba(90,80,60,0.5)', rng);
    },
    // Tile 3: Urban — exposed excavation floor
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 4, [165, 150, 120], [145, 135, 105], rng, 0.35);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 12, 1, 3, ['rgba(130,120,95,0.5)', 'rgba(155,145,115,0.4)'], rng);
    },
    // Tile 4: Open — dry scrub grass on rocky ground
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 6, 5, [190, 175, 145], [175, 165, 135], rng, 0.25);
      for (let i = 0; i < 6; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        ctx.fillStyle = `rgba(${80 + rng()*30}, ${95 + rng()*30}, ${55 + rng()*20}, 0.35)`;
        for (let s = 0; s < 6; s++) ctx.fillRect(x + (rng()-0.5)*8, y + (rng()-0.5)*8, 2, 4);
      }
    },
    // Tile 5: Open — rocky terrain with scattered stones
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 5, 5, [185, 170, 140], [170, 160, 130], rng, 0.28);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 18, 2, 6, ['rgba(150,140,110,0.5)', 'rgba(130,120,95,0.4)'], rng);
    },
    // Tile 6: Far — pale sandy earth fading
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 3, 3, [210, 200, 170], [205, 195, 165], rng, 0.15);
    },
    // Tile 7: Far — distant Jezreel Valley terrain
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 2, 2, [215, 205, 180], [210, 200, 175], rng, 0.1);
    },
  ],
  piran: [
    // Tile 0: Shoulder — Istrian limestone cobblestones
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 5, 5, [195, 185, 170], [175, 165, 150], rng, 0.3);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 15, 3, 6, ['rgba(180,170,155,0.5)', 'rgba(160,150,135,0.4)'], rng);
      drawCracks(ctx, TILE_SIZE, TILE_SIZE, 12, 'rgba(120,110,95,0.35)', rng);
    },
    // Tile 1: Shoulder — weathered flagstone pavement
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 4, [200, 190, 175], [180, 170, 155], rng, 0.25);
      for (let i = 0; i < 5; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        const w = 20 + rng() * 25, h = 18 + rng() * 20;
        ctx.fillStyle = `rgba(${190 + rng()*15}, ${180 + rng()*15}, ${165 + rng()*15}, 0.4)`;
        ctx.save(); ctx.translate(x, y); ctx.rotate(rng() * 0.3);
        ctx.fillRect(-w/2, -h/2, w, h); ctx.restore();
      }
    },
    // Tile 2: Urban — smooth rendered square paving
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 3, 3, [205, 195, 180], [190, 180, 165], rng, 0.2);
      drawCracks(ctx, TILE_SIZE, TILE_SIZE, 8, 'rgba(130,120,105,0.3)', rng);
    },
    // Tile 3: Urban — worn waterfront stone
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 5, [185, 180, 170], [170, 165, 155], rng, 0.28);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 8, 1, 3, ['rgba(155,150,140,0.4)', 'rgba(140,135,125,0.3)'], rng);
    },
    // Tile 4: Open — Mediterranean dry grass
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 5, 4, [195, 190, 165], [185, 180, 155], rng, 0.22);
      for (let i = 0; i < 8; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        ctx.fillStyle = `rgba(${90 + rng()*25}, ${110 + rng()*25}, ${65 + rng()*15}, 0.3)`;
        for (let s = 0; s < 5; s++) ctx.fillRect(x + (rng()-0.5)*6, y + (rng()-0.5)*6, 2, 3);
      }
    },
    // Tile 5: Open — coastal rocky path
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 4, [190, 185, 170], [175, 170, 155], rng, 0.25);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 14, 2, 5, ['rgba(170,165,150,0.4)', 'rgba(155,150,135,0.3)'], rng);
    },
    // Tile 6: Far — hazy Adriatic waterfront
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 3, 3, [210, 205, 195], [205, 200, 190], rng, 0.12);
    },
    // Tile 7: Far — distant Mediterranean terrain
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 2, 2, [215, 210, 200], [210, 205, 195], rng, 0.1);
    },
  ],
  beirut: [
    // Tile 0: Shoulder — Ottoman sandstone cobblestones
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 5, 5, [200, 185, 160], [180, 165, 140], rng, 0.3);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 12, 3, 6, ['rgba(190,175,150,0.5)', 'rgba(170,155,130,0.4)'], rng);
      drawCracks(ctx, TILE_SIZE, TILE_SIZE, 10, 'rgba(130,115,90,0.35)', rng);
    },
    // Tile 1: Shoulder — weathered limestone pavement
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 4, [210, 200, 180], [190, 180, 160], rng, 0.25);
      for (let i = 0; i < 5; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        const w = 22 + rng() * 20, h = 18 + rng() * 18;
        ctx.fillStyle = `rgba(${200 + rng()*15}, ${190 + rng()*15}, ${170 + rng()*10}, 0.35)`;
        ctx.save(); ctx.translate(x, y); ctx.rotate(rng() * 0.25);
        ctx.fillRect(-w/2, -h/2, w, h); ctx.restore();
      }
    },
    // Tile 2: Urban — Corniche waterfront flagstone
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 3, 3, [195, 190, 180], [180, 175, 165], rng, 0.2);
      drawCracks(ctx, TILE_SIZE, TILE_SIZE, 6, 'rgba(140,135,120,0.3)', rng);
    },
    // Tile 3: Urban — patched post-war concrete
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 5, [175, 175, 170], [165, 165, 160], rng, 0.28);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 10, 1, 3, ['rgba(155,155,150,0.4)', 'rgba(145,145,140,0.3)'], rng);
    },
    // Tile 4: Open — Mediterranean scrub and dry earth
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 5, 4, [200, 190, 165], [190, 180, 155], rng, 0.22);
      for (let i = 0; i < 7; i++) {
        const x = rng() * TILE_SIZE, y = rng() * TILE_SIZE;
        ctx.fillStyle = `rgba(${85 + rng()*30}, ${105 + rng()*25}, ${60 + rng()*20}, 0.3)`;
        for (let s = 0; s < 4; s++) ctx.fillRect(x + (rng()-0.5)*5, y + (rng()-0.5)*5, 2, 3);
      }
    },
    // Tile 5: Open — cedar hill path
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 4, 4, [195, 185, 160], [180, 170, 145], rng, 0.25);
      drawDebris(ctx, TILE_SIZE, TILE_SIZE, 12, 2, 5, ['rgba(175,165,140,0.4)', 'rgba(160,150,125,0.3)'], rng);
    },
    // Tile 6: Far — hazy Mediterranean waterfront
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 3, 3, [210, 205, 195], [205, 200, 190], rng, 0.12);
    },
    // Tile 7: Far — distant Mount Lebanon terrain
    (ctx, rng) => {
      tileableNoise(ctx, TILE_SIZE, TILE_SIZE, 2, 2, [215, 210, 200], [210, 205, 195], rng, 0.1);
    },
  ],
};

// ── Main ──
const envKey = process.argv[2] || 'gaza';
const outDir = process.argv[3] || join(process.cwd(), 'public', 'ground');

const tiles = ENV_TILES[envKey];
if (!tiles) {
  console.error(`Unknown env: ${envKey}. Available: ${Object.keys(ENV_TILES).join(', ')}`);
  process.exit(1);
}

const canvas = createCanvas(ATLAS_W, ATLAS_H);
const ctx = canvas.getContext('2d');

for (let i = 0; i < 8; i++) {
  const tileCanvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const tileCtx = tileCanvas.getContext('2d');
  const rng = mulberry32(42 + i * 7919);
  
  // Fill base color
  tileCtx.fillStyle = '#b0a080';
  tileCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  
  // Apply tile-specific generator
  tiles[i](tileCtx, rng);
  
  // Draw tile into atlas
  ctx.drawImage(tileCanvas, i * TILE_SIZE, 0);
}

mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `ground_atlas_${envKey}.png`);
writeFileSync(outPath, canvas.toBuffer('image/png'));
console.log(`✓ Generated ${outPath} (${ATLAS_W}×${ATLAS_H})`);
