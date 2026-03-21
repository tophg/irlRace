/* ── IRL Race — Procedural Track Generator (v2 — Convex Hull + Elevation) ── */

import * as THREE from 'three/webgpu';
import { Checkpoint, TrackData, RampDef } from './types';
import { SplineBVH } from './bvh';
import { buildRampGroup, placeRampsOnStraights } from './ramps';

export const ROAD_WIDTH = 14;
const BARRIER_HEIGHT = 1.8;
export const BARRIER_THICKNESS = 0.4;
const SPLINE_SAMPLES = (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) ? 200 : 400;
const MIN_RADIUS = 18;      // tightest allowed corner
export const MAX_BANK_ANGLE = 0.35; // ~20° banking
export const BANK_SCALE = 8;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Generate a closed circuit deterministically from seed.
 * Tries multiple seed offsets and picks the highest quality track. */
export function generateTrack(seed?: number): TrackData {
  const baseSeed = seed ?? (Date.now() % 100000);
  const ATTEMPTS = 4;
  let best = buildTrackAttempt(baseSeed);
  for (let i = 1; i < ATTEMPTS; i++) {
    const alt = buildTrackAttempt(baseSeed + i * 7919); // coprime offset
    if (alt.qualityScore > best.qualityScore) best = alt;
  }
  return best.data;
}

/** Build a track from user-placed 2D control points (Track Editor → TrackData pipeline). */
export function buildTrackFromControlPoints(
  points: { x: number; z: number }[],
  elevations?: number[],
  ramps?: RampDef[],
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
    // Clamp elevation: road must stay above ground plane (Y=-0.5)
    for (const p of controlPoints3D) p.y = Math.max(p.y, 0);
    // Flatten start/finish zone so checkerboard line sits flush on road
    flattenStartZone(controlPoints3D);
  }

  // Build spline & enforce constraints
  const spline = new THREE.CatmullRomCurve3(controlPoints3D, true, 'centripetal', 0.5);
  enforceMinRadius(spline, controlPoints3D, MIN_RADIUS);
  const finalSpline = new THREE.CatmullRomCurve3(controlPoints3D, true, 'centripetal', 0.5);
  const totalLength = finalSpline.getLength();

  const { curvatures, speedProfile } = computeProfiles(finalSpline);

  // Build meshes (reuse all existing builders)
  const roadMesh = buildRoadMesh(finalSpline, curvatures, rng);
  const theme = getCurrentTheme();
  const barrierStyle = theme.barrierStyle || 'concrete_clean';
  const barrierLeft = buildBarrierMesh(finalSpline, -1, curvatures, barrierStyle, theme.barrierColor);
  const barrierRight = buildBarrierMesh(finalSpline, 1, curvatures, barrierStyle, theme.barrierColor);
  const shoulderMesh = buildShoulders(finalSpline, curvatures);
  const kerbGroup = buildKerbs(finalSpline, curvatures);

  // Checkpoints — scale count by track length (1 per ~100 world units, min 4, max 12)
  const numCheckpoints = Math.max(4, Math.min(12, Math.round(totalLength / 100)));
  const checkpoints: Checkpoint[] = [];
  for (let i = 0; i < numCheckpoints; i++) {
    const t = i / numCheckpoints;
    const position = finalSpline.getPointAt(t);
    const tangent = finalSpline.getTangentAt(t).normalize();
    checkpoints.push({ position, tangent, index: i, t });
  }

  // Bake distance field BEFORE scenery so getTerrainHeight() has DFT data
  // for accurate building Y placement (DFT damping + transition dip)
  const distanceField = bakeDistanceField(finalSpline);
  updateGroundDistanceField(distanceField);

  const sceneryGroup = generateScenery(finalSpline, rng, getCurrentTheme(), roadMesh);
  const bvh = new SplineBVH(finalSpline, 800);

  // Build ramps from user definitions (or empty if none provided)
  const rampDefs: RampDef[] = ramps ?? [];
  const rampGroup = buildRampGroup(finalSpline, rampDefs);

  return { spline: finalSpline, roadMesh, barrierLeft, barrierRight, shoulderMesh, kerbGroup, checkpoints, sceneryGroup, totalLength, bvh, speedProfile, curvatures, rampGroup, rampDefs, distanceField };
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
  const theme = getCurrentTheme();
  const barrierStyle = theme.barrierStyle || 'concrete_clean';
  const barrierLeft = buildBarrierMesh(finalSpline, -1, curvatures, barrierStyle, theme.barrierColor);
  const barrierRight = buildBarrierMesh(finalSpline, 1, curvatures, barrierStyle, theme.barrierColor);
  const shoulderMesh = buildShoulders(finalSpline, curvatures);
  const kerbGroup = buildKerbs(finalSpline, curvatures);

  // ── 8. Place checkpoints (distributed from t > 0 to t=1.0 for precise lap completion) ──
  const numCheckpoints = 10;
  const checkpoints: Checkpoint[] = [];
  for (let i = 0; i < numCheckpoints; i++) {
    const t = i / numCheckpoints;
    const position = finalSpline.getPointAt(t);
    const tangent = finalSpline.getTangentAt(t).normalize();
    checkpoints.push({ position, tangent, index: i, t });
  }

  // ── 9. Bake DFT BEFORE scenery so getTerrainHeight() has damping data ──
  const distanceField = bakeDistanceField(finalSpline);
  updateGroundDistanceField(distanceField);

  // ── 10. Scenery ──
  const sceneryGroup = generateScenery(finalSpline, rng, getCurrentTheme(), roadMesh);

  // ── 11. Build BVH for O(log N) nearest-point queries ──
  const bvh = new SplineBVH(finalSpline, 800);

  // ── 7b. Place ramps on long straights ──
  const rampDefs = placeRampsOnStraights(curvatures, speedProfile, totalLength, rng);
  const rampGroup = buildRampGroup(finalSpline, rampDefs);

  // ── 12. Quality score ──
  const qualityScore = scoreTrack(curvatures, totalLength, speedProfile);

  const data: TrackData = { spline: finalSpline, roadMesh, barrierLeft, barrierRight, shoulderMesh, kerbGroup, checkpoints, sceneryGroup, totalLength, bvh, speedProfile, curvatures, rampGroup, rampDefs, distanceField };
  return { data, qualityScore };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// P2-A: CONVEX HULL SEED GENERATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Generate N random 2D seed points → convex hull → winding-order vertices.
 * Uses elliptical scatter to break circular symmetry. */
