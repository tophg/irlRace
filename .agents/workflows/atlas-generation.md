---
description: How to generate or update building facade atlas images
---

# Building Facade Atlas Generation

## Required Files

Each environment needs **4 facade images** + **1 ground atlas**:

| File | Location | Dimensions |
|------|----------|------------|
| `facade_atlas_{env}.png` | `public/buildings/` | 4096×4096 |
| `facade_atlas_{env}_emissive.png` | `public/buildings/` | 4096×4096 |
| `facade_atlas_{env}_normal.png` | `public/buildings/` | 4096×4096 |
| `facade_atlas_{env}_mobile.png` | `public/buildings/` | 1024×1024 |
| `ground_atlas_{env}.png` | `public/ground/` | 2048×256 |

> [!IMPORTANT]
> **ALL textures must have power-of-2 dimensions** (256, 512, 1024, 2048, 4096). Non-POT textures crash WebGPU mipmap generation (frozen frame, audio continues).

## Facade Atlas Layout (8 columns × 5 rows)

Each **column** (0-7) = one architectural style. Each **row** = one element type.

> [!CAUTION]
> The code (`scenery-buildings.ts`) uses exactly **5 rows** with `ATLAS_ROWS = 5`. Generating an 8-row atlas causes window tiles to appear on rooftops and other surfaces.

| Row | Type | Description | Emissive |
|-----|------|-------------|----------|
| 0 | Window | Shuttered/frosted glass (NO visible interiors) | Warm glow |
| 1 | Wall pier | Windowless wall surface (also used for roof tops) | Black |
| 2 | Ground floor | Storefront/door (NO TEXT/SIGNAGE) | Faint glow |
| 3 | Cornice | Decorative horizontal trim | Black |
| 4 | Roof cap | Parapet/roof edge with sky | Black |

### Tile Dimensions

The 4096×4096 atlas holds 40 tiles in an 8×5 grid. Each tile cell is **512×819 pixels** (non-square — tiles are stretched vertically to fill the square canvas). The stitch and emissive/normal scripts handle this resizing automatically. Generated tile images should be **square** (e.g. 512×512 or 1024×1024); the scripts resize them to 512×819 during stitching.

## Scripts

