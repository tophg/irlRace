---
description: How to add a new vehicle or replace an existing vehicle model
---

# Adding / Replacing Vehicles

## 1. Place the GLB model

// turbo
Copy the `.glb` file into `public/models/`:
```bash
cp /path/to/Model_Name.glb public/models/Model_Name.glb
```

Use PascalCase or Snake_Case filenames (e.g. `VW_Beetle.glb`, `Black_Mustang_GT.glb`).

## 2. Optimize the GLB (WebP textures + Draco)

// turbo
```bash
npx --yes @gltf-transform/cli webp public/models/Model_Name.glb /tmp/model_tex.glb --quality 80
npx --yes @gltf-transform/cli draco /tmp/model_tex.glb public/models/Model_Name.glb
rm /tmp/model_tex.glb
```

Target size: 2-6MB (matching existing roster models).

## 3. Add or update the CAR_ROSTER entry

Edit `src/types.ts` → `CAR_ROSTER` array.

**New vehicle** — add an entry in the appropriate tier section:
```ts
{ id: 'my_car', name: 'My Car', file: 'Model_Name.glb', maxSpeed: 75, acceleration: 30, handling: 2.3, braking: 45, driftFactor: 0.30, gripCoeff: 0.88, latFriction: 5.0, suspStiffness: 0.04, steerSpeed: 2.8, driftThreshold: 0.12, mass: 1500, cgHeight: 0.12, frontBias: 0.52, heightOffset: 0.05 },
```

**Replacing a model** — change only the `file:` field on the existing entry.

### CarDef fields reference

| Field | Description | Range |
|---|---|---|
| `id` | Unique lowercase identifier | — |
| `name` | Display name in garage | — |
| `file` | GLB filename in `public/models/` | — |
| `maxSpeed` | Top speed | 65–92 |
| `acceleration` | Acceleration force | 26–38 |
| `handling` | Steering responsiveness | 1.7–3.1 |
| `braking` | Brake force | 40–55 |
| `driftFactor` | Slide tendency (higher = slidier) | 0.20–0.46 |
| `gripCoeff` | Tire grip (higher = grippier) | 0.76–1.02 |
| `latFriction` | Lateral friction | 4.0–6.5 |
| `suspStiffness` | Suspension stiffness | 0.03–0.06 |
| `steerSpeed` | Steering speed | 2.4–3.5 |
| `driftThreshold` | Slip angle before drift | 0.08–0.15 |
| `mass` | Vehicle mass (kg) | 1200–2200 |
| `cgHeight` | Center of gravity height | 0.08–0.30 |
| `frontBias` | Weight distribution (>0.50 = front-heavy) | 0.40–0.58 |
| `heightOffset` | Vertical road offset | 0.0–0.35 |

### Tier guidelines

| Tier | maxSpeed | Character |
|---|---|---|
| Entry | 65–70 | Forgiving, beginner-friendly |
| Mid | 70–79 | Distinct personality |
| Exotic | 77–83 | Specialist, high skill ceiling |
| Elite | 85–92 | Glass cannons, max speed + risk |

## 4. Adjust heightOffset

Run the game, select the car, check road placement:
- **Floating** → decrease `heightOffset`
- **Clipping** → increase `heightOffset`
- SUVs/vans: 0.25–0.35, sedans: 0.0–0.15

## 5. (Optional) Car light calibration

Add entry in `src/car-lights.ts` → `CAR_LIGHT_MAP`, or use Calibration Studio (`/studio`).

## 6. Build & verify

// turbo
```bash
npx tsc --noEmit
```
