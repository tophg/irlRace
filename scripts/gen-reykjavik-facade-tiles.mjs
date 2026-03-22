#!/usr/bin/env node
// gen-reykjavik-facade-tiles.mjs — Generate 40 Reykjavík facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-reykjavik-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/reykjavik_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Icelandic architectural styles (columns)
const STYLES = [
  // Col 0 — Corrugated iron residential (blue)
  'Reykjavík classic corrugated iron residential house facade, painted corrugated galvanized metal cladding in bright ocean-blue, white-painted wooden window frames with double-hung sash windows, pitched roof edge visible at top, Nordic proportions, bright ocean-blue corrugated iron palette',

  // Col 1 — Painted concrete apartment (red)
  'Reykjavík mid-century Nordic modernist concrete apartment block facade, smooth cement-rendered walls painted in warm burgundy-red, simple rectangular aluminum-frame windows in regular grid pattern, flat roof with thin concrete fascia, warm burgundy-red painted concrete palette',

  // Col 2 — Turf-roofed stone cottage
  'Icelandic traditional turf-influenced stone cottage facade, rough dark basalt stone masonry walls, small deeply-recessed window openings with heavy timber frames, thick turf grass edge visible at roofline, heavy rustic proportions, dark basalt-grey stone palette with green turf accents',

  // Col 3 — Nordic commercial shopfront (green)
  'Reykjavík Nordic commercial shopfront building facade, painted corrugated iron walls in bright forest-green, large ground-floor display window with simple timber surround, upper residential windows with white frames, bright forest-green corrugated iron palette',

  // Col 4 — Harpa-inspired modern glass
  'Reykjavík contemporary Icelandic architecture facade, geometric glass and steel curtain-wall panels, angular honeycomb-pattern glazing frames, modern minimalist proportions, cool steel-grey and reflective glass palette',

  // Col 5 — Weathered harbor warehouse (rust-red)
  'Reykjavík old harbour fishing warehouse facade, weathered corrugated iron cladding in faded rust-red, heavy timber loading doors with iron hardware, industrial proportions with exposed structural elements, faded rust-red weathered iron palette',

  // Col 6 — Nordic institutional / church (white)
  'Reykjavík Nordic institutional or church building facade, clean white-rendered smooth concrete walls, minimal ornamentation, tall narrow windows with simple pointed arches, steep gabled roofline silhouette, clean white rendered palette',

  // Col 7 — Bright painted row house (yellow)
  'Reykjavík Laugavegur-style colorful row house facade, painted corrugated iron cladding in bright mustard-yellow, white-painted window frames with decorative trim, pitched roof with ornamental ridge detail, bright mustard-yellow corrugated iron palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — white-painted double-hung sash windows or aluminum-frame windows, simple painted frames, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform corrugated iron or rendered concrete texture, NO text',
    'ground floor — entrance with simple painted door or shopfront display window, NO text NO signage',
    'cornice — roof edge trim or gutter line with simple painted fascia board, NO text',
    'roof cap — corrugated iron pitched roof edge or flat concrete parapet, NO text',
  ],
  emissive: [
    'windows at night — warm golden interior glow behind window panes, cozy Nordic interior light, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — warm light spilling from doorway or shop window, mostly dark facade, NO text',
    'cornice at night — completely dark roof trim, no light, dark facade, NO text',
    'roof cap at night — completely dark roofline against dark arctic sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing window frame recess depth, sash bar profiles, and glass plane',
    'normal map of wall pier — blue-purple normal map showing corrugated iron wave ridges or smooth rendered surface',
    'normal map of ground floor — blue-purple normal map showing door panel depth, frame relief, and step profiles',
    'normal map of cornice — blue-purple normal map showing gutter profile, fascia board edge, and trim relief',
    'normal map of roof cap — blue-purple normal map showing corrugated iron ridge profile or concrete parapet edge',
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
      'Photorealistic, flat front elevation, overcast Nordic daylight.',
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
