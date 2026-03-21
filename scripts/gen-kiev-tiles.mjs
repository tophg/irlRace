#!/usr/bin/env node
/**
 * gen-kiev-tiles.mjs — Generate all 40 diffuse facade tiles for Kiev
 * using the Nano Banana 2 (Gemini 3.1 Flash Image) API.
 *
 * REFERENCE IMAGE FEEDBACK: For each column, row 0 (windows) is generated first.
 * That tile is then passed as a --ref image when generating rows 1-4, ensuring
 * material, color, and style continuity across all elements of the same building style.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-kiev-tiles.mjs [type]
 *   type: 'diffuse' (default), 'emissive', 'normal'
 *
 * Output: /tmp/kiev_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/kiev_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Kiev / Soviet-bloc architectural archetypes) ──
const COL_STYLES = [
  'Soviet 1960s Khrushchevka apartment block, cream/beige silicate brick facade with standardized small rectangular windows, flat utilitarian design, no ornamentation, pale yellow-beige brick panels, Kiev Ukraine',
  'Soviet 1970s Brezhnevka apartment tower, gray precast concrete panels with visible seams between panels, slightly larger windows, simple rectangular concrete balconies, cold gray concrete with darker grout lines, Soviet Ukraine style',
  'Late Soviet 1980s tower block, large-scale precast concrete slab panels, light gray with subtle blue-gray tint, modernized window frames, uniform grid pattern, clean geometric lines, typical Kiev microrayon',
  'Soviet Stalinist-era building (1940s-50s), yellow ochre stucco facade with classical decorative elements — cornices, pilasters, arched window frames, grander proportions, Khreshchatyk Street Kiev style',
  'Soviet industrial prefabricated building, raw exposed concrete panels with prominent joints and seams, utilitarian dark gray concrete, minimal windows, brutalist aesthetic, dark gray with weather staining',
  'Renovated Soviet apartment block with fresh pastel paint over concrete, light mint green painted facade, same standardized window layout as Soviet panels but with refreshed surface and modern PVC window frames',
  'Soviet-era brown/tan brick apartment building, dark reddish-brown brick with geometric patterns in the brickwork, recessed windows with concrete ledges, warm earthy tones, Podil district Kiev style',
  'Post-Soviet transitional building, off-white/cream plaster facade over concrete panels, some modern window replacements with white PVC frames, slightly cleaner than pure Soviet blocks, mixed old and new elements',
];

// ── Row element descriptions ──
const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows in a row with solid wall surface between them, typical upper story facade',
  'solid wall pier section between windows, showing the building\'s primary material texture (brick, stone, concrete, glass panel) with subtle architectural joints and surface details, NO windows',
  'ground floor street-level showing a storefront entrance with door frame, commercial glass, awning or signage area above, lobby entrance details',
  'horizontal transition band between floors showing a decorative cornice molding, dentil frieze, balcony railing with balustrade, or projecting band course',
  'roof cap and parapet showing the top edge of the building: coping stones, roofline cornice, flat roof membrane edge, or decorative parapet wall',
];

// ── Type-specific prompt suffixes ──
const TYPE_SUFFIX = {
  diffuse: 'Daytime lighting showing realistic material colors, textures, and surface details. Natural weathering and aging appropriate to the Soviet era style.',
  emissive: 'NIGHTTIME scene. All windows glow warm yellow/amber from interior lighting. Everything EXCEPT lit window panes must be pure black (#000000). This is an emissive glow mask.',
  normal: 'Normal map texture tile. Flat purple-blue (#8080FF) base. Emboss/relief showing depth of window recesses, molding profiles, brick mortar lines, stone joints, concrete panel seams. NO color, only tangent-space normal map data.',
};

const BASE_PROMPT = 'Seamlessly tileable architectural facade texture tile, 512x512 pixels, perfectly flat orthographic front view with no perspective or vanishing points. Game texture asset, no background, no sky, no ground visible. Left and right edges must tile seamlessly.';

function runGenerate(prompt, outputPath, refPath) {
  const refArg = refPath && existsSync(refPath) ? `--ref "${refPath}"` : '';
  const cmd = `GEMINI_API_KEY="${API_KEY}" node scripts/nb2-generate.mjs "${prompt.replace(/"/g, '\\"')}" "${outputPath}" ${refArg}`;
  execSync(cmd, { cwd: process.cwd(), stdio: 'inherit', timeout: 60000 });
}

async function generateAll() {
  const suffix = TYPE_SUFFIX[tileType] || TYPE_SUFFIX.diffuse;
  let count = 0;
  const total = 40;

  // Generate column-by-column for reference image continuity
  for (let col = 0; col < 8; col++) {
    const refPath = `${outDir}/r0_c${col}.png`; // row 0 becomes reference for rows 1-4

    for (let row = 0; row < 5; row++) {
      count++;
      const prompt = `${BASE_PROMPT} ${COL_STYLES[col]}. This tile shows the ${ROW_ELEMENTS[row]}. ${suffix}`;
      const outPath = `${outDir}/r${row}_c${col}.png`;
      const useRef = row > 0 ? refPath : null; // use row 0 as reference for rows 1-4

      console.log(`\n[${count}/${total}] r${row}_c${col} ${useRef ? '(with ref)' : '(seed tile)'}`);
      console.log(`  Style: ${COL_STYLES[col].substring(0, 60)}...`);

      try {
        runGenerate(prompt, outPath, useRef);
      } catch (err) {
        console.error(`  ✗ FAILED: ${err.message}`);
        // Retry once after 3s
        console.log('  ↻ Retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        try {
          runGenerate(prompt, outPath, useRef);
        } catch (err2) {
          console.error(`  ✗ RETRY FAILED: ${err2.message}`);
        }
      }

      // Rate limit delay
      if (count < total) await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.log(`\n✅ Done: ${count} tiles in ${outDir}`);
}

generateAll();
