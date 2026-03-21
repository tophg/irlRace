#!/usr/bin/env node
/**
 * NB2 Atlas Tile Generator — Uses Gemini Nano Banana 2 to generate atlas tiles.
 *
 * Usage:
 *   # Generate all 40 facade tiles for DC
 *   GEMINI_API_KEY=... node scripts/nb2-generate.mjs --type facade --env dc --style "Muted gray/beige government district"
 *
 *   # Generate all 8 ground tiles for DC
 *   GEMINI_API_KEY=... node scripts/nb2-generate.mjs --type ground --env dc --style "Washington D.C. — cool gray concrete, dark asphalt"
 *
 *   # Generate a single facade tile (re-do)
 *   GEMINI_API_KEY=... node scripts/nb2-generate.mjs --type facade --env dc --style "..." --row 0 --col 3
 *
 *   # Generate a single ground tile (re-do)
 *   GEMINI_API_KEY=... node scripts/nb2-generate.mjs --type ground --env dc --style "..." --tile 2
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Config ──
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-image-preview'; // Nano Banana 2
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DELAY_MS = 2000; // Rate limit: ~30 req/min

if (!API_KEY) {
  console.error('Error: Set GEMINI_API_KEY environment variable');
  process.exit(1);
}

// ── Parse args ──
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const TYPE = getArg('type'); // 'facade' or 'ground'
const ENV = getArg('env');
const STYLE = getArg('style');
const SINGLE_ROW = getArg('row') !== null ? parseInt(getArg('row')) : null;
const SINGLE_COL = getArg('col') !== null ? parseInt(getArg('col')) : null;
const SINGLE_TILE = getArg('tile') !== null ? parseInt(getArg('tile')) : null;

if (!TYPE || !ENV || !STYLE) {
  console.error('Usage: node scripts/nb2-generate.mjs --type <facade|ground> --env <name> --style "<description>"');
  console.error('Optional: --row N --col N (facade) or --tile N (ground)');
  process.exit(1);
}

// ── Output directory ──
const TILES_DIR = join(homedir(), '.irlrace_atlas_tiles', ENV, TYPE);
mkdirSync(TILES_DIR, { recursive: true });

// ── Prompt Templates ──

const FACADE_ROW_TYPES = [
  { name: 'Window', prompt: 'A building facade showing a row of windows. Shuttered or frosted glass, NO visible interiors, no identifiable details behind glass. Uniform, non-descript, generic windows that tile without exposing repetition. Same material/color across all windows.' },
  { name: 'Wall Pier', prompt: 'A solid, windowless building wall surface. Plain material — brick, concrete, stone, or plaster. Uniform texture with no windows, doors, or openings. Suitable for use as both wall infill and rooftop surface.' },
  { name: 'Ground Floor', prompt: 'A building ground-floor storefront or entrance. Simple door or shop front. NO TEXT, NO SIGNAGE, NO LOGOS, NO LETTERS. Generic, nondescript commercial frontage.' },
  { name: 'Cornice', prompt: 'A horizontal decorative trim/cornice band on a building facade. Molding, ledge, or ornamental horizontal strip. Architectural detail only — no windows, no text.' },
  { name: 'Roof Cap', prompt: 'A building parapet or roof edge, showing the top of the building meeting the sky. Upper wall surface transitioning to open sky above. Include a small strip of sky at the top.' },
];

const GROUND_ZONES = [
  { name: 'Shoulder A', prompt: 'Paved area immediately next to the road — concrete, asphalt edge, curb debris, fine gravel. High detail urban materials.' },
  { name: 'Shoulder B', prompt: 'Alternative paved road shoulder — same color palette as the first, but a different surface pattern. Concrete, asphalt, fine aggregate.' },
  { name: 'Urban A', prompt: 'Transitional ground between road and open terrain — broken pavers, packed dirt, rubble mixed with weeds. Medium detail, mixed urban/natural materials.' },
  { name: 'Urban B', prompt: 'Alternative transitional ground — same palette, different arrangement of materials. Packed earth with scattered debris.' },
  { name: 'Open A', prompt: 'Open terrain ground away from the road — environment-specific natural surface. Medium detail, natural materials dominant.' },
  { name: 'Open B', prompt: 'Alternative open terrain — same environment palette, different natural pattern arrangement.' },
  { name: 'Far A', prompt: 'Distant ground surface — sparse, minimal detail, faded colors. Simple uniform terrain that blends toward horizon fog.' },
  { name: 'Far B', prompt: 'Alternative distant ground — same muted colors, different subtle pattern. Very minimal features.' },
];

function buildFacadePrompt(row, col, style) {
  const rowType = FACADE_ROW_TYPES[row];
  return `Generate a photorealistic building facade tile.
Style: ${style}
Element: ${rowType.name} — ${rowType.prompt}
Column ${col} of 8 (maintain consistent architectural style within this column).

CRITICAL RULES:
- NO TEXT, NO LABELS, NO SIGNAGE, NO LETTERS anywhere in the image
- Bright clear sunny daylight — flat front elevation
- Photorealistic texture suitable for a game building facade
- Seamless edges preferred — generic, uniform, no unique focal points
- Square image, front-facing flat architectural photograph`;
}

function buildGroundPrompt(tileIdx, style) {
  const zone = GROUND_ZONES[tileIdx];
  return `Generate a seamless tileable top-down ground texture, aerial drone view looking straight down.
Zone: ${zone.name} — ${zone.prompt}
Environment: ${style}

CRITICAL RULES:
- NO horizon, NO sky, NO perspective, NO shadows
- Flat even lighting from directly above
- Seamless tileable texture — edges must match when repeated
- Completely generic, uniform distribution — NO distinct features, NO focal points
- 100 tiny pebbles tile better than 3 large rocks
- Photorealistic PBR-quality texture map
- Square image`;
}

// ── API Call ──

async function generateTile(prompt, refImagePath) {
  const url = `${BASE_URL}/models/${MODEL}:generateContent?key=${API_KEY}`;

  const parts = [{ text: prompt }];

  // Optionally include reference image for style consistency
  if (refImagePath && existsSync(refImagePath)) {
    try {
      const imgBuf = readFileSync(refImagePath);
      const b64 = imgBuf.toString('base64');
      // Determine mime type from extension
      const ext = refImagePath.split('.').pop().toLowerCase();
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      parts.unshift({ inlineData: { mimeType: mime, data: b64 } });
    } catch (e) {
      console.warn(`  ⚠️ Could not load ref image: ${e.message}`);
    }
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (json.error) {
    throw new Error(json.error.message);
  }

  const imgPart = json.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!imgPart) {
    const textPart = json.candidates?.[0]?.content?.parts?.find(p => p.text);
    throw new Error(`No image returned. Text: ${textPart?.text?.slice(0, 100) ?? '(empty)'}`);
  }

  return Buffer.from(imgPart.inlineData.data, 'base64');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ──

async function main() {
  console.log(`\n🎨 NB2 Atlas Generator`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Type:  ${TYPE}`);
  console.log(`   Env:   ${ENV}`);
  console.log(`   Style: ${STYLE}`);
  console.log(`   Output: ${TILES_DIR}\n`);

  if (TYPE === 'facade') {
    const rows = SINGLE_ROW !== null ? [SINGLE_ROW] : [0, 1, 2, 3, 4];
    const cols = SINGLE_COL !== null ? [SINGLE_COL] : [0, 1, 2, 3, 4, 5, 6, 7];

    for (const col of cols) {
      // Use first tile of same column as reference for consistency
      const refPath = join(TILES_DIR, `r0_c${col}.png`);

      for (const row of rows) {
        const outFile = join(TILES_DIR, `r${row}_c${col}.png`);

        // Skip existing unless explicitly re-doing a single tile
        if (existsSync(outFile) && SINGLE_ROW === null && SINGLE_COL === null) {
          console.log(`  ⏭️ r${row}_c${col} — exists, skipping`);
          continue;
        }

        const prompt = buildFacadePrompt(row, col, STYLE);
        // Reference: first row of same column (if generating subsequent rows)
        const ref = row > 0 ? refPath : null;

        console.log(`  🖼️ r${row}_c${col} (${FACADE_ROW_TYPES[row].name})...`);
        try {
          const buf = await generateTile(prompt, ref);
          writeFileSync(outFile, buf);
          // Save as JPEG too if the API returned JPEG
          console.log(`  ✅ r${row}_c${col} — ${buf.length} bytes → ${outFile}`);
        } catch (e) {
          console.error(`  ❌ r${row}_c${col} — ${e.message}`);
        }

        await sleep(DELAY_MS);
      }
    }
  } else if (TYPE === 'ground') {
    const tiles = SINGLE_TILE !== null ? [SINGLE_TILE] : [0, 1, 2, 3, 4, 5, 6, 7];

    for (const idx of tiles) {
      const outFile = join(TILES_DIR, `t${idx}.png`);

      if (existsSync(outFile) && SINGLE_TILE === null) {
        console.log(`  ⏭️ t${idx} — exists, skipping`);
        continue;
      }

      const prompt = buildGroundPrompt(idx, STYLE);
      // Reference: previous tile for palette continuity
      const prevRef = idx > 0 ? join(TILES_DIR, `t${idx - 1}.png`) : null;

      console.log(`  🖼️ t${idx} (${GROUND_ZONES[idx].name})...`);
      try {
        const buf = await generateTile(prompt, prevRef);
        writeFileSync(outFile, buf);
        console.log(`  ✅ t${idx} — ${buf.length} bytes → ${outFile}`);
      } catch (e) {
        console.error(`  ❌ t${idx} — ${e.message}`);
      }

      await sleep(DELAY_MS);
    }
  } else {
    console.error(`Unknown type: ${TYPE}. Use --type facade or --type ground`);
    process.exit(1);
  }

  console.log(`\n✅ Done! Tiles saved to ${TILES_DIR}`);
  console.log(`\nNext steps:`);
  if (TYPE === 'facade') {
    console.log(`  1. Review tiles: open ${TILES_DIR}`);
    console.log(`  2. Stitch: node scripts/stitch-atlas.mjs ${TILES_DIR} /tmp/facade_atlas_${ENV}.png`);
    console.log(`  3. Emissive+Normal: node scripts/gen-emissive-normal.mjs ${TILES_DIR} /tmp/facade_atlas_${ENV}_emissive.png /tmp/facade_atlas_${ENV}_normal.png`);
    console.log(`  4. Mobile: sips -z 1024 1024 /tmp/facade_atlas_${ENV}.png --out /tmp/facade_atlas_${ENV}_mobile.png`);
  } else {
    console.log(`  1. Review tiles: open ${TILES_DIR}`);
    console.log(`  2. Stitch: node scripts/stitch-ground.mjs ${TILES_DIR} public/ground/ground_atlas_${ENV}.png`);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