function generateHullPoints(rng: () => number): THREE.Vector2[] {
  const N = 8 + Math.floor(rng() * 5); // 8–12 seed points
  // Random elliptical bias (2:1 aspect ratio) at a random angle
  // prevents all-equidistant points that produce near-circles
  const angle = rng() * Math.PI;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const scaleX = 1.0 + rng() * 1.5; // 1.0–2.5× stretch
  const scaleY = 1.0;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < N; i++) {
    let x = (rng() - 0.5) * 300;
    let z = (rng() - 0.5) * 300;
    // Apply rotated elliptical stretch
    const rx = x * cos - z * sin;
    const rz = x * sin + z * cos;
    pts.push(new THREE.Vector2(rx * scaleX, rz * scaleY));
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

/** Insert dent points to create chicanes. Guarantees at least 3 chicanes
 * to prevent circular/oval tracks with no braking zones.
 * Includes post-insertion self-intersection filter. */
function addChicanes(hull: THREE.Vector2[], rng: () => number): THREE.Vector2[] {
  const result: THREE.Vector2[] = [];
  const centroid = hull.reduce((acc, p) => acc.add(p.clone()), new THREE.Vector2()).divideScalar(hull.length);

  // Compute edge lengths and sort to find the longest ones
  const edges: { idx: number; len: number }[] = [];
  for (let i = 0; i < hull.length; i++) {
    const next = hull[(i + 1) % hull.length];
    edges.push({ idx: i, len: hull[i].distanceTo(next) });
  }
  // Mark the 3 longest edges as forced (always get chicanes)
  const sorted = [...edges].sort((a, b) => b.len - a.len);
  const forcedEdges = new Set(sorted.slice(0, 3).map(e => e.idx));

  for (let i = 0; i < hull.length; i++) {
    result.push(hull[i].clone());

    const next = hull[(i + 1) % hull.length];
    const edgeLen = hull[i].distanceTo(next);
    const isForced = forcedEdges.has(i);

    // Lower threshold (35 units) + forced edges always get chicanes
    if ((edgeLen > 35 && rng() > 0.3) || isForced) {
      const numDents = 1 + Math.floor(rng() * 2); // 1–2 dents
      for (let d = 0; d < numDents; d++) {
        const t = 0.25 + rng() * 0.5; // midrange on the edge
        const mid = hull[i].clone().lerp(next, t);

        // Dent inward toward the centroid
        const inward = centroid.clone().sub(mid).normalize();
        const dentDepth = 15 + rng() * 40;
        mid.add(inward.multiplyScalar(dentDepth));

        result.push(mid);
      }
    }
  }

  // Post-insertion self-intersection filter:
  // Check each segment against non-adjacent segments; if crossing, remove the dent.
  return removeIntersections(result);
}

/** Remove control points that cause self-intersecting polygon edges. */
function removeIntersections(pts: THREE.Vector2[]): THREE.Vector2[] {
  const n = pts.length;
  if (n < 4) return pts;
  const bad = new Set<number>();

  for (let i = 0; i < n; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    // Check against non-adjacent segments (skip i-1, i, i+1)
    for (let j = i + 2; j < n; j++) {
      if (j === (i + n - 1) % n) continue; // skip wrap-adjacent
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        // Mark the later-inserted point (higher index, likely a dent)
        bad.add(j);
      }
    }
  }
  if (bad.size === 0) return pts;
  return pts.filter((_, i) => !bad.has(i));
}

