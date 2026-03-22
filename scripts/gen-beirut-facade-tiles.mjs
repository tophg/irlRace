#!/usr/bin/env node
// gen-beirut-facade-tiles.mjs — Generate 40 Beirut facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-beirut-facade-tiles.mjs [diffuse|emissive|normal]
//
// Research-informed Beirut architectural styles:
// - Ottoman-era (1516-1918): yellow sandstone load-bearing walls, triple-arch facades
//   with slender marble columns, ornate wrought-iron balconies, red Marseille roof tiles,
//   carved stone moldings, Central Hall house plan
// - French Mandate (1920-1943): Art Deco/Beaux-Arts geometry, reinforced concrete,
//   simplified arches → rectangular openings, bay windows, sandstone with limestone cladding
// - Central Hall houses: Tuscan-style triple arches, Mandaloun two-arched mullioned windows,
//   colored glass (vitraille), high ceilings, vaulted ground floors
// - Post-war reconstruction: patched concrete, modern aluminum frames over scarred masonry
// - Materials: yellow sandstone, limestone cladding, marble columns, red Marseille tiles,
//   wrought-iron railings, tinted glass

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/beirut_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 research-informed Beirut architectural styles (columns)
const STYLES = [
  // Col 0 — Ottoman sandstone mansion (warm ochre-gold)
  'Beirut Ottoman-era sandstone mansion facade, warm ochre-gold yellow sandstone load-bearing walls with limestone cladding, ornate carved stone moldings and decorative cornices, wrought-iron balconies with intricate scrollwork, warm ochre-gold Levantine palette',

  // Col 1 — Central Hall triple-arch house (honey limestone)
  'Beirut traditional Central Hall house facade, honey-colored limestone with iconic Tuscan-style triple-arch arcade on upper floor supported by slender marble columns, ornamental stone corbels, Mandaloun two-arched mullioned windows with colored vitraille glass, honey limestone heritage palette',

  // Col 2 — French Mandate Art Deco (cream-beige)
  'Beirut French Mandate Art Deco apartment building facade, smooth cream-beige rendered sandstone with limestone finish, geometric decorative bands and stepped cornices, simplified rectangular window openings with slim iron balconies, vertical Art Deco pilasters, cream-beige French colonial palette',

  // Col 3 — Red-tile roofed townhouse (terracotta-salmon)
  'Beirut traditional Levantine townhouse facade, painted stucco walls in warm terracotta-salmon, arched windows with wooden louvred shutters, hewn yellow sandstone window surrounds and sills, visible red Marseille clay roof tiles, Mediterranean terracotta-salmon palette',

  // Col 4 — Corniche waterfront commercial (white with blue trim)
  'Beirut Corniche seafront commercial building facade, white-painted rendered concrete with marine blue accent balcony railings, modern bay windows with sun awnings, ground-floor shopfront with stone surround, white and blue Levantine coastal palette',

  // Col 5 — Post-war reconstructed (muted grey)
  'Beirut post-war reconstructed building facade, patched grey concrete and new render over blast-scarred sandstone masonry, repaired windows with modern aluminum frames beside old stone arches, visible repair seams and tonal mismatches, muted grey reconstruction palette',

  // Col 6 — Painted residential block (dusty pink-rose)
  'Beirut residential apartment block facade, rendered stucco walls painted dusty pink-rose over sandstone structure, wooden shuttered double windows with small projecting balconies and wrought-iron railings, decorative plaster cornices and string courses, dusty pink-rose Mediterranean palette',

  // Col 7 — Modern downtown tower (dark grey-blue glass)
  'Beirut modern Solidere downtown tower facade, dark grey-blue tinted glass curtain wall with brushed steel mullions, narrow floor plates with minimal spandrel panels, sleek minimalist commercial design, dark grey-blue contemporary palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — tall wooden shuttered windows with arched or rectangular openings, hewn sandstone sills and carved stone surrounds, slight recess into wall, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform sandstone blocks with limestone cladding or rendered stucco texture, NO text',
    'ground floor — entrance with arched stone doorway or vaulted ground-floor opening, heavy wooden or glass door, NO text NO signage',
    'cornice — decorative carved stone cornice with dentil molding, Ottoman-influenced carved stone band or Art Deco stepped detail, NO text',
    'roof cap — red Marseille clay tile roof edge or flat Mediterranean concrete parapet with limestone coping, NO text',
  ],
  emissive: [
    'windows at night — warm golden lamplight glow behind shuttered window panes and colored vitraille glass, Mediterranean evening ambiance, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — warm light spilling from arched doorway or shopfront, mostly dark facade, NO text',
    'cornice at night — completely dark cornice, no light, dark facade, NO text',
    'roof cap at night — completely dark roofline against Mediterranean twilight sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing shuttered window recess depth, carved sandstone surround relief, and sill profiles',
    'normal map of wall pier — blue-purple normal map showing sandstone block joints, limestone cladding texture or stucco render surface',
    'normal map of ground floor — blue-purple normal map showing arched doorway depth, vaulted stone relief, and step profiles',
    'normal map of cornice — blue-purple normal map showing carved molding profiles, dentil block relief, and eave edge',
    'normal map of roof cap — blue-purple normal map showing red clay tile ridge profiles or flat parapet limestone coping edge',
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
