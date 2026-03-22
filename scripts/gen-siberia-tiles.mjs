#!/usr/bin/env node
/**
 * gen-siberia-tiles.mjs — Generate all 40 diffuse facade tiles for Siberia
 * using the Gemini 2.5 Flash Image API.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-siberia-tiles.mjs [type]
 *
 * Output: /tmp/siberia_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/siberia_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Siberian architectural archetypes) ──
// Research: khrushchyovka panels, wooden izba carvings, Stalinist neoclassical,
// brezhnevka enclosed balconies, industrial brutalism, brick residential
const COL_STYLES = [
  'Soviet khrushchyovka concrete panel building, grey-beige precast concrete slab facade with regular grid of small double-paned windows, minimal ornamentation, functional 5-story mass housing, visible panel seams and joints, typical 1960s Siberian city',
  'Soviet brezhnevka apartment block, light grey or cream concrete panel facade with rows of enclosed glazed balconies (haphazardly different frames), 9-story residential building, slightly larger windows than khrushchyovka, metal railings visible',
  'Stalinist neoclassical Siberian apartment, faded pastel yellow or pale green rendered masonry facade with white decorative cornices, pilasters, arched window headers, ornamental stucco mouldings between floors, grand 4-5 story proportions',
  'Traditional Siberian wooden izba facade, dark brown weathered horizontal log wall with highly ornate carved window surrounds (nalichniki) painted turquoise-blue, peaked wooden gable details, 1-2 story traditional log house',
  'Siberian red brick residential building, dark red-brown fired brick facade with visible mortar joints, rectangular windows with concrete lintels, simple concrete balconies, functional Soviet-era 5-story brick apartment',
  'Siberian silicate white brick apartment, pale grey-white silicate brick facade with regular small windows, minimal decoration, functional concrete balconies with metal railings, typical 1970s-80s 9-story residential',
  'Soviet brutalist institutional building, raw exposed concrete facade with bold geometric forms, deeply recessed windows in rhythmic pattern, massive concrete overhang or canopy, monumental 1970s Siberian government or cultural building',
  'Modern Siberian commercial building, contemporary glass and metal composite panel facade, clean lines, aluminium-framed curtain wall, bright signage panels, contrasting with older Soviet surroundings, new construction in Novosibirsk style',
];

const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows with surrounds or glazed balconies, solid wall surface between them, typical upper story for this style',
  'solid wall pier section between windows, showing the building\'s primary material texture (concrete panels, log wall, brick, glass) with subtle details, NO windows',
  'ground floor street-level showing an entrance doorway, shop front, or ground floor detail, typical Siberian ground level',
  'horizontal transition band between floors showing a concrete floor slab edge, decorative cornice band, or panel joint between stories',
  'roof cap and top edge showing the roofline: flat concrete parapet, peaked wooden gable, or simple metal roof edge against grey overcast Siberian sky',
];

const TYPE_SUFFIX = {
  diffuse: 'Overcast grey Siberian winter light, cold atmosphere, realistic material colors and textures. Muted cold tones, natural concrete patina, frost weathering visible. Bright clear daylight but under grey cloud cover.',
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
