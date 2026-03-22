#!/usr/bin/env node
// gen-cap-haitien-facade-tiles.mjs — Generate 40 Cap-Haïtien facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-cap-haitien-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/cap_haitien_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Cap-Haïtien architectural styles (columns)
const STYLES = [
  // Col 0 — French colonial townhouse (Rue Espagnole)
  'Cap-Haïtien French colonial townhouse facade, thick masonry walls plastered and painted in faded warm ochre-yellow, tall louvered wooden shutters on narrow windows, ornate wrought iron balcony with filigree railings, heavy wooden door with transom, tropical weathering and peeling paint patches, warm faded ochre-yellow palette',

  // Col 1 — Haitian gingerbread house
  'Cap-Haïtien Haitian gingerbread Victorian house facade, elaborate decorative fretwork wood trim along eaves and porches, ornate carved wooden balustrades and brackets, painted in vibrant turquoise blue over weathered timber, wide verandah openings, intricate lacework woodwork details, bright turquoise-blue with white trim palette',

  // Col 2 — Painted concrete block commercial
  'Cap-Haïtien painted concrete block commercial building facade, rough cinder block walls rendered with cement plaster and painted in vivid Caribbean coral-pink, metal security shutters on ground-floor shops, simple rectangular window openings, tropical staining and worn paint, vivid coral-pink painted palette',

  // Col 3 — Colonial stone warehouse (waterfront)
  'Cap-Haïtien colonial-era stone warehouse building facade, thick rough-cut coral limestone block walls with lime mortar joints, heavy arched loading doorways, small deeply set iron-barred windows, massive stone lintels, centuries of tropical weathering and moss staining, weathered grey-tan coral stone palette',

  // Col 4 — Tin-roof tropical residential
  'Cap-Haïtien modest tropical residential building facade, plastered masonry walls painted in bright lime-green, louvered jalousie windows for ventilation, corrugated metal elements, simple wooden door surrounds, tropical mildew staining on lower walls, bright lime-green painted palette',

  // Col 5 — Haitian Art Deco commercial
  'Cap-Haïtien Haitian Art Deco influenced commercial building facade, smooth rendered concrete with geometric stepped cornice details, rounded corner window openings, streamlined horizontal banding, painted in warm mango-orange with cream accents, 1930s Caribbean modernism, warm mango-orange palette',

  // Col 6 — French colonial government (Place d\'Armes)
  'Cap-Haïtien French colonial government or institutional building facade, formal symmetrical plastered masonry in faded cream-white, tall arched windows with heavy stone voussoirs, classical pilasters and pediment details, double-height ground floor arcades, dignified colonial proportions, faded cream-white colonial palette',

  // Col 7 — Market stall / informal commercial
  'Cap-Haïtien informal market or small shop building facade, patched concrete block and painted plywood walls in bright Caribbean purple-violet, improvised metal awning supports, wide open shop-front openings, hand-painted trim, vibrant informal tropical character, bright purple-violet painted palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — closed louvered wooden shutters or jalousie windows, simple painted frames, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform painted plaster or stone texture, NO text',
    'ground floor — shop-front or entrance with heavy wooden doors, iron gate details, NO text NO signage',
    'cornice — horizontal decorative wooden fretwork band or simple plaster molding, NO text',
    'roof cap — parapet edge or eave overhang with corrugated metal visible above, NO text',
  ],
  emissive: [
    'windows at night — warm golden interior glow behind louvered shutters, uniform warm light emission, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — faint warm light from doorway or shop opening, mostly dark facade, NO text',
    'cornice at night — completely dark decorative trim, no light, dark facade, NO text',
    'roof cap at night — completely dark roofline against dark sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing louvered shutter slat depth, frame recesses, and jalousie angle relief',
    'normal map of wall pier — blue-purple normal map showing plaster surface texture, stone block coursing, or concrete block pattern',
    'normal map of ground floor — blue-purple normal map showing door panel depth, iron gate bar relief, and step profiles',
    'normal map of cornice — blue-purple normal map showing fretwork carving depth, bracket profiles, and molding relief',
    'normal map of roof cap — blue-purple normal map showing corrugated metal ridges and eave overhang relief',
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
