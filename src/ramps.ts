/* ── IRL Race — Ramp Mesh Builder ── */

import * as THREE from 'three/webgpu';
import type { RampDef } from './types';
import { COLORS } from './colors';

const ROAD_WIDTH = 14;

// Reusable temps
const _tan = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Asymmetric ramp profile for launching vehicles airborne.
 * Returns 0..1 representing height fraction at position `f` (0..1 along ramp).
 *   - approach zone (~80%): gradual cosine ease-in from 0 to 1
 *   - flat top zone  (passed in): holds at 1
 *   - cliff lip      (~3%): near-vertical drop — car overshoots in one frame
 */
function rampProfile(f: number, flatTop: number): number {
  const clampedFlatTop = Math.min(flatTop, 0.15); // cap to leave room
  const approach = 0.97 - clampedFlatTop; // ~80% approach
  const cliff = 0.03; // 3% — near-vertical drop
  if (f < approach) {
    // Gradual ease-in: 0 → 1
    return 0.5 * (1 - Math.cos(Math.PI * f / approach));
  } else if (f < approach + clampedFlatTop) {
    return 1;
  } else {
    // Near-vertical cliff: drops from 1 → 0 in just 3% of ramp length
    const t = (f - approach - clampedFlatTop) / cliff;
    return Math.max(0, 1 - t);
  }
}

/** Build a single ramp mesh at spline position `def.t`. */
export function buildRampMesh(
  spline: THREE.CatmullRomCurve3,
  def: RampDef,
): THREE.Mesh {
  const totalLength = spline.getLength();
  const rampWorldLen = def.length;
  const halfLenT = (rampWorldLen / totalLength) / 2;
  const tStart = Math.max(0.001, def.t - halfLenT);
  const tEnd = Math.min(0.999, def.t + halfLenT);

  const segments = 20; // cross-sections along ramp
  const halfW = ROAD_WIDTH / 2;
  const rampHalfW = def.side === 'full' ? halfW
    : def.side === 'left' ? halfW / 2
    : halfW / 2;

  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const f = i / segments; // 0..1 along ramp
    const t = tStart + f * (tEnd - tStart);

    const pt = spline.getPointAt(t);
    _tan.copy(spline.getTangentAt(t)).normalize();
    _right.crossVectors(_tan, _up).normalize();

    const h = rampProfile(f, def.flatTop) * def.height;

    // Compute left/right offsets based on side
    let leftOff: number, rightOff: number;
    if (def.side === 'full') {
      leftOff = -halfW;
      rightOff = halfW;
    } else if (def.side === 'left') {
      leftOff = -halfW;
      rightOff = 0;
    } else {
      leftOff = 0;
      rightOff = halfW;
    }

    // Left vertex
    vertices.push(
      pt.x + _right.x * leftOff,
      pt.y + 0.02 + h,
      pt.z + _right.z * leftOff,
    );
    // Right vertex
    vertices.push(
      pt.x + _right.x * rightOff,
      pt.y + 0.02 + h,
      pt.z + _right.z * rightOff,
    );

    uvs.push(0, f * 4);
    uvs.push(1, f * 4);

    // Approximate normal: compute slope for proper lighting
    const df = 1 / segments;
    const hPrev = i > 0 ? rampProfile((i - 1) / segments, def.flatTop) * def.height : 0;
    const hNext = i < segments ? rampProfile((i + 1) / segments, def.flatTop) * def.height : 0;
    const slope = (hNext - hPrev) / (2 * rampWorldLen * df);
    const nx = 0, ny = 1, nz = -slope;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    normals.push(nx / nLen, ny / nLen, nz / nLen);
    normals.push(nx / nLen, ny / nLen, nz / nLen);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  // Side walls (left and right vertical faces for visual solidity)
  const wallBase = vertices.length / 3;
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const t = tStart + f * (tEnd - tStart);
    const pt = spline.getPointAt(t);
    _tan.copy(spline.getTangentAt(t)).normalize();
    _right.crossVectors(_tan, _up).normalize();

    const h = rampProfile(f, def.flatTop) * def.height;

    let leftOff: number, rightOff: number;
    if (def.side === 'full') { leftOff = -halfW; rightOff = halfW; }
    else if (def.side === 'left') { leftOff = -halfW; rightOff = 0; }
    else { leftOff = 0; rightOff = halfW; }

    // Left wall: top → bottom
    vertices.push(pt.x + _right.x * leftOff, pt.y + 0.02 + h, pt.z + _right.z * leftOff);
    vertices.push(pt.x + _right.x * leftOff, pt.y + 0.02, pt.z + _right.z * leftOff);
    normals.push(-_right.x, 0, -_right.z, -_right.x, 0, -_right.z);
    uvs.push(0, f * 4); uvs.push(0, f * 4);

    // Right wall: top → bottom
    vertices.push(pt.x + _right.x * rightOff, pt.y + 0.02 + h, pt.z + _right.z * rightOff);
    vertices.push(pt.x + _right.x * rightOff, pt.y + 0.02, pt.z + _right.z * rightOff);
    normals.push(_right.x, 0, _right.z, _right.x, 0, _right.z);
    uvs.push(1, f * 4); uvs.push(1, f * 4);

    if (i < segments) {
      const lb = wallBase + i * 4;
      // Left wall
      indices.push(lb, lb + 4, lb + 1);
      indices.push(lb + 1, lb + 4, lb + 5);
      // Right wall
      indices.push(lb + 2, lb + 3, lb + 6);
      indices.push(lb + 3, lb + 7, lb + 6);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);

  const tex = createRampTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.85,
    metalness: 0.0,
    envMapIntensity: 0.3,
    color: 0x666670,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Build all ramp meshes from an array of definitions. */
export function buildRampGroup(
  spline: THREE.CatmullRomCurve3,
  rampDefs: RampDef[],
): THREE.Group {
  const group = new THREE.Group();
  for (const def of rampDefs) {
    group.add(buildRampMesh(spline, def));
  }
  return group;
}
/** Create a canvas texture with configurable stripe color for ramp surface. */
function createRampTexture(stripeColor: string = COLORS.ORANGE, edgeColor: string = COLORS.ACCENT, baseColor: string = COLORS.DARK_SURFACE): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // Base
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, S, S);

  // Asphalt noise
  const imgData = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 15;
    imgData.data[i] += n;
    imgData.data[i + 1] += n;
    imgData.data[i + 2] += n;
  }
  ctx.putImageData(imgData, 0, 0);

  // Chevron warning stripes (diagonal)
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = stripeColor;
  ctx.lineWidth = 12;
  const spacing = 40;
  for (let y = -S; y < S * 2; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y + S);
    ctx.stroke();
  }
  ctx.restore();

  // Edge lines
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.7;
  ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(4, S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(S - 4, 0); ctx.lineTo(S - 4, S); ctx.stroke();
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1); tex.anisotropy = 4;
  return tex;
}

