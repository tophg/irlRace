#!/usr/bin/env node
// gen-tehran-facade-tiles.mjs — Generate 40 Tehran facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-tehran-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/tehran_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Tehran architectural styles (columns)
const STYLES = [
  // Col 0 — Traditional yellow brick residential (old Tehran)
  'traditional Tehran yellow brick residential building, honey-gold handmade brick facade with decorative brick coursing, arched window recesses with iron balcony rails, warm golden-ochre tones',

  // Col 1 — Qajar-era stone and plaster mansion
  'Qajar-era Tehran mansion facade, cream plaster over stone with ornamental moldings, tall sash windows with carved stone surrounds, subtle blue tilework accents above windows, warm cream and ivory tones',

  // Col 2 — Pahlavi-era modernist concrete apartment (1960s-70s)
  'Pahlavi-era Tehran modernist apartment block, smooth beige concrete with horizontal balcony bands, aluminum-framed rectangular windows in grid pattern, clean geometric lines, muted warm gray-beige',

  // Col 3 — Contemporary Tehran residential tower
  'contemporary Tehran high-rise residential tower, white composite panel cladding with dark tinted glass, cantilevered balconies with glass railings, sleek modern lines, cool white and dark gray palette',

  // Col 4 — Persian brick with geometric perforations
  'modern Tehran brick building with decorative perforated brick screen facade, geometric Islamic-inspired patterns in brick, warm terracotta brick with shadow play from perforations, copper-brown tones',

  // Col 5 — Tehran bazaar commercial shopfront
  'Tehran grand bazaar adjacent commercial building, ground-level arched shopfront with metal shutters, upper floors in aged cream stone with small square windows, traditional Iranian proportions, warm sandy-cream palette',

  // Col 6 — Tehran government/institutional stone
  'Tehran institutional government building, formal gray granite cladding with regular grid of tall windows, heavy stone lintels, authoritative modernist style, cool gray and charcoal tones',

  // Col 7 — Persian-Islamic decorative tile accent building
  'Tehran building with Persian Islamic tilework facade accent bands, blue and turquoise geometric tile panels between floors, cream stone facade, pointed arch window motifs, warm cream with vivid blue accents',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — closed uniform shutters or frosted glass, plain frames, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform texture, NO text',
    'ground floor — commercial entrance with metal grille or plain door, NO text NO signage',
    'cornice — horizontal decorative trim band or molding, NO text',
    'roof cap — parapet edge with sky visible above, NO text',
  ],
  emissive: [
    'windows at night — warm amber interior glow behind glass, uniform warm light emission, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — faint warm light from door/window, mostly dark facade, NO text',
    'cornice at night — completely dark decorative trim, no light, dark facade, NO text',
    'roof cap at night — completely dark parapet against dark sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing window frame depth, glass recesses, and shutter relief',
    'normal map of wall pier — blue-purple normal map showing brick/stone surface texture and mortar joints',
    'normal map of ground floor — blue-purple normal map showing door frame depth and storefront relief',
    'normal map of cornice — blue-purple normal map showing molding profiles and trim relief',
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
