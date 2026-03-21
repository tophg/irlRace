#!/usr/bin/env node
/**
 * gen-modiin-illit-tiles.mjs — Generate all 40 diffuse facade tiles for Modi'in Illit
 * using the Nano Banana 2 (Gemini 3.1 Flash Image) API.
 *
 * REFERENCE IMAGE FEEDBACK: For each column, row 0 (windows) is generated first.
 * That tile is then passed as a --ref image when generating rows 1-4, ensuring
 * material, color, and style continuity across all elements of the same building style.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-modiin-illit-tiles.mjs [type]
 *   type: 'diffuse' (default)
 *
 * Output: /tmp/modiin_illit_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/modiin_illit_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Modi'in Illit architectural archetypes — Israeli Haredi city) ──
// Research: Jerusalem stone facades, 3-4 story walk-ups, sukkah balconies,
// terraced hillside layout, painted concrete on side streets, some taller buildings
const COL_STYLES = [
  'Israeli residential apartment building, cream-gold Jerusalem stone cladding facade with uniform rectangular windows and sukkah balconies, typical Israeli settlement style, Modi\'in Illit West Bank, 4-story walk-up',
  'Israeli residential building, pale beige Jerusalem stone facade with arched window frames and wrought iron balcony railings, classical Israeli neo-Oriental style, Middle Eastern residential',
  'Israeli apartment block, warm golden Jerusalem stone facade with deeply recessed windows and small balconies with metal railings, Mediterranean Israeli residential style',
  'Israeli residential tower, light cream painted concrete facade with uniform metal-framed windows and air conditioning units visible, modern Israeli mass housing, 6-8 story building',
  'Israeli apartment building, light pink-beige painted stucco facade with brown-framed windows and terracotta roof tiles visible, typical Israeli suburban residential style',
  'Israeli commercial building, smooth off-white Jerusalem stone ground floor with metal rolling shutters and upper residential floors with stone cladding, mixed-use Israeli building',
  'Israeli residential building, weathered cream limestone facade with green-tinted windows and concrete sukkah balcony extensions, older Israeli construction style, worn but maintained',
  'Israeli institutional building, clean white painted concrete and Jerusalem stone combination facade with wide aluminum-framed windows, modern Israeli public or community building style',
];

// ── Row element descriptions ──
const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows in a row with solid wall surface between them, some with small sukkah-ready balconies, typical Israeli upper story facade',
  'solid wall pier section between windows, showing the building\'s primary material texture (Jerusalem stone, painted concrete, stucco) with subtle joints and surface details, NO windows',
  'ground floor street-level showing an entrance with door frame, lobby entrance with stone surround, Israeli ground floor entry with steps and metal railing',
  'horizontal transition band between floors showing a concrete floor line, stone coping, or painted fascia band between stories',
  'roof cap and parapet showing the top edge of the building: flat concrete roof edge with metal railing, solar water heater visible, Mediterranean roof terrace edge, with clear blue sky above',
];

// ── Type-specific prompt suffixes ──
const TYPE_SUFFIX = {
  diffuse: 'Bright clear sunny Mediterranean day lighting showing realistic material colors, textures, and surface details. Warm Israeli sunlight. Natural stone weathering.',
  emissive: 'NIGHTTIME scene. All windows glow warm yellow/amber from interior lighting. Everything EXCEPT lit window panes must be pure black (#000000). This is an emissive glow mask.',
  normal: 'Normal map texture tile. Flat purple-blue (#8080FF) base. Emboss/relief showing depth of window recesses, stone block joints. NO color, only tangent-space normal map data.',
};

const BASE_PROMPT = 'Seamlessly tileable architectural facade texture tile, 512x512 pixels, perfectly flat orthographic front view with no perspective or vanishing points. Game texture asset, no background, no sky, no ground visible. Left and right edges must tile seamlessly. NO TEXT.';

function runGenerate(prompt, outputPath, refPath) {
  const refArg = refPath && existsSync(refPath) ? `--ref "${refPath}"` : '';
  const cmd = `GEMINI_API_KEY="${API_KEY}" node scripts/nb2-generate.mjs "${prompt.replace(/"/g, '\\"')}" "${outputPath}" ${refArg}`;
  execSync(cmd, { cwd: process.cwd(), stdio: 'inherit', timeout: 60000 });
}

async function generateAll() {
  const suffix = TYPE_SUFFIX[tileType] || TYPE_SUFFIX.diffuse;
  let count = 0;
  const total = 40;

  for (let col = 0; col < 8; col++) {
    const refPath = `${outDir}/r0_c${col}.png`;

    for (let row = 0; row < 5; row++) {
      count++;
      const prompt = `${BASE_PROMPT} ${COL_STYLES[col]}. This tile shows the ${ROW_ELEMENTS[row]}. ${suffix}`;
      const outPath = `${outDir}/r${row}_c${col}.png`;
      const useRef = row > 0 ? refPath : null;

      console.log(`\n[${count}/${total}] r${row}_c${col} ${useRef ? '(with ref)' : '(seed tile)'}`);
      console.log(`  Style: ${COL_STYLES[col].substring(0, 60)}...`);

      try {
        runGenerate(prompt, outPath, useRef);
      } catch (err) {
        console.error(`  ✗ FAILED: ${err.message}`);
        console.log('  ↻ Retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        try {
          runGenerate(prompt, outPath, useRef);
        } catch (err2) {
          console.error(`  ✗ RETRY FAILED: ${err2.message}`);
        }
      }

      if (count < total) await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.log(`\n✅ Done: ${count} tiles in ${outDir}`);
}

generateAll();
