#!/usr/bin/env node
/**
 * gen-damascus-tiles.mjs — Generate all 40 diffuse facade tiles for Damascus
 * using the Nano Banana 2 (Gemini 3.1 Flash Image) API.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-damascus-tiles.mjs [type]
 *   type: 'diffuse' (default)
 *
 * Output: /tmp/damascus_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/damascus_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Damascus architectural archetypes) ──
// Research: limestone + basalt ablaq, mashrabiya, courtyard houses, modern concrete,
// Ottoman-era stone, French Mandate period, war-damaged facades
const COL_STYLES = [
  'Traditional Old Damascus limestone facade, warm cream-beige cut limestone blocks with fine mortar joints, solid high wall with one heavy wooden door with metal studs, plain austere Damascene privacy wall, aged and weathered stone, Syrian traditional architecture',
  'Damascus ablaq stone facade, alternating horizontal courses of light cream limestone and dark grey-black basalt stone creating striped pattern, pointed arch window with stone surround, Mamluk-era Islamic architecture, Damascus Old City',
  'Ottoman-era Damascus residential building, warm golden sandstone facade with mashrabiya wooden lattice projected window bay, ornate carved stone window frames, second floor wooden balcony with carved brackets, traditional Syrian Ottoman style',
  'Modern Damascus apartment building, light beige-cream painted concrete facade with uniform rectangular windows and continuous wrap-around balconies with metal railings, air conditioning units visible, typical 6-8 story Syrian residential block',
  'Damascus French Mandate era building, smooth cream-white rendered facade with classical European-influenced details, arched windows with decorative keystones, iron balcony railings, corniced roofline, 1920s-1940s colonial style',
  'Damascus commercial building, ground floor with metal rolling shutters and shop fronts, upper floors of light sandstone or beige concrete with rectangular windows, Arabic signage area, typical Syrian souk-adjacent mixed-use',
  'War-damaged Damascus residential facade, light cream concrete and stone wall showing patches of exposed rebar and concrete, some windows boarded up, bullet-scarred surface, weathered and worn but still standing, Syrian civil war era',
  'Damascus modernist concrete tower, smooth light grey-beige concrete facade with recessed window openings creating shadow patterns, flat roof with water tanks, simple geometric lines, 1970s-1980s Syrian modernist residential style',
];

// ── Row element descriptions ──
const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows with stone or concrete surrounds, solid wall surface between them, typical upper story for this architectural style',
  'solid wall pier section between windows, showing the building\'s primary material texture (limestone blocks, ablaq courses, painted concrete, stucco) with subtle details and weathering, NO windows',
  'ground floor street-level showing an entrance doorway, shop front with rolling shutter, or heavy wooden door with stone surround, typical ground level for Damascus',
  'horizontal transition band between floors showing a stone cornice line, concrete floor slab edge, or decorative stone course between stories',
  'roof cap and parapet showing the top edge: flat roof with simple stone or concrete parapet, sometimes with satellite dishes or water tanks visible, bright Mediterranean sky above',
];

// ── Type-specific prompt suffixes ──
const TYPE_SUFFIX = {
  diffuse: 'Bright clear sunny Mediterranean day lighting showing realistic material colors, textures, and surface details. Warm Syrian sunlight with strong shadows. Natural stone aging and surface patina.',
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
