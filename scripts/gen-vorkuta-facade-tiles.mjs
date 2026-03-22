#!/usr/bin/env node
// gen-vorkuta-facade-tiles.mjs — Generate 40 Vorkuta facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-vorkuta-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/vorkuta_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Vorkuta architectural styles (columns)
const STYLES = [
  // Col 0 — Abandoned Khrushchyovka panel block
  'Vorkuta abandoned Soviet Khrushchyovka panel housing facade, crumbling precast concrete panels with exposed rebar and frost damage, broken small rectangular windows with missing glass panes, ice staining and black mold patches, grey-brown weathered concrete palette',

  // Col 1 — Stalinist-era administrative building
  'Vorkuta Soviet Stalinist administrative building facade, heavy grey rendered concrete with classical pretensions, tall narrow windows with cracked stone surrounds, propaganda relief panels above entrance, snow accumulation on ledges, dark grey institutional concrete palette',

  // Col 2 — Coal mine industrial structure
  'Vorkuta coal mine industrial building facade, corrugated metal cladding over steel frame with heavy rust and oxidation, metal-framed industrial windows with wire glass, coal dust staining, exposed pipe runs and conduit, rusted brown-orange industrial palette',

  // Col 3 — Soviet workers dormitory (obshchezhitiye)
  'Vorkuta Soviet workers dormitory facade, long monotonous rendered concrete block with repeating identical small windows, peeling pale blue or green paint over render, frost-cracked plaster revealing brick substrate, faded pastel over grey palette',

  // Col 4 — Gulag-era brick barracks
  'Vorkuta gulag-era brick barracks facade, dark handmade brick with crude mortar joints, small barred windows with heavy steel frames, weathered brick with white salt efflorescence from freeze-thaw cycles, dark red-brown frost-damaged brick palette',

  // Col 5 — Abandoned concrete school/cultural center
  'Vorkuta abandoned Soviet school or cultural center facade, large poured concrete panels with decorative mosaic fragments still visible, wide windows with smashed glass and plywood boarding, graffiti tags on lower walls, grey concrete with faded mosaic accent palette',

  // Col 6 — Soviet-era boiler house/heating plant
  'Vorkuta Soviet boiler house facade, heavy brick and concrete industrial structure with corrugated metal additions, large ventilation openings with rusted metal louvres, thick insulated pipes entering through wall, soot-stained brick with metal patches palette',

  // Col 7 — Prefab concrete garage/storage blocks
  'Vorkuta Soviet prefab concrete garage block facade, raw precast concrete panels with minimal openings, roll-up corrugated metal doors with heavy rust, crude concrete lintels, snow drifts against base, raw grey concrete with rusted metal palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — broken or boarded small rectangular windows with frost damage, cracked frames, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, cracked weathered concrete or brick with frost damage and staining, NO text',
    'ground floor — deteriorated entrance with damaged door, snow accumulation at base, debris, NO text NO signage',
    'cornice — damaged horizontal concrete or brick band, crumbling molding with exposed rebar or missing sections, NO text',
    'roof cap — flat damaged parapet with broken edges, icicles hanging from rim, snow accumulation, NO text',
  ],
  emissive: [
    'windows at night — very faint dim yellow light in one pane, most windows completely dark and broken, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — faint flickering light from one doorway, rest completely dark, dark facade, NO text',
    'cornice at night — completely dark damaged trim, no light, dark facade, NO text',
    'roof cap at night — completely dark parapet against dark Arctic sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing cracked window frame recesses, broken glass depth, and damaged surround relief',
    'normal map of wall pier — blue-purple normal map showing concrete panel seams, crack patterns, and frost-damaged surface texture',
    'normal map of ground floor — blue-purple normal map showing damaged doorframe depth, debris relief, and snow drift profiles',
    'normal map of cornice — blue-purple normal map showing crumbling molding profiles, exposed rebar, and broken edge relief',
    'normal map of roof cap — blue-purple normal map showing damaged parapet edge, icicle formations, and snow accumulation texture',
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
      'Photorealistic, flat front elevation, overcast grey Arctic sky.',
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
