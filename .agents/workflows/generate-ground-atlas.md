---
description: Generate a ground atlas for a new environment
---

# Ground Atlas Generation Workflow

Generate an 8-tile ground atlas (2048×256 PNG) for any environment. The shader samples 4 distance zones × 2 variants per zone.

## Atlas Layout

```
| Shoulder A | Shoulder B | Urban A | Urban B | Open A | Open B | Far A | Far B |
|    0–8m    |    0–8m    |  8–20m  |  8–20m  | 20–60m | 20–60m |  60m+ |  60m+ |
```

Each tile is 256×256 in the final atlas. `tw = 0.125 = 1/8` in the TSL shader (`scene.ts:937`).

## Zone Descriptions

| Zone | Content | Detail Level |
|------|---------|-------------|
| **Shoulder** (0–8m) | Paved area near road — concrete, asphalt, curb debris | High detail, urban materials |
| **Urban** (8–20m) | Transitional — broken pavers, packed dirt, rubble, weeds | Medium detail, mixed materials |
| **Open** (20–60m) | Environment-specific terrain — sand, grass, gravel, scrub | Medium detail, natural |
| **Far** (60m+) | Distant ground — sparse, faded, blends toward fog | Low detail, minimal features |

## Step 1: Generate Tile Images

Generate tiles **sequentially with cross-referencing** for color continuity. Each tile should reference the previous one(s) via the `ImagePaths` parameter.

### Generation Order

1. **Shoulder A** — base tile, establishes the color palette
2. **Shoulder B** — reference: Shoulder A → "same palette, different pattern"
3. **Urban A** — reference: Shoulder A → "same palette, more earth, less concrete"
4. **Urban B** — reference: Urban A → "same palette, different arrangement"
5. **Open A** — reference: Urban A → "same palette, more natural, less rubble"
6. **Open B** — reference: Open A → "same palette, different arrangement"
7. **Far A** — reference: Open A → "same sand color, minimal detail" (may fail with ref image — try without if so)
8. **Far B** — reference: Far A → "same color, different ripple pattern"

### Prompt Template

```
Seamless tileable top-down ground texture, aerial drone view looking straight down.
{ZONE_DESCRIPTION}.
{ENVIRONMENT_STYLE} — warm/cool earth tones matching {PALETTE_DESCRIPTION}.
NO horizon, NO sky, NO perspective.
Flat even lighting from directly above.
Photorealistic texture map.
```

### Variant Prompt Template (for B tiles)

```
Create a variant of this ground texture with the SAME color palette and style
— but a DIFFERENT {pattern/arrangement/detail}.
Keep the same {specific colors}. Must look like the same environment.
Seamless tileable, top-down aerial view, flat lighting, no perspective.
```

### Key Rules

- **Always feed previous tile as reference** via `ImagePaths` for palette continuity
- **Far tiles** may fail with reference images (content too minimal) — retry without `ImagePaths`
- Generated images are **640×640** — they get resized to 256×256 during stitch
- All prompts must include "NO horizon, NO sky, NO perspective" to avoid non-top-down results

## Step 2: Resize Tiles

```bash
# Resize each generated tile to 256×256
for tile in t0a t0b t1a t1b t2a t2b t3a t3b; do
  sips -z 256 256 "$BRAIN/${tile}.png" --out /tmp/ground_tiles/${tile}.png
done
```

## Step 3: Stitch Atlas

// turbo
```bash
cd /Users/devnull/irlRace && node scripts/stitch-ground.mjs
```

The stitch script (`scripts/stitch-ground.mjs`) uses `sharp` to composite 8 tiles horizontally into a 2048×256 PNG.

Update the tile paths in the script to point to your resized tiles before running.

### Output

`public/ground/ground_atlas_{env}.png` — 2048×256 PNG, ~1.2 MB

## Step 4: Register the Atlas

Add the environment to the `GROUND_ATLAS` map in `scene.ts` (line ~56):

```typescript
'Environment Name': '/ground/ground_atlas_{env}.png',
```

## Step 5: Verify

1. Run `npm run dev`
2. Select the environment in race setup
3. Check ground transitions: shoulder → urban → open → far should blend smoothly
4. Verify no visible seams at zone boundaries (smoothstep handles this)
5. Verify variant switching isn't too jarring (both A/B should be same palette)

## Step 6: Commit

// turbo
```bash
cd /Users/devnull/irlRace && git add public/ground/ground_atlas_*.png src/scene.ts && git commit -m "art: add ground atlas for {Environment}"
```

## Per-Environment Tile Descriptions (Reference)

### Gaza City
| Zone | Content |
|------|---------|
| Shoulder | Cracked pale gray-beige concrete, sand-filled joints, stone debris |
| Urban | Hard-packed sandy dirt, broken concrete pavers, brick fragments, dried grass |
| Open | Dry sandy terrain, sparse scrub, scattered rocks, tumbleweeds |
| Far | Pale warm beige sand, subtle wind ripple marks |

*(Add new environments here as they are generated)*

## Files

| File | Purpose |
|------|---------|
| `scripts/stitch-ground.mjs` | Sharp-based stitcher: 8 tiles → 2048×256 atlas |
| `src/scene.ts:56` | `GROUND_ATLAS` path map |
| `src/scene.ts:920-949` | TSL shader: distance-field zone blending |
| `public/ground/ground_atlas_*.png` | Atlas PNGs per environment |
