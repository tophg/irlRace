/**
 * Generate emissive mask and normal map from hi-res diffuse tile images.
 * 
 * EMISSIVE MASK:
 *   - Rows 0-3 are window tiles. The shader checks emissiveColor.r > 0.3
 *     and only enables emissive glow + interior mapping when that's true.
 *   - Row 2 (lit windows) → bright warm glow (luminance-based window detection)
 *   - Rows 0, 1 (curtains, blinds) → faint warm glow (slightly visible light edges)
 *   - Row 3 (dark windows) → very faint cool glow (ambient reflections)
 *   - Rows 4-7 (wall/ground/cornice/roof) → pure black (no glow)
 * 
 * NORMAL MAP:
 *   - Convert each tile to grayscale (height map)
 *   - Apply 3×3 Sobel operator to compute surface gradients
 *   - Encode as tangent-space normal: N = normalize(-dX, -dY, strength)
 *   - Remap [-1,1] → [0,255]: R = (nx+1)*127.5, G = (ny+1)*127.5, B = (nz+1)*127.5
 *   - Flat surface = (128, 128, 255) which is the purple/blue default
 * 
 * Usage: node scripts/gen-emissive-normal.mjs <tiles_dir> <output_emissive> <output_normal>
 */
import { readdir } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';

const [,, tilesDir, outEmissive, outNormal] = process.argv;
if (!tilesDir || !outEmissive || !outNormal) {
  console.error('Usage: node scripts/gen-emissive-normal.mjs <tiles_dir> <output_emissive> <output_normal>');
  process.exit(1);
}

// Must match stitch-atlas.mjs: 8×5 grid in 4096×4096 POT canvas
// Each tile cell is 512×819 (non-square, stretched to fill)
const GRID_COLS = 8;
const GRID_ROWS = 5;
const ATLAS_SIZE = 4096;
const TILE_W = Math.floor(ATLAS_SIZE / GRID_COLS);  // 512
const TILE_H = Math.floor(ATLAS_SIZE / GRID_ROWS);  // 819
// Internal processing size (square, for Sobel etc)
const PROC_SIZE = 512;

console.log(`Generating ${ATLAS_SIZE}×${ATLAS_SIZE} emissive mask and normal map from ${tilesDir}`);

// Read all tile images
const files = await readdir(tilesDir);
const tileFiles = files.filter(f => /^r\d+_c\d+\.png$/.test(f)).sort();
console.log(`Found ${tileFiles.length} tiles`);

// ── Helper: Luminance from RGB ──
function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ── Helper: Generate emissive tile from diffuse ──
// Uses luminance thresholding to detect bright/lit regions (glass areas)
// and paints them with warm window glow color
async function generateEmissiveTile(tileBuffer, row) {
  // Get raw RGBA pixel data
  const { data, info } = await sharp(tileBuffer)
    .resize(PROC_SIZE, PROC_SIZE, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  const w = info.width, h = info.height;
  const outBuf = Buffer.alloc(w * h * 3); // RGB output

  // Atlas row layout (5-row format):
  //   Row 0: Windows — full warm glow
  //   Row 1: Wall pier — no windows, no glow
  //   Row 2: Ground floor — faint storefront glow
  //   Row 3: Transition band — decorative, no glow
  //   Row 4: Roof cap — no glow

  // Rows with no emissive — return black
  if (row === 1 || row === 3 || row >= 4) {
    return outBuf;
  }

  // Glow color and intensity per row
  const glowConfigs = {
    0: { r: 255, g: 204, b: 102, absThreshold: 220, intensity: 1.00 }, // Row 0: windows — only very bright highlights
    2: { r: 255, g: 200, b: 100, absThreshold: 230, intensity: 0.25 }, // Row 2: ground floor — only brightest spots
  };
  const config = glowConfigs[row];

  // Step 1: Compute luminance for each pixel
  const lumMap = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    lumMap[i] = luminance(data[idx], data[idx + 1], data[idx + 2]);
  }

  // Step 2: Use absolute luminance threshold
  // Only genuinely bright pixels (glass reflections, light patches) trigger glow
  // This prevents uniform gray/beige concrete from being entirely emissive
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const lum = lumMap[i];
      
      let glowFactor = 0;
      if (lum > config.absThreshold) {
        // Soft ramp over 30 luminance units
        glowFactor = Math.min(1, (lum - config.absThreshold) / 30);
      }

      // Spatial weighting: windows tend to be in center of tile, not edges
      // This prevents stone texture highlights at edges from being marked as emissive
      const cx = (x / w - 0.5) * 2; // -1 to 1
      const cy = (y / h - 0.5) * 2;
      const edgeDist = Math.max(Math.abs(cx), Math.abs(cy));
      const spatialWeight = edgeDist < 0.75 ? 1.0 : 
                            edgeDist < 0.92 ? 1.0 - (edgeDist - 0.75) / 0.17 : 0.0;
      
      glowFactor *= spatialWeight * config.intensity;
      
      const outIdx = i * 3;
      outBuf[outIdx]     = Math.round(config.r * glowFactor);
      outBuf[outIdx + 1] = Math.round(config.g * glowFactor);
      outBuf[outIdx + 2] = Math.round(config.b * glowFactor);
    }
  }

  return outBuf;
}