All scripts live in `scripts/` (NOT `/tmp/`). They require the `sharp` npm package.

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/stitch-atlas.mjs` | Stitch tiles → 4096×4096 diffuse atlas | `node scripts/stitch-atlas.mjs <tiles_dir> <output.png>` |
| `scripts/gen-emissive-normal.mjs` | Generate emissive + normal from tiles | `node scripts/gen-emissive-normal.mjs <tiles_dir> <emissive.png> <normal.png>` |
| `scripts/stitch-ground.mjs` | Stitch 8 ground tiles → 2048×256 | `node scripts/stitch-ground.mjs` (edit paths inside) |

> [!NOTE]
> Re-stitching always rebuilds the **entire** atlas from all 40 tiles. There is no partial/single-column stitch — modify the tile file and re-run the full stitch.

## Tile Generation Prompt Rules

### General Rules
- **NO TEXT, NO LABELS, NO SIGNAGE** — anywhere, on any tile
- Each column = one consistent style (same frames, materials, colors)
- Every tile prompt MUST include: "NO TEXT. Photorealistic, flat front elevation, even lighting."
- Feed previous column tiles as reference via `ImagePaths` for style consistency

### Window Tiles (Row 0) — Critical Quality Rules
1. **Non-descript windows** — MUST be generic. No visible furniture, bookshelves, lamps, specific curtain arrangements, or identifiable interior details. These create obvious repetition patterns when tiled.
2. **Uniform glass treatment** — Use uniform tints, frosted glass, simple blinds, or plain reflections. Each repeated tile must look indistinguishable from the next.
3. **Prompt keywords that work**: "uniform", "generic", "non-descript", "no identifiable interior details", "plain frosted glass", "even tint"
4. **Prompt keywords to AVOID**: "cozy room", "furniture visible", "bookshelf", "lamp", "detailed interior", "curtains pulled back revealing"
5. **Same principle applies to all rows** — storefronts, cornices, and roof caps should also avoid unique focal points that expose repetition.

## Step-by-Step: Generate a New Environment

### 0. Tile Preservation (CRITICAL)
Always generate and keep individual tiles in `/tmp/atlas_tiles/{env}/`:
- Naming convention: `r{row}_c{col}.png` (e.g. `r0_c0.png` through `r4_c7.png`)
- **Never delete individual tiles** after stitching — they are the source of truth
- To modify a single tile, regenerate just that file and re-run the full stitch

### 1. Generate 40 diffuse tiles (8 columns × 5 rows)
Generate tiles sequentially by column, feeding previous tiles as reference for style consistency. For each column, generate all 5 rows: window → wall pier → ground → cornice → roof cap.

Save to `/tmp/atlas_tiles/{env}/r{row}_c{col}.png`.

### 2. Quality Checklist (before stitching)
Verify tiles before committing to the stitch:

- [ ] 40 files exist: `ls /tmp/atlas_tiles/{env}/ | wc -l` → 40
- [ ] Naming is correct: `r0_c0.png` through `r4_c7.png`
- [ ] No text or signage in any tile
- [ ] Windows (row 0) are non-descript — no identifiable interiors
- [ ] Wall piers (row 1) have no windows
- [ ] Each column is visually consistent (same style across all 5 rows)

// turbo
### 3. Stitch diffuse atlas
```bash
cd /Users/devnull/irlRace
node scripts/stitch-atlas.mjs /tmp/atlas_tiles/{env} /tmp/facade_atlas_{env}.png
```

### 4. Visual verification
```bash
open /tmp/facade_atlas_{env}.png
```
Verify: 8 columns visible, 5 rows visible, 4096×4096 dimensions, no text/signage.

// turbo
### 5. Generate emissive mask + normal map
```bash
cd /Users/devnull/irlRace
node scripts/gen-emissive-normal.mjs /tmp/atlas_tiles/{env} /tmp/facade_atlas_{env}_emissive.png /tmp/facade_atlas_{env}_normal.png
```

// turbo
### 6. Generate mobile variant
The source atlas is already square (4096×4096), so resizing to 1024×1024 preserves aspect ratio.
```bash
sips -z 1024 1024 /tmp/facade_atlas_{env}.png --out /tmp/facade_atlas_{env}_mobile.png
```

// turbo
### 7. Copy all files to public/
```bash
cp /tmp/facade_atlas_{env}.png public/buildings/
cp /tmp/facade_atlas_{env}_emissive.png public/buildings/
cp /tmp/facade_atlas_{env}_normal.png public/buildings/
cp /tmp/facade_atlas_{env}_mobile.png public/buildings/
```

### 8. Post-Copy Validation
```bash
# Verify all 4 files exist and are POT dimensions
for f in public/buildings/facade_atlas_{env}*.png; do
  sips -g pixelWidth -g pixelHeight "$f"
