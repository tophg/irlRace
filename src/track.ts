/* ── Hood Racer — Procedural Track Generator (v2 — Convex Hull + Elevation) ── */

import * as THREE from 'three';
import { Checkpoint, TrackData } from './types';
import { SplineBVH } from './bvh';

const ROAD_WIDTH = 14;
const BARRIER_HEIGHT = 1.8;
const BARRIER_THICKNESS = 0.4;
const SPLINE_SAMPLES = 400;
const MIN_RADIUS = 18;      // tightest allowed corner
const MAX_BANK_ANGLE = 0.35; // ~20° banking
const BANK_SCALE = 8;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Generate a closed circuit deterministically from seed. Single-pass for cross-platform consistency. */
export function generateTrack(seed?: number): TrackData {
  const baseSeed = seed ?? (Date.now() % 100000);
  return buildTrackAttempt(baseSeed).data;
}

/** Build a track from user-placed 2D control points (Track Editor → TrackData pipeline). */
export function buildTrackFromControlPoints(
  points: { x: number; z: number }[],
  elevations?: number[],
): TrackData {
  if (points.length < 4) throw new Error('Need at least 4 control points');

  const rng = seededRandom(42); // deterministic scenery

  // Convert 2D → 3D with optional per-point elevation
  let controlPoints3D: THREE.Vector3[];
  if (elevations && elevations.length === points.length) {
    controlPoints3D = points.map((p, i) => new THREE.Vector3(p.x, elevations[i], p.z));
  } else {
    // Auto-elevation via value noise
    const noise = createValueNoise2D(rng);
    controlPoints3D = points.map(p => {
      const nx = p.x * 0.004;
      const nz = p.z * 0.004;
      const y = noise(nx, nz) * 10 + noise(nx * 4, nz * 4) * 2;
      return new THREE.Vector3(p.x, y, p.z);
    });
    // Smooth elevation with moving average (same as procedural)
    for (let pass = 0; pass < 4; pass++) {
      const prev = controlPoints3D.map(p => p.y);
      for (let i = 0; i < controlPoints3D.length; i++) {
        let avg = 0;
        for (let j = -4; j <= 4; j++) {
          avg += prev[(i + j + controlPoints3D.length) % controlPoints3D.length];
        }
        controlPoints3D[i].y = avg / 9;
      }
    }
  }

  // Build spline & enforce constraints
  const spline = new THREE.CatmullRomCurve3(controlPoints3D, true, 'centripetal', 0.5);
  enforceMinRadius(spline, controlPoints3D, MIN_RADIUS);
  const finalSpline = new THREE.CatmullRomCurve3(controlPoints3D, true, 'centripetal', 0.5);
  const totalLength = finalSpline.getLength();

  const { curvatures, speedProfile } = computeProfiles(finalSpline);

  // Build meshes (reuse all existing builders)
  const roadMesh = buildRoadMesh(finalSpline, curvatures, rng);
  const barrierLeft = buildBarrierMesh(finalSpline, -1, curvatures);
  const barrierRight = buildBarrierMesh(finalSpline, 1, curvatures);
  const shoulderMesh = buildShoulders(finalSpline);
  const kerbGroup = buildKerbs(finalSpline, curvatures);

  // Checkpoints — scale count by track length (1 per ~100 world units, min 4, max 12)
  const numCheckpoints = Math.max(4, Math.min(12, Math.round(totalLength / 100)));
  const checkpoints: Checkpoint[] = [];
  for (let i = 1; i <= numCheckpoints; i++) {
    const t = i / numCheckpoints;
    const evalT = t >= 1.0 ? 0 : t;
    const position = finalSpline.getPointAt(evalT);
    const tangent = finalSpline.getTangentAt(evalT).normalize();
    checkpoints.push({ position, tangent, index: i - 1, t });
  }

  const sceneryGroup = generateScenery(finalSpline, rng);
  const bvh = new SplineBVH(finalSpline, 800);

  return { spline: finalSpline, roadMesh, barrierLeft, barrierRight, shoulderMesh, kerbGroup, checkpoints, sceneryGroup, totalLength, bvh, speedProfile, curvatures };
}

interface TrackAttemptResult { data: TrackData; qualityScore: number }