// ── Helper: Generate normal map tile from diffuse using 3×3 Sobel ──
async function generateNormalTile(tileBuffer) {
  // Get grayscale data (used as height map)
  const grayData = await sharp(tileBuffer)
    .resize(PROC_SIZE, PROC_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  
  const w = PROC_SIZE, h = PROC_SIZE;
  const normalBuf = Buffer.alloc(PROC_SIZE * PROC_SIZE * 3); // RGB output
  
  // Sobel strength: controls depth of normal map effect
  // Higher = flatter appearance, lower = more pronounced bumps
  // The existing normal map looks moderately detailed, ~1.5-2.0 range
  const strength = 1.5;
  
  // Helper to sample height map with clamping
  const sample = (x, y) => {
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(0, Math.min(h - 1, y));
    return grayData[y * w + x] / 255.0;
  };
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 3×3 Sobel kernel for X gradient:
      // [-1  0  1]
      // [-2  0  2]
      // [-1  0  1]
      const dX = (
        -1 * sample(x-1, y-1) + 1 * sample(x+1, y-1) +
        -2 * sample(x-1, y  ) + 2 * sample(x+1, y  ) +
        -1 * sample(x-1, y+1) + 1 * sample(x+1, y+1)
      );
      
      // 3×3 Sobel kernel for Y gradient:
      // [-1 -2 -1]
      // [ 0  0  0]
      // [ 1  2  1]
      const dY = (
        -1 * sample(x-1, y-1) + -2 * sample(x, y-1) + -1 * sample(x+1, y-1) +
         1 * sample(x-1, y+1) +  2 * sample(x, y+1) +  1 * sample(x+1, y+1)
      );
      
      // Construct tangent-space normal vector
      // N = normalize(-dX, -dY, 1/strength)
      const nx = -dX;
      const ny = -dY;
      const nz = 1.0 / strength;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      
      // Remap from [-1,1] to [0,255]
      const outIdx = (y * w + x) * 3;
      normalBuf[outIdx]     = Math.round(((nx / len) * 0.5 + 0.5) * 255); // R = X
      normalBuf[outIdx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255); // G = Y
      normalBuf[outIdx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255); // B = Z
    }
  }
  
  return normalBuf;
}

// ── Process all tiles ──
const emissiveComposites = [];
const normalComposites = [];

for (const file of tileFiles) {
  const match = file.match(/r(\d+)_c(\d+)\.png/);
  if (!match) continue;
  const row = parseInt(match[1], 10);
  const col = parseInt(match[2], 10);
  const x = col * TILE_W;
  const y = row * TILE_H;

  const filePath = join(tilesDir, file);
  const tileBuffer = await sharp(filePath).png().toBuffer();

  // Generate emissive tile (process at PROC_SIZE, resize to TILE_W×TILE_H for atlas)
  const emissiveRaw = await generateEmissiveTile(tileBuffer, row);
  const emissivePng = await sharp(emissiveRaw, { raw: { width: PROC_SIZE, height: PROC_SIZE, channels: 3 } })
    .resize(TILE_W, TILE_H, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  emissiveComposites.push({ input: emissivePng, left: x, top: y });

  // Generate normal map tile (process at PROC_SIZE, resize to TILE_W×TILE_H for atlas)
  const normalRaw = await generateNormalTile(tileBuffer);
  const normalPng = await sharp(normalRaw, { raw: { width: PROC_SIZE, height: PROC_SIZE, channels: 3 } })
    .resize(TILE_W, TILE_H, { kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  normalComposites.push({ input: normalPng, left: x, top: y });

  const rowType = ['window', 'wall_pier', 'ground', 'transition', 'roof'][row] ?? 'unknown';
  console.log(`  ${file} → (${x}, ${y}) [${rowType}]`);
}

// ── Assemble emissive atlas ──
console.log('\\nAssembling emissive mask atlas...');
const emissiveBase = await sharp({
  create: { width: ATLAS_SIZE, height: ATLAS_SIZE, channels: 3, background: { r: 0, g: 0, b: 0 } }
}).png().toBuffer();

await sharp(emissiveBase)
  .composite(emissiveComposites)
  .toFile(outEmissive);
console.log(`✅ Emissive mask saved: ${outEmissive} (${ATLAS_SIZE}×${ATLAS_SIZE})`);

// ── Assemble normal map atlas ──
console.log('Assembling normal map atlas...');
// Base = flat normal (128, 128, 255)
const normalBase = await sharp({
  create: { width: ATLAS_SIZE, height: ATLAS_SIZE, channels: 3, background: { r: 128, g: 128, b: 255 } }
}).png().toBuffer();

await sharp(normalBase)
  .composite(normalComposites)
  .toFile(outNormal);
console.log(`✅ Normal map saved: ${outNormal} (${ATLAS_SIZE}×${ATLAS_SIZE})`);
