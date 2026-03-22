#!/usr/bin/env node
/**
 * gen-mogadishu-tiles.mjs — Generate all 40 diffuse facade tiles for Mogadishu
 * using the Gemini 2.5 Flash Image API.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-mogadishu-tiles.mjs [type]
 *
 * Output: /tmp/mogadishu_facade_{type}/r{row}_c{col}.png
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/mogadishu_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Mogadishu architectural archetypes) ──
// Research: coral stone heritage, Italian colonial, war-damaged, modern glass,
// painted concrete residential, compound walls, commercial mixed-use
const COL_STYLES = [
  'Traditional Mogadishu coral stone building, white-washed walls with rough-textured coral limestone blocks visible beneath peeling lime plaster, small recessed windows with simple stone surrounds, flat roof, historic Benaadir coastal style, 2-3 story',
  'Italian colonial era Mogadishu building, cream-beige rendered facade with classical arched windows, ornate stone balconies with wrought iron railings, decorative cornice mouldings, columns framing ground floor arcade, weathered but elegant 1920s-1930s colonial style',
  'War-damaged Mogadishu residential building, white-beige concrete and plaster facade with bullet holes and shell damage pockmarks, some windows missing or boarded, exposed rebar in places, crumbling cornice, still standing but heavily scarred civil war era',
  'Modern Mogadishu commercial tower, clean white and blue-tinted glass curtain wall facade with aluminum mullions, sleek contemporary lines, new construction, 8-12 story reconstruction era building, East African modern style',
  'Mogadishu painted concrete apartment, bright white or pale yellow painted concrete facade with rectangular windows fitted with decorative steel security grilles, concrete balconies with painted metal railings, satellite dishes visible, typical newer 4-6 story residential',
  'Mogadishu compound wall and gatehouse, high beige-cream rendered concrete boundary wall 2-3 meters tall with simple gate opening, smooth plastered surface with subtle weathering, topped with metal railing or spikes, typical Somali residential perimeter',
  'Mogadishu mixed-use commercial building, ground floor with metal rolling shutters and shop fronts, upper floors of white or cream painted concrete with small windows fitted with metal grilles, flat roof with water tanks visible, typical Somali market-adjacent',
  'Modern Mogadishu villa, clean white painted concrete facade with terracotta-orange or coral pink accent trim around windows and roofline, decorative geometric patterns in the wall surface, modern Islamic-influenced residential architecture, flat roof',
];

const ROW_ELEMENTS = [
  'upper floor windows section showing 2-3 regularly spaced windows with surrounds or security grilles, solid wall surface between them, typical upper story for this style',
  'solid wall pier section between windows, showing the building\'s primary material texture (coral stone, rendered plaster, painted concrete, glass panels) with subtle details, NO windows',
  'ground floor street-level showing a doorway, shop entrance with metal shutters, or compound gate opening, typical Mogadishu ground level detail',
  'horizontal transition band between floors showing a simple concrete floor slab edge, painted cornice line, or plain band between stories',
  'roof cap and top edge showing the roofline: flat concrete parapet with water tanks, satellite dishes, or simple railing against bright blue tropical sky',
];

const TYPE_SUFFIX = {
  diffuse: 'Bright clear sunny tropical day with strong equatorial sunlight and sharp shadows. Realistic material colors, textures, and surface details. Warm East African coastal light. Natural weathering and sun-bleached patina.',
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