done
# Expected: diffuse/emissive/normal = 4096×4096, mobile = 1024×1024
```

### 9. Generate ground atlas (8-tile strip, 2048×256)

The ground shader samples 4 distance zones × 2 variants per zone. Output: `public/ground/ground_atlas_{env}.png` (2048×256).

#### Ground Atlas Layout

```
| Shoulder A | Shoulder B | Urban A | Urban B | Open A | Open B | Far A | Far B |
|    0–8m    |    0–8m    |  8–20m  |  8–20m  | 20–60m | 20–60m |  60m+ |  60m+ |
```

Each tile is 256×256 in the final atlas. `tw = 0.125 = 1/8` in the TSL shader (`scene.ts:937`).

#### Zone Descriptions

| Zone | Content | Detail Level |
|------|---------|-------------|
| **Shoulder** (0–8m) | Paved area near road — concrete, asphalt, curb debris | High detail, urban materials |
| **Urban** (8–20m) | Transitional — broken pavers, packed dirt, rubble, weeds | Medium detail, mixed materials |
| **Open** (20–60m) | Environment-specific terrain — sand, grass, gravel, scrub | Medium detail, natural |
| **Far** (60m+) | Distant ground — sparse, faded, blends toward fog | Low detail, minimal features |

#### Generation Order

Generate tiles **sequentially with cross-referencing** for color continuity. Feed previous tile as reference via `ImagePaths`.

1. **Shoulder A** — base tile, establishes the color palette
2. **Shoulder B** — reference: Shoulder A → "same palette, different pattern"
3. **Urban A** — reference: Shoulder A → "same palette, more earth, less concrete"
4. **Urban B** — reference: Urban A → "same palette, different arrangement"
5. **Open A** — reference: Urban A → "same palette, more natural, less rubble"
6. **Open B** — reference: Open A → "same palette, different arrangement"
7. **Far A** — reference: Open A → "same color, minimal detail" (may fail with ref image — try without)
8. **Far B** — reference: Far A → "same color, different ripple pattern"

#### Ground Prompt Template

```
Seamless tileable top-down ground texture, aerial drone view looking straight down.
{ZONE_DESCRIPTION}.
{ENVIRONMENT_STYLE} — warm/cool earth tones matching {PALETTE_DESCRIPTION}.
NO horizon, NO sky, NO perspective.
Flat even lighting from directly above.
Photorealistic texture map.
```

#### Ground Variant Prompt (B tiles)

```
Create a variant of this ground texture with the SAME color palette and style
— but a DIFFERENT {pattern/arrangement/detail}.
Keep the same {specific colors}. Must look like the same environment.
Seamless tileable, top-down aerial view, flat lighting, no perspective.
```

#### Ground Tile Quality Rules
1. **NO distinct features** — avoid tumbleweeds, large slabs, prominent clusters. These expose tiling repetition.
2. **Uniform, nondescript** — fine cracks, evenly scattered gravel, uniform sand. Never a single dominant feature.
3. **Generic over specific** — 100 tiny pebbles tile better than 3 large rocks.
4. **Keywords that work**: "uniform distribution", "completely generic", "no focal points", "no unique features"
5. **Keywords to AVOID**: "scattered large", "prominent", "distinct", named objects like "tumbleweed"

#### Stitch Ground Atlas

Save generated tiles as `t0.png` through `t7.png`, then stitch. The stitch script (`scripts/stitch-ground.mjs`) composites 8 tiles horizontally. Update the tile paths inside the script before running.

// turbo
```bash
cd /Users/devnull/irlRace && node scripts/stitch-ground.mjs
# Output: public/ground/ground_atlas_{env}.png (2048×256)
```

Alternatively, use a quick inline stitch (replace paths as needed):
```bash
cd /Users/devnull/irlRace && node -e "
const sharp = require('sharp');
const TILE = 256;
const tiles = ['/tmp/ground_tiles/t0.png','/tmp/ground_tiles/t1.png','/tmp/ground_tiles/t2.png','/tmp/ground_tiles/t3.png','/tmp/ground_tiles/t4.png','/tmp/ground_tiles/t5.png','/tmp/ground_tiles/t6.png','/tmp/ground_tiles/t7.png'];
(async()=>{
  const composites=[];
  for(let i=0;i<8;i++){const buf=await sharp(tiles[i]).resize(TILE,TILE).toBuffer();composites.push({input:buf,left:i*TILE,top:0});}
  await sharp({create:{width:2048,height:256,channels:4,background:{r:0,g:0,b:0,alpha:255}}}).composite(composites).png().toFile('public/ground/ground_atlas_{env}.png');
  console.log('done');
})();
"
```

#### Ground Atlas Registration

Add to `GROUND_ATLAS` in `scene.ts` (~line 56):
```typescript
'{Environment Name}': '/ground/ground_atlas_{env}.png',
```

### 10. Wire into codebase (3 files)

**`src/scenery-buildings.ts`** — Add facade atlas path to `STYLE_ATLAS` (~line 45):
```typescript
{style_key}: '/buildings/facade_atlas_{env}.png',
```

**`src/scene.ts`** — Add ground atlas path to `GROUND_ATLAS` (~line 56):
```typescript
'{Environment Name}': '/ground/ground_atlas_{env}.png',
```

**`src/scene.ts`** — Add or update environment preset (~line 160+):
```typescript
{
  name: '{Environment Name}',
  // ... fog, sky, lighting, ground colors ...
  scenery: {
    // ... road, barriers, trees, etc ...
    buildingStyle: '{style_key}',  // must match STYLE_ATLAS key
    // ...
  },
},
```

// turbo
### 11. Build and verify
```bash
cd /Users/devnull/irlRace
npx vite build --mode development 2>&1 | tail -3
```

// turbo
### 12. Commit + push
```bash
cd /Users/devnull/irlRace
git add public/buildings/facade_atlas_{env}*.png public/ground/ground_atlas_{env}.png src/scene.ts src/scenery-buildings.ts
git commit -m 'art: add {env} facade + ground atlases and wire environment'
git push dev main
```

> [!NOTE]
> Push to `dev` remote (`https://github.com/tophg/irlRace-DEV`) unless instructed otherwise.

