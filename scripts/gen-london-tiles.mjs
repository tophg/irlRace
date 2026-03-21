#!/usr/bin/env node
/**
 * gen-london-tiles.mjs — Generate all 40 diffuse facade tiles for London
 * using the Nano Banana 2 (Gemini 3.1 Flash Image) API.
 *
 * REFERENCE IMAGE FEEDBACK: For each column, row 0 (windows) is generated first.
 * That tile is then passed as a --ref image when generating rows 1-4, ensuring
 * material, color, and style continuity across all elements of the same building style.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-london-tiles.mjs [type]
 *   type: 'diffuse' (default), 'emissive', 'normal'
 *
 * Output: /tmp/london_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/london_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (London architectural archetypes) ──
// Step 1 research: 8 distinct London building styles
const COL_STYLES = [
  'Georgian London townhouse, cream-yellow London stock brick facade with white painted sash windows, classical proportions, black iron railings, Bloomsbury or Mayfair style',
  'Victorian London terraced house, dark red-brown brick facade with elaborate stone lintels, bay windows, decorative arched details, Kensington or Chelsea style',
  'Edwardian London mansion block, red brick and cream terracotta facade with Arts and Crafts detailing, wide windows with transoms, mansion flat style, Marylebone or Battersea',
  'Post-war London council estate tower block, raw brutalist concrete panel facade with uniform metal-framed windows, utilitarian 1960s social housing, Barbican or Thamesmead style',
  'London Regency stucco townhouse, smooth white painted stucco facade with black iron balcony railings, elegant classical proportions, Belgravia or Notting Hill style',
  'Modern London mixed-use building, glass and steel curtain wall facade with dark metal cladding panels, contemporary Canary Wharf or Kings Cross development style',
  'Victorian London warehouse converted to loft, industrial yellow London stock brick with large arched cast-iron windows, Shoreditch or Bermondsey converted warehouse style',
  'Art Deco London apartment building, smooth cream render facade with geometric stepped details, Crittall-style steel windows with curved corners, 1930s West London or Hampstead style',
];

// ── Row element descriptions ──
const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows in a row with solid wall surface between them, typical upper story facade',
  'solid wall pier section between windows, showing the building\'s primary material texture (brick, stone, stucco, concrete) with subtle joints and surface details, NO windows',
  'ground floor street-level showing an entrance with door frame, porch, or lobby entrance, typical London ground floor with steps or level entry',
  'horizontal transition band between floors showing a decorative string course, cornice moulding, floor line, or horizontal trim band',
  'roof cap and parapet showing the top edge of the building: chimney pots, parapet coping, roof ridge, slate roof edge, with clear sky above',
];

// ── Type-specific prompt suffixes ──
const TYPE_SUFFIX = {
  diffuse: 'Bright clear sunny day lighting showing realistic material colors, textures, and surface details. Natural weathering and aging. British daylight.',
  emissive: 'NIGHTTIME scene. All windows glow warm yellow/amber from interior lighting. Everything EXCEPT lit window panes must be pure black (#000000). This is an emissive glow mask.',
  normal: 'Normal map texture tile. Flat purple-blue (#8080FF) base. Emboss/relief showing depth of window recesses, brick courses, stone joints. NO color, only tangent-space normal map data.',
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
