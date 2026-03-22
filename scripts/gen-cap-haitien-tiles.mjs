#!/usr/bin/env node
/**
 * gen-cap-haitien-tiles.mjs — Generate all 40 diffuse facade tiles for Cap-Haïtien
 * using the Gemini 2.5 Flash Image API.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/Users/devnull/.irlrace_atlas_tiles/cap_haitien_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

const COL_STYLES = [
  'Cap-Haïtien French colonial facade, warm ochre-yellow rendered masonry with bright green wooden louvered shutters (jalousies), full-length wrought iron balcony at second floor, ground-floor arcade with colonial arches, 2-3 story historic Caribbean colonial style',
  'Cap-Haïtien colonial townhouse, salmon pink plastered facade with contrasting deep blue wooden jalousie shutters, ornate wooden balcony with decorative fretwork, corrugated metal hip roof visible, weathered tropical patina, 2-story historic center',
  'Cap-Haïtien Gingerbread style house, pale cream or white painted wooden facade with intricate ornamental wooden fretwork (gingerbread trim) along eaves and balcony railings, steep corrugated metal gabled roof, elaborate Victorian-Caribbean wooden details',
  'Cap-Haïtien sky blue colonial building, bright sky blue rendered masonry facade with white trim around tall narrow windows with dark wooden jalousie shutters, simple wrought iron Juliet balconies, flat parapet with decorative moulding, 2-story',
  'Cap-Haïtien raw cinder block residential, bare grey hollow concrete block wall with visible mortar joints, small rectangular window openings with simple metal bars, flat concrete roof with exposed rebar sticking up, unfinished informal construction, 1-2 story',
  'Cap-Haïtien painted concrete residential, bright lime green or turquoise painted concrete block facade with contrasting colored window frames, simple metal door, corrugated metal lean-to roof, vibrant tropical colors, basic 1-2 story popular housing',
  'Cap-Haïtien market-district commercial, ground floor with metal rolling shutters or open shop front, upper floor of weathered peach or yellow painted plaster with wooden louvered windows, hand-painted signage area, dense urban commercial, 2-story',
  'Cap-Haïtien modern concrete villa, clean white painted reinforced concrete facade with horizontal rectangular windows, glass louvers, flat roof with decorative parapet, contemporary Caribbean tropical modern style, 2-3 story',
];

const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows with jalousie shutters or metal bars, solid wall surface between them, typical upper story for this style',
  'solid wall pier section between windows, showing the building\'s primary material texture (rendered plaster, cinder block, painted concrete, ornamental wood) with subtle details, NO windows',
  'ground floor street-level showing a doorway, arcade arch, shop front with shutters, or residential doorway, typical Cap-Haïtien ground level detail',
  'horizontal transition band between floors showing a simple painted cornice line, floor slab edge, or decorative moulding between stories',
  'roof cap and top edge showing the roofline: corrugated metal gable, flat concrete parapet with exposed rebar, or decorative colonial cornice against bright tropical blue sky',
];

const TYPE_SUFFIX = {
  diffuse: 'Bright tropical Caribbean sunlight, strong shadows, warm atmosphere. Realistic weathered material colors and textures with tropical patina and humidity staining. Vivid colors.',
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
