#!/usr/bin/env node
// gen-machuelo-abajo-facade-tiles.mjs — Generate 40 Machuelo Abajo facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-machuelo-abajo-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/machuelo_abajo_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Puerto Rican rural architectural styles (columns)
const STYLES = [
  // Col 0 — Concrete block house (casita de bloques)
  'Puerto Rican rural concrete block house facade, rough unpainted grey cinder block walls with visible mortar joints, simple rectangular window openings with metal jalousie louvers, flat concrete roof slab edge visible at top, modest utilitarian proportions, tropical weathering and algae staining on lower walls, raw grey concrete block palette',

  // Col 1 — Painted concrete residential
  'Puerto Rican painted concrete residential house facade, smooth cement-rendered walls painted in bright Caribbean turquoise-blue, flat concrete roof, simple aluminum-frame windows with security bars, small covered porch entrance, tropical mildew staining, bright turquoise-blue painted palette',

  // Col 2 — Wood and zinc rural house
  'Puerto Rican traditional wooden rural house facade, horizontal painted wood plank siding in faded pastel green, corrugated zinc metal roof overhang visible at top, simple wooden-frame windows with wooden shutters, raised wooden porch, weathered tropical aging, faded pastel green wood palette',

  // Col 3 — Colmado / small shop
  'Puerto Rican rural colmado small shop building facade, painted concrete block walls in bright warm yellow, wide open storefront with metal roll-up shutter opening, hand-painted trim around openings, awning overhang, modest commercial proportions, bright warm yellow shop palette',

  // Col 4 — Painted stucco with ironwork
  'Puerto Rican painted stucco house facade, smooth rendered concrete walls painted in warm terracotta-orange, decorative wrought iron window grilles and porch railings, flat roof with simple concrete parapet, arched doorway detail, tropical weathering patina, warm terracotta-orange palette',

  // Col 5 — Abandoned / weathered structure
  'Puerto Rican abandoned weathered building facade, crumbling concrete block walls with exposed rebar and missing plaster patches, boarded-up windows, vegetation growing from cracks, heavily stained and moss-covered surfaces, post-hurricane damage character, distressed grey-green weathered palette',

  // Col 6 — Rural church / community building
  'Puerto Rican rural community or small church building facade, painted concrete block walls in clean white with sky-blue trim, simple pointed window openings, modest bell tower or cross element at roofline, neat institutional proportions, clean white with blue trim palette',

  // Col 7 — Modern affordable housing
  'Puerto Rican modern affordable housing unit facade, smooth poured concrete walls painted in muted coral-pink, sliding aluminum windows with tinted glass, flat roof with concrete fascia, simple repeated unit module proportions, muted coral-pink modern palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — closed metal jalousie louvers or barred windows, simple painted frames, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform concrete block or painted stucco texture, NO text',
    'ground floor — entrance with simple door or open shop-front, NO text NO signage',
    'cornice — horizontal concrete roof slab edge or simple painted trim band, NO text',
    'roof cap — flat concrete parapet or corrugated zinc roof edge, NO text',
  ],
  emissive: [
    'windows at night — warm golden interior glow behind jalousie louvers or barred windows, uniform warm light emission, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — faint warm light from doorway or shop opening, mostly dark facade, NO text',
    'cornice at night — completely dark trim, no light, dark facade, NO text',
    'roof cap at night — completely dark roofline against dark sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing jalousie slat depth, security bar relief, and frame recesses',
    'normal map of wall pier — blue-purple normal map showing concrete block coursing, mortar joints, or rendered plaster surface',
    'normal map of ground floor — blue-purple normal map showing door panel depth, frame relief, and step profiles',
    'normal map of cornice — blue-purple normal map showing roof slab edge profile and trim relief',
    'normal map of roof cap — blue-purple normal map showing parapet edge or corrugated metal ridge relief',
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
      'Photorealistic, flat front elevation, bright tropical daylight.',
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