function buildTrackAttempt(seed: number): TrackAttemptResult {
  const rng = seededRandom(seed);

  // ── 1. Convex-hull seed points ──
  const hullPts = generateHullPoints(rng);

  // ── 2. Insert chicane dent points ──
  const routePoints2D = addChicanes(hullPts, rng);

  // ── 3. Apply Perlin-style elevation ──
  const controlPoints3D = applyElevation(routePoints2D, rng);

  // ── 4. Build smooth closed spline ──
  const spline = new THREE.CatmullRomCurve3(controlPoints3D, true, 'centripetal', 0.5);

  // ── 5. Curvature constraint enforcement ──
  enforceMinRadius(spline, controlPoints3D, MIN_RADIUS);
  // Rebuild spline after enforcement
  const finalSpline = new THREE.CatmullRomCurve3(controlPoints3D, true, 'centripetal', 0.5);
  const totalLength = finalSpline.getLength();

  // ── 6. Compute curvature profile + speed profile ──
  const { curvatures, speedProfile } = computeProfiles(finalSpline);

  // ── 7. Build meshes ──
  const roadMesh = buildRoadMesh(finalSpline, curvatures, rng);
  const barrierLeft = buildBarrierMesh(finalSpline, -1, curvatures);
  const barrierRight = buildBarrierMesh(finalSpline, 1, curvatures);
  const shoulderMesh = buildShoulders(finalSpline);
  const kerbGroup = buildKerbs(finalSpline, curvatures);

  // ── 8. Place checkpoints (distributed from t > 0 to t=1.0 for precise lap completion) ──
  const numCheckpoints = 10;
  const checkpoints: Checkpoint[] = [];
  for (let i = 1; i <= numCheckpoints; i++) {
    const t = i / numCheckpoints; // e.g. 0.1, 0.2 ... 1.0
    // Use t=0 for geometry evaluation if t=1, since the spline loops perfectly
    const evalT = t === 1.0 ? 0 : t;
    const position = finalSpline.getPointAt(evalT);
    const tangent = finalSpline.getTangentAt(evalT).normalize();
    checkpoints.push({ position, tangent, index: i - 1, t });
  }

  // ── 9. Scenery ──
  const sceneryGroup = generateScenery(finalSpline, rng);

  // ── 10. Build BVH for O(log N) nearest-point queries ──
  const bvh = new SplineBVH(finalSpline, 800);

  // ── 11. Quality score ──
  const qualityScore = scoreTrack(curvatures, totalLength, speedProfile);

  const data: TrackData = { spline: finalSpline, roadMesh, barrierLeft, barrierRight, shoulderMesh, kerbGroup, checkpoints, sceneryGroup, totalLength, bvh, speedProfile, curvatures };
  return { data, qualityScore };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// P2-A: CONVEX HULL SEED GENERATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Generate N random 2D seed points → convex hull → winding-order vertices. */
function generateHullPoints(rng: () => number): THREE.Vector2[] {
  const N = 8 + Math.floor(rng() * 5); // 8–12 seed points
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < N; i++) {
    pts.push(new THREE.Vector2(
      (rng() - 0.5) * 300,
      (rng() - 0.5) * 300,
    ));
  }
  return convexHull(pts);
}

/** Gift-wrapping (Jarvis March) convex hull — returns points in CCW winding order. */
function convexHull(pts: THREE.Vector2[]): THREE.Vector2[] {
  if (pts.length < 3) return pts;

  // Find leftmost point
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < pts[start].x || (pts[i].x === pts[start].x && pts[i].y < pts[start].y)) {
      start = i;
    }
  }

  const hull: THREE.Vector2[] = [];
  let current = start;
  do {
    hull.push(pts[current]);
    let next = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i === current) continue;
      // Cross product to find most counter-clockwise point
      const cross = crossProduct(pts[current], pts[next], pts[i]);
      if (next === current || cross > 0 ||
        (cross === 0 && pts[current].distanceTo(pts[i]) > pts[current].distanceTo(pts[next]))) {
        next = i;
      }
    }
    current = next;
  } while (current !== start && hull.length < pts.length + 1);

  return hull;
}

