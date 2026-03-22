#!/usr/bin/env node
// gen-sukhumi-facade-tiles.mjs — Generate 40 Sukhumi facade tiles via NB2 API
// Research-informed: Sukhumi = capital of Abkhazia, abandoned Black Sea resort
// city, 1992-93 war damage, subtropical overgrowth on Soviet architecture
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const NB2 = resolve(__dirname, 'nb2-generate.mjs');
const TYPE = process.argv[2] || 'diffuse';
const OUTDIR = `/tmp/sukhumi_facade_${TYPE}`;
mkdirSync(OUTDIR, { recursive: true });

// 8 research-informed Sukhumi architectural styles
const STYLES = [
  // Col 0 — Stalinist sanatorium (grand resort, cream stucco, ornamental)
  'Sukhumi Stalinist sanatorium facade, grand 1940s-50s Socialist Classicism resort architecture, cream-colored stucco with ornamental balustrades and columns, French windows with wooden louvred shutters, decorative cornices and medallions, subtropical vines growing up walls, moss in crevices, paint peeling in patches, warm cream and faded gold palette',

  // Col 1 — Soviet Brutalist government building (raw concrete, war damage)
  'Sukhumi Soviet Brutalist government building facade, 1980s-era exposed raw concrete panel construction, repetitive window grid pattern with some windows smashed and blackened from 1992 fire damage, scorched concrete above openings, weeds growing from cracks, dark grey brutalist concrete with char marks palette',

  // Col 2 — Art Nouveau Hotel Abkhazia (1930s landmark, 5-floor embankment)
  'Sukhumi 1930s Art Nouveau resort hotel facade, elegant five-story pre-war beachfront hotel with decorative plasterwork, arched windows on ground floor transitioning to rectangular above, ornate iron balcony railings with Art Nouveau curves, faded pastel yellow walls with white stucco ornament, subtropical weathering, faded yellow with white and green patina palette',

  // Col 3 — Faded Soviet apartment block (beige prefab panels)
  'Sukhumi faded Soviet apartment block facade, 1960s-70s prefab concrete panel construction with prominent white vertical staircase sections breaking up faded beige wall panels, small rectangular windows with thin metal frames, laundry hanging from some balconies, subtropical mold staining on lower floors, faded beige concrete with white and green mold palette',

  // Col 4 — Pre-war Caucasian villa (stone arches, iron balconies)
  'Sukhumi pre-war Caucasian residential villa facade, early 20th century local stone construction with decorative arched windows and doorways, wrought iron balconies with geometric patterns, exposed rough-cut limestone walls with rendered sections, fig and wisteria growing through cracks, warm honey limestone with dark iron accent palette',

  // Col 5 — War-damaged commercial (bullet-pocked, graffiti)
  'Sukhumi war-damaged commercial building facade, rendered concrete storefront structure with dense bullet-pock damage across surface, blast-cracked walls showing rebar beneath, metal security shutters permanently closed over ground-floor shops, political graffiti in Cyrillic script area, subtropical weeds at base, pock-marked grey render with rust stain palette',

  // Col 6 — Abandoned railway station (Stalinist Gothic)
  'Sukhumi abandoned Stalinist railway station facade, grand Socialist Classicism with symmetrical design, tall arched entrance portals, decorative pilasters and entablature, clock tower element, platform canopy visible, heavy subtropical vegetation encroaching on all lower surfaces, pale grey monumental stucco with green overgrowth palette',

  // Col 7 — Black Sea waterfront structure (maritime stone/concrete)
  'Sukhumi Black Sea waterfront pier building facade, seaside restaurant and promenade structure, curved concrete and stone maritime architecture, large panoramic window openings now empty, salt-eroded balustrades, barnacle-encrusted lower walls, rusted steel railings, maritime weathering with algae streaks, grey-white salt-stained concrete with sea-green patina palette',
];

const ROWS = {
  diffuse: [
    'windows — damaged or overgrown windows with subtropical vine tendrils, some with broken louvred shutters, peeling paint frames, condensation and mold on glass, NO visible interiors, NO text',
    'wall pier — solid windowless wall surface showing the characteristic material: stucco, exposed concrete, limestone, or panels, with moss patches and subtropical weathering, NO text',
    'ground floor — deteriorated entrance or shopfront with vegetation encroachment, broken steps or collapsed canopy, debris and rubble accumulation, NO text NO signage',
    'cornice — damaged ornamental molding or concrete parapet edge with plants growing from cracks, crumbling classical details, bird droppings, NO text',
    'roof cap — damaged roof edge or parapet with subtropical vegetation overtaking, broken balustrade sections, rusty antenna or satellite dish, NO text',
  ],
  emissive: [
    'windows at night — very sparse dim amber light from one or two squatter-occupied windows, most completely dark and broken, dark abandoned facade, NO text',
    'wall pier at night — completely dark solid wall, no light emission, faint blue moonlight on damp moss, dark facade, NO text',
    'ground floor at night — single dim light from occupied doorway or makeshift lamp, rest completely dark, dark facade, NO text',
    'cornice at night — completely dark damaged trim silhouette, no light, dark facade, NO text',
    'roof cap at night — completely dark parapet against night sky, no light, NO text',
  ],
  normal: [
    'normal map of windows — blue-purple normal map showing broken shutter slat depth, vine tendril relief, cracked glass, and damaged frame profiles',
    'normal map of wall pier — blue-purple normal map showing cracked stucco texture, bullet-pock craters, moss bump relief, and exposed concrete grain',
    'normal map of ground floor — blue-purple normal map showing cracked step profiles, rubble debris texture, collapsed canopy depth, and vegetation growth',
    'normal map of cornice — blue-purple normal map showing crumbling molding profiles, plant root relief, and eroded edge depth',
    'normal map of roof cap — blue-purple normal map showing broken balustrade profiles, vegetation growth, rusted metal texture, and damaged parapet edge',
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
      'Photorealistic, flat front elevation, overcast humid subtropical day.',
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
