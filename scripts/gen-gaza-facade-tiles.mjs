#!/usr/bin/env node
/**
 * gen-gaza-facade-tiles.mjs — Generate all 40 facade tiles for Gaza City
 * using the Nano Banana 2 (Gemini 3.1 Flash Image) API.
 *
 * REFERENCE IMAGE FEEDBACK: For each column, row 0 (windows) is generated first.
 * That tile is then passed as a --ref image when generating rows 1-4.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-gaza-facade-tiles.mjs [type]
 *   type: 'diffuse' (default), 'emissive', 'normal'
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/gaza_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Gaza / Levantine architectural archetypes) ──
const COL_STYLES = [
  'traditional ochre sandstone Levantine residential building, warm golden-tan quarried stone blocks, arched windows with stone lintels, Gaza Old City heritage style',
  'Ottoman-era limestone house with ornate arched doorway, thick stone walls, carved stone window surrounds, courtyard-facing iwan design, Mamluk-Gaza architectural heritage',
  'mid-century Palestinian concrete apartment block, beige/off-white rendered concrete, small rectangular balconies with metal railings, utilitarian UNRWA-era construction',
  'modern Gaza residential tower, smooth white-gray concrete with tinted glass windows, simple geometric balconies, contemporary Palestinian urban style',
  'war-damaged concrete building facade, exposed rebar, cracked rendered concrete showing block underneath, patched repairs, bullet pockmarks, Gaza conflict architecture',
  'commercial Levantine shopfront building, ground-level metal shutters, upper ochre stone facade with green-painted wooden shutters on arched windows, Syrian-Palestinian style',
  'dense Gaza refugee camp concrete structure, rough unpainted cinder block and concrete, narrow openings, ad-hoc construction, rooftop water tanks visible',
  'mosque-adjacent stone building, cream-white limestone with pointed arch windows, decorative geometric stone carving, Islamic architectural motifs, green-painted iron details',
];

// ── Row element descriptions ──
const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows in a row with wall surface between them, typical Levantine upper story',
  'solid wall pier section, windowless facade surface showing the building\'s primary material texture (sandstone blocks, concrete render, cinder block) with mortar joints and surface details, NO windows',
  'ground floor street-level showing a commercial entrance with metal roll-up shutter, doorway, or lobby area, typical Middle Eastern street-level facade',
  'horizontal transition band between floors showing a decorative stone cornice, concrete ledge, balcony slab, or band course typical of Levantine architecture',
  'roof cap and parapet showing the top edge of the building: concrete parapet wall, flat roof edge with satellite dishes or water tank mounting rails, Middle Eastern roofline',
];

// ── Type-specific prompt suffixes ──
const TYPE_SUFFIX = {
  diffuse: 'Bright clear daylight showing realistic material colors, textures, and surface details. Warm Mediterranean light, dust and weathering appropriate to Gaza climate.',
  emissive: 'NIGHTTIME scene. All windows glow warm yellow/amber from interior lighting. Everything EXCEPT lit window panes must be pure black (#000000). This is an emissive glow mask.',
  normal: 'Normal map texture tile. Flat purple-blue (#8080FF) base. Emboss/relief showing depth of stone block joints, window recesses, concrete surface texture, mortar lines. NO color, only tangent-space normal map data.',
};

const BASE_PROMPT = 'Seamlessly tileable architectural facade texture tile, 512x512 pixels, perfectly flat orthographic front view with no perspective or vanishing points. Game texture asset, no background, no sky, no ground visible. Left and right edges must tile seamlessly. NO TEXT, NO SIGNAGE.';

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