// ── Ramp type archetype definitions ──
type RampType = 'standard' | 'speed_bump' | 'half_ramp' | 'mega' | 'kicker';

interface RampArchetype {
  lengthRange: [number, number];   // [min, max] world units
  heightRange: [number, number];   // [min, max] units
  flatTopRange: [number, number];  // [min, max] fraction
  side: 'full' | 'left' | 'right' | 'random';
  meshColor: number;
  stripeColor: string;
  edgeColor: string;
  baseColor: string;
}

const RAMP_ARCHETYPES: Record<RampType, RampArchetype> = {
  // Standard — yellow chevrons, medium size
  standard: {
    lengthRange: [18, 28],
    heightRange: [1.5, 3],
    flatTopRange: [0.08, 0.12],
    side: 'full',
    meshColor: 0x666670,
    stripeColor: COLORS.ORANGE,
    edgeColor: COLORS.ACCENT,
    baseColor: COLORS.DARK_SURFACE,
  },
  // Speed bump — short, low, quick hop
  speed_bump: {
    lengthRange: [6, 10],
    heightRange: [1.2, 2.0],
    flatTopRange: [0.05, 0.10],
    side: 'full',
    meshColor: 0x777755,
    stripeColor: '#ffffff',
    edgeColor: '#cccccc',
    baseColor: '#4a4a3e',
  },
  // Half-ramp — one side only, asymmetric launch
  half_ramp: {
    lengthRange: [14, 22],
    heightRange: [1.5, 3],
    flatTopRange: [0.08, 0.12],
    side: 'random', // randomly left or right
    meshColor: 0x5566aa,
    stripeColor: COLORS.BLUE,
    edgeColor: '#2288dd',
    baseColor: '#35354a',
  },
  // Mega — tall and long, maximum air
  mega: {
    lengthRange: [25, 35],
    heightRange: [3, 4.5],
    flatTopRange: [0.10, 0.15],
    side: 'full',
    meshColor: 0x885533,
    stripeColor: '#ff4400',
    edgeColor: '#cc2200',
    baseColor: '#3a3028',
  },
  // Kicker — short and steep, quick vertical lift
  kicker: {
    lengthRange: [8, 14],
    heightRange: [2, 3.5],
    flatTopRange: [0.03, 0.06],
    side: 'full',
    meshColor: 0x558855,
    stripeColor: '#44ff66',
    edgeColor: '#22cc44',
    baseColor: '#2e3e2e',
  },
};

