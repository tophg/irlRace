#!/usr/bin/env node
/**
 * gen-lima-tiles.mjs — Generate all 40 diffuse facade tiles for Lima
 * using the Gemini 2.5 Flash Image API.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-lima-tiles.mjs [type]
 *
 * Output: /tmp/lima_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/lima_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Lima architectural archetypes) ──
// Research: colonial wooden balconies, Baroque facades, ochre/mustard,
// Republican era, modern Miraflores glass towers, adobe plaster
const COL_STYLES = [
  'Lima colonial Baroque facade, bright mustard yellow plastered adobe wall with ornate carved stone doorway surround, enclosed dark wooden box balcony (balcón de cajón) with detailed lattice screens at second floor, white stone cornice mouldings, 2-3 story historic center style',
  'Lima colonial mansion, warm terracotta-red plastered facade with tall narrow windows framed by white carved stone pilasters, dark cedar wooden enclosed box balcony with carved panels, arched carriage entrance at ground level, Spanish viceregal style',
  'Lima Republican era building, cream-white neoclassical rendered facade with tall double windows and decorative stone balcony railings, subtle Baroque stone carvings around windows, wrought iron balconies, 3-4 story elegance',
  'Lima Art Nouveau early 20th century building, pale green or mint painted plaster facade with flowing decorative organic motifs around windows, ornamental wrought iron balconies with curving forms, stained glass transoms, European-influenced Lima style',
  'Lima modern Miraflores residential tower, clean white concrete and floor-to-ceiling tinted glass facade, transparent glass balconies with thin steel railings at each floor, minimalist contemporary design, sleek coastal high-rise',
  'Lima mid-century modernist apartment block, raw exposed concrete brutalist facade with deeply recessed rectangular windows in a regular grid, cantilevered concrete balconies, functional utilitarian 1960s-70s Lima style',
  'Lima painted concrete working-class residential, bright blue or turquoise painted concrete facade with small rectangular windows, simple metal window grilles, laundry hanging from basic concrete balconies, practical 4-6 story district housing',
  'Lima mixed-use commercial street building, ground floor with metal rolling shutters and awnings, upper floors of ochre-yellow or peach painted plaster with rectangular windows, crowded dense urban Lima market-district style',
];

const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows with surrounds and balconies or lattice screens, solid wall surface between them, typical upper story for this style',
  'solid wall pier section between windows, showing the building\'s primary material texture (plastered adobe, carved stone, painted concrete, glass panels) with subtle details, NO windows',
  'ground floor street-level showing a doorway, arched carriage entrance, shop front with shutters, or residential entry, typical Lima ground level detail',
  'horizontal transition band between floors showing a decorative stone cornice, painted moulding, or plain concrete floor slab edge between stories',
  'roof cap and top edge showing the roofline: flat plastered parapet, decorative stone balustrade, or simple concrete edge against overcast Lima sky',
];

const TYPE_SUFFIX = {
  diffuse: 'Overcast soft diffused light typical of Lima (garúa), realistic material colors and textures. Warm earth tones, natural patina, realistic South American coastal city atmosphere.',
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
