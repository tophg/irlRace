#!/usr/bin/env node
/**
 * gen-montclair-tiles.mjs — Generate all 40 diffuse facade tiles for Montclair NJ
 * using the Nano Banana 2 (Gemini 3.1 Flash Image) API.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-montclair-tiles.mjs [type]
 *   type: 'diffuse' (default)
 *
 * Output: /tmp/montclair_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/montclair_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Montclair NJ architectural archetypes) ──
// Research: Victorian Queen Anne, Tudor Revival, Colonial Revival, red brick commercial,
// Craftsman bungalow, Italianate, Mission style. Earthy reds/browns/beiges.
const COL_STYLES = [
  'Classic red brick commercial building, dark red-brown aged brick facade with stone or cream painted lintels above arched windows, ornate cornice at roofline, typical northeast US downtown Bloomfield Avenue Montclair NJ style, 3-story storefront',
  'Victorian Queen Anne residential facade, natural wood clapboard siding in deep sage green or slate blue with white painted window trim, decorative gable brackets, patterned fish-scale shingles in gable, Montclair NJ historic home',
  'Tudor Revival half-timbered facade, cream stucco panels divided by dark brown exposed timber beams, leaded casement windows, steep gable with decorative bargeboards, typical northeast US suburban Tudor style',
  'Colonial Revival brick facade, warm red-orange brick with white painted wood shutters flanking double-hung windows, symmetrical design, Georgian proportions, white trim details, Montclair NJ colonial home style',
  'Craftsman bungalow facade, natural cedar shingle siding in warm brown, wide front porch with tapered stone piers and wood columns, exposed rafter tails under deep eaves, Arts and Crafts style, Montclair NJ',
  'Italianate commercial building facade, warm tan-brown brick with elaborate window hoods, heavy bracketed cornice, tall narrow arched windows, cast iron storefront details, historic northeast downtown',
  'Mission Revival facade, smooth cream-white stucco with terracotta red tile accents, arched entry with decorative tile surround, curved parapet and bell-shaped roofline, Spanish Colonial influence Montclair NJ',
  'Mixed-use downtown brick building, dark red-brown pressed brick facade with large plate glass storefront at ground level, decorative stone or terra cotta band courses, flat roof with ornamental parapet, Bloomfield Avenue Montclair',
];

// ── Row element descriptions ──
const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows with decorative lintels or hoods, solid wall surface between them, typical upper-story detail for this architectural style',
  'solid wall pier section between windows, showing the building\'s primary material texture (brick, wood siding, stucco, shingles) with subtle details and weathering, NO windows',
  'ground floor street-level showing a storefront entrance, front porch with columns, or door frame with surrounding detail, typical ground-level entry for this style',
  'horizontal transition band between floors showing a decorative cornice line, belt course, water table, or porch roof line between stories',
  'roof cap and top edge showing the roofline: decorated cornice with brackets, gabled peak with shingles, or parapet edge with sky visible above',
];

// ── Type-specific prompt suffixes ──
const TYPE_SUFFIX = {
  diffuse: 'Warm golden hour lighting showing realistic material colors, textures, and surface patina. Natural brick aging and wood weathering. Autumn northeast US sunlight.',
  emissive: 'NIGHTTIME scene. All windows glow warm yellow/amber from interior lighting. Everything EXCEPT lit window panes must be pure black (#000000). This is an emissive glow mask.',
  normal: 'Normal map texture tile. Flat purple-blue (#8080FF) base. Emboss/relief showing depth of window recesses, brick joints, wood grain. NO color, only tangent-space normal map data.',
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
