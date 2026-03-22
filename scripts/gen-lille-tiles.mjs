#!/usr/bin/env node
/**
 * gen-lille-tiles.mjs — Generate all 40 diffuse facade tiles for Lille
 * using the Gemini 2.5 Flash Image API.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `${process.env.HOME}/.irlrace_atlas_tiles/lille_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

const COL_STYLES = [
  'Lille Flemish Baroque townhouse facade, rich red-orange brick with ornate cream limestone carved decorations, elaborate stepped Flemish gable crown, scrollwork pediment above windows, stone mullion windows with small panes, 3-4 story Vieux-Lille historic building',
  'Lille French classical townhouse, warm ochre-yellow rendered masonry facade with white stone window surrounds and cornice mouldings, tall narrow vertical windows with delicate wrought iron Juliet balconies, dark grey slate mansard roof with dormer windows, 4-5 story',
  'Lille red brick residential, dark red-brown brick facade with white limestone quoin corners and window lintels, regular grid of tall rectangular multi-pane sash windows, simple stone cornice between floors, 3-4 story northern French row house',
  'Lille Art Deco facade, orange-red brick with geometric cream stone banding and stylized floral relief panels, vertical emphasis with pilaster strips, stepped geometric parapet profile, multi-pane steel-frame windows, 1920s-30s post-war reconstruction style',
  'Lille cream plaster Haussmann-influenced facade, smooth pale cream rendered wall with stone balcony rail at third floor, continuous wrought iron balcony with delicate ironwork, tall French doors with louvered shutters, ornate cornice, 5-story grand boulevard building',
  'Lille salmon pink painted brick townhouse, pastel salmon pink painted brick facade with contrasting white window frames and stone lintels, green or blue painted wooden shutters, simple gabled roofline, charming 3-story Vieux-Lille residential',
  'Lille mixed-use commercial ground floor, modern shopfront with large glass display windows at street level, upper floors of traditional red brick with white stone trim, painted signage band between floors, typical Lille commercial street building, 3-4 story',
  'Lille modern Euralille glass tower, contemporary curtain wall facade of dark smoked glass panels in aluminium grid frame, clean geometric lines, flush surface with no balconies, sleek corporate modern tower in Euralille business district',
];

const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows with surrounds or shutters, solid wall surface between them, typical upper story for this style',
  'solid wall pier section between windows, showing the building\'s primary material texture (brick, plaster, stone, glass) with subtle details, NO windows',
  'ground floor street-level showing an entrance doorway, shop front, or ground floor detail, typical Lille ground level',
  'horizontal transition band between floors showing a stone cornice line, brick course detail, or decorative moulding between stories',
  'roof cap and top edge showing the roofline: Flemish stepped gable, slate mansard with dormers, Art Deco geometric parapet, or flat glass edge against overcast northern French sky',
];

const TYPE_SUFFIX = {
  diffuse: 'Bright clear daylight, optimal visibility, realistic material colors and textures. NO TEXT. Photorealistic, flat front elevation.',
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
