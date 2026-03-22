#!/usr/bin/env node
// gen-siberia-facade-tiles.mjs — Generate 40 Siberia facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-siberia-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/siberia_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Siberian architectural styles (columns)
const STYLES = [
  // Col 0 — Soviet Khrushchyovka panel block
  'Siberian Soviet-era Khrushchyovka apartment block facade, prefabricated concrete panel walls with visible seams between panels, small uniform rectangular windows in rigid grid, flat monotone grey concrete surface weathered by extreme cold, snow-stained and frost-damaged, bleak utilitarian Soviet housing, cold grey-blue concrete palette',

  // Col 1 — Soviet Brezhnevka tower block
  'Siberian Soviet Brezhnevka high-rise apartment tower facade, taller prefab reinforced concrete panels with slightly larger windows than Khrushchyovka, protruding balcony slabs with metal railings, panel joints sealed with dark caulk, snow accumulation on ledges, cold industrial grey-beige concrete palette',

  // Col 2 — Traditional Siberian log house (izba)
  'Siberian traditional wooden izba log house facade, horizontal round dark weathered pine logs with white chinking between courses, ornately carved nalichniki window frames painted blue or white, steep pitched roof overhang visible at top, deeply aged dark brown wood grain, warm dark brown timber palette with blue trim',

  // Col 3 — Soviet industrial/administrative
  'Siberian Soviet administrative or industrial building facade, heavy reinforced concrete brutalist form, narrow ribbon windows with thick concrete mullions, massive blank wall surfaces with exposed aggregate texture, utilitarian institutional proportions, harsh raw grey concrete palette with rust staining',

  // Col 4 — Painted plaster residential (barracks-style)
  'Siberian Soviet-era painted plaster residential building facade, smooth rendered walls painted in faded pastel yellow or green over brick, small double-paned windows with thick frames for insulation, cracking and peeling paint from freeze-thaw cycles, simple rectangular proportions, faded pale yellow-green pastel palette',

  // Col 5 — Brick industrial/warehouse
  'Siberian industrial brick warehouse building facade, dark red-brown kiln-fired brick with thick mortar joints, tall narrow loading windows with brick arched lintels, soot stains and frost damage on surface, rugged utilitarian proportions, dark red-brown industrial brick palette',

  // Col 6 — Post-Soviet renovated block
  'Siberian post-Soviet renovated apartment block facade, older concrete panel building clad with ventilated composite facade panels in muted blue or tan colors, replacement double-glazed PVC windows, clean geometric panel grid, partially modernized appearance, muted blue-grey or tan cladding palette',

  // Col 7 — Soviet-era commercial/shop ground floor
  'Siberian Soviet-era small commercial building facade, ground-floor shop with wide plate glass display windows in metal frames, upper floors of smooth rendered concrete or brick, simple utilitarian signage space, snow-covered ledges, muted cream-grey commercial palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — closed uniform double-paned insulated windows, thick frames for cold protection, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform concrete panel or brick texture, NO text',
    'ground floor — entrance with heavy insulated doors or shop display, NO text NO signage',
    'cornice — horizontal concrete panel joint band or simple trim ledge, NO text',
    'roof cap — flat or low-pitch parapet edge with snow accumulation, NO text',
  ],
  emissive: [
    'windows at night — warm golden interior glow behind frost-patterned glass, uniform warm light emission, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — faint warm light from entrance, mostly dark facade, NO text',
    'cornice at night — completely dark concrete trim, no light, dark facade, NO text',
    'roof cap at night — completely dark parapet against dark sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing window frame recesses, double-pane depth, and thick frame relief',
    'normal map of wall pier — blue-purple normal map showing concrete panel seams, brick mortar joints, or log surface texture',
    'normal map of ground floor — blue-purple normal map showing door frame depth and entrance relief',
    'normal map of cornice — blue-purple normal map showing panel joint profiles and ledge relief',
    'normal map of roof cap — blue-purple normal map showing parapet edge and snow accumulation relief',
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
      'Photorealistic, flat front elevation, overcast winter daylight, snow visible.',
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
