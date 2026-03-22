#!/usr/bin/env node
// gen-iqaluit-facade-tiles.mjs — Generate 40 Iqaluit facade tiles via NB2 API
// Usage: GEMINI_API_KEY=... node scripts/gen-iqaluit-facade-tiles.mjs [diffuse|emissive|normal]

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');

const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/iqaluit_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 Iqaluit architectural styles (columns)
const STYLES = [
  // Col 0 — Bright blue prefab house on stilts
  'Iqaluit Arctic prefab house facade, bold cobalt blue painted metal-clad walls on elevated permafrost stilts, small triple-paned windows with white PVC frames, corrugated metal siding with visible rivets, snow drifts at base, bright blue over white trim palette',

  // Col 1 — Red government/institutional building
  'Iqaluit Arctic government building facade, bright red painted metal cladding panels, large double-glazed windows with aluminum frames, flat-roofed institutional design elevated on concrete piers, exposed utilidor pipes along base, bold red with grey trim palette',

  // Col 2 — Yellow prefab residential duplex
  'Iqaluit Arctic residential duplex facade, bright canary yellow painted wood and metal siding, paired entry porches with enclosed vestibules, small windows with storm shutters, metal chimney stacks, yellow painted cladding over steel frame palette',

  // Col 3 — Green community/commercial building
  'Iqaluit Arctic community building facade, forest green painted corrugated metal cladding, large storefront windows with metal security bars, above-ground utilidor service connections, snow fencing at ground level, green metal cladding with white accent palette',

  // Col 4 — Unpainted corrugated metal utilitarian structure
  'Iqaluit Arctic utilitarian warehouse facade, unpainted galvanized corrugated steel panels with visible fasteners and seams, small rectangular windows with wire mesh guards, industrial roll-up doors, fuel tanks adjacent, raw silver-grey galvanized steel palette',

  // Col 5 — Orange/rust prefab modular housing
  'Iqaluit Arctic modular housing facade, burnt orange painted insulated metal panels with snap-lock seams, small sealed double-pane windows, arctic entry vestibule projection, satellite dish on wall, exposed mechanical vents, orange-rust painted panel palette',

  // Col 6 — White municipal/health building
  'Iqaluit Arctic municipal building facade, clean white painted metal panel cladding with blue accent trim, large energy-efficient windows with internal blinds, accessible ramp with metal railings, Canadian flag bracket, white with blue accent palette',

  // Col 7 — Brown wooden traditional-influenced building
  'Iqaluit Arctic traditional-influenced building facade, dark brown stained wood board-and-batten cladding, small deeply recessed windows with thick frames against wind, stone and poured concrete foundation visible above permafrost, dark brown wood with grey stone base palette',
];

// Row descriptions
const ROWS = {
  diffuse: [
    'windows — small triple-glazed Arctic windows with thick PVC or aluminum frames, frost on outer pane, condensation visible, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface of painted metal cladding panels with visible rivets and snap-lock seams, NO text',
    'ground floor — elevated base showing permafrost stilts or concrete piers, utilidor pipes, snow accumulation around supports, NO text NO signage',
    'cornice — simple metal fascia trim or parapet edge, icicles hanging, snow accumulation on ledge, NO text',
    'roof cap — flat or low-slope corrugated metal roof edge with snow load, ventilation stacks, NO text',
  ],
  emissive: [
    'windows at night — warm bright amber glow from occupied windows against dark Arctic night, most windows warmly lit, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, only faint ambient snow reflection, dark facade, NO text',
    'ground floor at night — faint warm light from enclosed vestibule entry, utility light on stilt, dark facade, NO text',
    'cornice at night — completely dark metal trim, no light, dark facade, NO text',
    'roof cap at night — completely dark roof edge against black Arctic sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing recessed window frame depth, thick triple-pane glass profile, and frame surround relief',
    'normal map of wall pier — blue-purple normal map showing corrugated metal panel ridges, rivet bumps, and snap-lock seam profiles',
    'normal map of ground floor — blue-purple normal map showing stilt/pier depth, utilidor pipe cylinder profiles, and snow drift texture',
    'normal map of cornice — blue-purple normal map showing metal fascia edge profile, icicle forms, and snow accumulation relief',
    'normal map of roof cap — blue-purple normal map showing corrugated roof edge ripples, ventilation stack profiles, and snow load texture',
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