function crossProduct(o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Insert 1-3 "dent" points per hull edge to create chicanes. */
function addChicanes(hull: THREE.Vector2[], rng: () => number): THREE.Vector2[] {
  const result: THREE.Vector2[] = [];

  for (let i = 0; i < hull.length; i++) {
    result.push(hull[i].clone());

    const next = hull[(i + 1) % hull.length];
    const edgeLen = hull[i].distanceTo(next);

    // Only add chicanes on edges > 60 units
    if (edgeLen > 60 && rng() > 0.35) {
      const numDents = 1 + Math.floor(rng() * 2); // 1–2 dents
      for (let d = 0; d < numDents; d++) {
        const t = 0.25 + rng() * 0.5; // midrange on the edge
        const mid = hull[i].clone().lerp(next, t);

        // Dent inward toward the centroid
        const centroid = hull.reduce((acc, p) => acc.add(p.clone()), new THREE.Vector2()).divideScalar(hull.length);
        const inward = centroid.clone().sub(mid).normalize();
        const dentDepth = 15 + rng() * 40;
        mid.add(inward.multiplyScalar(dentDepth));

        result.push(mid);
      }
    }
  }

  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// P2-D: ELEVATION (Layered Simplex-like noise)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Apply gentle hills via seeded 2D noise to the 2D route points. */
function applyElevation(pts2D: THREE.Vector2[], rng: () => number): THREE.Vector3[] {
  // Use a simple value-noise implementation (no dependencies)
  const noise = createValueNoise2D(rng);

  const pts3D = pts2D.map(p => {
    const nx = p.x * 0.004;
    const ny = p.y * 0.004;
    // Two octaves of noise
    const coarse = noise(nx, ny) * 15;
    const fine = noise(nx * 4, ny * 4) * 3;
    const y = coarse + fine;
    return new THREE.Vector3(p.x, y, p.y);
  });

  // Non-biased moving average (read from copy) with wrap-around
  // 4 passes × 9-point window for smooth hills across the start/finish seam
  for (let pass = 0; pass < 4; pass++) {
    const prev = pts3D.map(p => p.y);
    for (let i = 0; i < pts3D.length; i++) {
      let avg = 0;
      for (let j = -4; j <= 4; j++) {
        avg += prev[(i + j + pts3D.length) % pts3D.length];
      }
      pts3D[i].y = avg / 9;
    }
  }

  return pts3D;
}

/** Simple seeded 2D value noise (gradient-hash based, no external deps). */
function createValueNoise2D(rng: () => number): (x: number, y: number) => number {
  // Build a 256-entry permutation table (seeded)
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  // Fisher–Yates shuffle with seeded rng
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + t * (b - a);
  const grad = (hash: number, x: number, y: number) => {
    const h = hash & 3;
    const u = h < 2 ? x : y;
    const v = h < 2 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  };

  return (x: number, y: number): number => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v,
    );
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// P2-B: CURVATURE CONSTRAINT ENFORCEMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Iteratively relax control points where curvature exceeds 1/minRadius. */
function enforceMinRadius(spline: THREE.CatmullRomCurve3, ctrlPts: THREE.Vector3[], minRadius: number) {
  const maxIter = 10;
  const maxCurvature = 1 / minRadius;

  for (let iter = 0; iter < maxIter; iter++) {
    let violated = false;
    // Sample curvature at many points
    for (let i = 0; i < 200; i++) {
      const t = i / 200;
      const kappa = estimateCurvature(spline, t);

      if (Math.abs(kappa) > maxCurvature) {
        violated = true;
        // Find closest control point and relax it toward its neighbours
        let bestIdx = 0, bestDist = Infinity;
        const pt = spline.getPointAt(t);
        for (let c = 0; c < ctrlPts.length; c++) {
          const d = pt.distanceToSquared(ctrlPts[c]);
          if (d < bestDist) { bestDist = d; bestIdx = c; }
        }

        const prev = ctrlPts[(bestIdx - 1 + ctrlPts.length) % ctrlPts.length];
        const next = ctrlPts[(bestIdx + 1) % ctrlPts.length];
        const mid = prev.clone().add(next).multiplyScalar(0.5);
        // Move 20% toward the midpoint of neighbours (relaxation)
        ctrlPts[bestIdx].lerp(mid, 0.2);
      }
    }

    if (!violated) break;

    // Rebuild spline for next iteration
    spline.points = ctrlPts;
    spline.updateArcLengths();
  }
}

/** Estimate curvature κ at parameter t using finite differences. */
function estimateCurvature(spline: THREE.CatmullRomCurve3, t: number): number {
  const eps = 0.002;
  const t0 = Math.max(0, t - eps);
  const t1 = Math.min(1, t + eps);
  const tan0 = spline.getTangentAt(t0);
  const tan1 = spline.getTangentAt(t1);
  const dTan = tan1.clone().sub(tan0);
  const ds = spline.getLength() * (t1 - t0);
  if (ds < 0.001) return 0;
  return dTan.length() / ds;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// P2-C: CURVATURE-DRIVEN SPEED PROFILE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function computeProfiles(spline: THREE.CatmullRomCurve3): { curvatures: number[]; speedProfile: number[] } {
  const N = SPLINE_SAMPLES;
  const curvatures: number[] = [];
  const speedProfile: number[] = [];
  const maxSpeed = 80;   // max speed units/s
  const maxLatG = 1.2;   // comfortable lateral g  
  const g = 35;          // gravity-ish tuning constant

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const kappa = estimateCurvature(spline, t);
    curvatures.push(kappa);

    // optimal speed = sqrt(maxLatG * g / |κ|)
    const absK = Math.max(Math.abs(kappa), 0.001);
    const optimalSpeed = Math.min(Math.sqrt(maxLatG * g / absK), maxSpeed);
    speedProfile.push(Math.max(optimalSpeed, 12)); // minimum corner speed
  }

  return { curvatures, speedProfile };
}

/** Export speed profile for external use (AI, boost zones). */
export function getSpeedProfileAt(speedProfile: number[], t: number): number {
  const idx = Math.floor(t * (speedProfile.length - 1));
  return speedProfile[Math.min(idx, speedProfile.length - 1)];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// P2-F: TRACK QUALITY SCORER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function scoreTrack(curvatures: number[], totalLength: number, speedProfile: number[]): number {
  let score = 1.0;

  // A. Total length: prefer 400–1200 units
  if (totalLength < 300) score -= 0.3;
  else if (totalLength > 1500) score -= 0.2;

  // B. Curvature variety (stddev)
  const mean = curvatures.reduce((a, b) => a + b, 0) / curvatures.length;
  const variance = curvatures.reduce((a, k) => a + (k - mean) ** 2, 0) / curvatures.length;
  const stddev = Math.sqrt(variance);
  if (stddev < 0.005) score -= 0.3; // too uniform

  // C. Longest straight (speedProfile >= 0.85 * maxSpeed for consecutive samples)
  let maxStraight = 0, currentStraight = 0;
  for (const sp of speedProfile) {
    if (sp >= 60) { currentStraight++; } else { maxStraight = Math.max(maxStraight, currentStraight); currentStraight = 0; }
  }
  maxStraight = Math.max(maxStraight, currentStraight);
  if (maxStraight < 20) score -= 0.2; // no good straight

  // D. Tightest corner must not violate minRadius
  const maxK = Math.max(...curvatures);
  if (maxK > 1 / MIN_RADIUS) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MESH BUILDERS (P2-E: auto-banked corners)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Reusable temps for mesh builders (avoids ~1200 allocations per track gen)
const _meshUp = new THREE.Vector3();
const _meshRight = new THREE.Vector3();
const _meshBankQuat = new THREE.Quaternion();
const _meshBankedRight = new THREE.Vector3();
const _meshBankedUp = new THREE.Vector3();

function buildRoadMesh(spline: THREE.CatmullRomCurve3, curvatures: number[], rng: () => number): THREE.Mesh {
  // getSpacedPoints(N) returns N+1 points; on a closed spline, point[N] == point[0].
  // Drop the duplicate to avoid a degenerate triangle at the closure seam.
  const rawPoints = spline.getSpacedPoints(SPLINE_SAMPLES);
  const points = rawPoints.slice(0, rawPoints.length - 1);
  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const halfW = ROAD_WIDTH / 2;

  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    const tangent = spline.getTangentAt(t).normalize();
    _meshUp.set(0, 1, 0);
    _meshRight.crossVectors(tangent, _meshUp).normalize();

    // ── P2-E: Auto-banking ──
    // Bank the road cross-section proportional to curvature
    const kappa = curvatures[i % curvatures.length] || 0;
    const bankAngle = clamp(kappa * BANK_SCALE, -MAX_BANK_ANGLE, MAX_BANK_ANGLE);

    // Rotate the "up" and "right" vectors about the tangent by bankAngle
    _meshBankQuat.setFromAxisAngle(tangent, -bankAngle);
    _meshBankedRight.copy(_meshRight).applyQuaternion(_meshBankQuat);
    _meshBankedUp.copy(_meshUp).applyQuaternion(_meshBankQuat);

    const p = points[i];

    // Left edge
    vertices.push(
      p.x - _meshBankedRight.x * halfW,
      p.y + 0.01 - _meshBankedRight.y * halfW,
      p.z - _meshBankedRight.z * halfW,
    );
    // Right edge
    vertices.push(
      p.x + _meshBankedRight.x * halfW,
      p.y + 0.01 + _meshBankedRight.y * halfW,
      p.z + _meshBankedRight.z * halfW,
    );

    uvs.push(0, t * 40);
    uvs.push(1, t * 40);

    normals.push(_meshBankedUp.x, _meshBankedUp.y, _meshBankedUp.z, _meshBankedUp.x, _meshBankedUp.y, _meshBankedUp.z);

    if (i < points.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  // Close the loop: connect last pair of vertices to first pair
  const last = (points.length - 1) * 2;
  indices.push(last, last + 1, 0);
  indices.push(last + 1, 1, 0);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);

  const roadTex = createRoadTexture(rng);
  const mat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.3,
    color: 0x555560,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function createRoadTexture(rng: () => number): THREE.CanvasTexture {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // Base asphalt
  ctx.fillStyle = '#3a3a42';
  ctx.fillRect(0, 0, S, S);

  // Asphalt grain noise
  const imgData = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const noise = (rng() - 0.5) * 18;
    imgData.data[i]     += noise;
    imgData.data[i + 1] += noise;
    imgData.data[i + 2] += noise;
  }
  ctx.putImageData(imgData, 0, 0);

  // Faint tire marks (random dark streaks)
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 3;
  for (let t = 0; t < 6; t++) {
    const x = 100 + rng() * 312;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rng() - 0.5) * 20, S);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  // Center dashed yellow line
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 4;
  ctx.setLineDash([30, 25]);
  ctx.beginPath(); ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S); ctx.stroke();
  ctx.setLineDash([]);

  // Edge lines (solid white)
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(14, S); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(S - 14, 0); ctx.lineTo(S - 14, S); ctx.stroke();

  // Shoulder rumble strips near edges
  ctx.fillStyle = 'rgba(80,70,60,0.3)';
  ctx.fillRect(0, 0, 10, S);
  ctx.fillRect(S - 10, 0, 10, S);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1); tex.anisotropy = 8;
  return tex;
}

