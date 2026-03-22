#!/usr/bin/env node
// gen-dublin-facade-tiles.mjs — Generate 40 Dublin facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-dublin-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/dublin_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Dublin architectural styles (columns)
const STYLES = [
  // Col 0 — Georgian brick townhouse (Merrion Square)
  'Dublin Georgian townhouse facade, warm handmade red-brown brick with irregular texture, tall symmetrical sash windows decreasing in size on upper floors, ornate limestone doorcase with fanlight above, wrought iron balconette railings, classical proportions, warm red-brown brick palette',

  // Col 1 — Georgian granite institutional (Trinity College)
  'Dublin Georgian institutional building, grey Leinster granite ashlar facade with Portland stone trim, tall rectangular windows with stone surrounds and keystones, heavy classical pediment details, rusticated ground floor, austere grey limestone palette',

  // Col 2 — Red brick Victorian terrace
  'Dublin red-brick Victorian terrace house facade, mass-produced uniform red brick with cream-colored brick string courses, bay window projections with decorative carved stone lintels, ornate brick chimney details, polychromatic brickwork accents, warm red brick with cream trim palette',

  // Col 3 — Rendered stucco Edwardian
  'Dublin Edwardian rendered facade, smooth painted stucco plaster in muted pastel colors, wide sash windows with delicate glazing bars, decorative plaster cornices and door surrounds, pebble-dash lower wall sections, muted cream-sage-blue pastel palette',

  // Col 4 — Painted Georgian row (Portobello/Camden)
  'Dublin painted Georgian row house facade, smooth painted plaster over brick in bright colors like blue yellow red, tall elegant sash windows with thin glazing bars, decorative door surrounds with columns and fanlights, painted quoin corners, bright vivid painted street palette',

  // Col 5 — Stone-front pub/commercial (Temple Bar)
  'Dublin traditional pub or shop front facade, dark painted timber shopfront below with ornate carved brackets and fascia board, polished granite or painted brick above, small-paned upper windows, ornamental pub signage area in dark green or maroon, dark pub-green and gilt palette',

  // Col 6 — Victorian limestone church/civic
  'Dublin Victorian civic building facade, dressed pale Portland limestone blocks with carved decorative cornices, tall pointed or round-headed windows with carved stone tracery, heavy rusticated base, Renaissance Revival ornamental details, pale warm limestone palette',

  // Col 7 — Modern glass/concrete (Docklands)
  'Dublin modern Docklands commercial building, smooth concrete and glass curtain wall facade, large floor-to-ceiling glazed panels in aluminum frames, clean geometric grid composition, brushed metal spandrel panels between floors, cool grey-silver glass palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — closed uniform sash windows with thin glazing bars, stone or brick surrounds, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform brick or stone texture, NO text',
    'ground floor — entrance with doorcase or shopfront, iron railings and granite steps, NO text NO signage',
    'cornice — horizontal decorative stone or plaster molding band with dentils, NO text',
    'roof cap — parapet edge with chimney pots and slate roof visible above, NO text',
  ],
  emissive: [
    'windows at night — warm golden interior glow behind curtains, uniform warm light emission, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — faint warm light from doorway or pub glow, mostly dark facade, NO text',
    'cornice at night — completely dark decorative trim, no light, dark facade, NO text',
    'roof cap at night — completely dark parapet against dark sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing sash window frame recesses, glazing bar depth, and stone surround relief',
    'normal map of wall pier — blue-purple normal map showing brick mortar joints or stone block coursing surface texture',
    'normal map of ground floor — blue-purple normal map showing doorcase depth, railing relief, and step profiles',
    'normal map of cornice — blue-purple normal map showing molding profiles, dentil patterns, and trim relief',
    'normal map of roof cap — blue-purple normal map showing parapet edge, chimney pot relief, and slate texture',
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
      'Photorealistic, flat front elevation, overcast daylight.',
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
