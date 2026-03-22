#!/usr/bin/env node
// gen-shanghai-facade-tiles.mjs — Generate 40 Shanghai facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-shanghai-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/shanghai_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Shanghai architectural styles (columns)
const STYLES = [
  // Col 0 — Bund neoclassical stone
  'Shanghai Bund-era neoclassical building, grand cream-white stone facade with classical columns and carved pediments, ornate cornice, granite base, formal European Revival proportions, warm cream-stone tones',

  // Col 1 — Art Deco geometric
  'Shanghai Art Deco building from 1930s, smooth buff-colored concrete facade with geometric stepped motifs, chrome-trimmed windows, streamlined horizontal banding, zigzag ornamental details, warm golden-beige palette',

  // Col 2 — Shikumen stone-gate townhouse
  'Shanghai Shikumen lane house, gray-blue traditional Jiangnan brick facade, stone-framed entrance gate with carved arch pediment, wooden shuttered windows, gray tile roof edge detail, muted cool gray-blue tones',

  // Col 3 — French Concession villa
  'Shanghai French Concession-era villa building, cream-colored stucco facade with red brick trim, arched windows with decorative keystones, wrought iron Juliet balconies, warm cream and terracotta palette',

  // Col 4 — Modern glass curtain-wall
  'Shanghai modern commercial high-rise, sleek blue-green reflective glass curtain-wall facade with silver aluminum mullion grid, minimal ornamentation, clean contemporary lines, cool blue-green metallic palette',

  // Col 5 — Gray brick residential
  'Shanghai mid-century residential apartment building, dark gray concrete brick facade, uniform rows of small rectangular windows with metal frames, horizontal balcony slabs, austere functional design, cool dark gray palette',

  // Col 6 — Pudong granite commercial
  'Shanghai Pudong-era commercial office building, polished granite and dark glass composite facade, wide horizontal window bands between granite spandrel panels, modern corporate proportions, dark gray-brown palette',

  // Col 7 — Chinese Deco fusion
  'Shanghai Chinese Deco building, warm tan plastered facade with traditional Chinese ornamental motifs integrated into Art Deco geometry, pagoda-inspired stepped roofline details, lattice window patterns, warm tan-gold palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — closed uniform shuttered or curtained windows, plain frames, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform texture, NO text',
    'ground floor — commercial entrance with doors or gates, NO text NO signage',
    'cornice — horizontal decorative molding band or trim, NO text',
    'roof cap — parapet edge with sky visible above, NO text',
  ],
  emissive: [
    'windows at night — warm golden interior glow behind curtains, uniform warm light emission, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — faint warm light from doorway, mostly dark facade, NO text',
    'cornice at night — completely dark decorative trim, no light, dark facade, NO text',
    'roof cap at night — completely dark parapet against dark sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing window frame recesses, shutter depth, and mullion relief',
    'normal map of wall pier — blue-purple normal map showing brick or stone surface texture and mortar joints',
    'normal map of ground floor — blue-purple normal map showing door frame depth and storefront relief',
    'normal map of cornice — blue-purple normal map showing classical molding profiles and trim relief',
    'normal map of roof cap — blue-purple normal map showing parapet edge and cap stone relief',
  ],
};

const rowDescs = ROWS[TYPE];
const COLS = 8, ROW_COUNT = 5;

let done = 0, total = COLS * ROW_COUNT;

for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROW_COUNT; r++) {
    done++;
    const out = `${OUTDIR}/r${r}_c${c}.png`;
    const refFile = `${OUTDIR}/r0_c${c}.png`;
    const hasRef = r > 0 && existsSync(refFile);

    console.log(`\n[${done}/${total}] r${r}_c${c} (${hasRef ? 'with ref' : 'seed tile'})`);
    console.log(`  Style: ${STYLES[c].substring(0, 70)}...`);

    const prompt = [
      'Seamlessly tileable architectural facade texture tile,',
      '512x512 pixels, perfectly repeating edges,',
      `${STYLES[c]},`,
      `element: ${rowDescs[r]}.`,
      'Photorealistic, flat front elevation, bright clear daylight.',
      'NO TEXT. NO SIGNAGE. NO LABELS.',
    ].join(' ');

    const args = [NB2, prompt, out];
    if (hasRef) args.push('--ref', refFile);

    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        execFileSync('node', args, {
          stdio: 'inherit',
          env: process.env,
          timeout: 120_000,
        });
        break;
      } catch (err) {
        console.error(`  ✗ Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) {
          const wait = attempt * 3;
          console.log(`  ↻ Retrying in ${wait}s...`);
          execFileSync('sleep', [String(wait)]);
        } else {
          console.error(`  ✗ GIVING UP on r${r}_c${c}`);
        }
      }
    }
  }
}
console.log(`\n✅ Done: ${total} tiles in ${OUTDIR}`);