function buildBarrierMesh(spline: THREE.CatmullRomCurve3, side: number, curvatures: number[]): THREE.Mesh {
  const rawPoints = spline.getSpacedPoints(SPLINE_SAMPLES);
  const points = rawPoints.slice(0, rawPoints.length - 1);
  const vertices: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const baseHalfW = ROAD_WIDTH / 2 + BARRIER_THICKNESS;
  const topHalfW = ROAD_WIDTH / 2 + BARRIER_THICKNESS * 0.6; // slight inward taper

  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    const tangent = spline.getTangentAt(t).normalize();
    _meshUp.set(0, 1, 0);
    _meshRight.crossVectors(tangent, _meshUp).normalize();
    const p = points[i];

    // Apply banking to match road edge elevation
    const kappa = curvatures[i % curvatures.length] || 0;
    const bankAngle = clamp(kappa * BANK_SCALE, -MAX_BANK_ANGLE, MAX_BANK_ANGLE);
    _meshBankQuat.setFromAxisAngle(tangent, -bankAngle);
    _meshBankedRight.copy(_meshRight).applyQuaternion(_meshBankQuat);

    // Road-edge Y offset from banking
    const edgeYOffset = _meshBankedRight.y * (ROAD_WIDTH / 2) * side;

    // Base (wider)
    const bx = p.x + _meshRight.x * baseHalfW * side;
    const bz = p.z + _meshRight.z * baseHalfW * side;
    vertices.push(bx, p.y + edgeYOffset, bz);

    // Top (narrower — taper inward)
    const tx = p.x + _meshRight.x * topHalfW * side;
    const tz = p.z + _meshRight.z * topHalfW * side;
    vertices.push(tx, p.y + edgeYOffset + BARRIER_HEIGHT, tz);

    const nx = -_meshRight.x * side;
    const nz = -_meshRight.z * side;
    normals.push(nx, 0, nz, nx, 0, nz);

    // Alternating red/white bands
    const bandIndex = Math.floor(t * SPLINE_SAMPLES / 4);
    const isRed = bandIndex % 2 === 0;
    if (isRed) {
      colors.push(0.85, 0.15, 0.1, 0.85, 0.15, 0.1);
    } else {
      colors.push(0.95, 0.95, 0.95, 0.95, 0.95, 0.95);
    }

    if (i < points.length - 1) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
    }
  }

  // Close the loop
  const last = (points.length - 1) * 2;
  indices.push(last, 0, last + 1);
  indices.push(last + 1, 0, 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.02,
    envMapIntensity: 0.2,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0x330000),
    emissiveIntensity: 0.2,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SHOULDER STRIPS (gravel between road and barriers)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildShoulders(spline: THREE.CatmullRomCurve3): THREE.Mesh {
  const rawPoints = spline.getSpacedPoints(SPLINE_SAMPLES);
  const points = rawPoints.slice(0, rawPoints.length - 1);
  const vertices: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const innerW = ROAD_WIDTH / 2;
  const outerW = ROAD_WIDTH / 2 + BARRIER_THICKNESS;

  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    const tangent = spline.getTangentAt(t).normalize();
    _meshUp.set(0, 1, 0);
    _meshRight.crossVectors(tangent, _meshUp).normalize();
    const p = points[i];

    // Left shoulder: inner edge → outer edge
    vertices.push(
      p.x - _meshRight.x * outerW, p.y - 0.02, p.z - _meshRight.z * outerW,
    );
    vertices.push(
      p.x - _meshRight.x * innerW, p.y + 0.005, p.z - _meshRight.z * innerW,
    );
    // Right shoulder: inner edge → outer edge
    vertices.push(
      p.x + _meshRight.x * innerW, p.y + 0.005, p.z + _meshRight.z * innerW,
    );
    vertices.push(
      p.x + _meshRight.x * outerW, p.y - 0.02, p.z + _meshRight.z * outerW,
    );

    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);

    if (i < points.length - 1) {
      const base = i * 4;
      // Left shoulder quad
      indices.push(base, base + 4, base + 1);
      indices.push(base + 1, base + 4, base + 5);
      // Right shoulder quad
      indices.push(base + 2, base + 6, base + 3);
      indices.push(base + 3, base + 6, base + 7);
    }
  }

  // Close the loop
  const last = (points.length - 1) * 4;
  indices.push(last, 0, last + 1);
  indices.push(last + 1, 0, 1);
  indices.push(last + 2, 2, last + 3);
  indices.push(last + 3, 2, 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x4a4038,
    roughness: 0.95,
    metalness: 0.0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// KERBS (colored strips at tight corners)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildKerbs(spline: THREE.CatmullRomCurve3, curvatures: number[]): THREE.Group {
  const group = new THREE.Group();
  const kerbWidth = 1.2;
  const kerbThreshold = 0.03; // curvature above which kerbs appear
  const points = spline.getSpacedPoints(SPLINE_SAMPLES);

  // Build separate kerb strip meshes for left and right sides
  for (const side of [-1, 1]) {
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let vertCount = 0;
    let prevWasKerb = false;

    for (let i = 0; i < points.length; i++) {
      const kappa = Math.abs(curvatures[Math.min(i, curvatures.length - 1)] || 0);
      if (kappa < kerbThreshold) {
        prevWasKerb = false;
        continue;
      }

      const t = i / (points.length - 1);
      const tangent = spline.getTangentAt(t).normalize();
      const rx = tangent.z, rz = -tangent.x;
      const p = points[i];
      const edgeOffset = ROAD_WIDTH / 2;

      const ix = p.x + rx * edgeOffset * side;
      const iz = p.z + rz * edgeOffset * side;
      const ox = p.x + rx * (edgeOffset + kerbWidth) * side;
      const oz = p.z + rz * (edgeOffset + kerbWidth) * side;

      vertices.push(ix, p.y + 0.03, iz);
      vertices.push(ox, p.y + 0.06, oz);

      const isRed = Math.floor(t * 60) % 2 === 0;
      const r = isRed ? 0.85 : 0.95;
      const g = isRed ? 0.1 : 0.95;
      const b = isRed ? 0.1 : 0.95;
      colors.push(r, g, b, r, g, b);

      // Only connect to previous pair if it was also a kerb (no gap stretching)
      if (prevWasKerb && vertCount >= 2) {
        const base = vertCount - 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
      vertCount += 2;
      prevWasKerb = true;
    }

    if (vertCount < 4) continue;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
  }

  return group;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SCENERY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Generate scenery using InstancedMesh for performance.
 * Collapses ~212 individual draw calls into ~5 instanced draws.
 * Street lights use emissive-only materials (no PointLights).
 */
function generateScenery(spline: THREE.CatmullRomCurve3, rng: () => number): THREE.Group {
  const group = new THREE.Group();

  // Pre-compute all tree positions
  interface TreeItem { x: number; y: number; z: number; trunkH: number; crownR: number; green: number; }
  const trees: TreeItem[] = [];
  for (let i = 0; i < 80; i++) {
    const t = rng();
    const p = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const rx = tangent.z, rz = -tangent.x;
    const side = rng() > 0.5 ? 1 : -1;
    const offset = ROAD_WIDTH / 2 + 5 + rng() * 30;
    const x = p.x + rx * offset * side;
    const z = p.z + rz * offset * side;
    trees.push({ x, y: p.y, z, trunkH: 2 + rng() * 3, crownR: 1.5 + rng() * 2, green: Math.floor(rng() * 255) });
  }

  const _m = new THREE.Matrix4();
  const _c = new THREE.Color();

  // ── Tree trunks (InstancedMesh) ──
  if (trees.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.3, 3.5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9 });
    const trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    trunkIM.castShadow = true;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      _m.makeScale(1, t.trunkH / 3.5, 1);
      _m.setPosition(t.x, t.y + t.trunkH / 2, t.z);
      trunkIM.setMatrixAt(i, _m);
    }
    trunkIM.instanceMatrix.needsUpdate = true;
    group.add(trunkIM);

    // ── Tree crowns (InstancedMesh with per-instance color) ──
    const crownGeo = new THREE.SphereGeometry(2.0, 8, 6);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2a6d2a, roughness: 0.8 });
    const crownIM = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
    crownIM.castShadow = true;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      _m.makeScale(t.crownR / 2.0, t.crownR / 2.0, t.crownR / 2.0);
      _m.setPosition(t.x, t.y + t.trunkH + t.crownR * 0.6, t.z);
      crownIM.setMatrixAt(i, _m);
      const g = 0x1a + Math.floor((t.green / 255) * 0x40);
      _c.setRGB(g / 255 * 0.4, g / 255, g / 255 * 0.4);
      crownIM.setColorAt(i, _c);
    }
    crownIM.instanceMatrix.needsUpdate = true;
    crownIM.instanceColor!.needsUpdate = true;
    group.add(crownIM);
  }

  // ── Street lights (InstancedMesh — NO PointLights) ──
  const LIGHT_COUNT = 30;

  // Poles
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.6, roughness: 0.3 });
  const poleIM = new THREE.InstancedMesh(poleGeo, poleMat, LIGHT_COUNT);

  // Fixtures (emissive glow — replaces PointLight)
  const fixGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const fixMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffdd66, emissiveIntensity: 1.5, roughness: 0.2 });
  const fixIM = new THREE.InstancedMesh(fixGeo, fixMat, LIGHT_COUNT);

  for (let i = 0; i < LIGHT_COUNT; i++) {
    const t = i / LIGHT_COUNT;
    const p = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const rx = tangent.z, rz = -tangent.x;
    const side = i % 2 === 0 ? 1 : -1;
    const offset = ROAD_WIDTH / 2 + 2;
    const x = p.x + rx * offset * side;
    const z = p.z + rz * offset * side;

    _m.identity();
    _m.setPosition(x, p.y + 3, z);
    poleIM.setMatrixAt(i, _m);

    _m.setPosition(x, p.y + 6, z);
    fixIM.setMatrixAt(i, _m);

    // Add real PointLights to every 10th lamp for visible road illumination pools
    if (i % 10 === 0) {
      const light = new THREE.PointLight(0xffdd88, 1.5, 14, 2);
      light.position.set(x, p.y + 5.8, z);
      group.add(light);
    }
  }
  poleIM.instanceMatrix.needsUpdate = true;
  fixIM.instanceMatrix.needsUpdate = true;
  group.add(poleIM);
  group.add(fixIM);

  // ── Start/Finish line ──
  {
    const t = 0;
    const p = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const right = new THREE.Vector3(tangent.z, 0, -tangent.x);

    // Checkerboard pattern start line
    const lineGeo = new THREE.PlaneGeometry(ROAD_WIDTH, 2);
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const sqW = 16, sqH = 16;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 8; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#111111';
        ctx.fillRect(col * sqW, row * sqH, sqW, sqH);
      }
    }
    const lineTex = new THREE.CanvasTexture(canvas);
    const lineMat = new THREE.MeshStandardMaterial({
      map: lineTex,
      roughness: 0.6,
      transparent: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const lineMesh = new THREE.Mesh(lineGeo, lineMat);
    lineMesh.renderOrder = -1; // Draw before vehicles
    lineMesh.position.copy(p);
    lineMesh.position.y += 0.03; // Just above road surface
    // Rotate plane to lie flat on the road, aligned with the track direction
    lineMesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), tangent)
    );
    lineMesh.rotateX(-Math.PI / 2);
    group.add(lineMesh);
  }

  // ── Tire walls at tight corners (InstancedMesh) ──
  // Find sharp corners and place tire stacks outside them
  const TIRE_STACK_COUNT = 20;
  const tireGeo = new THREE.TorusGeometry(0.35, 0.15, 6, 8);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const tireIM = new THREE.InstancedMesh(tireGeo, tireMat, TIRE_STACK_COUNT * 3);
  let tireIdx = 0;

  // Sample curvature and place at the sharpest corners
  const cornerSpots: { t: number; side: number }[] = [];
  for (let i = 0; i < 200 && cornerSpots.length < TIRE_STACK_COUNT; i++) {
    const t = rng();
    const kappa = estimateCurvature(spline, t);
    if (Math.abs(kappa) > 0.035) {
      const side = kappa > 0 ? 1 : -1; // outside of corner
      cornerSpots.push({ t, side });
    }
  }

  for (const spot of cornerSpots) {
    const p = spline.getPointAt(spot.t);
    const tangent = spline.getTangentAt(spot.t).normalize();
    const rx = tangent.z, rz = -tangent.x;
    const offset = ROAD_WIDTH / 2 + BARRIER_THICKNESS + 1;
    const x = p.x + rx * offset * spot.side;
    const z = p.z + rz * offset * spot.side;

    // Stack 3 tires vertically
    for (let s = 0; s < 3; s++) {
      if (tireIdx >= TIRE_STACK_COUNT * 3) break;
      _m.identity();
      _m.makeRotationX(Math.PI / 2);
      _m.setPosition(x, p.y + 0.15 + s * 0.3, z);
      tireIM.setMatrixAt(tireIdx++, _m);
    }
  }
  if (tireIdx > 0) {
    tireIM.count = tireIdx;
    tireIM.instanceMatrix.needsUpdate = true;
    group.add(tireIM);
  }

  // ── Advertising boards at straight sections ──
  const AD_COUNT = 8;
  const adGeo = new THREE.PlaneGeometry(6, 2);

  for (let i = 0; i < AD_COUNT; i++) {
    const t = (i + 0.5) / AD_COUNT;
    const p = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const rx = tangent.z, rz = -tangent.x;
    const side = i % 2 === 0 ? 1 : -1;
    const offset = ROAD_WIDTH / 2 + BARRIER_THICKNESS + 2;
    const x = p.x + rx * offset * side;
    const z = p.z + rz * offset * side;

    // Create a colored advertising board
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 86;
    const ctx = canvas.getContext('2d')!;
    const hue = Math.floor(rng() * 360);
    ctx.fillStyle = `hsl(${hue}, 70%, 25%)`;
    ctx.fillRect(0, 0, 256, 86);
    ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    const sponsors = ['SPEED', 'TURBO', 'APEX', 'DRIFT', 'NITRO', 'BOOST', 'GRIP', 'RACE'];
    ctx.fillText(sponsors[i % sponsors.length], 128, 55);
    // Border
    ctx.strokeStyle = `hsl(${hue}, 80%, 70%)`;
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 78);

    const adTex = new THREE.CanvasTexture(canvas);
    const adMat = new THREE.MeshStandardMaterial({
      map: adTex,
      emissive: new THREE.Color(`hsl(${hue}, 60%, 20%)`),
      emissiveIntensity: 0.3,
      side: THREE.DoubleSide,
    });

    const board = new THREE.Mesh(adGeo.clone(), adMat);
    board.position.set(x, p.y + 2.5, z);
    board.lookAt(p);
    group.add(board);
  }

  // ── Procedural buildings (InstancedMesh cityscape backdrop) ──
  const BUILDING_COUNT = 25;
  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingTexCanvas = document.createElement('canvas');
  buildingTexCanvas.width = 64; buildingTexCanvas.height = 128;
  {
    const ctx = buildingTexCanvas.getContext('2d')!;
    ctx.fillStyle = '#2a2a35';
    ctx.fillRect(0, 0, 64, 128);
    // Draw window grid
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 4; col++) {
        const lit = rng() > 0.5;
        ctx.fillStyle = lit ? `hsl(${40 + rng() * 20}, ${50 + rng() * 30}%, ${50 + rng() * 30}%)` : '#1a1a22';
        ctx.fillRect(4 + col * 15, 4 + row * 10, 10, 7);
      }
    }
  }
  const buildingTex = new THREE.CanvasTexture(buildingTexCanvas);
  buildingTex.wrapS = THREE.RepeatWrapping;
  buildingTex.wrapT = THREE.RepeatWrapping;
  const buildingMat = new THREE.MeshStandardMaterial({
    map: buildingTex,
    roughness: 0.85,
    metalness: 0.1,
  });
  const buildingIM = new THREE.InstancedMesh(buildingGeo, buildingMat, BUILDING_COUNT);

  for (let i = 0; i < BUILDING_COUNT; i++) {
    const t = rng();
    const p = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const rx = tangent.z, rz = -tangent.x;
    const side = rng() > 0.5 ? 1 : -1;
    let offset = ROAD_WIDTH / 2 + 50 + rng() * 60; // Far from road (57-117 units)
    let x = p.x + rx * offset * side;
    let z = p.z + rz * offset * side;
    const w = 4 + rng() * 8;
    const h = 8 + rng() * 20;
    const d = 4 + rng() * 6;

    // Proximity check: ensure building doesn't land near ANY part of the track
    // Use 100 samples for dense coverage and 35-unit minimum clearance
    const MIN_CLEARANCE = 35;
    const MIN_CLEARANCE_SQ = MIN_CLEARANCE * MIN_CLEARANCE;
    let placed = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      let tooClose = false;
      for (let s = 0; s < 100; s++) {
        const sp = spline.getPointAt(s / 100);
        const dx = x - sp.x;
        const dz = z - sp.z;
        if (dx * dx + dz * dz < MIN_CLEARANCE_SQ) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        placed = true;
        break;
      }
      // Push building further out and retry
      offset += 40;
      x = p.x + rx * offset * side;
      z = p.z + rz * offset * side;
    }

    if (!placed) {
      // Skip this building entirely — don't render it on the track
      _m.makeScale(0, 0, 0);
      _m.setPosition(0, -1000, 0);
      buildingIM.setMatrixAt(i, _m);
      _c.setRGB(0, 0, 0);
      buildingIM.setColorAt(i, _c);
      continue;
    }

    _m.makeScale(w, h, d);
    _m.setPosition(x, p.y + h / 2, z);
    buildingIM.setMatrixAt(i, _m);

    // Vary building color per instance
    const shade = 0.12 + rng() * 0.08;
    _c.setRGB(shade, shade, shade * 1.1);
    buildingIM.setColorAt(i, _c);
  }
  buildingIM.instanceMatrix.needsUpdate = true;
  buildingIM.instanceColor!.needsUpdate = true;
  group.add(buildingIM);

  // ── Grandstand at start/finish ──
  {
    const startP = spline.getPointAt(0);
    const startTan = spline.getTangentAt(0).normalize();
    const right = new THREE.Vector3(startTan.z, 0, -startTan.x);
    const grandstandOffset = ROAD_WIDTH / 2 + 8;

    // Build stepped seating rows
    const grandstandGroup = new THREE.Group();
    const seatGeo = new THREE.BoxGeometry(12, 0.4, 1.5);

    for (let row = 0; row < 5; row++) {
      const seatMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.6 - row * 0.05, 0.5, 0.35 + row * 0.05),
        roughness: 0.7,
      });
      const seat = new THREE.Mesh(seatGeo, seatMat);
      seat.position.set(0, row * 0.8, -row * 1.6);
      grandstandGroup.add(seat);
    }

    // Support structure
    const supportGeo = new THREE.BoxGeometry(12, 4, 8);
    const supportMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
    const support = new THREE.Mesh(supportGeo, supportMat);
    support.position.set(0, -1.5, -4);
    grandstandGroup.add(support);

    // Position and orient the grandstand
    grandstandGroup.position.set(
      startP.x + right.x * grandstandOffset,
      startP.y,
      startP.z + right.z * grandstandOffset,
    );
    grandstandGroup.lookAt(startP);
    group.add(grandstandGroup);
  }

  // ── Road direction arrows (InstancedMesh decals on straight sections) ──
  const ARROW_COUNT = 12;
  const arrowCanvas = document.createElement('canvas');
  arrowCanvas.width = 64; arrowCanvas.height = 128;
  {
    const ctx = arrowCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 128);
    // Draw arrow shape
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.moveTo(32, 10);   // Arrow tip
    ctx.lineTo(52, 50);
    ctx.lineTo(38, 40);
    ctx.lineTo(38, 118);
    ctx.lineTo(26, 118);
    ctx.lineTo(26, 40);
    ctx.lineTo(12, 50);
    ctx.closePath();
    ctx.fill();
  }
  const arrowTex = new THREE.CanvasTexture(arrowCanvas);
  const arrowGeo = new THREE.PlaneGeometry(2, 4);
  const arrowMat = new THREE.MeshStandardMaterial({
    map: arrowTex,
    transparent: true,
    depthWrite: false,
    roughness: 0.8,
  });

  for (let i = 0; i < ARROW_COUNT; i++) {
    const t = (i + 0.5) / ARROW_COUNT;
    const kappa = estimateCurvature(spline, t);
    // Only place arrows on relatively straight sections
    if (Math.abs(kappa) < 0.02) {
      const p = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.copy(p);
      arrow.position.y += 0.04; // Just above road
      // Orient arrow to lie flat on road, pointing along track direction
      const rightVec = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      arrow.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(rightVec, new THREE.Vector3(0, 1, 0), tangent)
      );
      arrow.rotateX(-Math.PI / 2);
      group.add(arrow);
    }
  }

  return group;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Find the closest point on the spline to `pos`.
 * When a SplineBVH is provided, uses O(log N) branch-and-bound traversal.
 * Falls back to brute-force O(N) linear scan otherwise.
 */
