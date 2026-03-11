/* ── Hood Racer — Procedural Track Generator ── */

import * as THREE from 'three';
import { Checkpoint, TrackData } from './types';

const ROAD_WIDTH = 14;
const BARRIER_HEIGHT = 1.8;
const BARRIER_THICKNESS = 0.4;
const NUM_CONTROL_POINTS = 12;
const TRACK_RADIUS_MIN = 60;
const TRACK_RADIUS_MAX = 120;
const SPLINE_SAMPLES = 400;

/** Generate a closed circuit racing track. */
export function generateTrack(seed?: number): TrackData {
  const rng = seededRandom(seed ?? (Date.now() % 100000));

  // ── 1. Generate control points in a roughly oval loop ──
  const controlPoints: THREE.Vector3[] = [];
  for (let i = 0; i < NUM_CONTROL_POINTS; i++) {
    const angle = (i / NUM_CONTROL_POINTS) * Math.PI * 2;
    const radiusX = TRACK_RADIUS_MIN + rng() * (TRACK_RADIUS_MAX - TRACK_RADIUS_MIN);
    const radiusZ = TRACK_RADIUS_MIN + rng() * (TRACK_RADIUS_MAX - TRACK_RADIUS_MIN);
    // Add randomness to radius for organic feel
    const jitterR = (rng() - 0.5) * 30;
    const x = Math.cos(angle) * (radiusX + jitterR);
    const z = Math.sin(angle) * (radiusZ + jitterR);
    const y = Math.sin(angle * 2) * (2 + rng() * 4); // gentle hills
    controlPoints.push(new THREE.Vector3(x, y, z));
  }

  // ── 2. Create smooth closed spline ──
  const spline = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal', 0.5);
  const totalLength = spline.getLength();

  // ── 3. Build road surface ──
  const roadMesh = buildRoadMesh(spline);

  // ── 4. Build barriers ──
  const barrierLeft = buildBarrierMesh(spline, -1);
  const barrierRight = buildBarrierMesh(spline, 1);

  // ── 5. Place checkpoints at equal intervals ──
  const numCheckpoints = 10;
  const checkpoints: Checkpoint[] = [];
  for (let i = 0; i < numCheckpoints; i++) {
    const t = i / numCheckpoints;
    const position = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    checkpoints.push({ position, tangent, index: i });
  }

  // ── 6. Generate scenery ──
  const sceneryGroup = generateScenery(spline, rng);

  return { spline, roadMesh, barrierLeft, barrierRight, checkpoints, sceneryGroup, totalLength };
}

/** Build a flat road strip following the spline. */
function buildRoadMesh(spline: THREE.CatmullRomCurve3): THREE.Mesh {
  const points = spline.getSpacedPoints(SPLINE_SAMPLES);
  const vertices: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const halfW = ROAD_WIDTH / 2;

  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    const tangent = spline.getTangentAt(t).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

    const p = points[i];

    // Left edge
    vertices.push(p.x - right.x * halfW, p.y + 0.01, p.z - right.z * halfW);
    // Right edge
    vertices.push(p.x + right.x * halfW, p.y + 0.01, p.z + right.z * halfW);

    uvs.push(0, t * 40); // left
    uvs.push(1, t * 40); // right

    normals.push(0, 1, 0, 0, 1, 0);

    if (i < points.length - 1) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);

  // Road texture from canvas
  const roadTex = createRoadTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: roadTex,
    roughness: 0.7,
    metalness: 0.0,
    color: 0x444450,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** Create a procedural road texture with lane markings. */
function createRoadTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Base asphalt
  ctx.fillStyle = '#3a3a42';
  ctx.fillRect(0, 0, 256, 256);

  // Asphalt noise
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const brightness = 50 + Math.random() * 30;
    ctx.fillStyle = `rgb(${brightness},${brightness},${brightness + 5})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Center dashed line
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 3;
  ctx.setLineDash([20, 20]);
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();
  ctx.setLineDash([]);

  // Edge lines
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(10, 0); ctx.lineTo(10, 256);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(246, 0); ctx.lineTo(246, 256);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.anisotropy = 4;
  return tex;
}

/** Build barrier walls along one side of the track. */
function buildBarrierMesh(spline: THREE.CatmullRomCurve3, side: number): THREE.Mesh {
  const points = spline.getSpacedPoints(SPLINE_SAMPLES);
  const vertices: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const halfW = ROAD_WIDTH / 2 + BARRIER_THICKNESS;

  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1);
    const tangent = spline.getTangentAt(t).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

    const p = points[i];
    const ox = p.x + right.x * halfW * side;
    const oz = p.z + right.z * halfW * side;

    // Bottom vertex
    vertices.push(ox, p.y, oz);
    // Top vertex
    vertices.push(ox, p.y + BARRIER_HEIGHT, oz);

    // Normal pointing inward
    const n = right.clone().multiplyScalar(-side);
    normals.push(n.x, 0, n.z, n.x, 0, n.z);

    if (i < points.length - 1) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xcc3300,
    roughness: 0.6,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  mat.emissive = new THREE.Color(0x330000);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/** Scatter scenery objects around the track edges. */
function generateScenery(spline: THREE.CatmullRomCurve3, rng: () => number): THREE.Group {
  const group = new THREE.Group();
  const numObjects = 80;

  for (let i = 0; i < numObjects; i++) {
    const t = rng();
    const p = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

    const side = rng() > 0.5 ? 1 : -1;
    const offset = ROAD_WIDTH / 2 + 5 + rng() * 30;

    const x = p.x + right.x * offset * side;
    const z = p.z + right.z * offset * side;

    if (rng() > 0.3) {
      // Tree
      const tree = createTree(rng);
      tree.position.set(x, p.y, z);
      group.add(tree);
    } else {
      // Concrete block / barrel
      const block = createBlock(rng);
      block.position.set(x, p.y, z);
      group.add(block);
    }
  }

  // Street lights along the track
  for (let i = 0; i < 30; i++) {
    const t = i / 30;
    const p = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(tangent, up).normalize();

    const side = i % 2 === 0 ? 1 : -1;
    const offset = ROAD_WIDTH / 2 + 2;

    const x = p.x + right.x * offset * side;
    const z = p.z + right.z * offset * side;

    const light = createStreetLight();
    light.position.set(x, p.y, z);
    group.add(light);
  }

  return group;
}

function createTree(rng: () => number): THREE.Group {
  const tree = new THREE.Group();
  const trunkHeight = 2 + rng() * 3;
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, trunkHeight, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9 });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = true;
  tree.add(trunk);

  const crownRadius = 1.5 + rng() * 2;
  const crownGeo = new THREE.SphereGeometry(crownRadius, 8, 6);
  const green = 0x1a4d1a + Math.floor(rng() * 0x1a3300);
  const crownMat = new THREE.MeshStandardMaterial({ color: green, roughness: 0.8 });
  const crown = new THREE.Mesh(crownGeo, crownMat);
  crown.position.y = trunkHeight + crownRadius * 0.6;
  crown.castShadow = true;
  tree.add(crown);

  return tree;
}

function createBlock(rng: () => number): THREE.Mesh {
  const w = 0.8 + rng() * 1.5;
  const h = 0.6 + rng() * 1.2;
  const d = 0.8 + rng() * 1.5;
  const geo = new THREE.BoxGeometry(w, h, d);
  const grey = 0x555555 + Math.floor(rng() * 0x333333);
  const mat = new THREE.MeshStandardMaterial({ color: grey, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = h / 2;
  mesh.castShadow = true;
  return mesh;
}

function createStreetLight(): THREE.Group {
  const group = new THREE.Group();

  // Pole
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.6, roughness: 0.3 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 3;
  group.add(pole);

  // Light fixture
  const fixGeo = new THREE.SphereGeometry(0.25, 8, 6);
  const fixMat = new THREE.MeshStandardMaterial({
    color: 0xffffaa,
    emissive: 0xffdd66,
    emissiveIntensity: 0.8,
  });
  const fixture = new THREE.Mesh(fixGeo, fixMat);
  fixture.position.y = 6;
  group.add(fixture);

  // Point light (limited range for perf)
  const pointLight = new THREE.PointLight(0xffdd88, 0.6, 20, 2);
  pointLight.position.y = 5.8;
  group.add(pointLight);

  return group;
}

/** Seeded PRNG (mulberry32) for reproducible tracks. */
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Get the closest point on the spline to a world position + distance to road center. */
export function getClosestSplinePoint(
  spline: THREE.CatmullRomCurve3,
  pos: THREE.Vector3,
  samples = 100
): { t: number; point: THREE.Vector3; distance: number } {
  let bestT = 0;
  let bestDist = Infinity;
  let bestPoint = new THREE.Vector3();

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = spline.getPointAt(t);
    const d = pos.distanceToSquared(p);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
      bestPoint = p;
    }
  }

  return { t: bestT, point: bestPoint, distance: Math.sqrt(bestDist) };
}

/** Build 3D checkpoint gate arches. */
export function buildCheckpointMarkers(checkpoints: Checkpoint[]): THREE.Group {
  const group = new THREE.Group();

  checkpoints.forEach((cp, i) => {
    const arch = createCheckpointArch(i === 0);
    // Orient the arch perpendicular to the track
    const right = new THREE.Vector3()
      .crossVectors(cp.tangent, new THREE.Vector3(0, 1, 0))
      .normalize();
    arch.position.copy(cp.position);
    arch.position.y += 0.1;
    arch.lookAt(cp.position.clone().add(cp.tangent));
    group.add(arch);
  });

  return group;
}

function createCheckpointArch(isStart: boolean): THREE.Group {
  const arch = new THREE.Group();
  const height = 5;
  const width = ROAD_WIDTH;
  const color = isStart ? 0xffcc00 : 0xff6600;

  // Left pillar
  const pillarGeo = new THREE.BoxGeometry(0.3, height, 0.3);
  const pillarMat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.6,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.3,
  });
  const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
  leftPillar.position.set(-width / 2, height / 2, 0);
  arch.add(leftPillar);

  // Right pillar
  const rightPillar = new THREE.Mesh(pillarGeo, pillarMat.clone());
  rightPillar.position.set(width / 2, height / 2, 0);
  arch.add(rightPillar);

  // Top beam
  const beamGeo = new THREE.BoxGeometry(width + 0.3, 0.3, 0.3);
  const beam = new THREE.Mesh(beamGeo, pillarMat.clone());
  beam.position.set(0, height, 0);
  arch.add(beam);

  // Start/finish banner
  if (isStart) {
    const bannerGeo = new THREE.PlaneGeometry(width, 1.5);
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 512;
    bannerCanvas.height = 96;
    const ctx = bannerCanvas.getContext('2d')!;
    // Checkerboard
    const sq = 32;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 16; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#111111';
        ctx.fillRect(c * sq, r * sq, sq, sq);
      }
    }
    const bannerTex = new THREE.CanvasTexture(bannerCanvas);
    const bannerMat = new THREE.MeshBasicMaterial({
      map: bannerTex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(0, height - 1, 0);
    arch.add(banner);
  }

  return arch;
}
