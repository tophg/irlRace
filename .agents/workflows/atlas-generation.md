---
description: How to generate or update building facade atlas images
---

# Building Facade Atlas Generation

Each environment needs **3 atlas images** in `public/buildings/`:

| File | Purpose |
|------|---------|
| `facade_atlas_{env}.png` | Diffuse color (what the building looks like) |
| `facade_atlas_{env}_emissive.png` | Emissive mask (white = lit window glow, black = no glow) |
| `facade_atlas_{env}_normal.png` | Normal map (surface depth/relief detail) |

## Atlas Layout (8×5 grid)

Each **column** (0-7) is one architectural style. All tiles in a column share the same wall material, window frames, and color scheme.

> [!CAUTION]
> The code (`scenery-buildings.ts`) uses a **5-row layout**. Do NOT generate 8-row atlases — they will cause window tiles to appear on rooftops and other surfaces.

| Row | Type | Description |
|-----|------|-------------|
| 0 | Window | Shuttered/frosted glass (NO visible interiors) |
| 1 | Wall pier | Windowless wall surface |
| 2 | Ground floor | Storefront/door (NO TEXT/SIGNAGE) |
| 3 | Cornice | Decorative horizontal trim |
| 4 | Roof cap | Parapet/roof edge |

## Environments

| Name | File suffix | Style |
|------|-------------|-------|
| DC | `_dc` | Muted gray/beige government district |
| Havana | `_havana` | Vibrant Caribbean colonial pastels |
| Mojave | `_mojave` | Warm earth-tone adobe/stucco |
| Shibuya | `_shibuya` | Dark concrete/steel, neon accents |
| Zermatt | `_zermatt` | Wood/stone Swiss chalet |
| Weathered | `_weathered` | Decayed/abandoned aesthetic |
| Warehouse | `_warehouse` | Industrial brick/metal/concrete |

## Step-by-Step: Generate or Replace an Atlas

### 0. Tile Preservation (CRITICAL)
Always generate and keep individual tiles in `/tmp/atlas_tiles/{env}/` before stitching:
- Naming convention: `r{row}_c{col}.png` (e.g. `r0_c0.png`, `r7_c7.png`)
- **Never delete individual tiles** after stitching — they are the source of truth
- To modify a single tile, regenerate just that file and re-stitch
- Stitch command: `NODE_PATH=./node_modules node /tmp/stitch_atlas.js /tmp/atlas_tiles/{env} /tmp/facade_atlas_{env}.png 4096`

### 1. Generate the diffuse atlas
Generate an 8×8 grid image with the layout above. Key rules:
- **NO TEXT, NO LABELS, NO SIGNAGE** anywhere
- Each column = one consistent style (same frames, materials, colors)
- Rows 0-3 share the same window frame per column, only interior state differs

#### Critical: Tile Quality Rules (learned from iteration)

1. **Non-descript windows** — Window tiles MUST be generic. No visible furniture, bookshelves, lamps, specific curtain arrangements, or identifiable interior details. These create obvious repetition patterns when tiled across a building.
2. **Uniform glass treatment** — Use uniform tints, frosted glass, simple blinds, or plain reflections. The goal is that each repeated tile looks indistinguishable from the next.
3. **Prompt keywords that work**: "uniform", "generic", "non-descript", "no identifiable interior details", "plain frosted glass", "even tint"
4. **Prompt keywords to AVOID**: "cozy room", "furniture visible", "bookshelf", "lamp", "detailed interior", "curtains pulled back revealing"
5. **Same principle applies to all rows** — storefronts, cornices, and roof caps should also avoid unique focal points that expose repetition.

### 2. Generate the emissive mask
Same 8×8 grid layout. Rules:
- **Row 2** (lit windows): **bright warm glow** (white/amber)
- **All other rows**: **pure black** (no emission)
- Match the window positions exactly from the diffuse atlas

### 3. Generate the normal map
Same 8×8 grid layout. Rules:
- Flat blue-purple (#8080FF) base = no depth
- Window frames should have **indented depth** (darker blue = recessed)
- Wall piers (row 4) should have wall texture relief
- Ground floor (row 5) should have door/shop frame depth

// turbo
### 4. Upscale to 4096×4096
```bash
cd public/buildings
sips -z 4096 4096 facade_atlas_{env}.png --out facade_atlas_{env}.png
sips -z 4096 4096 facade_atlas_{env}_emissive.png --out facade_atlas_{env}_emissive.png
sips -z 4096 4096 facade_atlas_{env}_normal.png --out facade_atlas_{env}_normal.png
```

// turbo
### 5. Verify sizes
```bash
sips -g pixelWidth -g pixelHeight facade_atlas_{env}.png
```

// turbo
### 6. Build + commit + push
```bash
cd /Users/devnull/irlRace
npx vite build --mode development 2>&1 | tail -3
git add public/buildings/facade_atlas_{env}*.png
git commit -m 'art: regenerate {env} atlas images'
git push
```

## Adding a New Environment

1. Choose a name (lowercase, e.g. `tokyo`)
2. Add to `STYLE_ATLAS` map in `src/track-scenery.ts` (~line 860):
   ```typescript
   ['tokyo', 'buildings/facade_atlas_tokyo.png'],
   ```
3. Generate all 3 atlas images following steps above
4. Add theme entry in `src/themes.ts` with matching `sceneryStyle: 'tokyo'`

## Code Reference

- Atlas loading: `src/track-scenery.ts` ~line 1145
- Tile mapping (row assignments): `src/track-scenery.ts` ~line 1240
- Tiler composition: `src/track-scenery.ts` ~line 990 (`addComposedFace`)
- `ATLAS_ROWS = 8`, `ATLAS_COLS = 8`, `VARIANT_COUNT = 8`