export function getClosestSplinePoint(
  spline: THREE.CatmullRomCurve3,
  pos: THREE.Vector3,
  samplesOrBvh: number | SplineBVH = 100,
): { t: number; point: THREE.Vector3; distance: number } {
  // ── BVH fast path ──
  if (typeof samplesOrBvh !== 'number') {
    return samplesOrBvh.nearestPoint(pos);
  }

  // ── Brute-force fallback ──
  const samples = samplesOrBvh;
  let bestT = 0;
  let bestDist = Infinity;
  let bestPoint = new THREE.Vector3();

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = spline.getPointAt(t);
    const d = pos.distanceToSquared(p);
    if (d < bestDist) { bestDist = d; bestT = t; bestPoint = p; }
  }

  return { t: bestT, point: bestPoint, distance: Math.sqrt(bestDist) };
}

export function buildCheckpointMarkers(checkpoints: Checkpoint[]): THREE.Group {
  const group = new THREE.Group();

  checkpoints.forEach((cp, i) => {
    const arch = createCheckpointArch(i === 0);
    arch.position.copy(cp.position);
    arch.position.y += 0.1;
    arch.lookAt(cp.position.clone().add(cp.tangent));
    group.add(arch);
  });

  return group;
}

function createCheckpointArch(isStart: boolean): THREE.Group {
  const arch = new THREE.Group();
  const height = isStart ? 7 : 5;
  const width = ROAD_WIDTH;
  const color = isStart ? 0xffcc00 : 0xff6600;

  const pillarGeo = new THREE.BoxGeometry(isStart ? 0.5 : 0.3, height, isStart ? 0.5 : 0.3);
  const pillarMat = new THREE.MeshStandardMaterial({
    color, transparent: true, opacity: isStart ? 0.85 : 0.6,
    emissive: new THREE.Color(color), emissiveIntensity: isStart ? 0.5 : 0.3,
  });
  const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
  leftPillar.position.set(-width / 2, height / 2, 0);
  arch.add(leftPillar);

  const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
  rightPillar.position.set(width / 2, height / 2, 0);
  arch.add(rightPillar);

  const beamGeo = new THREE.BoxGeometry(width + 0.5, isStart ? 0.5 : 0.3, isStart ? 0.5 : 0.3);
  const beam = new THREE.Mesh(beamGeo, pillarMat);
  beam.position.set(0, height, 0);
  arch.add(beam);


  if (isStart) {
    // Overhead floodlights on the gantry beam
    const lightPositions = [-width * 0.35, -width * 0.12, width * 0.12, width * 0.35];
    for (const lx of lightPositions) {
      const light = new THREE.PointLight(0xffeecc, 3, 25, 1.5);
      light.position.set(lx, height - 0.3, 0);
      arch.add(light);
      // Small light housing mesh
      const housGeo = new THREE.BoxGeometry(0.3, 0.2, 0.3);
      const housMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: new THREE.Color(0xffeecc), emissiveIntensity: 1.0 });
      const housing = new THREE.Mesh(housGeo, housMat);
      housing.position.set(lx, height - 0.15, 0);
      arch.add(housing);
    }
  }

  return arch;
}

