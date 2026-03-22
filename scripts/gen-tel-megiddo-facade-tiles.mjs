#!/usr/bin/env node
/**
 * gen-tel-megiddo-facade-tiles.mjs — Generate all 40 facade tiles for Tel Megiddo
 * using the Nano Banana 2 (Gemini 3.1 Flash Image) API.
 *
 * Tel Megiddo (Armageddon) is a UNESCO World Heritage archaeological tel in Israel's
 * Jezreel Valley. Architecture spans Early Bronze through Iron Age:
 * - Canaanite monumental ashlar palaces with 2m-thick walls
 * - Iron Age six-chambered gates with casemate wall systems
 * - Mudbrick domestic architecture with lime plaster
 * - Fieldstone fortifications with basalt foundations
 * - Proto-Aeolic limestone column capitals
 * - Great Temple megaron with 4m-wide parallel stone walls
 *
 * REFERENCE IMAGE FEEDBACK: For each column, row 0 (windows) is generated first.
 * That tile is then passed as a --ref image when generating rows 1-4.
 *
 * Usage: GEMINI_API_KEY=... node scripts/gen-tel-megiddo-facade-tiles.mjs [type]
 *   type: 'diffuse' (default), 'emissive', 'normal'
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const NB2_SCRIPT = join(__dirname, 'nb2-generate.mjs');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('Set GEMINI_API_KEY'); process.exit(1); }

const tileType = process.argv[2] || 'diffuse';
const outDir = `/tmp/tel_megiddo_facade_${tileType}`;
mkdirSync(outDir, { recursive: true });

// ── Column styles (Tel Megiddo archaeological archetypes, research-informed) ──
const COL_STYLES = [
  // Col 0: Canaanite monumental ashlar — Bronze Age palace walls
  'ancient Canaanite monumental ashlar wall, large precisely dressed golden-tan limestone blocks with tight dry-stone joints, Bronze Age palatial architecture, warm honey-colored nari limestone, smooth hammer-dressed face with marginal drafting, 2-meter-thick wall section',
  // Col 1: Iron Age casemate wall — Israelite fortification
  'Iron Age Israelite casemate wall, two parallel walls of roughly hewn limestone with internal cross-partitions, grey-tan fieldstone with mud mortar fill between courses, 9th century BCE military architecture, offset-inset wall pattern',
  // Col 2: Mudbrick domestic — Canaanite residential
  'ancient Canaanite mudbrick wall, sun-dried clay bricks in regular courses with thin mud mortar, patches of degraded white lime plaster revealing warm brown bricks underneath, Middle Bronze Age domestic architecture, weathered and eroded surface',
  // Col 3: Six-chambered gate complex — monumental dressed stone
  'Israelite six-chambered gate complex stonework, massive hewn limestone ashlar blocks with boss marks and marginal drafting, monumental orthostats at base course, basalt threshold stones, Iron Age IIA fortification gate architecture',
  // Col 4: Great Temple megaron — Early Bronze Age sacred
  'Early Bronze Age Great Temple wall, massive parallel fieldstone wall four meters wide, large uncut limestone boulders and cobbles with mud mortar, ancient Canaanite sacred architecture, circular altar stone elements embedded',
  // Col 5: Lime-plastered fieldstone — domestic/administrative
  'ancient plastered fieldstone wall, thick cream-white lime plaster coat over irregular limestone rubble fill, weathering cracks revealing rough stone beneath, smooth plaster surface with ancient repair patches, Canaanite administrative building',
  // Col 6: Basalt foundation wall — volcanic stone fortification
  'dark basalt foundation wall, large roughly shaped volcanic basalt boulders fitted together with minimal mortar, dark grey-black weathered stone surface, Canaanite defensive fortification base course, megalithic construction with rubble fill core',
  // Col 7: Reconstructed archaeological display — restored limestone
  'reconstructed archaeological site wall, neatly restored limestone block wall with modern grey cement pointing, clean warm golden nari limestone, archaeological site conservation, proto-Aeolic carved capital fragment embedded, visitor heritage display',
];

// ── Row element descriptions (adapted for ancient ruins context) ──
const ROW_ELEMENTS = [
  'upper wall section showing small narrow window openings or ventilation slits in thick ancient stone or mudbrick wall, typical of Bronze Age fortified architecture, deep-set openings in massive masonry',
  'solid wall surface section, windowless facade showing the primary building material texture (dressed ashlar, fieldstone rubble, mudbrick courses) with joints, mortar lines, and millennia of surface weathering, NO windows',
  'ground floor base showing a low doorway threshold with large basalt lintel stone, or thick foundation course with oversized ashlar blocks, typical of ancient Near Eastern ground-level monumental construction',
  'horizontal transition band showing a stone string course, projecting ledge, change in masonry technique between construction phases, or header course marking floor level in multi-period archaeological stratigraphy',
  'wall cap and ruin edge showing the crumbling top of an ancient wall: rough broken stone coping, eroded mudbrick top, or archaeological excavation exposure edge with visible stratification layers against sky',
];

// ── Type-specific prompt suffixes ──
const TYPE_SUFFIX = {
  diffuse: 'Bright harsh Mediterranean sunlight showing realistic ancient stone colors, textures, deep weathering, and millennia of patina. Warm dry Jezreel Valley climate, golden-tan limestone, dust accumulation in joints, lichen patches on north-facing surfaces.',
  emissive: 'NIGHTTIME scene. All windows glow warm yellow/amber from interior torch or oil lamp lighting. Everything EXCEPT lit window panes must be pure black (#000000). This is an emissive glow mask.',
  normal: 'Normal map texture tile. Flat purple-blue (#8080FF) base. Emboss/relief showing depth of stone block joints, mortar recesses, ashlar drafting margins, plaster surface texture, mudbrick course lines. NO color, only tangent-space normal map data.',
};

const BASE_PROMPT = 'Seamlessly tileable architectural facade texture tile, 512x512 pixels, perfectly flat orthographic front view with no perspective or vanishing points. Game texture asset, no background, no sky, no ground visible. Left and right edges must tile seamlessly. NO TEXT, NO SIGNAGE.';

function runGenerate(prompt, outputPath, refPath) {
  const refArg = refPath && existsSync(refPath) ? `--ref "${refPath}"` : '';
  const cmd = `GEMINI_API_KEY="${API_KEY}" node "${NB2_SCRIPT}" "${prompt.replace(/"/g, '\\"')}" "${outputPath}" ${refArg}`;
  execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit', timeout: 60000 });
}

async function generateAll() {
  const suffix = TYPE_SUFFIX[tileType] || TYPE_SUFFIX.diffuse;
  let count = 0;
  const total = 40;

  for (let col = 0; col < 8; col++) {
    const refPath = `${outDir}/r0_c${col}.png`;

    for (let row = 0; row < 5; row++) {
      count++;
      const prompt = `${BASE_PROMPT} ${COL_STYLES[col]}. This tile shows the ${ROW_ELEMENTS[row]}. ${suffix}`;
      const outPath = `${outDir}/r${row}_c${col}.png`;
      const useRef = row > 0 ? refPath : null;

      console.log(`\n[${count}/${total}] r${row}_c${col} ${useRef ? '(with ref)' : '(seed tile)'}`);
      console.log(`  Style: ${COL_STYLES[col].substring(0, 60)}...`);

      try {
        runGenerate(prompt, outPath, useRef);
      } catch (err) {
        console.error(`  ✗ FAILED: ${err.message}`);
        console.log('  ↻ Retrying in 3s...');
        await new Promise(r => setTimeout(r, 3000));
        try {
          runGenerate(prompt, outPath, useRef);
        } catch (err2) {
          console.error(`  ✗ RETRY FAILED: ${err2.message}`);
        }
      }

      if (count < total) await new Promise(r => setTimeout(r, 1000));
    }
  }
  console.log(`\n✅ Done: ${count} tiles in ${outDir}`);
}

generateAll();