## Rollback

If an atlas looks bad after pushing:
```bash
# Revert specific atlas files to last known good state
git checkout HEAD~1 -- public/buildings/facade_atlas_{env}*.png public/ground/ground_atlas_{env}.png
git commit -m 'revert: roll back {env} atlas to previous version'
git push dev main
```

Original tiles remain in `/tmp/atlas_tiles/{env}/` — fix individual tiles there and re-stitch.

## Existing Environments

| Name | Style key | File suffix | Description |
|------|-----------|-------------|-------------|
| Washington D.C. | `modern` | `_dc` | Muted gray/beige government district |
| Havana | `beach_house` | `_havana` | Vibrant Caribbean colonial pastels |
| Mojave | `adobe` | `_mojave` | Warm earth-tone adobe/stucco |
| Shibuya | `cyberpunk` | `_shibuya` | Dark concrete/steel, neon accents |
| Zermatt | `chalet` | `_zermatt` | Wood/stone Swiss chalet |
| Weathered | `weathered` | `_weathered` | Decayed/abandoned aesthetic |
| Warehouse | `warehouse` | `_warehouse` | Industrial brick/metal/concrete |
| Gaza City | `levantine` | `_gaza` | Sandy limestone, arched windows |
| Baghdad | `mesopotamian` | `_baghdad` | Mesopotamian brick/stone |
| Damascus | `damascene` | `_damascus` | Ottoman-era stone/plaster |
| Beirut | `levantine_med` | `_beirut` | Mediterranean levantine |
| Tripoli | `north_african` | `_tripoli` | North African plaster/tile |
| Mogadishu | `somali_coastal` | `_mogadishu` | Somali coastal coral/plaster |
| Tehran | `persian` | `_tehran` | Persian brick/tile |
| Khartoum | `nile_brick` | `_khartoum` | Nile region fired brick |
| Kiev | `soviet_bloc` | `_kiev` | Soviet-era concrete panel |
| Shanghai | `shanghai` | `_shanghai` | Bund-era, Art Deco, Shikumen, modern glass |

### Placeholder Environments (reuse existing atlases)
These environments exist in `scene.ts` but borrow another environment's atlas:
- Chennai → `levantine` (Gaza atlas)
- Sukhumi → `weathered`
- Sochi → `soviet_bloc` (Kiev atlas)
- Tokyo → `modern` (DC atlas)
- Montclair → `modern` (DC atlas)
- Lille → `modern` (DC atlas)
- Nuuk → `weathered`

## Code Reference

| What | File | Location |
|------|------|----------|
| Facade atlas style map | `src/scenery-buildings.ts` | `STYLE_ATLAS` (~line 45) |
| Atlas row/col constants | `src/scenery-buildings.ts` | `ATLAS_COLS = 8`, `ATLAS_ROWS = 5` |
| Building composition | `src/scenery-buildings.ts` | `buildComposedBox` / `addComposedFace` |
| Ground atlas map | `src/scene.ts` | `GROUND_ATLAS` (~line 56) |
| Environment presets | `src/scene.ts` | Array starting ~line 160 |
| Ground shader | `src/scene.ts` | TSL shader (~line 920-949) |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Windows on rooftops | Atlas has wrong row count (8 instead of 5) | Re-stitch as 5-row layout |
| Stretched roof textures | `addFlatFace` not subdividing | Already fixed — uses tiled grid |
| Frozen frame (GPU crash) | Non-POT texture dimensions | Ensure all textures are POT |
| 404 on Vercel | Missing files or wrong extension | Check `.png` vs `.jpg` in `STYLE_ATLAS` |
| Emissive on walls/ground | Glow applied to wrong rows | Verify script uses 5-row logic (row 0 + faint row 2 only) |
| Emissive/normal wrong size | Script output doesn't match diffuse | Script must output 4096×4096 (was fixed) |