/**
 * Highlight the next checkpoint and dim passed ones.
 * Call every frame with the group from `buildCheckpointMarkers()`.
 */
export function updateCheckpointHighlight(
  markerGroup: THREE.Group,
  nextCpIndex: number,
  time: number,
) {
  const cpCount = markerGroup.children.length;
  for (let i = 0; i < cpCount; i++) {
    const arch = markerGroup.children[i] as THREE.Group;
    const isNext = i === nextCpIndex;
    const isPassed = i < nextCpIndex || (nextCpIndex === 0 && i > 0);

    // Pulse scale for the next checkpoint
    if (isNext) {
      const pulse = 1.0 + Math.sin(time * 4) * 0.08;
      arch.scale.setScalar(pulse);
    } else {
      // Lerp scale back to 1 (in case it was just crossed)
      arch.scale.lerp(_scaleOne, 0.1);
    }

    // Set opacity: next = bright, passed = dim, future = medium
    arch.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat.transparent !== undefined) {
          if (isNext) {
            mat.opacity = 0.85 + Math.sin(time * 6) * 0.15;
            mat.emissiveIntensity = 0.5 + Math.sin(time * 4) * 0.3;
          } else if (isPassed) {
            mat.opacity = Math.max(mat.opacity - 0.02, 0.15);
            mat.emissiveIntensity = 0.1;
          } else {
            mat.opacity = 0.4;
            mat.emissiveIntensity = 0.2;
          }
        }
      }
    });
  }
}

const _scaleOne = new THREE.Vector3(1, 1, 1);
