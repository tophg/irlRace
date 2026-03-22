#!/usr/bin/env node
// gen-piran-facade-tiles.mjs — Generate 40 Piran facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-piran-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/piran_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Venetian/Adriatic architectural styles (columns)
const STYLES = [
  // Col 0 — Venetian palazzo (ochre-gold)
  'Piran Venetian palazzo facade, weathered ochre-gold stucco over stone, pointed Gothic arched windows with ornamental stone tracery, slender stone balconies with iron railings, warm ochre-gold Mediterranean palette',

  // Col 1 — Painted stucco townhouse (salmon-pink)
  'Piran painted stucco townhouse facade, smooth rendered walls in warm salmon-pink, tall wooden shuttered windows with green-painted louvred shutters, simple stone window sills, warm salmon-pink Mediterranean palette',

  // Col 2 — Rough limestone facade (grey stone)
  'Piran exposed Istrian limestone masonry facade, rough-cut warm grey stone blocks with visible mortar joints, deeply recessed small windows with heavy stone lintels, natural warm grey Istrian stone palette',

  // Col 3 — Adriatic shopfront (terracotta-orange)
  'Piran Adriatic coastal shopfront building facade, painted stucco walls in warm terracotta-orange, ground-floor commercial display window with timber frame, upper residential windows with wooden shutters, terracotta-orange Mediterranean palette',

  // Col 4 — Venetian Gothic doorway house (cream-white)
  'Piran Venetian Gothic residential facade, cream-white rendered stucco walls, pointed arch doorway with decorative stone surround, Gothic trefoil window openings with stone mullions, cream-white Venetian palette',

  // Col 5 — Weathered fishing harbor (faded blue-green)
  'Piran old fishing harbor building facade, sea-weathered stucco walls in faded blue-green, peeling paint revealing stone beneath, simple shuttered windows with weathered timber frames, faded blue-green coastal palette',

  // Col 6 — Medieval stone tower house (dark stone)
  'Piran medieval stone tower house facade, narrow tall proportions, rough-cut dark warm limestone masonry, minimal small window openings with heavy stone arches, dark warm stone medieval Istrian palette',

  // Col 7 — Pastel rendered residential (lavender-mauve)
  'Piran pastel residential building facade, smooth rendered walls painted soft lavender-mauve, simple wooden louvred shuttered windows, decorative stone cornice detail, soft lavender-mauve pastel Mediterranean palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — tall narrow wooden shuttered windows with louvred shutters, stone sills, slight recess into wall, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform stucco render or exposed stone texture, NO text',
    'ground floor — entrance with wooden or stone-framed door, arched or rectangular doorway, NO text NO signage',
    'cornice — decorative stone cornice or simple plaster moulding at eave line, NO text',
    'roof cap — terracotta clay tile roof edge or stone parapet with weathering, NO text',
  ],
  emissive: [
    'windows at night — warm golden candlelight glow behind shuttered window panes, Mediterranean evening ambiance, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — warm light spilling from doorway or shopfront, mostly dark facade, NO text',
    'cornice at night — completely dark cornice, no light, dark facade, NO text',
    'roof cap at night — completely dark roofline against twilight Adriatic sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing shuttered window recess depth, louvre slat profiles, and stone sill',
    'normal map of wall pier — blue-purple normal map showing stucco render texture or exposed stone block profiles',
    'normal map of ground floor — blue-purple normal map showing door panel depth, stone arch relief, and step profiles',
    'normal map of cornice — blue-purple normal map showing moulding profiles, dentil block relief, and eave edge',
    'normal map of roof cap — blue-purple normal map showing terracotta tile ridge profiles or stone parapet edge',
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
      'Photorealistic, flat front elevation, warm Mediterranean golden hour light.',
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
