#!/usr/bin/env node
/**
 * gen-chennai-tiles.mjs — Generate all 40 diffuse facade tiles for Chennai
 * using the Gemini 2.5 Flash Image API.
 * Following walkthrough: persistent storage, CLEAR SUNNY DAY, NO TEXT, generic uniform.
 */

import { mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `${process.env.HOME}/.irlrace_atlas_tiles/chennai_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

const COL_STYLES = [
  'Chennai Indo-Saracenic colonial facade, deep red burnt-clay brick with cream limestone arched window surrounds and ornamental cornices, cusped Mughal arches, decorative stone banding, classical columns flanking entrance, 3-4 story British colonial period civic building',
  'Chennai colonial neoclassical facade, smooth cream or white lime-plastered masonry with tall Corinthian pilasters, large shuttered windows with wooden louvres, ornamental pediment above entrance, flat parapet roof, 2-3 story George Town colonial townhouse',
  'Chennai Art Deco facade, cream painted concrete with geometric stepped banding, stylized floral relief panels, rounded corner balcony with horizontal railings, porthole or circular window accent, streamlined horizontal emphasis, 1930s-40s residential style',
  'Chennai painted concrete residential apartment, bright salmon pink or peach painted smooth cement plaster facade, rectangular windows with concrete chajja sunshade above each, iron safety grills on windows, simple flat concrete balconies, 4-5 story mid-rise apartment block',
  'Chennai blue painted concrete residential, vivid electric blue painted cement plaster facade with white window frames, small rectangular windows with metal grills, flat concrete balconies with simple pipe railings, water staining on walls, 3-4 story working class housing',
  'Chennai ochre-yellow commercial building, warm ochre-yellow painted plaster facade with dark brown window shutters, ground floor shopfronts with metal rolling shutters, painted band between floors, simple cornice, dense 3-story market district building',
  'Chennai exposed red brick residential, dark red-brown exposed brick facade with white cement pointing, concrete lintels above rectangular windows, concrete staircase block visible on side, flat roof with water tank silhouette, 3-4 story newer construction',
  'Chennai modern glass IT park tower, sleek blue-tinted glass curtain wall in dark aluminium grid frame, horizontal floor plate bands visible through glass, flush surface with no balconies, clean contemporary corporate tower in IT corridor',
];

const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows with surrounds or grills, solid wall surface between them, typical upper story for this style',
  'solid wall pier section between windows, showing the building\'s primary material texture (brick, plaster, painted concrete, glass) with subtle weathering details, NO windows',
  'ground floor street-level showing an entrance doorway, shop front with rolling shutter, or residential entrance with gate, typical Chennai ground level',
  'horizontal transition band between floors showing a simple painted cornice line, concrete floor slab edge, or decorative moulding between stories',
  'roof cap and top edge showing the roofline: flat concrete parapet with water tank, decorative colonial cornice, or glass curtain wall top edge against bright clear tropical sky',
];

const TYPE_SUFFIX = {
  diffuse: 'Bright clear sunny day lighting, optimal visibility. Realistic material colors and textures with tropical weathering. NO TEXT. Photorealistic, flat front elevation, bright clear daylight.',
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
