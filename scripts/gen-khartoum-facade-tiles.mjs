#!/usr/bin/env node
// gen-khartoum-facade-tiles.mjs — Generate 40 Khartoum facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-khartoum-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/khartoum_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Khartoum architectural styles (columns)
const STYLES = [
  // Col 0 — Red fired brick (classic Khartoum)
  'Khartoum Nile-region building, warm red-brown fired brick facade with recessed mortar joints, simple rectangular window openings with concrete lintels, flat roofline, dusty warm terracotta-red palette',

  // Col 1 — Anglo-Egyptian colonial
  'Khartoum Anglo-Egyptian colonial building from early 1900s, whitewashed plaster facade over brick, deep verandah arches with rounded tops, heavy cornice moldings, louvered wooden shutters, warm cream-white palette with sandy undertones',

  // Col 2 — Nubian mud-brick vernacular
  'Khartoum traditional Nubian-influenced building, sun-dried mud-brick facade with thick rounded walls, small deeply recessed window openings, hand-plastered surface with earthy texture, warm ochre-brown desert palette',

  // Col 3 — Tropical modernist (Khartoum Style 1950s-60s)
  'Khartoum tropical modernist building from 1960s, reinforced concrete facade with deep sun-breaker brise-soleil screens, projecting cantilevered balconies, horizontal window bands between concrete panels, brutalist functional design, cool gray concrete palette',

  // Col 4 — White stucco residential
  'Khartoum residential villa building, bright white smooth stucco-plastered facade, flat roof with thin parapet, narrow rectangular windows with metal grilles, minimalist cubic form, clean bright white palette with slight sandy dust tinge',

  // Col 5 — Omdurman market (old commercial)
  'Khartoum Omdurman-style old commercial building, weathered sandy-tan plaster facade over brick, wide arched ground-floor openings for shops, wooden lattice mashrabiya window screens, traditional market proportions, warm sandy-tan palette',

  // Col 6 — Islamic institutional
  'Khartoum Islamic institutional building, pale sandstone-colored facade with pointed arch window frames, geometric Islamic carved relief patterns, crenellated parapet details, minaret-inspired vertical elements, warm pale sandstone palette',

  // Col 7 — Modern concrete commercial
  'Khartoum modern commercial office building, smooth beige-gray concrete panel facade, large rectangular tinted glass windows with thin aluminum frames, simple gridded composition, contemporary functional design, muted beige-gray palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — closed uniform shuttered or grilled windows, plain frames, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface, uniform texture, NO text',
    'ground floor — commercial entrance with doors or arched openings, NO text NO signage',
    'cornice — horizontal decorative molding band or trim, NO text',
    'roof cap — parapet edge with sky visible above, NO text',
  ],
  emissive: [
    'windows at night — warm golden interior glow behind curtains, uniform warm light emission, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — faint warm light from doorway, mostly dark facade, NO text',
    'cornice at night — completely dark decorative trim, no light, dark facade, NO text',
    'roof cap at night — completely dark parapet against dark sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing window frame recesses, shutter depth, and grille relief',
    'normal map of wall pier — blue-purple normal map showing brick or plaster surface texture and mortar joints',
    'normal map of ground floor — blue-purple normal map showing door frame depth and archway relief',
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
