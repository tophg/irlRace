/* ── Hood Racer — BVH (Bounding Volume Hierarchy) ──
 *
 * Two structures:
 *
 * 1. SplineBVH — Static BVH built from densely-sampled spline segments.
 *    Provides O(log N) nearest-point queries replacing the brute-force
 *    O(N) loop in getClosestSplinePoint.
 *
 * 2. AABB helpers for car-to-car collision broadphase + push-apart.
 */

import * as THREE from 'three/webgpu';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AABB — Axis-Aligned Bounding Box
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface AABB {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export function aabbFromPoints(a: THREE.Vector3, b: THREE.Vector3, padding = 0): AABB {
  return {
    minX: Math.min(a.x, b.x) - padding,
    minY: Math.min(a.y, b.y) - padding,
    minZ: Math.min(a.z, b.z) - padding,
    maxX: Math.max(a.x, b.x) + padding,
    maxY: Math.max(a.y, b.y) + padding,
    maxZ: Math.max(a.z, b.z) + padding,
  };
}

export function aabbUnion(a: AABB, b: AABB): AABB {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

export function aabbOverlaps(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX
      && a.minY <= b.maxY && a.maxY >= b.minY
      && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

/** Squared distance from a point to the closest point on / in the AABB. */
export function aabbDistSq(box: AABB, px: number, py: number, pz: number): number {
  let dSq = 0;
  if (px < box.minX) dSq += (px - box.minX) ** 2;
  else if (px > box.maxX) dSq += (px - box.maxX) ** 2;
  if (py < box.minY) dSq += (py - box.minY) ** 2;
  else if (py > box.maxY) dSq += (py - box.maxY) ** 2;
  if (pz < box.minZ) dSq += (pz - box.minZ) ** 2;
  else if (pz > box.maxZ) dSq += (pz - box.maxZ) ** 2;
  return dSq;
}

function aabbLongestAxis(box: AABB): number {
  const dx = box.maxX - box.minX;
  const dy = box.maxY - box.minY;
  const dz = box.maxZ - box.minZ;
  if (dx >= dy && dx >= dz) return 0; // X
  if (dy >= dz) return 1; // Y
  return 2; // Z
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SPLINE SEGMENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** A segment of the spline between two consecutive sample points. */
interface SplineSegment {
  /** Start point of the segment */
  a: THREE.Vector3;
  /** End point of the segment */
  b: THREE.Vector3;
  /** Parameter t at start point (0–1 along the full spline) */
  tStart: number;
  /** Parameter t at end point */
  tEnd: number;
  /** Pre-computed centroid X (for sorting during construction) */
  cx: number;
  /** Pre-computed centroid Y */
  cy: number;
  /** Pre-computed centroid Z */
  cz: number;
  /** AABB of this segment (with small padding) */
  bounds: AABB;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BVH NODE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface BVHNode {
  bounds: AABB;
  /** If leaf: exactly one segment. If internal: null. */
  segment: SplineSegment | null;
  left: BVHNode | null;
  right: BVHNode | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SPLINE BVH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface NearestResult {
  t: number;               // spline parameter [0,1]
  point: THREE.Vector3;    // closest point on the spline
  distance: number;        // world-space distance
}

const MAX_LEAF_SIZE = 4;   // segments per leaf

/**
 * Static BVH built from evenly-sampled spline points.
 *
 * Construction: O(N log N) — Top-down median-split on longest AABB axis.
 * Query:        O(log N)   — Branch-and-bound nearest-point search.
 *
 * Rebuild once per track generation (~0.5 ms for 800 segments).
 */
export class SplineBVH {
  private root: BVHNode;
  private spline: THREE.CatmullRomCurve3;
  readonly segmentCount: number;

  constructor(spline: THREE.CatmullRomCurve3, samples = 800) {
    this.spline = spline;
    const segments = this.sampleSpline(spline, samples);
    this.segmentCount = segments.length;
    this.root = this.buildNode(segments, 0, segments.length);
  }

  // ── Sample spline into line segments ──────────────────────────
  private sampleSpline(spline: THREE.CatmullRomCurve3, N: number): SplineSegment[] {
    const pts: THREE.Vector3[] = [];
    const ts: number[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push(spline.getPointAt(t));
      ts.push(t);
    }

    const segments: SplineSegment[] = [];
    for (let i = 0; i < N; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const bounds = aabbFromPoints(a, b, 0.1);
      segments.push({
        a, b,
        tStart: ts[i],
        tEnd: ts[i + 1],
        cx: (a.x + b.x) * 0.5,
        cy: (a.y + b.y) * 0.5,
        cz: (a.z + b.z) * 0.5,
        bounds,
      });
    }
    return segments;
  }

  // ── Top-down recursive BVH construction ───────────────────────
  private buildNode(segs: SplineSegment[], start: number, end: number): BVHNode {
    // Compute overall bounds
    let bounds = segs[start].bounds;
    for (let i = start + 1; i < end; i++) {
      bounds = aabbUnion(bounds, segs[i].bounds);
    }

    const count = end - start;

    // Leaf node
    if (count <= MAX_LEAF_SIZE) {
      // For small leaves, store as a single node with segments in left/right children (or null)
      // But the simplest correct approach: if count == 1, it's a pure leaf
      if (count === 1) {
        return { bounds, segment: segs[start], left: null, right: null };
      }

      // Small multi-segment leaf — split in half
      const mid = (start + end) >> 1;
      const axis = aabbLongestAxis(bounds);
      this.partialSort(segs, start, end, mid, axis);
      return {
        bounds,
        segment: null,
        left: this.buildNode(segs, start, mid),
        right: this.buildNode(segs, mid, end),
      };
    }

    // Internal node — split at median along longest axis
    const axis = aabbLongestAxis(bounds);
    const mid = (start + end) >> 1;
    this.partialSort(segs, start, end, mid, axis);

    return {
      bounds,
      segment: null,
      left: this.buildNode(segs, start, mid),
      right: this.buildNode(segs, mid, end),
    };
  }

  /**
   * Nth-element partial sort: reorder segs[start..end) so that
   * segs[mid] is the median along the given axis, with smaller
   * elements to the left and larger to the right. O(N) average.
   */
  private partialSort(segs: SplineSegment[], start: number, end: number, mid: number, axis: number) {
    // Simple intro-sort-like partition (quickselect)
    while (start < end - 1) {
      const pivotIdx = start + ((end - start) >> 1);
      const pivotVal = this.getAxisValue(segs[pivotIdx], axis);

      // Move pivot to end
      this.swap(segs, pivotIdx, end - 1);
      let store = start;
      for (let i = start; i < end - 1; i++) {
        if (this.getAxisValue(segs[i], axis) < pivotVal) {
          this.swap(segs, i, store);
          store++;
        }
      }
      this.swap(segs, store, end - 1);

      if (store === mid) return;
      if (store < mid) start = store + 1;
      else end = store;
    }
  }

  private getAxisValue(seg: SplineSegment, axis: number): number {
    return axis === 0 ? seg.cx : axis === 1 ? seg.cy : seg.cz;
  }

  private swap(segs: SplineSegment[], i: number, j: number) {
    const tmp = segs[i]; segs[i] = segs[j]; segs[j] = tmp;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NEAREST POINT QUERY (branch-and-bound)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Find the closest point on the spline to `pos`.
   * Returns { t, point, distance } matching the old API.
   */
  nearestPoint(pos: THREE.Vector3): NearestResult {
    let bestDistSq = Infinity;
    let bestT = 0;

    this.searchNearest(this.root, pos.x, pos.y, pos.z, (seg) => {
      // Closest point on line segment a→b to pos (for finding correct t)
      const result = closestPointOnSegment(pos, seg.a, seg.b);

      if (result.distSq < bestDistSq) {
        bestDistSq = result.distSq;
        // Interpolate t between tStart and tEnd based on projection fraction
        bestT = seg.tStart + result.fraction * (seg.tEnd - seg.tStart);
      }

      return bestDistSq;
    });

    // Use the TRUE spline point at bestT (not the segment chord)
    // This prevents cars from sinking below the road on curved/banked sections
    const truePoint = this.spline.getPointAt(bestT);
    const trueDist = pos.distanceTo(truePoint);

    return {
      t: bestT,
      point: truePoint,
      distance: trueDist,
    };
  }

  /**
   * Recursive branch-and-bound traversal.
   * `callback` is called for each leaf segment; it should return the
   * current best-known squared distance for pruning.
   */
  private searchNearest(
    node: BVHNode,
    px: number, py: number, pz: number,
    callback: (seg: SplineSegment) => number,
  ): number {
    // Leaf node — test the segment
    if (node.segment) {
      return callback(node.segment);
    }

    if (!node.left || !node.right) return Infinity;

    // Compute min distance from point to each child's AABB
    const dLeft = aabbDistSq(node.left.bounds, px, py, pz);
    const dRight = aabbDistSq(node.right.bounds, px, py, pz);

    // Visit nearer child first (branch-and-bound heuristic)
    let best: number;
    if (dLeft <= dRight) {
      best = this.searchNearest(node.left, px, py, pz, callback);
      // Only visit right child if its AABB is closer than current best
      if (dRight < best) {
        best = this.searchNearest(node.right, px, py, pz, callback);
      }
    } else {
      best = this.searchNearest(node.right, px, py, pz, callback);
      if (dLeft < best) {
        best = this.searchNearest(node.left, px, py, pz, callback);
      }
    }

    return best;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLOSEST POINT ON LINE SEGMENT (utility)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Reusable temp vectors for segment queries (avoids GC allocations per query)
const _seg_ab = new THREE.Vector3();
const _seg_ap = new THREE.Vector3();

interface SegmentQueryResult {
  distSq: number;
  /** Fraction [0,1] along the segment from a to b */
  fraction: number;
}

function closestPointOnSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
): SegmentQueryResult {
  _seg_ab.subVectors(b, a);
  _seg_ap.subVectors(p, a);

  const abLenSq = _seg_ab.lengthSq();
  if (abLenSq < 1e-10) {
    // Degenerate segment (a == b)
    return { distSq: _seg_ap.lengthSq(), fraction: 0 };
  }

  // Project p onto the line a→b, clamp to [0,1]
  let t = _seg_ap.dot(_seg_ab) / abLenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  // Compute squared distance without allocating a Vector3
  const cx = a.x + _seg_ab.x * t;
  const cy = a.y + _seg_ab.y * t;
  const cz = a.z + _seg_ab.z * t;

  const dx = p.x - cx;
  const dy = p.y - cy;
  const dz = p.z - cz;

  return {
    distSq: dx * dx + dy * dy + dz * dz,
    fraction: t,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CAR-TO-CAR COLLISION — AABB BROADPHASE + PUSH-APART
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface CarCollider {
  id: string;
  position: THREE.Vector3; // centre (mutable reference into vehicle group)
  halfExtents: THREE.Vector3; // half-size of the car's oriented box (XZ approx)
  heading: number;
}

/**
 * Build an AABB enclosing the car's oriented bounding box.
 * The car's local half-extents are rotated by heading and expanded
 * to form a conservative axis-aligned box for broadphase.
 */
export function carAABB(car: CarCollider): AABB {
  // Conservatively expand: use max of halfExtents.x, halfExtents.z as both
  // X and Z half-widths (since any heading rotation could swap them).
  const r = Math.max(car.halfExtents.x, car.halfExtents.z);
  const hx = r;
  const hy = car.halfExtents.y;
  const hz = r;

  return {
    minX: car.position.x - hx,
    minY: car.position.y - hy,
    minZ: car.position.z - hz,
    maxX: car.position.x + hx,
    maxY: car.position.y + hy,
    maxZ: car.position.z + hz,
  };
}

/** Collision event reported back to the game loop for damage processing. */
export interface CollisionEvent {
  idA: string;
  idB: string;
  normalX: number;  // A→B direction
  normalZ: number;
  impactForce: number;
}

// ── OBB Separating Axis Test (SAT) ──
// Tests overlap of two oriented bounding boxes on the XZ plane using 4
// separating axes (2 from each car's heading). Returns the minimum
// translation vector (MTV) if overlapping, or null if separated.

interface OBBResult {
  overlap: number;  // penetration depth along MTV
  nx: number;       // MTV direction X (A→B push)
  nz: number;       // MTV direction Z
}

function obbOverlap(a: CarCollider, b: CarCollider): OBBResult | null {
  // Local axes for car A (forward = Z in car space, right = X)
  const cosA = Math.cos(a.heading);
  const sinA = Math.sin(a.heading);
  // A's axes: right = (cosA, -sinA), forward = (sinA, cosA) in XZ
  const aRX = cosA, aRZ = -sinA;     // A's local X (right)
  const aFX = sinA, aFZ = cosA;      // A's local Z (forward)

  // Local axes for car B
  const cosB = Math.cos(b.heading);
  const sinB = Math.sin(b.heading);
  const bRX = cosB, bRZ = -sinB;
  const bFX = sinB, bFZ = cosB;

  // Centre-to-centre vector
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;

  // Test 4 separating axes: A.right, A.forward, B.right, B.forward
  // For each axis, project distance and combined half-extents
  const axes = [
    { ax: aRX, az: aRZ }, // A's right
    { ax: aFX, az: aFZ }, // A's forward
    { ax: bRX, az: bRZ }, // B's right
    { ax: bFX, az: bFZ }, // B's forward
  ];

  let minOverlap = Infinity;
  let mtvX = 0, mtvZ = 0;

  for (const { ax, az } of axes) {
    // Project distance onto this axis
    const dist = Math.abs(dx * ax + dz * az);

    // Project A's half-extents onto this axis
    const projA = a.halfExtents.x * Math.abs(aRX * ax + aRZ * az)
                + a.halfExtents.z * Math.abs(aFX * ax + aFZ * az);

    // Project B's half-extents onto this axis
    const projB = b.halfExtents.x * Math.abs(bRX * ax + bRZ * az)
                + b.halfExtents.z * Math.abs(bFX * ax + bFZ * az);

    const gap = dist - (projA + projB);
    if (gap > 0) return null; // Separated on this axis → no collision

    const overlap = -gap;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      // MTV direction along this axis, pointing A→B
      const sign = (dx * ax + dz * az) >= 0 ? 1 : -1;
      mtvX = ax * sign;
      mtvZ = az * sign;
    }
  }

  return { overlap: minOverlap, nx: mtvX, nz: mtvZ };
}

/**
 * Detect and resolve car-to-car overlaps using AABB broadphase,
 * OBB narrow phase (Separating Axis Test), and minimum-translation-vector push-apart.
 * Returns collision events for damage/VFX processing.
 */
export function resolveCarCollisions(
  colliders: CarCollider[],
  velocities?: { velX: number; velZ: number }[],
): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  const n = colliders.length;

  for (let i = 0; i < n; i++) {
    const a = colliders[i];
    const aBox = carAABB(a);

    for (let j = i + 1; j < n; j++) {
      const b = colliders[j];
      const bBox = carAABB(b);

      // Broadphase: AABB overlap check
      if (!aabbOverlaps(aBox, bBox)) continue;

      // Narrowphase: OBB SAT overlap test
      const sat = obbOverlap(a, b);
      if (!sat) continue;

      const { overlap, nx, nz } = sat;

      // Degenerate case: cars directly on top of each other
      if (overlap < 0.001 && nx === 0 && nz === 0) {
        a.position.x -= 0.5;
        b.position.x += 0.5;
        continue;
      }

      // Push apart along MTV
      const pushAmount = overlap * 0.5;
      a.position.x -= nx * pushAmount;
      a.position.z -= nz * pushAmount;
      b.position.x += nx * pushAmount;
      b.position.z += nz * pushAmount;

      // Compute impact force from relative velocity along collision normal
      let impactForce = overlap * 2;
      if (velocities) {
        const vaX = velocities[i]?.velX ?? 0;
        const vaZ = velocities[i]?.velZ ?? 0;
        const vbX = velocities[j]?.velX ?? 0;
        const vbZ = velocities[j]?.velZ ?? 0;
        const relVelN = (vbX - vaX) * nx + (vbZ - vaZ) * nz;
        impactForce = Math.max(impactForce, Math.abs(relVelN));

        // Scale friction by impact strength — gentle sideswipes lose less speed
        const impactRatio = Math.min(1, impactForce / 30); // normalize: 30 = hard hit
        const frictionFactor = 1 - 0.15 * impactRatio;     // 0.85 at max, ~1.0 for gentle touches

        if (velocities[i]) {
          velocities[i].velX *= frictionFactor;
          velocities[i].velZ *= frictionFactor;
        }
        if (velocities[j]) {
          velocities[j].velX *= frictionFactor;
          velocities[j].velZ *= frictionFactor;
        }
      }

      events.push({ idA: a.id, idB: b.id, normalX: nx, normalZ: nz, impactForce });
    }
  }

  return events;
}
