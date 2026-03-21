#!/usr/bin/env node
/**
 * gen-nuuk-tiles.mjs — Generate all 40 diffuse facade tiles for Nuuk
 * using the Nano Banana 2 (Gemini 3.1 Flash Image) API.
 *
 * REFERENCE IMAGE FEEDBACK: For each column, row 0 (windows) is generated first.
 * That tile is then passed as a --ref image when generating rows 1-4, ensuring
 * material, color, and style continuity across all elements of the same building style.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-nuuk-tiles.mjs [type]
 *   type: 'diffuse' (default), 'emissive', 'normal'
 *
 * Output: /tmp/nuuk_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/nuuk_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Nuuk / Arctic Greenlandic architectural archetypes) ──
const COL_STYLES = [
  'Greenlandic colorful wooden house, bright red painted timber cladding with white window frames, traditional Nordic Arctic residential style, small cozy house, Nuuk Greenland',
  'Greenlandic colorful wooden house, bright blue painted timber siding with white trim, traditional Nordic Arctic residential style, weather-beaten but vibrant, Nuuk Greenland',
  'Greenlandic colorful wooden house, bright yellow painted wooden panels with white window frames, traditional Scandinavian-Greenlandic residential style, Nuuk Greenland',
  'Greenlandic colorful wooden house, dark green painted timber cladding with white trim and window frames, traditional Nordic Arctic style, Nuuk Greenland',
  'Modern Greenlandic apartment block, gray concrete and metal cladding with large insulated windows, contemporary Arctic architecture, Nuuk municipal housing style',
  'Modern Greenlandic commercial building, dark corrugated metal cladding with warm-toned wood accent panels, contemporary Arctic institutional style, Nuuk Greenland',
  'Weathered unpainted wooden building, raw gray driftwood-colored timber boards, aged and wind-worn Arctic wooden structure, traditional Greenlandic outbuilding or fish processing shed',
  'Renovated Greenlandic building, warm orange-brown painted wooden siding with modern insulated windows, refreshed traditional Arctic style, Nuuk Greenland',
];

// ── Row element descriptions ──
const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows in a row with solid wall surface between them, typical upper story facade',
  'solid wall pier section between windows, showing the building\'s primary material texture (timber, metal, concrete) with subtle joints and surface details, NO windows',
  'ground floor street-level showing an entrance with door frame, small porch or steps, Arctic-style raised entry, lobby entrance details',
  'horizontal transition band between floors showing a decorative trim board, gutter line, horizontal batten strip, or snow guard rail',
  'roof cap and parapet showing the top edge of the building: roof ridge line, metal roof edge, snow guard, gutter, with clear Arctic sky above',
];

// ── Type-specific prompt suffixes ──
const TYPE_SUFFIX = {
  diffuse: 'Daytime lighting showing realistic material colors, textures, and surface details. Natural weathering and aging appropriate to the Arctic style. Clear winter day light.',
  emissive: 'NIGHTTIME scene. All windows glow warm yellow/amber from interior lighting. Everything EXCEPT lit window panes must be pure black (#000000). This is an emissive glow mask.',
  normal: 'Normal map texture tile. Flat purple-blue (#8080FF) base. Emboss/relief showing depth of window recesses, timber board profiles, cladding joints. NO color, only tangent-space normal map data.',
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