/** 2D segment-segment intersection test. */
function segmentsIntersect(a1: THREE.Vector2, a2: THREE.Vector2, b1: THREE.Vector2, b2: THREE.Vector2): boolean {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-8) return false; // parallel
  const dx = b1.x - a1.x, dy = b1.y - a1.y;
  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;
  return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99; // strict interior
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

  // Clamp elevation: road must stay above ground plane (Y=-0.5)
  for (const p of pts3D) p.y = Math.max(p.y, 0);
  // Flatten start/finish zone so checkerboard line sits flush on road
  flattenStartZone(pts3D);

  return pts3D;
}

/** Force the start/finish zone to Y=0 for flat grid + proper checkerboard rendering. */
function flattenStartZone(pts: THREE.Vector3[]) {
  const n = pts.length;
  if (n < 12) return;
  // Force first 4 and last 4 control points to Y=0 (they neighbor the start on a closed spline)
  const flatCount = 4;
  const blendCount = 4; // additional points that blend from 0 to their original elevation
  for (let i = 0; i < flatCount; i++) {
    pts[i].y = 0;
    pts[n - 1 - i].y = 0;
  }
  // Smooth blend from flat zone to natural elevation
  for (let i = 0; i < blendCount; i++) {
    const t = (i + 1) / (blendCount + 1);
    const fwdIdx = flatCount + i;
    const bwdIdx = n - 1 - flatCount - i;
    if (fwdIdx < n && fwdIdx < bwdIdx) pts[fwdIdx].y *= t;
    if (bwdIdx >= 0 && bwdIdx > fwdIdx) pts[bwdIdx].y *= t;
  }
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
export function estimateCurvature(spline: THREE.CatmullRomCurve3, t: number): number {
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

  // A. Total length: hard reject very short tracks, prefer 400–1200 units
  if (totalLength < 250) return 0; // hard reject
  if (totalLength < 400) score -= 0.3;
  else if (totalLength > 1500) score -= 0.15;

  // B. Curvature variety (stddev) — penalize uniform tracks
  const mean = curvatures.reduce((a, b) => a + b, 0) / curvatures.length;
  const variance = curvatures.reduce((a, k) => a + (k - mean) ** 2, 0) / curvatures.length;
  const stddev = Math.sqrt(variance);
  if (stddev < 0.005) score -= 0.35; // too uniform (oval/circle)
  else if (stddev < 0.01) score -= 0.15; // borderline monotonous

  // C. Longest straight — every good circuit needs a DRS/slipstream zone
  let maxStraight = 0, currentStraight = 0;
  for (const sp of speedProfile) {
    if (sp >= 60) { currentStraight++; } else { maxStraight = Math.max(maxStraight, currentStraight); currentStraight = 0; }
  }
  maxStraight = Math.max(maxStraight, currentStraight);
  if (maxStraight < 15) score -= 0.35; // no usable straight at all
  else if (maxStraight < 25) score -= 0.15; // short straights only

  // D. Boredom score — penalize long arcs of constant curvature
  let boredomRuns = 0;
  let runLen = 0;
  for (let i = 1; i < curvatures.length; i++) {
    if (Math.abs(curvatures[i] - curvatures[i - 1]) < 0.002) {
      runLen++;
    } else {
      if (runLen > 40) boredomRuns++; // 40+ samples of same curvature = boring arc
      runLen = 0;
    }
  }
  if (runLen > 40) boredomRuns++;
  score -= boredomRuns * 0.1;

  // E. Tightest corner must not violate minRadius
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
    // Fade banking to zero in start/finish zone so the starting line is flat
    const startFade = Math.min(i / 12, (points.length - 1 - i) / 12, 1);
    const bankAngle = clamp(kappa * BANK_SCALE * startFade, -MAX_BANK_ANGLE, MAX_BANK_ANGLE);

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

  // Audit fix #7: blend normals at loop closure seam to avoid hard lighting edge
  {
    const nArr = geo.getAttribute('normal').array as Float32Array;
    const last = (points.length - 1) * 2;
    for (let v = 0; v < 2; v++) {
      const fi = v * 3;          // first vertex normal offset
      const li = (last + v) * 3; // last vertex normal offset
      const ax = (nArr[fi]     + nArr[li])     * 0.5;
      const ay = (nArr[fi + 1] + nArr[li + 1]) * 0.5;
      const az = (nArr[fi + 2] + nArr[li + 2]) * 0.5;
      const len = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      nArr[fi]     = nArr[li]     = ax / len;
      nArr[fi + 1] = nArr[li + 1] = ay / len;
      nArr[fi + 2] = nArr[li + 2] = az / len;
    }
  }

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
  ctx.strokeStyle = COLORS.YELLOW;
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

// ── Barrier texture cache ──
const _barrierMaterialCache = new Map<string, THREE.MeshStandardMaterial>();

function getBarrierMaterial(style: string, barrierColor: number): THREE.MeshStandardMaterial {
  const key = `${style}_${barrierColor.toString(16)}`;
  const cached = _barrierMaterialCache.get(key);
  if (cached) return cached;

  const isMetal = style.startsWith('metal');
  const mat = new THREE.MeshStandardMaterial({
    roughness: isMetal ? 0.5 : 0.9,
    metalness: isMetal ? 0.6 : 0.0,
    envMapIntensity: isMetal ? 0.5 : 0.2,
    side: THREE.DoubleSide,
    color: barrierColor,
  });

  // Load texture asynchronously; material renders with barrierColor until ready
  const loader = new THREE.TextureLoader();
  loader.load(`/barriers/barrier_${style}.png`, (tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    mat.map = tex;
    mat.needsUpdate = true;
  });

  _barrierMaterialCache.set(key, mat);
  return mat;
}

function buildBarrierMesh(
  spline: THREE.CatmullRomCurve3,
  side: number,
  curvatures: number[],
  barrierStyle: string,
  barrierColor: number,
): THREE.Mesh {
  const rawPoints = spline.getSpacedPoints(SPLINE_SAMPLES);
  const points = rawPoints.slice(0, rawPoints.length - 1);
  const vertices: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const baseHalfW = ROAD_WIDTH / 2 + BARRIER_THICKNESS;
  const topHalfW = ROAD_WIDTH / 2 + BARRIER_THICKNESS * 0.6; // slight inward taper
  const totalLength = spline.getLength();
  const tileRepeatLength = 8; // world units per texture repeat

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

    // UV: U = 0 at base, 1 at top; V = arc-length tiling
    const v = t * totalLength / tileRepeatLength;
    uvs.push(0, v);  // base vertex
    uvs.push(1, v);  // top vertex

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
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);

  const mat = getBarrierMaterial(barrierStyle, barrierColor);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SHOULDER STRIPS (gravel between road and barriers)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildShoulders(spline: THREE.CatmullRomCurve3, curvatures: number[]): THREE.Mesh {
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

    // Apply banking to shoulders to match road (prevents gaps at banked sections)
    const kappa = curvatures[i % curvatures.length] || 0;
    const startFade = Math.min(i / 12, (points.length - 1 - i) / 12, 1);
    const bankAngle = clamp(kappa * BANK_SCALE * startFade, -MAX_BANK_ANGLE, MAX_BANK_ANGLE);
    _meshBankQuat.setFromAxisAngle(tangent, -bankAngle);
    _meshBankedRight.copy(_meshRight).applyQuaternion(_meshBankQuat);

    // Left shoulder: inner edge → outer edge (banked to match road)
    vertices.push(
      p.x - _meshBankedRight.x * outerW, p.y - 0.02 - _meshBankedRight.y * outerW, p.z - _meshBankedRight.z * outerW,
    );
    vertices.push(
      p.x - _meshBankedRight.x * innerW, p.y + 0.005 - _meshBankedRight.y * innerW, p.z - _meshBankedRight.z * innerW,
    );
    // Right shoulder: inner edge → outer edge (banked to match road)
    vertices.push(
      p.x + _meshBankedRight.x * innerW, p.y + 0.005 + _meshBankedRight.y * innerW, p.z + _meshBankedRight.z * innerW,
    );
    vertices.push(
      p.x + _meshBankedRight.x * outerW, p.y - 0.02 + _meshBankedRight.y * outerW, p.z + _meshBankedRight.z * outerW,
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
// SCENERY — extracted to track-scenery.ts
import { generateScenery, updateSceneryWind } from './track-scenery';
import { getCurrentTheme, updateGroundDistanceField } from './scene';
import { COLORS } from './colors';
export { generateScenery, updateSceneryWind };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function seededRandom(seed: number): () => number {
  let s = (seed | 0) || 1; // avoid seed 0 collapse — ensure non-zero initial state
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISTANCE FIELD BAKING (ground zone blending)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Bake a 256×256 distance-from-spline texture for ground zone blending.
 *  Each texel stores min distance to any spline sample point,
 *  encoded as 0 (on track) → 255 (≥100m away). */
function bakeDistanceField(spline: THREE.CatmullRomCurve3): THREE.DataTexture {
  const size = 256;
  const worldSize = 1200;  // matches ground PlaneGeometry
  const data = new Uint8Array(size * size);
  const splinePoints = spline.getSpacedPoints(500);

  for (let y = 0; y < size; y++) {
    const wz = (y / size - 0.5) * worldSize;
    for (let x = 0; x < size; x++) {
      const wx = (x / size - 0.5) * worldSize;
      let minDistSq = Infinity;
      for (const sp of splinePoints) {
        const dx = wx - sp.x, dz = wz - sp.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < minDistSq) minDistSq = d2;
      }
      // Encode: 0 = on track, 255 = 100m+ away
      data[y * size + x] = Math.min(255, Math.floor(Math.sqrt(minDistSq) * 2.55));
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
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
