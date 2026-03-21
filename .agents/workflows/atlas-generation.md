---
description: How to generate or update building facade atlas images
---

# Building Facade Atlas Generation

## Required Files

Each environment needs **4 facade atlas images** + **1 ground atlas** + **1 mobile variant**:

| File | Location | Purpose |
|------|----------|---------|
| `facade_atlas_{env}.png` | `public/buildings/` | Diffuse color (4096×4096) |
| `facade_atlas_{env}_emissive.png` | `public/buildings/` | Emissive mask — row 0 window glow only |
| `facade_atlas_{env}_normal.png` | `public/buildings/` | Normal map — surface depth/relief |
| `facade_atlas_{env}_mobile.png` | `public/buildings/` | Downscaled diffuse (1024×1024) |
| `ground_atlas_{env}.png` | `public/ground/` | Ground texture atlas (2048×256) |

> [!IMPORTANT]
> **ALL textures must have power-of-2 dimensions** (256, 512, 1024, 2048, 4096). Non-power-of-2 textures crash WebGPU mipmap generation.

## Facade Atlas Layout (8 columns × 5 rows)

Each **column** (0-7) = one architectural style. All tiles in a column share the same wall material, window frames, and color scheme.

> [!CAUTION]
> The code (`scenery-buildings.ts`) uses a **5-row layout** with `ATLAS_ROWS = 5`. Do NOT generate 8-row atlases — they cause window tiles to appear on rooftops and other surfaces.

| Row | Type | Description | Emissive |
|-----|------|-------------|----------|
| 0 | Window | Shuttered/frosted glass (NO visible interiors) | Warm glow |
| 1 | Wall pier | Windowless wall surface (also used for roof tops) | Black |
| 2 | Ground floor | Storefront/door (NO TEXT/SIGNAGE) | Black |
| 3 | Cornice | Decorative horizontal trim | Black |
| 4 | Roof cap | Parapet/roof edge with sky | Black |

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

### All Rows
- Storefronts, cornices, and roof caps should also avoid unique focal points that expose repetition
- Wall piers should be plain material with no windows at all
- Roof caps should show parapet/edge with sky visible above

## Step-by-Step: Generate a New Environment

### 0. Tile Preservation (CRITICAL)
Always generate and keep individual tiles in `/tmp/atlas_tiles/{env}/` before stitching:
- Naming convention: `r{row}_c{col}.png` (e.g. `r0_c0.png`, `r4_c7.png`)
- **Never delete individual tiles** after stitching — they are the source of truth
- To modify a single tile, regenerate just that file and re-stitch

### 1. Generate 40 diffuse tiles (8 columns × 5 rows)
Generate tiles sequentially by column, feeding previous tiles as reference for style consistency. For each column, generate all 5 rows in order: window → wall pier → ground → cornice → roof cap.

Save to `/tmp/atlas_tiles/{env}/r{row}_c{col}.png`.

// turbo
### 2. Stitch into 4096×4096 diffuse atlas
```bash
cd /Users/devnull/irlRace
# Ensure stitch script uses ROWS = 5
NODE_PATH=node_modules node /tmp/stitch_atlas.js /tmp/atlas_tiles/{env} /tmp/facade_atlas_{env}.png 4096
```

### 3. Generate emissive mask and normal map
Use the `gen_emissive_normal.mjs` script (copy into project root to resolve `sharp`).
- **Emissive**: only row 0 (windows) gets warm glow; rows 1-4 are pure black
- **Normal**: Sobel-derived from grayscale heightmap of each tile

```bash
cp /tmp/gen_emissive_normal.mjs ./gen_emissive_normal.mjs
node gen_emissive_normal.mjs /tmp/atlas_tiles/{env} /tmp/facade_atlas_{env}_emissive.png /tmp/facade_atlas_{env}_normal.png 512
rm gen_emissive_normal.mjs
```

> [!WARNING]
> The emissive script defaults to 8-row glow logic (rows 0-3 glow). For 5-row atlases, only row 0 should glow. Verify the script applies glow to row 0 only.

// turbo
### 4. Generate mobile variant
```bash
sips -z 1024 1024 /tmp/facade_atlas_{env}.png --out /tmp/facade_atlas_{env}_mobile.png
```

// turbo
### 5. Copy all files to public/
```bash
cp /tmp/facade_atlas_{env}.png public/buildings/
cp /tmp/facade_atlas_{env}_emissive.png public/buildings/
cp /tmp/facade_atlas_{env}_normal.png public/buildings/
cp /tmp/facade_atlas_{env}_mobile.png public/buildings/
```

### 6. Generate ground atlas
Follow the `/generate-ground-atlas` workflow to create 8 ground tiles and stitch into `public/ground/ground_atlas_{env}.png` (2048×256).

### 7. Wire into codebase (3 files)

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
### 8. Build and verify
```bash
cd /Users/devnull/irlRace
npx vite build --mode development 2>&1 | tail -3
```

// turbo
### 9. Commit + push
```bash
cd /Users/devnull/irlRace
git add public/buildings/facade_atlas_{env}*.png public/ground/ground_atlas_{env}.png src/scene.ts src/scenery-buildings.ts
git commit -m 'art: add {env} facade + ground atlases and wire environment'
git push dev main
```

> [!NOTE]
> Push to `dev` remote (`https://github.com/tophg/irlRace-DEV`) unless instructed otherwise.

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
These environments exist in `scene.ts` but use another environment's atlas:
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
| Building composition | `src/scenery-buildings.ts` | `buildComposedBox` / `addComposedFace` |
| Atlas constants | `src/scenery-buildings.ts` | `ATLAS_COLS = 8`, `ATLAS_ROWS = 5` |
| Ground atlas map | `src/scene.ts` | `GROUND_ATLAS` (~line 56) |
| Environment presets | `src/scene.ts` | Array starting ~line 160 |
| Ground shader | `src/scene.ts` | TSL shader (~line 920-949) |
| Stitch script | `/tmp/stitch_atlas.js` | Sharp-based: tiles → 4096×4096 atlas |
| Emissive/normal gen | `/tmp/gen_emissive_normal.mjs` | Luminance-based emissive + Sobel normal |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Windows on rooftops | Atlas has wrong row count (8 instead of 5) | Re-stitch as 5-row layout |
| Stretched roof textures | `addFlatFace` not subdividing | Already fixed — uses tiled grid |
| Frozen frame (GPU crash) | Non-power-of-2 texture dimensions | Ensure all textures are POT |
| 404 on Vercel | Missing files or wrong extension | Check `.png` vs `.jpg` in `STYLE_ATLAS` |
| Emissive on walls/ground | Script applies glow to rows 0-3 (8-row logic) | Fix script to only glow row 0 |
