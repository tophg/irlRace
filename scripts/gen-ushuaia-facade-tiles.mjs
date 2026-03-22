#!/usr/bin/env node
// gen-ushuaia-facade-tiles.mjs — Generate 40 Ushuaia facade tiles via NB2 API
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');
const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/ushuaia_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });
const STYLES = [
  'Ushuaia Patagonian corrugated metal house facade, bright red painted corrugated iron cladding over timber frame, small double-glazed windows with white PVC frames, steep pitched roof angle visible at top, wind-battered but maintained, bright red corrugated metal palette',
  'Ushuaia end-of-world blue timber house facade, bold navy blue painted horizontal weatherboard cladding, white-trimmed sash windows, enclosed front porch with glass panels against wind, flower boxes despite harsh climate, navy blue wood with white trim palette',
  'Ushuaia green corrugated tourist shop facade, forest green painted corrugated metal walls, large display windows with wooden frames, hand-painted sign area above, stone foundation visible, green metal with warm wood accent palette',
  'Ushuaia yellow Argentine residential facade, bright sunflower yellow painted rendered masonry, paired windows with brown timber shutters, covered balcony with timber railings, steep corrugated metal roof edge, yellow render with brown wood palette',
  'Ushuaia port-district industrial building facade, unpainted weathered corrugated zinc cladding with heavy patina, industrial windows with wire glass, loading bay with steel roller door, maritime equipment mounted on wall, weathered zinc-grey industrial palette',
  'Ushuaia alpine lodge style facade, dark stained timber log and board construction, large picture windows with heavy timber frames, stone chimney stack, steep A-frame roof line, carved timber details, dark wood with stone accent palette',
  'Ushuaia white government building facade, clean white painted rendered masonry with Argentine blue accent trim, large formal windows with aluminium frames, flagpole bracket, wheelchair ramp, institutional but maintained, white with sky-blue trim palette',
  'Ushuaia weathered fisherman cottage facade, grey weathered unpainted timber boards with silver patina, tiny deeply recessed windows, heavy plank door, rope and net hooks on wall, smokestack, grey driftwood timber palette',
];
const ROWS = {
  diffuse: [
    'windows — double-glazed windows with thick frames against Patagonian wind, frost on outer pane, white PVC or timber frames, NO visible interiors, NO text',
    'wall pier — solid windowless wall of corrugated metal or weatherboard, wind-worn surface texture, NO text',
    'ground floor — stone or concrete foundation with entrance, steep step up, wind barrier vestibule, NO text NO signage',
    'cornice — simple painted metal fascia or timber eave board, wind-worn edges, NO text',
    'roof cap — steep corrugated metal roof edge with ridge cap, snow traces, ventilation caps, NO text',
  ],
  emissive: [
    'windows at night — warm amber glow from cozy occupied windows against dark sub-Antarctic night, most windows lit, dark facade, NO text',
    'wall pier at night — completely dark solid wall, no light, dark facade, NO text',
    'ground floor at night — warm light from enclosed porch entry, welcoming glow, dark facade, NO text',
    'cornice at night — completely dark trim, no light, dark facade, NO text',
    'roof cap at night — completely dark roof edge against dark Patagonian sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing recessed window frame depth, double-pane glass profile, and thick frame surround',
    'normal map of wall pier — blue-purple normal map showing corrugated metal ridge pattern or weatherboard lap profile',
    'normal map of ground floor — blue-purple normal map showing stone foundation texture, step profiles, and vestibule projection depth',
    'normal map of cornice — blue-purple normal map showing metal fascia edge profile and timber eave board grain',
    'normal map of roof cap — blue-purple normal map showing steep corrugated roof ridge profile, cap detail, and snow trace texture',
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
      'Photorealistic, flat front elevation, overcast Patagonian sky.',
      'NO TEXT. NO SIGNAGE. NO LABELS.',
    ].join(' ');
    const args = [NB2, prompt, out];
    if (hasRef) args.push('--ref', refFile);
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        execFileSync('node', args, { stdio: 'inherit', env: process.env, timeout: 120_000 });
        break;
      } catch (err) {
        console.error(`  ✗ Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) { const wait = attempt * 3; console.log(`  ↻ Retrying in ${wait}s...`); execFileSync('sleep', [String(wait)]); }
        else console.error(`  ✗ GIVING UP on r${r}_c${c}`);
      }
    }
  }
}
console.log(`\n✅ Done: ${total} tiles in ${OUTDIR}`);
