/* ── Hood Racer — Ramp Mesh Builder ── */

import * as THREE from 'three';
import type { RampDef } from './types';

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

/** Create a canvas texture with chevron warning stripes for ramp surface. */
function createRampTexture(): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // Base: dark asphalt
  ctx.fillStyle = '#3e3e48';
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

  // Yellow chevron warning stripes (diagonal)
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#ffaa00';
  ctx.lineWidth = 12;
  const spacing = 40;
  for (let y = -S; y < S * 2; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y + S);
    ctx.stroke();
  }
  ctx.restore();

  // Orange edge lines
  ctx.strokeStyle = '#ff6600';
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

/**
 * Procedurally place ramps on long straights.
 * Scans the speed profile for sections where speed > threshold for consecutive samples.
 */
export function placeRampsOnStraights(
  curvatures: number[],
  speedProfile: number[],
  _totalLength: number,
  rng: () => number,
): RampDef[] {
  const ramps: RampDef[] = [];
  const MIN_STRAIGHT_SAMPLES = 25; // ~6% of track must be straight
  const SPEED_THRESHOLD = 55;
  const MIN_RAMP_SPACING_T = 0.08; // at least 8% of track between ramps

  // Find long straight sections
  type Straight = { startIdx: number; endIdx: number };
  const straights: Straight[] = [];
  let runStart = -1;

  for (let i = 0; i < speedProfile.length; i++) {
    if (speedProfile[i] >= SPEED_THRESHOLD && Math.abs(curvatures[Math.min(i, curvatures.length - 1)]) < 0.02) {
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

  // Place 1-2 ramps per straight
  for (const s of straights) {
    const numRamps = 1 + Math.floor(rng() * 1.5); // 1-2
    for (let r = 0; r < numRamps; r++) {
      // Random position within the straight (avoid edges)
      const margin = 0.15; // 15% margin from straight edges
      const sLen = s.endIdx - s.startIdx;
      const idx = s.startIdx + Math.floor(sLen * (margin + rng() * (1 - 2 * margin)));
      const t = idx / (speedProfile.length - 1);

      // Skip near start/finish
      if (t < 0.04 || t > 0.96) continue;

      // Check spacing from existing ramps
      const tooClose = ramps.some(existing => Math.abs(existing.t - t) < MIN_RAMP_SPACING_T);
      if (tooClose) continue;

      ramps.push({
        t,
        length: 15 + rng() * 15, // 15-30 units
        height: 3.5 + rng() * 3.5, // 3.5-7 units (tall enough for dramatic jumps)
        flatTop: 0.15 + rng() * 0.2, // 0.15-0.35
        side: 'full',
      });
    }
  }

  return ramps;
}
