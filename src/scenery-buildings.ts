/* ── IRL Race — Building Generation (extracted from track-scenery.ts) ──
 *
 * Procedural box cityscape with AI-generated facade atlas,
 * multi-story composition, themed roofs, awnings, and rooftop props.
 */

import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  mix, smoothstep, vec2, float, sin, cos, mul, add, fract, min,
  floor, texture, positionWorld, step,
} from 'three/tsl';
import { type SceneryTheme, getTerrainHeight, _groundAtlasTexture, _dftTexture } from './scene';
import { ktx2Loader } from './loaders';

// ── Building culling state (shared with track-scenery.ts) ──
export let _buildingInstances: THREE.Vector3[] = [];
export let _buildingInstancedMeshes: THREE.InstancedMesh[] = [];

export function resetBuildingCullingState() {
  _buildingInstances = [];
  _buildingInstancedMeshes = [];
}

// ── Reusable temps ──
const _c = new THREE.Color();

// ── KTX2 texture loader with PNG/JPEG fallback ──
// Loads the PNG/JPEG via TextureLoader (synchronous return, async image load).
// In parallel, tries to load a .ktx2 version. If KTX2 loads successfully,
// calls onUpgrade with the CompressedTexture so the material can swap to it.
// This avoids copying CompressedTexture data into a regular Texture, which
// doesn't work in WebGPU (different GPU resource types).
function loadAtlasTexture(
  originalPath: string,
  colorSpace: THREE.ColorSpace,
  onUpgrade?: (ktx2Tex: THREE.Texture) => void,
): THREE.Texture {
  // Primary path: standard TextureLoader (works for all renderers)
  const tex = new THREE.TextureLoader().load(originalPath);
  tex.colorSpace = colorSpace;

  // Secondary path: try KTX2 for smaller/faster loading
  const ktx2Path = originalPath.replace(/\.(png|jpg|jpeg)$/i, '.ktx2');
  ktx2Loader.load(
    ktx2Path,
    (ktx2Tex) => {
      // KTX2 loaded — match TextureLoader's orientation (flipY=true) so that
      // the UV coordinates computed in buildComposedBox map correctly.
      // KTX2Loader defaults to flipY=false for WebGPU, which inverts all atlas rows.
      ktx2Tex.flipY = true;
      ktx2Tex.colorSpace = colorSpace;
      onUpgrade?.(ktx2Tex);
    },
    undefined,
    () => { /* KTX2 not found — PNG/JPEG already loading, nothing to do */ },
  );

  return tex;
}

/**
 * Generate procedural box cityscape and add to the scene group.
 * Extracted from generateScenery() in track-scenery.ts.
 */