// Weighted random selection of ramp types
const RAMP_TYPE_WEIGHTS: [RampType, number][] = [
  ['standard', 3],
  ['speed_bump', 3],
  ['half_ramp', 2],
  ['mega', 1],
  ['kicker', 2],
];

function pickRampType(rng: () => number): RampType {
  const total = RAMP_TYPE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [type, weight] of RAMP_TYPE_WEIGHTS) {
    r -= weight;
    if (r <= 0) return type;
  }
  return 'standard';
}

/** Cache textures per ramp type to avoid recreating. */
const _texCache = new Map<RampType, THREE.CanvasTexture>();

function getRampTexture(type: RampType): THREE.CanvasTexture {
  let tex = _texCache.get(type);
  if (!tex) {
    const a = RAMP_ARCHETYPES[type];
    tex = createRampTexture(a.stripeColor, a.edgeColor, a.baseColor);
    _texCache.set(type, tex);
  }
  return tex;
}

/**
 * Procedurally place ramps on long straights.
 * Now uses multiple ramp types for variety.
 */
export function placeRampsOnStraights(
  curvatures: number[],
  speedProfile: number[],
  _totalLength: number,
  rng: () => number,
): RampDef[] {
  const ramps: RampDef[] = [];
  const MIN_STRAIGHT_SAMPLES = 15; // shorter straights now qualify
  const SPEED_THRESHOLD = 40;       // lower speed threshold
  const MIN_RAMP_SPACING_T = 0.05;  // 5% track spacing (was 8%)

  // Find straight sections
  type Straight = { startIdx: number; endIdx: number };
  const straights: Straight[] = [];
  let runStart = -1;

  for (let i = 0; i < speedProfile.length; i++) {
    if (speedProfile[i] >= SPEED_THRESHOLD && Math.abs(curvatures[Math.min(i, curvatures.length - 1)]) < 0.025) {
      if (runStart < 0) runStart = i;
    } else {
      if (runStart >= 0 && i - runStart >= MIN_STRAIGHT_SAMPLES) {
        straights.push({ startIdx: runStart, endIdx: i - 1 });
      }
      runStart = -1;
    }
  }
  if (runStart >= 0 && speedProfile.length - runStart >= MIN_STRAIGHT_SAMPLES) {
    straights.push({ startIdx: runStart, endIdx: speedProfile.length - 1 });
  }

  // Place 2-4 ramps per straight
  for (const s of straights) {
    const sLen = s.endIdx - s.startIdx;
    const numRamps = 2 + Math.floor(rng() * 2.5); // 2-4
    for (let r = 0; r < numRamps; r++) {
      const margin = 0.10;
      const idx = s.startIdx + Math.floor(sLen * (margin + rng() * (1 - 2 * margin)));
      const t = idx / (speedProfile.length - 1);

      if (t < 0.03 || t > 0.97) continue;

      const tooClose = ramps.some(existing => Math.abs(existing.t - t) < MIN_RAMP_SPACING_T);
      if (tooClose) continue;

      // Pick a random ramp type
      const type = pickRampType(rng);
      const arch = RAMP_ARCHETYPES[type];

      const length = arch.lengthRange[0] + rng() * (arch.lengthRange[1] - arch.lengthRange[0]);
      const height = arch.heightRange[0] + rng() * (arch.heightRange[1] - arch.heightRange[0]);
      const flatTop = arch.flatTopRange[0] + rng() * (arch.flatTopRange[1] - arch.flatTopRange[0]);
      let side: 'full' | 'left' | 'right' = arch.side === 'random'
        ? (rng() > 0.5 ? 'left' : 'right')
        : arch.side;

      ramps.push({ t, length, height, flatTop, side });
    }
  }

  return ramps;
}
