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

## Atlas Layout (8×8 grid)

Each **column** (0-7) is one architectural style. All tiles in a column share the same wall material, window frames, and color scheme.

| Row | Type | Description |
|-----|------|-------------|
| 0 | Window A | Curtains/shutters closed |
| 1 | Window B | Blinds/shutters half-open |
| 2 | Window C | Open with warm interior light |
| 3 | Window D | Dark/reflective, no interior light |
| 4 | Wall pier | Windowless wall surface |
| 5 | Ground floor | Storefront/door (NO TEXT/SIGNAGE) |
| 6 | Cornice | Decorative horizontal trim |
| 7 | Roof cap | Parapet/roof edge |

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

### 1. Generate the diffuse atlas
Generate an 8×8 grid image with the layout above. Key rules:
- **NO TEXT, NO LABELS, NO SIGNAGE** anywhere
- Each column = one consistent style (same frames, materials, colors)
- Rows 0-3 share the same window frame per column, only interior state differs

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