export function generateBuildings(
  spline: THREE.CatmullRomCurve3,
  rng: () => number,
  T: SceneryTheme,
  group: THREE.Group,
) {
// ── Procedural Box Cityscape (InstancedMesh) ──
// BoxGeometry buildings with procedural canvas facade atlas.
// Per-face UVs: sides = tiled facade, roof = dark surface.
// Emissive window glow, height-proportional widths, per-tile sizing.
const isMobile = window.matchMedia('(pointer: coarse)').matches;
const density = isMobile ? Math.min(T.buildingDensity ?? 1.0, 0.5) : (T.buildingDensity ?? 1.0);
const rowCount = isMobile ? 1 : Math.min(3, Math.max(1, T.buildingRowCount ?? 2));
const gapChance = isMobile ? Math.max(T.buildingGapChance ?? 0.15, 0.3) : (T.buildingGapChance ?? 0.15);

// ── AI-generated facade atlas (8×5 = 40 tiles, high-resolution PNGs) ──
const ATLAS_COLS = 8, ATLAS_ROWS = 5;

// Each environment has its own AI-generated atlas with photorealistic textures
const STYLE_ATLAS: Record<string, string> = {
  modern:       '/buildings/facade_atlas_dc.png',
  adobe:        '/buildings/facade_atlas_mojave.png',
  beach_house:  '/buildings/facade_atlas_havana.png',
  cyberpunk:    '/buildings/facade_atlas_shibuya.png',
  weathered:    '/buildings/facade_atlas_weathered.png',
  chalet:       '/buildings/facade_atlas_zermatt.png',
  warehouse:    '/buildings/facade_atlas_warehouse.png',
  levantine:      '/buildings/facade_atlas_gaza.jpg',
  mesopotamian:   '/buildings/facade_atlas_baghdad.jpg',
  damascene:      '/buildings/facade_atlas_damascus.png',
  levantine_med:  '/buildings/facade_atlas_beirut.png',
  north_african:  '/buildings/facade_atlas_tripoli.png',
  somali_coastal: '/buildings/facade_atlas_mogadishu.png',
  persian:        '/buildings/facade_atlas_tehran.png',
  nile_brick:     '/buildings/facade_atlas_khartoum.png',
  soviet_bloc:  '/buildings/facade_atlas_kiev.png',
  concrete:     '/buildings/facade_atlas_dc.png',       // reuse DC's concrete/glass
  bamboo_lodge: '/buildings/facade_atlas_zermatt.png',  // reuse Zermatt's wood/stone
  shanghai:     '/buildings/facade_atlas_shanghai.png',
  nuuk:         '/buildings/facade_atlas_nuuk.png',
  london:       '/buildings/facade_atlas_london.png',
  modiin_illit: '/buildings/facade_atlas_modiin_illit.png',
  montclair:    '/buildings/facade_atlas_montclair.png',
  tokyo:        '/buildings/facade_atlas_tokyo.png',
  lima:         '/buildings/facade_atlas_lima.png',
  dublin:       '/buildings/facade_atlas_dublin.png',
  siberia:      '/buildings/facade_atlas_siberia.png',
  cap_haitien:  '/buildings/facade_atlas_cap_haitien.png',
  lille:        '/buildings/facade_atlas_lille.png',
  sochi:        '/buildings/facade_atlas_sochi.png',
};

// Forward-declare so KTX2 upgrade closures can reference the material
let buildingMat: THREE.MeshStandardMaterial;

const styleName = T.buildingStyle ?? 'modern';
const atlasPathFull = STYLE_ATLAS[styleName] ?? '/buildings/facade_atlas_dc.png';
// Mobile: load pre-downscaled 1024px atlas (saves ~48MB GPU per texture)
const atlasPath = isMobile ? atlasPathFull.replace(/\.(png|jpg)$/, '_mobile.png') : atlasPathFull;
// KTX2 upgrade disabled: CompressedTexture flipY is ignored in WebGPU,
// causing atlas rows to render inverted. Use PNG/JPEG until encoding-level flip is solved.
const atlasTexture = loadAtlasTexture(atlasPath, THREE.SRGBColorSpace);
atlasTexture.wrapS = THREE.RepeatWrapping;
atlasTexture.wrapT = THREE.RepeatWrapping;
atlasTexture.anisotropy = isMobile ? 4 : 16;
// Atlas layout (8×5 grid):
//   Row 0: Window (single style per column)
//   Row 1: Wall pier (windowless wall surfaces)
//   Row 2: Ground storefront / doors (front & side)
//   Row 3: Cornice / trim — decorative ledges, moldings
//   Row 4: Roof / cap — parapet caps, roof edges
const VARIANT_COUNT = 8;

// Per-tile height clamps (now per-variant column for consistency)
// Column heights control the mix of short vs tall buildings
const VARIANT_HEIGHT: [number, number][] = [
  [12, 45], // Col 0 — medium to tall
  [8, 30],  // Col 1 — short to medium
  [15, 55], // Col 2 — medium to very tall
  [6, 20],  // Col 3 — short (often single-story)
  [10, 40], // Col 4 — medium
  [14, 50], // Col 5 — medium-tall
  [8, 25],  // Col 6 — short-medium
  [18, 60], // Col 7 — tall
];

// Row offset definitions (heights come from tile clamp)
const ROW_DEFS: [number, number][] = [];
if (rowCount >= 1) ROW_DEFS.push([25, 50]);
if (rowCount >= 2) ROW_DEFS.push([35, 65]);
if (rowCount >= 3) ROW_DEFS.push([50, 80]);

// ── Place buildings ──
const placements: BoxPlacement[] = [];

// Pre-compute landmark positions for building exclusion zones
const landmarkExclusionZones: { x: number; z: number }[] = [];
const LANDMARK_EXCLUSION_SQ = 50 * 50; // 50m radius — clear space around each landmark
if (T.landmarks?.length) {
  const lmCount = T.landmarks.length;
  for (let li = 0; li < lmCount; li++) {
    const lmT = (0.15 + (li / lmCount) * 0.7) % 1;
    const lmP = spline.getPointAt(lmT);
    const lmTan = spline.getTangentAt(lmT).normalize();
    const lmRight = new THREE.Vector3(lmTan.z, 0, -lmTan.x);
    const lmSide = li % 2 === 0 ? 1 : -1;
    const lmOffset = 22 + 3;
    landmarkExclusionZones.push({
      x: lmP.x + lmRight.x * lmOffset * lmSide,
      z: lmP.z + lmRight.z * lmOffset * lmSide,
    });
  }
}

// Collect placements
interface BoxPlacement { x: number; y: number; z: number; w: number; h: number; d: number; rotY: number; tile: number; }

const totalLength = spline.getLength();
const sampleSpacing = Math.max(15, 30 / density);
const totalSamples = Math.floor(totalLength / sampleSpacing);
const MAX_PLACEMENTS = isMobile ? 60 : 400;

// Pre-sample spline points for road-overlap rejection
// Buildings on tight curves can land on a different road section
const ROAD_CHECK_SAMPLES = 100;
const roadCheckPts: { x: number; z: number }[] = [];
for (let i = 0; i < ROAD_CHECK_SAMPLES; i++) {
  const pt = spline.getPointAt(i / ROAD_CHECK_SAMPLES);
  roadCheckPts.push({ x: pt.x, z: pt.z });
}
const MIN_ROAD_DIST_SQ = 18 * 18; // road half-width(7) + barrier(0.4) + building half-width(~5) + margin(~5.6)

// Minimum distance between building centers to prevent overlap
const MIN_BUILDING_DIST_SQ = 12 * 12;

for (let si = 0; si < totalSamples && placements.length < MAX_PLACEMENTS; si++) {
  const t = si / totalSamples;
  const p = spline.getPointAt(t);
  const tan = spline.getTangentAt(t).normalize();
  const right = new THREE.Vector3(tan.z, 0, -tan.x);

  for (const [dist, maxOffset] of ROW_DEFS) {
    for (let side = -1; side <= 1; side += 2) {
      if (rng() < gapChance) continue;

      const baseD = dist + rng() * (maxOffset - dist);
      const px = p.x + right.x * baseD * side + (rng() - 0.5) * 6;
      const pz = p.z + right.z * baseD * side + (rng() - 0.5) * 6;

      // Skip buildings near landmark exclusion zones (50m radius)
      let nearLandmark = false;
      for (const lz of landmarkExclusionZones) {
        const ldx = px - lz.x; const ldz = pz - lz.z;
        if (ldx * ldx + ldz * ldz < LANDMARK_EXCLUSION_SQ) { nearLandmark = true; break; }
      }
      if (nearLandmark) continue;

      // Skip buildings too close to any road section (prevents on-road placement)
      let onRoad = false;
      for (const rp of roadCheckPts) {
        const rdx = px - rp.x; const rdz = pz - rp.z;
        if (rdx * rdx + rdz * rdz < MIN_ROAD_DIST_SQ) { onRoad = true; break; }
      }
      if (onRoad) continue;

      // Skip buildings overlapping existing placements
      let overlaps = false;
      for (const existing of placements) {
        const edx = px - existing.x; const edz = pz - existing.z;
        if (edx * edx + edz * edz < MIN_BUILDING_DIST_SQ) { overlaps = true; break; }
      }
      if (overlaps) continue;

      // Pick a style variant column (0-7) deterministically from position
      const variant = ((Math.abs(Math.round(px * 73 + pz * 137))) & 0xFF) % VARIANT_COUNT;

      // Height from variant-specific range, clamped to environment's buildingHeightRange
      const [hMin, hMax] = VARIANT_HEIGHT[variant];
      const envMin = T.buildingHeightRange?.[0] ?? hMin;
      const envMax = T.buildingHeightRange?.[1] ?? hMax;
      const clampedMin = Math.max(hMin, envMin);
      const clampedMax = Math.min(hMax, envMax);
      const h = clampedMin + rng() * (Math.max(0, clampedMax - clampedMin));
      const w = 8 + rng() * 10;
      const d = 8 + rng() * 10;

      const rotY = Math.atan2(tan.x, tan.z) + (side > 0 ? Math.PI : 0) + (rng() - 0.5) * 0.1;
      // Use spline elevation so buildings sit flush with the road surface
      placements.push({ x: px, y: p.y, z: pz, w, h, d, rotY, tile: variant });
    }
  }
}

// Build InstancedMesh from placements
if (placements.length > 0) {
  const tileW = 1 / ATLAS_COLS, tileH = 1 / ATLAS_ROWS;

  // Build a box with subdivided faces for facade tiling
  // Each face subdivision maps to the FULL tile sub-region, giving proper repetition
  // buildComposedBox: vertical facade composition
  // Multi-story: ground (Row 2) → mid repeating (Row 0/1) → transition (Row 3) → roof cap (Row 4)
  // Single-story (repV ≤ 1): uses singleTile (Row 1) for entire face
  const buildComposedBox = (
    groundTile: number, sideGroundTile: number,
    windowTile: number, wallPierTile: number, roofCapTile: number,
    transitionTile: number, singleTile: number, flipU: boolean,
    boxW: number, boxH: number, boxD: number,
  ) => {
    // Helper: get atlas UV rect for a tile index
    const tileUV = (tile: number) => {
      const col = tile % ATLAS_COLS;
      const row = Math.floor(tile / ATLAS_COLS);
      return {
        uMin: col * tileW + 0.002,
        uMax: (col + 1) * tileW - 0.002,
        vMin: 1 - (row + 1) * tileH + 0.002,
        vMax: 1 - row * tileH - 0.002,
      };
    };

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Roof UV — collapsed to single-pixel sample from wall pier center for flat solid color
    // (prevents architectural patterns from tiling onto visible rooftops)
    const wallPierUV = tileUV(wallPierTile);
    const roofMidU = (wallPierUV.uMin + wallPierUV.uMax) / 2;
    const roofMidV = (wallPierUV.vMin + wallPierUV.vMax) / 2;
    const roofTileUVs = { uMin: roofMidU, uMax: roofMidU, vMin: roofMidV, vMax: roofMidV };
    // Bottom face — single-point sample from roof cap (not visible)
    const bottomUVs = tileUV(roofCapTile);

    const addFlatFace = (
      origin: [number, number, number],
      axisU: [number, number, number],
      axisV: [number, number, number],
      isRoof: boolean,
      faceW: number, faceD: number,
    ) => {
      const uvRect = isRoof ? roofTileUVs : bottomUVs;
      const tW = uvRect.uMax - uvRect.uMin;
      const tH = uvRect.vMax - uvRect.vMin;

      // Subdivide into a grid of tiles matching physical tile size
      const tilesU = Math.max(1, Math.round(faceW / TILE_W));
      const tilesV = Math.max(1, Math.round(faceD / TILE_W)); // square tiles

      for (let tv = 0; tv < tilesV; tv++) {
        for (let tu = 0; tu < tilesU; tu++) {
          const baseIdx = positions.length / 3;
          const u0 = tu / tilesU, u1 = (tu + 1) / tilesU;
          const v0 = tv / tilesV, v1 = (tv + 1) / tilesV;
          // 4 corners of this sub-tile
          for (let r = 0; r <= 1; r++) {
            for (let c = 0; c <= 1; c++) {
              const u = c === 0 ? u0 : u1;
              const v = r === 0 ? v0 : v1;
              positions.push(
                origin[0] + axisU[0] * u + axisV[0] * v,
                origin[1] + axisU[1] * u + axisV[1] * v,
                origin[2] + axisU[2] * u + axisV[2] * v,
              );
              uvs.push(
                c === 0 ? uvRect.uMin : uvRect.uMax,
                r === 0 ? uvRect.vMin : uvRect.vMax,
              );
            }
          }
          indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
          indices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2);
        }
      }
    };

    // addComposedFace: builds a wall face with ground/mid/roof zones
    // faceW/faceH are physical dimensions in meters
    // Physical tile size — smaller tiles = less stretch from rounding.
    // Atlas is 8×8 (square tiles), so square physical tiles map 1:1.
    const TILE_W = 5;  // fixed tile physical width (meters)
    const TILE_H = 5;  // fixed tile physical height (meters)
    const addComposedFace = (
      origin: [number, number, number],
      axisU: [number, number, number],
      axisV: [number, number, number],
      faceW: number, faceH: number,
      faceGroundTile: number,
    ) => {
      const isSingleStory = faceH <= TILE_H * 1.5;

      if (isSingleStory) {
        // Single-story: tile the face with fixed-size tiles
        const hTiles = Math.max(1, Math.round(faceW / TILE_W));
        const uv = tileUV(singleTile);
        const tW = uv.uMax - uv.uMin;
        const tH = uv.vMax - uv.vMin;
        const baseIdx = positions.length / 3;
        for (let vr = 0; vr <= 1; vr++) {
          for (let vc = 0; vc <= 1; vc++) {
            positions.push(
              origin[0] + axisU[0] * vc + axisV[0] * vr,
              origin[1] + axisU[1] * vc + axisV[1] * vr,
              origin[2] + axisU[2] * vc + axisV[2] * vr,
            );
            let tU = vc;
            if (flipU) tU = 1 - tU;
            uvs.push(uv.uMin + tU * tW, uv.vMin + vr * tH);
          }
        }
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
        indices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2);
        return;
      }

      // Multi-story composition using fixed tile sizes
      const groundH = TILE_H;             // ground floor = one tile height
      const transH = TILE_H * 0.4;        // transition band (cornice/balcony/ductwork)
      const roofH = TILE_H * 0.3;         // thin roof cap
      const midH = Math.max(TILE_H, faceH - groundH - transH - roofH); // remainder
      const totalH = groundH + midH + transH + roofH;

      const groundFrac = groundH / totalH;
      const transFrac = transH / totalH;
      const roofFrac = roofH / totalH;
      const midFrac = 1 - groundFrac - transFrac - roofFrac;

      // Compute tile repeats from physical dimensions
      // Force odd column count so edges are always wall piers
      let hTiles = Math.max(1, Math.round(faceW / TILE_W));
      if (hTiles > 1 && hTiles % 2 === 0) hTiles++; // force odd
      const midVTiles = Math.max(1, Math.round(midH / TILE_H));

      // Symmetric column pattern: pier | window | pier | window | pier
      // All tiles use the SAME atlas column (variant) for style consistency
      // Window columns: per-tile random state from rows 0-3
      // Wall pier columns: always row 4
      const V = windowTile % ATLAS_COLS; // building's atlas column
      for (let col = 0; col < hTiles; col++) {
        const isWindowCol = (col % 2 === 1);
        const uStart = col / hTiles;
        const uEnd = (col + 1) / hTiles;

        // Ground zone for this column
        {
          const zUV = tileUV(isWindowCol ? faceGroundTile : (1 * ATLAS_COLS + V));
          const zTW = zUV.uMax - zUV.uMin;
          const zTH = zUV.vMax - zUV.vMin;
          const baseIdx = positions.length / 3;
          for (let vr = 0; vr <= 1; vr++) {
            for (let vc = 0; vc <= 1; vc++) {
              const u = uStart + vc * (uEnd - uStart);
              const v = vr * groundFrac;
              positions.push(
                origin[0] + axisU[0] * u + axisV[0] * v,
                origin[1] + axisU[1] * u + axisV[1] * v,
                origin[2] + axisU[2] * u + axisV[2] * v,
              );
              let tU = vc;
              if (flipU) tU = 1 - tU;
              uvs.push(zUV.uMin + tU * zTW, zUV.vMin + vr * zTH);
            }
          }
          indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
          indices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2);
        }

        // Mid zone for this column (repeating vertically)
        if (midFrac > 0) {
          for (let tileR = 0; tileR < midVTiles; tileR++) {
            // Per-tile: window (row 0) or wall pier (row 1)
            let tileMid: number;
            if (isWindowCol) {
              tileMid = 0 * ATLAS_COLS + V; // single window row
            } else {
              tileMid = 1 * ATLAS_COLS + V; // wall pier, row 1
            }
            const zUV = tileUV(tileMid);
            const zTW = zUV.uMax - zUV.uMin;
            const zTH = zUV.vMax - zUV.vMin;
            const baseIdx = positions.length / 3;
            for (let vr = 0; vr <= 1; vr++) {
              for (let vc = 0; vc <= 1; vc++) {
                const u = uStart + vc * (uEnd - uStart);
                const rFrac = (tileR + vr) / midVTiles;
                const v = groundFrac + rFrac * midFrac;
                positions.push(
                  origin[0] + axisU[0] * u + axisV[0] * v,
                  origin[1] + axisU[1] * u + axisV[1] * v,
                  origin[2] + axisU[2] * u + axisV[2] * v,
                );
                let tU = vc;
                if (flipU) tU = 1 - tU;
                uvs.push(zUV.uMin + tU * zTW, zUV.vMin + vr * zTH);
              }
            }
            indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
            indices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2);
          }
        }
      }

      // Transition band: single tile across full width (archetype-specific detail)
      {
        const zUV = tileUV(transitionTile);
        const zTW = zUV.uMax - zUV.uMin;
        const zTH = zUV.vMax - zUV.vMin;
        const baseIdx = positions.length / 3;
        for (let vr = 0; vr <= 1; vr++) {
          for (let vc = 0; vc <= 1; vc++) {
            const u = vc;
            const v = groundFrac + midFrac + vr * transFrac;
            positions.push(
              origin[0] + axisU[0] * u + axisV[0] * v,
              origin[1] + axisU[1] * u + axisV[1] * v,
              origin[2] + axisU[2] * u + axisV[2] * v,
            );
            let tU = vc;
            if (flipU) tU = 1 - tU;
            uvs.push(zUV.uMin + tU * zTW, zUV.vMin + vr * zTH);
          }
        }
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
        indices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2);
      }

      // Roof cap: single tile across full width
      {
        const zUV = tileUV(roofCapTile);
        const zTW = zUV.uMax - zUV.uMin;
        const zTH = zUV.vMax - zUV.vMin;
        const baseIdx = positions.length / 3;
        for (let vr = 0; vr <= 1; vr++) {
          for (let vc = 0; vc <= 1; vc++) {
            const u = vc;
            const v = (1 - roofFrac) + vr * roofFrac;
            positions.push(
              origin[0] + axisU[0] * u + axisV[0] * v,
              origin[1] + axisU[1] * u + axisV[1] * v,
              origin[2] + axisU[2] * u + axisV[2] * v,
            );
            let tU = vc;
            if (flipU) tU = 1 - tU;
            uvs.push(zUV.uMin + tU * zTW, zUV.vMin + vr * zTH);
          }
        }
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
        indices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2);
      }

    };

    // Front (+Z) — storefronts/doors
    addComposedFace([-0.5, -0.5, 0.5], [1, 0, 0], [0, 1, 0], boxW, boxH, groundTile);
    // Back (-Z) — storefronts/doors
    addComposedFace([0.5, -0.5, -0.5], [-1, 0, 0], [0, 1, 0], boxW, boxH, groundTile);
    // Right (+X) — plain walls at ground level
    addComposedFace([0.5, -0.5, 0.5], [0, 0, -1], [0, 1, 0], boxD, boxH, sideGroundTile);
    // Left (-X) — plain walls at ground level
    addComposedFace([-0.5, -0.5, -0.5], [0, 0, 1], [0, 1, 0], boxD, boxH, sideGroundTile);
    // Top (+Y) — flat roof
    addFlatFace([-0.5, 0.5, 0.5], [1, 0, 0], [0, 0, -1], true, boxW, boxD);
    // Bottom (-Y)
    addFlatFace([-0.5, -0.5, -0.5], [1, 0, 0], [0, 0, 1], false, boxW, boxD);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  };

  // (tileGroups no longer needed — bucketing uses height only)

  // Material with emissive window glow + normal map + AO shader
  const windowGlow = T.windowLitChance ?? 0.5;

  // buildingMat is declared above texture loading so KTX2 upgrade callbacks can reference it

  if (isMobile) {
    // ── Mobile: simple material — no normal map, no emissive, no shaders ──
    // Saves ~128MB GPU (normal + emissive textures) + avoids shader compilation
    buildingMat = new THREE.MeshStandardMaterial({
      map: atlasTexture,
      roughness: 0.75,
      metalness: 0.15,
      emissive: new THREE.Color(T.windowColor ?? 0xffcc66),
      emissiveIntensity: windowGlow * 0.15, // subtle baked glow without mask
    });
  } else {
    // ── Desktop: full pipeline with normal, emissive, AO, interior mapping ──
    // Load companion normal map atlas (same grid layout as diffuse)
    const normalPath = atlasPath.replace(/\.(png|jpg)$/, '_normal.png');
    const normalTexture = loadAtlasTexture(normalPath, THREE.LinearSRGBColorSpace);
    normalTexture.wrapS = THREE.RepeatWrapping;
    normalTexture.wrapT = THREE.RepeatWrapping;

    // Load companion emissive mask atlas (white=lit window, black=wall)
    const emissiveMaskPath = atlasPath.replace(/\.(png|jpg)$/, '_emissive.png');
    const emissiveMaskTexture = loadAtlasTexture(emissiveMaskPath, THREE.LinearSRGBColorSpace);
    emissiveMaskTexture.wrapS = THREE.RepeatWrapping;
    emissiveMaskTexture.wrapT = THREE.RepeatWrapping;
    emissiveMaskTexture.minFilter = THREE.LinearMipmapLinearFilter;

    buildingMat = new THREE.MeshStandardMaterial({
      map: atlasTexture,
      normalMap: normalTexture,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.75,
      metalness: 0.15,
      emissiveMap: emissiveMaskTexture,
      emissive: new THREE.Color(T.windowColor ?? 0xffcc66),
      emissiveIntensity: windowGlow * 0.10,
    });

    // Shader injection: AO banding + interior mapping
    buildingMat.onBeforeCompile = (shader) => {
      shader.uniforms.windowMask = { value: emissiveMaskTexture };

      // Vertex shader: pass height, world position, and normal
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          varying float vHeightFrac;
          varying vec3 vWPos;
          varying vec3 vWNormal;
        `)
         .replace('#include <uv_vertex>', `
          #include <uv_vertex>
          vHeightFrac = (position.y + 0.5);
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vWNormal = normalize(normalMatrix * normal);
        `);

      // Fragment shader: AO + emissive gating + interior mapping
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          uniform sampler2D windowMask;
          varying float vHeightFrac;
          varying vec3 vWPos;
          varying vec3 vWNormal;

          float hash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }

          vec3 interiorColor(vec3 worldPos, vec3 viewDir, vec3 wallNormal) {
            float roomW = 4.0; float roomH = 3.5; float roomDepth = 3.0;
            vec3 tangent = abs(wallNormal.y) > 0.9
              ? normalize(cross(wallNormal, vec3(1.0, 0.0, 0.0)))
              : normalize(cross(wallNormal, vec3(0.0, 1.0, 0.0)));
            float u = dot(worldPos, tangent);
            float v = worldPos.y;
            vec2 roomCell = vec2(floor(u / roomW), floor(v / roomH));
            float roomU = fract(u / roomW);
            float roomV = fract(v / roomH);
            float dU = dot(viewDir, tangent);
            float dV = dot(viewDir, vec3(0.0, 1.0, 0.0));
            float dN = dot(viewDir, wallNormal);
            if (dN >= 0.0) return vec3(0.05);
            float tBack = -roomDepth / dN;
            float tLeft = (dU > 0.0) ? ((1.0 - roomU) * roomW) / dU : (-roomU * roomW) / dU;
            float tFloor = (-roomV * roomH) / dV;
            float tCeil = ((1.0 - roomV) * roomH) / dV;
            float tMin = tBack;
            int hitFace = 0;
            if (tLeft > 0.0 && tLeft < tMin) { tMin = tLeft; hitFace = 1; }
            if (tFloor > 0.0 && tFloor < tMin) { tMin = tFloor; hitFace = 2; }
            if (tCeil > 0.0 && tCeil < tMin) { tMin = tCeil; hitFace = 3; }
            float roomHash = hash21(roomCell);
            vec3 backWall, sideWall, floorCol, ceilCol;
            if (roomHash < 0.3) {
              backWall = vec3(0.85, 0.78, 0.65); sideWall = vec3(0.75, 0.68, 0.55);
              floorCol = vec3(0.45, 0.35, 0.25); ceilCol  = vec3(0.92, 0.90, 0.85);
            } else if (roomHash < 0.6) {
              backWall = vec3(0.65, 0.72, 0.82); sideWall = vec3(0.55, 0.62, 0.72);
              floorCol = vec3(0.35, 0.35, 0.40); ceilCol  = vec3(0.88, 0.90, 0.92);
            } else if (roomHash < 0.8) {
              backWall = vec3(0.15, 0.13, 0.12); sideWall = vec3(0.12, 0.10, 0.09);
              floorCol = vec3(0.08, 0.07, 0.06); ceilCol  = vec3(0.18, 0.16, 0.15);
            } else {
              backWall = vec3(0.90, 0.75, 0.50); sideWall = vec3(0.80, 0.65, 0.40);
              floorCol = vec3(0.50, 0.38, 0.22); ceilCol  = vec3(0.95, 0.90, 0.80);
            }
            vec3 col;
            if (hitFace == 0) col = backWall;
            else if (hitFace == 1) col = sideWall;
            else if (hitFace == 2) col = floorCol;
            else col = ceilCol;
            float depth = tMin / (roomDepth * 2.0);
            col *= mix(1.0, 0.4, clamp(depth, 0.0, 1.0));
            return col;
          }
        `)
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            float camDist = length(vWPos - cameraPosition);
            float mipBias = mix(-0.7, 0.0, smoothstep(30.0, 150.0, camDist));
            vec4 sampledDiffuseColor = texture2D(map, vMapUv, mipBias);
            float interiorFade = 1.0 - smoothstep(40.0, 60.0, camDist);
            bool isWallFace = abs(vWNormal.y) < 0.3;
            bool isMidZone = vHeightFrac > 0.15 && vHeightFrac < 0.85;
            float maskVal = texture2D(windowMask, vMapUv).r;
            if (interiorFade > 0.01 && isWallFace && isMidZone && maskVal > 0.5) {
              vec3 viewDir = normalize(vWPos - cameraPosition);
              vec3 roomCol = interiorColor(vWPos, viewDir, vWNormal);
              sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, roomCol, interiorFade);
            }
            diffuseColor *= sampledDiffuseColor;
          #endif
        `)
        .replace('#include <emissivemap_fragment>', `
          #ifdef USE_EMISSIVEMAP
            vec4 emissiveColor = texture2D(emissiveMap, vEmissiveMapUv);
            float emCamDist = length(vWPos - cameraPosition);
            float emFade = 1.0 - smoothstep(60.0, 120.0, emCamDist);
            bool isEmWall = abs(vWNormal.y) < 0.3;
            bool isEmMid = vHeightFrac > 0.15 && vHeightFrac < 0.85;
            if (isEmWall && isEmMid && emissiveColor.r > 0.6) {
              totalEmissiveRadiance *= emFade;
            } else {
              totalEmissiveRadiance = vec3(0.0);
            }
          #endif
          float ao = smoothstep(0.0, 0.12, vHeightFrac) *
                     mix(1.0, 0.88, smoothstep(0.85, 1.0, vHeightFrac));
          diffuseColor.rgb *= ao;
        `);
    };

    normalTexture.minFilter = THREE.LinearMipmapLinearFilter;
    normalTexture.anisotropy = 16;
  }

  // Use trilinear filtering for smooth quality
  atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTexture.magFilter = THREE.LinearFilter;

  const dummy = new THREE.Object3D();
  const _instances: THREE.Vector3[] = [];

  // Group placements by HEIGHT BUCKET + VARIANT COLUMN
  // (since WebGPU renderer ignores onBeforeCompile, we bake column into UVs)
  const HEIGHT_BUCKET_SIZE = 10;
  const bucketKey = (hBucket: number, variant: number) => `${hBucket}_${variant}`;
  const combinedBuckets = new Map<string, BoxPlacement[]>();
  for (const pl of placements) {
    const hBucket = Math.floor(pl.h / HEIGHT_BUCKET_SIZE);
    const key = bucketKey(hBucket, pl.tile);
    const arr = combinedBuckets.get(key) ?? [];
    arr.push(pl);
    combinedBuckets.set(key, arr);
  }

  for (const [, bucketPlacements] of combinedBuckets) {
    if (bucketPlacements.length === 0) continue;

    // All placements in this bucket share the same variant column
    const variant = bucketPlacements[0].tile;

    // Compute average dimensions for this height bucket
    const avgW = bucketPlacements.reduce((s, p) => s + p.w, 0) / bucketPlacements.length;
    const avgH = bucketPlacements.reduce((s, p) => s + p.h, 0) / bucketPlacements.length;
    const avgD = bucketPlacements.reduce((s, p) => s + p.d, 0) / bucketPlacements.length;

    // Parse height bucket from key for hashing
    const hBucketNum = Math.floor(avgH / HEIGHT_BUCKET_SIZE);

    // Tile mapping: 5-row atlas layout (one column per building)
    // Row 0: window, Row 1: wall pier, Row 2: ground, Row 3: transition, Row 4: roof
    const windowTile      = 0 * ATLAS_COLS + variant; // Row 0 (window)
    const wallPierTile    = 1 * ATLAS_COLS + variant; // Row 1 (wall pier)
    const groundTile      = 2 * ATLAS_COLS + variant; // Row 2 (ground/storefront)
    const sideGroundTile  = 1 * ATLAS_COLS + variant; // Side ground = wall pier (row 1)
    const transitionTile  = 3 * ATLAS_COLS + variant; // Row 3 (transition band)
    const roofCapTile     = 4 * ATLAS_COLS + variant; // Row 4 (roof cap)
    const singleTile      = 1 * ATLAS_COLS + variant; // Single-story = wall surface

    // Pass physical dimensions — addComposedFace computes tile repeats internally
    const geo0 = buildComposedBox(groundTile, sideGroundTile, windowTile, wallPierTile, roofCapTile, transitionTile, singleTile, false, avgW, avgH, avgD);
    const geo1 = buildComposedBox(groundTile, sideGroundTile, windowTile, wallPierTile, roofCapTile, transitionTile, singleTile, true,  avgW, avgH, avgD);

    // Split placements into 2 visual variants (flip mirror)
    const bucket0: BoxPlacement[] = [];
    const bucket1: BoxPlacement[] = [];
    bucketPlacements.forEach((pl, i) => (i % 2 === 0 ? bucket0 : bucket1).push(pl));

    const variantSets: [THREE.BufferGeometry, BoxPlacement[]][] = [
      [geo0, bucket0],
      [geo1, bucket1],
    ];

    for (const [geo, bucket] of variantSets) {
      if (bucket.length === 0) continue;

      const instancedMesh = new THREE.InstancedMesh(geo, buildingMat, bucket.length);
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;

      for (let j = 0; j < bucket.length; j++) {
        const pl = bucket[j];
        const groundY = getTerrainHeight(pl.x, pl.z);
        dummy.position.set(pl.x, groundY + pl.h / 2, pl.z);
        dummy.scale.set(pl.w, pl.h, pl.d);

        // Per-environment silhouette variation
        const hash = ((pl.x * 73 + pl.z * 137) & 0xFF) / 255; // deterministic 0-1
        if (styleName === 'cyberpunk' && pl.h > 25) {
          // Shibuya tall towers: slight taper (narrower at top) for megastructure feel
          const taper = 0.92 + hash * 0.08; // 92-100% width at top
          dummy.scale.set(pl.w * taper, pl.h, pl.d * taper);
          dummy.rotation.set(0, pl.rotY, 0);
        } else {
          dummy.rotation.set(0, pl.rotY, 0);
        }
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(j, dummy.matrix);

        // Per-instance tint — AI atlases already have correct colors,
        // so use near-white with subtle ±10% luminance variation only
        const lum = 0.9 + (((pl.x * 31 + pl.z * 97) & 0xFF) / 255) * 0.2;
        _c.setRGB(lum, lum, lum);
        instancedMesh.setColorAt(j, _c);
        _instances.push(new THREE.Vector3(pl.x, pl.y, pl.z));
      }
      instancedMesh.instanceMatrix.needsUpdate = true;
      if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
      group.add(instancedMesh);
    }
  }

  // ── Foundation pads: flat boxes beneath each building to bridge terrain gap ──
  // Uses TSL ground-atlas material for seamless terrain-to-building transition
  // Skip on mobile — visual polish, not gameplay-relevant
  if (!isMobile && placements.length > 0) {
    const padGeo = new THREE.BoxGeometry(1, 1, 1);

    // TSL material that samples the same ground atlas as the terrain shader
    const padMat = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    const wXZ = positionWorld.xz;
    const P_NUM_ZONES = 4;
    const pTw = float(1.0 / (P_NUM_ZONES * 2));

    // DFT sampling for zone selection
    const dUV = vec2(add(mul(wXZ.x, 1.0 / 1200), 0.5), add(mul(wXZ.y, 1.0 / 1200), 0.5));
    const dDist = texture(_dftTexture, dUV).x;

    // Compute which 2 zones this pixel falls between
    const pZoneF = mul(dDist, float(P_NUM_ZONES));
    const pZoneA = floor(pZoneF);
    const pZoneB = min(add(pZoneA, 1.0), float(P_NUM_ZONES - 1));
    const pZoneMix = fract(pZoneF);
    const pColA = mul(pZoneA, 2.0);
    const pColB = mul(pZoneB, 2.0);

    // Variant hash (matches ground shader)
    const pCell = floor(mul(wXZ, 0.08));
    const pHash = fract(mul(sin(add(mul(pCell.x, 127.1), mul(pCell.y, 311.7))), 43758.5453));
    const pVar = smoothstep(0.3, 0.7, pHash);

    // Per-zone tiling scale + cell rotation (matches ground shader)
    const pScaleA = add(0.20, mul(pZoneA, -0.035));
    const pScaleB = add(0.20, mul(pZoneB, -0.035));
    const pUV_A = fract(mul(wXZ, pScaleA));
    const pUV_B = fract(mul(wXZ, pScaleB));
    const pRotAngle = mul(fract(mul(sin(add(mul(pCell.x, 43.7), mul(pCell.y, 89.3))), 9381.7)), 6.283);
    const pCosR = cos(pRotAngle);
    const pSinR = sin(pRotAngle);
    const pDoRot = (uvIn: typeof pUV_A) => {
      const cx = add(uvIn.x, -0.5);
      const cy = add(uvIn.y, -0.5);
      return fract(vec2(add(add(mul(cx, pCosR), mul(mul(cy, pSinR), -1)), 0.5),
                  add(add(mul(cx, pSinR), mul(cy, pCosR)), 0.5)));
    };
    const prA = pDoRot(pUV_A);
    const prB = pDoRot(pUV_B);

    // Sample 2 adjacent zones only (4 texture reads)
    const pcA_a = texture(_groundAtlasTexture, vec2(add(mul(prA.x, pTw), mul(pTw, pColA)), fract(prA.y)));
    const pcA_b = texture(_groundAtlasTexture, vec2(add(mul(prA.x, pTw), mul(pTw, add(pColA, 1))), fract(prA.y)));
    const pcA = mix(pcA_a, pcA_b, pVar);
    const pcB_a = texture(_groundAtlasTexture, vec2(add(mul(prB.x, pTw), mul(pTw, pColB)), fract(prB.y)));
    const pcB_b = texture(_groundAtlasTexture, vec2(add(mul(prB.x, pTw), mul(pTw, add(pColB, 1))), fract(prB.y)));
    const pcB = mix(pcB_a, pcB_b, pVar);
    const pAtlas = mix(pcA, pcB, pZoneMix);
    padMat.colorNode = pAtlas.xyz;

    const padIM = new THREE.InstancedMesh(padGeo, padMat, placements.length);
    padIM.receiveShadow = true;
    for (let j = 0; j < placements.length; j++) {
      const pl = placements[j];
      const groundY = getTerrainHeight(pl.x, pl.z);
      const padH = 0.2; // thin ground-level slab
      const padW = pl.w + 4; // 2-unit overhang each side
      const padD = pl.d + 4;
      dummy.position.set(pl.x, groundY + padH / 2, pl.z);
      dummy.scale.set(padW, padH, padD);
      dummy.rotation.set(0, pl.rotY, 0);
      dummy.updateMatrix();
      padIM.setMatrixAt(j, dummy.matrix);
    }
    padIM.instanceMatrix.needsUpdate = true;
    group.add(padIM);
  }

  _buildingInstances = _instances;
  _buildingInstancedMeshes = [];
  group.children.forEach((child: THREE.Object3D) => {
    if ((child as THREE.InstancedMesh).isInstancedMesh) {
      _buildingInstancedMeshes.push(child as THREE.InstancedMesh);
    }
  });

  // ── Phase 4: Peaked roof caps for chalet-style buildings (Zermatt) ──
  // Skip on mobile — saves 1 InstancedMesh draw call + geometry
  if (!isMobile && (styleName === 'chalet' || styleName === 'bamboo_lodge')) {
    // Triangular prism geometry for gabled roofs
    const roofPositions = new Float32Array([
      // Front triangle
      -0.5, 0, 0.5,   0.5, 0, 0.5,   0, 0.35, 0.5,
      // Back triangle
      0.5, 0, -0.5,   -0.5, 0, -0.5,   0, 0.35, -0.5,
      // Left slope
      -0.5, 0, 0.5,   0, 0.35, 0.5,   0, 0.35, -0.5,
      -0.5, 0, 0.5,   0, 0.35, -0.5,   -0.5, 0, -0.5,
      // Right slope
      0.5, 0, 0.5,   0.5, 0, -0.5,   0, 0.35, -0.5,
      0.5, 0, 0.5,   0, 0.35, -0.5,   0, 0.35, 0.5,
    ]);
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(roofPositions, 3));
    roofGeo.computeVertexNormals();

    // Use a darkened version of roof tile as color
    const roofCapMat = new THREE.MeshStandardMaterial({
      color: 0x4a3a2a, roughness: 0.85, metalness: 0,
    });
    const roofCapIM = new THREE.InstancedMesh(roofGeo, roofCapMat, placements.length);
    for (let j = 0; j < placements.length; j++) {
      const pl = placements[j];
      dummy.position.set(pl.x, pl.y + pl.h, pl.z);
      dummy.scale.set(pl.w * 1.1, pl.h * 0.25, pl.d * 1.1); // overhang + proportional height
      dummy.rotation.set(0, pl.rotY, 0);
      dummy.updateMatrix();
      roofCapIM.setMatrixAt(j, dummy.matrix);
      // Slight color variation
      const rv = 0.8 + (((pl.x * 31 + pl.z * 97) & 0xFF) / 255) * 0.4;
      _c.setRGB(0.29 * rv, 0.23 * rv, 0.17 * rv);
      roofCapIM.setColorAt(j, _c);
    }
    roofCapIM.instanceMatrix.needsUpdate = true;
    roofCapIM.instanceColor!.needsUpdate = true;
    roofCapIM.castShadow = true;
    group.add(roofCapIM);
  }

  // ── Phase 4: Stepped setback towers for cyberpunk megastructures (Shibuya) ──
  // Skip on mobile
  if (!isMobile && styleName === 'cyberpunk') {
    // Filter tall buildings that get a stepped upper section
    const tallPlacements = placements.filter(pl => pl.h > 30);
    if (tallPlacements.length > 0) {
      // Reuse a random facade tile for the setback section
      const setbackGeo = new THREE.BoxGeometry(1, 1, 1);
      const setbackIM = new THREE.InstancedMesh(setbackGeo, buildingMat, tallPlacements.length);
      for (let j = 0; j < tallPlacements.length; j++) {
        const pl = tallPlacements[j];
        const setbackH = pl.h * 0.4;   // 40% of base height
        const setbackW = pl.w * 0.6;   // 60% narrower
        const setbackD = pl.d * 0.6;
        dummy.position.set(pl.x, pl.y + pl.h + setbackH / 2, pl.z);
        dummy.scale.set(setbackW, setbackH, setbackD);
        dummy.rotation.set(0, pl.rotY, 0);
        dummy.updateMatrix();
        setbackIM.setMatrixAt(j, dummy.matrix);
        // Slightly darker tint for the upper section
        const bright = 0.7 + (((pl.x * 73 + pl.z * 137) & 0xFF) / 255) * 0.2;
        _c.setRGB(bright, bright, bright * 1.1); // subtle blue tint
        setbackIM.setColorAt(j, _c);
      }
      setbackIM.instanceMatrix.needsUpdate = true;
      setbackIM.instanceColor!.needsUpdate = true;
      setbackIM.castShadow = true;
      group.add(setbackIM);
    }
  }

  // ── Ground-level awnings / canopies — DISABLED (looked like dark bands on facades) ──
  const AWNING_COLORS: Record<string, number[]> = {
    modern:      [0x2d5a27, 0x8b1a1a, 0x1a3d5c],  // dark green, burgundy, navy
    adobe:       [0xc4a882, 0xa0805a, 0x8b6b4a],   // sun-bleached tan, faded sand
    beach_house: [0xe8a0b0, 0xf0d060, 0x70c8c0, 0xa0d8a0], // tropical pastels
    cyberpunk:   [0x4400aa, 0x00aacc, 0xcc0066],   // neon purple, cyan, pink
    weathered:   [0xc4a882, 0x8b7355, 0x6b5b45],   // faded warm tones
    chalet:      [0x5a3a2a, 0x2a4a2a, 0x4a3020],   // dark wood, forest green
    warehouse:   [0x555555, 0x666666, 0x444444],    // industrial gray
    concrete:    [0x555555, 0x2d5a27, 0x444444],    // gray + green
    bamboo_lodge:[0x5a3a2a, 0x3a5a3a, 0x6a4a30],   // warm wood tones
  };
  const awningColors = AWNING_COLORS[styleName] ?? AWNING_COLORS['modern'];
  // Awnings disabled — they render as dark rectangles on building faces
  const awningPlacements: typeof placements = [];
  if (awningPlacements.length > 0) {
    const awningGeo = new THREE.PlaneGeometry(1, 1);
    const awningMat = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const awningIM = new THREE.InstancedMesh(awningGeo, awningMat, awningPlacements.length);
    for (let j = 0; j < awningPlacements.length; j++) {
      const pl = awningPlacements[j];
      // Place at front face, ground level with slight downward tilt
      const awningW = pl.w * 0.7;
      const awningD = 2.5;
      dummy.position.set(
        pl.x + Math.sin(pl.rotY) * (pl.d / 2 + 1),
        pl.y + 1.5,
        pl.z + Math.cos(pl.rotY) * (pl.d / 2 + 1),
      );
      dummy.scale.set(awningW, awningD, 1);
      dummy.rotation.set(-0.3, pl.rotY, 0); // slight tilt
      dummy.updateMatrix();
      awningIM.setMatrixAt(j, dummy.matrix);
      const aCol = awningColors[((pl.x * 17 + pl.z * 41) & 0xFF) % awningColors.length];
      const av = 0.85 + (((pl.x * 61 + pl.z * 83) & 0xFF) / 255) * 0.3;
      _c.setHex(aCol);
      _c.multiplyScalar(av);
      awningIM.setColorAt(j, _c);
    }
    awningIM.instanceMatrix.needsUpdate = true;
    awningIM.instanceColor!.needsUpdate = true;
    group.add(awningIM);
  }

  // ── Rooftop props (HVAC units, water tanks, antenna bases) ──
  // Skip for chalets (peaked roofs), very short buildings, and mobile
  if (!isMobile && styleName !== 'chalet' && styleName !== 'bamboo_lodge') {
    const roofPropPlacements = placements.filter(pl =>
      pl.h > 12 && ((pl.x * 41 + pl.z * 67) & 0xFF) < 128 // ~50% of tall buildings
    );
    if (roofPropPlacements.length > 0) {
      const propGeo = new THREE.BoxGeometry(1, 1, 1);
      const propMat = new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.9,
        metalness: 0.3,
      });
      const propIM = new THREE.InstancedMesh(propGeo, propMat, roofPropPlacements.length);
      for (let j = 0; j < roofPropPlacements.length; j++) {
        const pl = roofPropPlacements[j];
        const propW = 1.5 + (((pl.x * 23) & 0xFF) / 255) * 2;
        const propH = 0.8 + (((pl.z * 37) & 0xFF) / 255) * 1.5;
        const propD = 1.5 + (((pl.x * 59 + pl.z * 11) & 0xFF) / 255) * 2;
        // Offset from center of roof
        const offX = ((((pl.x * 71) & 0xFF) / 255) - 0.5) * pl.w * 0.4;
        const offZ = ((((pl.z * 43) & 0xFF) / 255) - 0.5) * pl.d * 0.4;
        dummy.position.set(pl.x + offX, pl.y + pl.h + propH / 2, pl.z + offZ);
        dummy.scale.set(propW, propH, propD);
        dummy.rotation.set(0, pl.rotY + (((pl.x * 13) & 0xFF) / 255) * 0.5, 0);
        dummy.updateMatrix();
        propIM.setMatrixAt(j, dummy.matrix);
        // Slight color variation (darker/lighter gray)
        const pv = 0.5 + (((pl.x * 31 + pl.z * 97) & 0xFF) / 255) * 0.4;
        _c.setRGB(pv, pv, pv);
        propIM.setColorAt(j, _c);
      }
      propIM.instanceMatrix.needsUpdate = true;
      propIM.instanceColor!.needsUpdate = true;
      propIM.castShadow = true;
      group.add(propIM);
    }
  }
}
}
