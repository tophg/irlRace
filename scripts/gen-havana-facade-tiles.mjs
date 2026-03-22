#!/usr/bin/env node
// gen-havana-facade-tiles.mjs — Generate 40 Havana facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-havana-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/havana_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Havana architectural styles (columns)
const STYLES = [
  // Col 0 — Spanish Colonial pastel pink plaster
  'Havana Spanish colonial building, soft pastel pink plastered masonry facade, tall arched windows with dark green wooden louvered shutters, ornate wrought iron balcony railings, warm coral pink tones',

  // Col 1 — Colonial pastel yellow/ochre
  'Havana colonial building, warm pastel golden-yellow plastered facade, rhythmic arched colonnades at ground level, carved stone window surrounds, wooden shutters, sunlit warm ochre-yellow tones',

  // Col 2 — Neoclassical blue-green pastel
  'Havana neoclassical building, soft pastel teal-blue plastered facade with white classical columns and pilasters, decorative pediment above windows, wrought iron balconies, cool blue-green tones',

  // Col 3 — Art Deco geometric concrete
  'Havana Art Deco building, smooth cream concrete facade with geometric stepped motifs, horizontal banding, chrome-trimmed porthole windows, streamlined corners, warm cream and beige palette',

  // Col 4 — Weathered colonial coral stone
  'Havana weathered colonial building, aged coral stone and peeling plaster facade showing warm orange-brown stone underneath faded mint-green paint, rustic tropical patina, warm earthy tones',

  // Col 5 — Caribbean commercial shopfront
  'Havana commercial street-level building, vibrant painted plaster facade in pastel lavender-purple, wide arched shopfront openings with decorative transom windows, colorful Caribbean proportions',

  // Col 6 — Mid-century modernist concrete
  'Havana mid-century modernist apartment building, smooth pale gray concrete with horizontal sun-shade louvers, ribbon windows with aluminum frames, minimal ornamentation, cool gray-white palette',

  // Col 7 — Colonial mansion with ornate ironwork
  'Havana colonial mansion facade, rich pastel peach-orange plastered walls, elaborate decorative wrought iron balconies on every floor, tall French windows with wooden louvered shutters, warm peach tones',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — closed uniform wooden louvered shutters, plain frames, NO visible interiors, NO text',
    'wall pier — solid windowless plastered wall surface, uniform texture, NO text',
    'ground floor — arched commercial entrance with wooden doors or iron gates, NO text NO signage',
    'cornice — horizontal decorative molding band or classical trim, NO text',
    'roof cap — parapet edge with sky visible above, NO text',
  ],
  emissive: [
    'windows at night — warm golden interior glow behind shutters, uniform warm light emission, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — faint warm light from doorway, mostly dark facade, NO text',
    'cornice at night — completely dark decorative trim, no light, dark facade, NO text',
    'roof cap at night — completely dark parapet against dark sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing shutter slat depth, window frame recesses, and balcony railing relief',
    'normal map of wall pier — blue-purple normal map showing plaster surface texture and mortar joints',
    'normal map of ground floor — blue-purple normal map showing arched door frame depth and storefront relief',
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
