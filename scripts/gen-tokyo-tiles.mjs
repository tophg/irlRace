#!/usr/bin/env node
/**
 * gen-tokyo-tiles.mjs — Generate all 40 diffuse facade tiles for Tokyo
 * using the Gemini 2.5 Flash Image API.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-tokyo-tiles.mjs [type]
 *
 * Output: /tmp/tokyo_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/tokyo_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Tokyo architectural archetypes) ──
// Research: ceramic tile apartments, concrete, neon signage, glass commercial,
// pencil buildings, machiya wood lattice, brutalist, mixed-use dense urban
const COL_STYLES = [
  'Tokyo apartment building, beige-white ceramic tile facade with small uniform square tiles, regular grid of rectangular windows with metal frames, metal balcony railings at each floor, visible AC units, Japanese residential manshon style, 6-8 story',
  'Tokyo commercial building, grey concrete facade covered in bright neon signage and backlit Japanese text panels in red, yellow and cyan, vertical sign boards between windows, Shibuya-Shinjuku entertainment district nightlife style, dense layered signage',
  'Modern Tokyo glass office tower, blue-grey reflective glass curtain wall facade with thin aluminium mullions creating a regular grid pattern, clean geometric lines, Marunouchi-Shinagawa business district style',
  'Japanese pencil building, extremely narrow 3-4 meter wide facade, light grey concrete and metal cladding with one window per floor, external steel staircase or fire escape, air conditioning compressors, typical Tokyo shotgun-style mixed-use building',
  'Tokyo brutalist concrete residential facade, raw exposed concrete with board-formed texture marks, deeply recessed square windows, minimal decoration, heavy geometric forms, Japanese metabolist-influenced style, similar to Tadao Ando',
  'Traditional Japanese machiya-inspired facade, dark brown-black timber lattice grid (koushi) over warm wood panels, narrow shopfront at ground level with noren curtain, sloped dark tile roof edge, Kyoto-Tokyo heritage infill building',
  'Tokyo mixed-use building, white-cream painted concrete lower floors with shop shutters and small awnings, upper floors with aluminum-framed sliding windows and laundry-hanging balconies, dense urban residential-over-commercial',
  'Tokyo modern residential tower, smooth white or pale grey concrete facade with irregular asymmetric window openings of varying sizes, architectural statement building, contemporary Japanese minimalist style, clean white surfaces',
];

const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows with surrounds, solid wall surface between them, air conditioning units, typical upper story for this style',
  'solid wall pier section between windows, showing the building\'s primary material texture (ceramic tiles, raw concrete, glass panels, timber lattice) with subtle details, NO windows',
  'ground floor street-level showing a shop entrance with shutters, doorway, or residential entry with post boxes, typical Japanese ground level detail',
  'horizontal transition band between floors showing a floor slab edge, rain gutter line, signage band, or balcony railing between stories',
  'roof cap and top edge showing the roofline: flat concrete parapet with water tank, AC equipment, or traditional dark tile roof edge against grey sky',
];

const TYPE_SUFFIX = {
  diffuse: 'Overcast soft diffused light typical of Tokyo, realistic material colors and textures. Urban patina, slight weathering, realistic Japanese city atmosphere.',
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
        try { runGenerate(prompt, outPath, useRef); } catch (err2) { console.error(`  ✗ RETRY FAILED: ${err2.message}`); }
      }
      if (count < total) await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.log(`\n✅ Done: ${count} tiles in ${outDir}`);
}

generateAll();
