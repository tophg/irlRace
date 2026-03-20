/* ── IRL Race — Track Scenery Generation ── */

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROAD_WIDTH, BARRIER_THICKNESS, estimateCurvature, BANK_SCALE, MAX_BANK_ANGLE } from './track';
import { loadGLB } from './loaders';
import type { SceneryTheme } from './scene';

// ── Typed data storage (replaces `as any` monkey-patching) ──
interface WindShaderRef {
  uniforms: { uWindTime: { value: number }; [k: string]: { value: unknown } };
}
interface SceneryGroupData {
  crownMat: THREE.MeshStandardMaterial | null;
  fxMats: THREE.MeshStandardMaterial[];
}
const _windShaders = new WeakMap<THREE.Material, WindShaderRef>();
const _sceneryGroupData = new WeakMap<THREE.Object3D, SceneryGroupData>();

// ── Distance culling for procedural city buildings ──
let _buildingClones: THREE.Object3D[] = [];
let _buildingInstances: THREE.Vector3[] = [];
let _buildingInstancedMeshes: THREE.InstancedMesh[] = [];
const _CULL_DIST_SQ = 250 * 250;

/** Call once per frame to cull buildings beyond camera range. */
export function updateBuildingCulling(camPos: THREE.Vector3) {
  // Legacy clone-based culling
  for (const b of _buildingClones) {
    const dx = b.position.x - camPos.x, dz = b.position.z - camPos.z;
    b.visible = (dx * dx + dz * dz) < _CULL_DIST_SQ;
  }
  // InstancedMesh culling: toggle visibility of entire mesh groups
  for (const im of _buildingInstancedMeshes) {
    im.visible = true; // InstancedMesh frustum culling handled by Three.js
  }
}

/** Clean up culling references on race exit. */
export function destroyBuildingCulling() {
  _buildingClones = [];
  _buildingInstances = [];
  _buildingInstancedMeshes = [];
}

function getGroupData(group: THREE.Object3D): SceneryGroupData {
  let data = _sceneryGroupData.get(group);
  if (!data) {
    data = { crownMat: null, fxMats: [] };
    _sceneryGroupData.set(group, data);
  }
  return data;
}

export function generateScenery(spline: THREE.CatmullRomCurve3, rng: () => number, theme?: SceneryTheme, roadMesh?: THREE.Mesh): THREE.Group {
  // Default theme fallback (Washington D.C. style)
  const T: SceneryTheme = theme ?? {
    roadColor: 0x2a2a30, roadRoughness: 0.85, barrierColor: 0x444450,
    buildingPalette: [0x1a1a2e, 0x22223a, 0x2a2a45, 0x181830],
    buildingHeightRange: [8, 25], windowLitChance: 0.6, windowColor: 0xffcc66,
    treeTrunkColor: 0x332211, treeCanopyColor: 0x1a3a1a,
    treeCanopyStyle: 'sphere', treeCount: 30,
    billboardStyle: 'neon', streetLightColor: 0xffdd88, streetLightDensity: 1.0,
    groundTexture: 'grass', kerbColor: 0x888888, shoulderColor: 0x333333,
    mountainColor: 0x1a1a2e, mountainHeight: 1, cloudOpacity: 0.3, cloudTint: 0x2a2a40,
    fenceDensity: 1.0, rockDensity: 0.3, rockColor: 0x444450, bushDensity: 0.3,
    spectatorDensity: 1.0, accentProps: [],
  };
  const group = new THREE.Group();
  const _asyncLoads: Promise<void>[] = []; // collect async loads so caller can await them

  // ── Ground plane (large flat grass surface) ──
  {
    const groundGeo = new THREE.PlaneGeometry(800, 800);
    // Procedural grass texture
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 256;
    groundCanvas.height = 256;
    const gctx = groundCanvas.getContext('2d')!;
    // Base color by ground texture type
    const groundColors: Record<string, [string, string, string]> = {
      grass: ['#2a5a1a', '#2e6420', '#245216'],
      sand: ['#8a7755', '#917f5d', '#7d6b4a'],
      snow: ['#bbccdd', '#c0d0e0', '#aabbcc'],
      concrete: ['#3a3a40', '#404048', '#333338'],
      dirt: ['#4a3a28', '#503e2c', '#3e3020'],
    };
    const [base, v1, v2] = groundColors[T.groundTexture] ?? groundColors.grass;
    gctx.fillStyle = base;
    gctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 200; i++) {
      const px = Math.random() * 256;
      const py = Math.random() * 256;
      gctx.fillStyle = Math.random() > 0.5 ? v1 : v2;
      gctx.fillRect(px, py, 3 + Math.random() * 8, 3 + Math.random() * 8);
    }
    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(40, 40);

    const groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      roughness: 0.95,
      metalness: 0,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2; // lay flat
    groundMesh.position.y = -2; // well below road surface to prevent clipping
    groundMesh.receiveShadow = true;
    group.add(groundMesh);
  }

  // Pre-compute all tree positions
  interface TreeItem { x: number; y: number; z: number; trunkH: number; crownR: number; green: number; rotY: number; model: string; }
  const trees: TreeItem[] = [];
  const treeCount = T.treeCanopyStyle === 'none' && !T.treeModels?.length ? 0 : T.treeCount;
  const treeModelList = T.treeModels?.length ? T.treeModels : [];
  for (let i = 0; i < treeCount; i++) {
    const t = rng();
    const p = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const rx = tangent.z, rz = -tangent.x;
    const side = rng() > 0.5 ? 1 : -1;
    const offset = ROAD_WIDTH / 2 + 5 + rng() * 30;
    const x = p.x + rx * offset * side;
    const z = p.z + rz * offset * side;
    trees.push({
      x, y: p.y, z,
      trunkH: 2 + rng() * 3,
      crownR: 1.5 + rng() * 2,
      green: Math.floor(rng() * 255),
      rotY: rng() * Math.PI * 2,
      model: treeModelList.length ? treeModelList[Math.floor(rng() * treeModelList.length)] : '',
    });
  }

  const _m = new THREE.Matrix4();
  const _c = new THREE.Color();

  // ── Trees: GLB models if available, otherwise procedural ──
  if (treeModelList.length > 0 && trees.length > 0) {
    // Async load GLB tree models and place clones
    const TREE_SCALE: Record<string, number> = {
      'red_maple.glb': 3.0,
      'red_maple_b.glb': 2.8,
      'pine.glb': 3.5,
      'pine_b.glb': 3.2,
      'dogwood.glb': 2.5,
      'walnut.glb': 3.2,
      'walnut_b.glb': 3.2,
      'black_walnut.glb': 3.0,
      'black_walnut_b.glb': 3.0,
      'oak.glb': 3.0,
      'cactus_tall.glb': 2.0,
      'cactus.glb': 1.5,
      'cactus_b.glb': 1.5,
      'cactus_c.glb': 1.5,
      'palm_tree.glb': 3.0,
      'palm_tree_b.glb': 2.8,
      'palm_tree_c.glb': 2.6,
      'palm_trees_cluster.glb': 2.5,
    };

    const uniqueTreeModels = [...new Set(trees.map(t => t.model))];
    _asyncLoads.push(Promise.all(
      uniqueTreeModels.map(name => loadGLB(`/trees/${name}`).then(scene => ({ name, scene })))
    ).then((loaded) => {
      const treeMap = new Map<string, { scene: THREE.Group; bottom: number }>();
      for (const { name, scene } of loaded) {
        const bbox = new THREE.Box3().setFromObject(scene);
        treeMap.set(name, { scene, bottom: bbox.min.y });
      }

      for (const t of trees) {
        const entry = treeMap.get(t.model);
        if (!entry) continue;

        const clone = entry.scene.clone(true);
        const s = (TREE_SCALE[t.model] ?? 2.5) * (0.8 + rng() * 0.4); // add ±20% variation
        clone.scale.setScalar(s);
        clone.position.set(t.x, t.y - entry.bottom * s, t.z);
        clone.rotation.y = t.rotY;

        clone.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).castShadow = true;
          }
        });

        group.add(clone);
      }
    }).catch((err) => {
      console.warn('Failed to load tree models:', err);
    }));
  } else if (trees.length > 0) {
    // ── Fallback: Procedural trees (InstancedMesh) ──
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.3, 3.5, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: T.treeTrunkColor, roughness: 0.9 });
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

    // ── Tree crowns (InstancedMesh with per-instance color + wind sway) ──
    // Select crown geometry based on tree variant
    const treeVariant = T.treeVariant ?? 'standard';
    let crownGeo: THREE.BufferGeometry;

    switch (treeVariant) {
      case 'joshua':
        // Spiky desert tree crown — small icosahedron
        crownGeo = new THREE.IcosahedronGeometry(1.5, 0);
        break;
      case 'layered_pine':
        // Stacked two-cone pine silhouette (merged geometry)
        {
          const lowerCone = new THREE.ConeGeometry(2.2, 3.0, 8);
          const upperCone = new THREE.ConeGeometry(1.5, 2.5, 8);
          upperCone.translate(0, 2.0, 0);
          crownGeo = mergeGeometries([lowerCone, upperCone]) ?? new THREE.ConeGeometry(2.0, 4.0, 8);
        }
        break;
      case 'palm_frond':
        // Wide flat disc for palm tree top
        crownGeo = new THREE.CylinderGeometry(2.5, 2.5, 0.4, 8);
        break;
      case 'snow_capped':
        // Standard cone but coloring handles the snow cap
        crownGeo = new THREE.ConeGeometry(2.0, 4.0, 8);
        break;
      case 'standard':
      default:
        crownGeo = T.treeCanopyStyle === 'cone'
          ? new THREE.ConeGeometry(2.0, 4.0, 8)
          : new THREE.SphereGeometry(2.0, 8, 6);
        break;
    }

    const crownMat = new THREE.MeshStandardMaterial({ color: T.treeCanopyColor, roughness: 0.8 });

    // Enhancement 5: Inject wind sway into vertex shader (zero CPU cost)
    crownMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = { value: 0 };
      // Insert time uniform declaration before main()
      shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader;
      // Inject wind displacement after #include <begin_vertex>
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         // Wind sway — gentle organic motion using world position
         vec4 worldPos4 = instanceMatrix * vec4(transformed, 1.0);
         float windX = sin(uWindTime * 1.5 + worldPos4.x * 0.3) * 0.25;
         float windZ = cos(uWindTime * 1.2 + worldPos4.z * 0.25) * 0.18;
         // Upper vertices sway more (normalized Y in sphere: -1 to 1)
         float heightFactor = clamp(position.y + 0.5, 0.0, 1.0);
         transformed.x += windX * heightFactor;
         transformed.z += windZ * heightFactor;`
      );
      // Store shader ref for time updates
      _windShaders.set(crownMat, shader as unknown as WindShaderRef);
    };

    const crownIM = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
    crownIM.castShadow = true;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      _m.makeScale(t.crownR / 2.0, t.crownR / 2.0, t.crownR / 2.0);
      _m.setPosition(t.x, t.y + t.trunkH + t.crownR * 0.6, t.z);
      crownIM.setMatrixAt(i, _m);
      const tc = new THREE.Color(T.treeCanopyColor);
      const g = tc.g + (t.green / 255) * 0.15;
      // Always consume the same number of rng() calls regardless of variant
      // to keep building generation deterministic across weather types
      const rng1 = rng(), rng2 = rng(), rng3 = rng();
      if (treeVariant === 'snow_capped') {
        const snowBlend = 0.3 + rng1 * 0.4; // 30-70% white
        _c.setRGB(
          tc.r * (1 - snowBlend) + snowBlend,
          (tc.g + (t.green / 255) * 0.15) * (1 - snowBlend) + snowBlend,
          tc.b * (1 - snowBlend) + snowBlend
        );
      } else {
        _c.setRGB(tc.r * 0.9 + rng1 * 0.1, g, tc.b * 0.9 + rng2 * 0.1);
      }
      crownIM.setColorAt(i, _c);
    }
    crownIM.instanceMatrix.needsUpdate = true;
    crownIM.instanceColor!.needsUpdate = true;
    group.add(crownIM);

    // Store crown material ref for wind time updates from game loop
    getGroupData(group).crownMat = crownMat;
  }



  // ── Street lights (InstancedMesh — themed) ──
  const LIGHT_COUNT = Math.round(30 * T.streetLightDensity);

  // Poles
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.6, roughness: 0.3 });
  const poleIM = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, LIGHT_COUNT));

  // Fixtures (emissive glow — themed color)
  const fixGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const fixMat = new THREE.MeshStandardMaterial({
    color: T.streetLightColor,
    emissive: T.streetLightColor,
    emissiveIntensity: 0.8,
    roughness: 0.2,
  });
  const fixIM = new THREE.InstancedMesh(fixGeo, fixMat, Math.max(1, LIGHT_COUNT));

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
    _m.setPosition(x, 3, z);
    poleIM.setMatrixAt(i, _m);

    _m.setPosition(x, 6, z);
    fixIM.setMatrixAt(i, _m);

    // Add real PointLights to every 10th lamp for visible road illumination pools
    if (i % 10 === 0) {
      const light = new THREE.PointLight(T.streetLightColor, 1.5, 14, 2);
      light.position.set(x, 5.8, z);
      group.add(light);
    }
  }
  if (LIGHT_COUNT > 0) {
    poleIM.instanceMatrix.needsUpdate = true;
    fixIM.instanceMatrix.needsUpdate = true;
    group.add(poleIM);
    group.add(fixIM);
  }

  // ── Chain-link fences along track edges (InstancedMesh) ──
  if (T.fenceDensity > 0) {
    const FENCE_COUNT = Math.round(20 * T.fenceDensity);
    const fencePostGeo = new THREE.CylinderGeometry(0.06, 0.08, 3, 4);
    const fencePostMat = new THREE.MeshStandardMaterial({ color: T.barrierColor, metalness: 0.5, roughness: 0.4 });
    const fencePostIM = new THREE.InstancedMesh(fencePostGeo, fencePostMat, FENCE_COUNT * 2);

    // Fence panels (semi-transparent chain-link texture)
    const fencePanelCanvas = document.createElement('canvas');
    fencePanelCanvas.width = 64; fencePanelCanvas.height = 64;
    const fpCtx = fencePanelCanvas.getContext('2d')!;
    fpCtx.clearRect(0, 0, 64, 64);
    fpCtx.strokeStyle = 'rgba(150,150,150,0.3)';
    fpCtx.lineWidth = 1;
    for (let d = -64; d < 128; d += 6) {
      fpCtx.beginPath(); fpCtx.moveTo(d, 0); fpCtx.lineTo(d + 64, 64); fpCtx.stroke();
      fpCtx.beginPath(); fpCtx.moveTo(d, 64); fpCtx.lineTo(d + 64, 0); fpCtx.stroke();
    }
    const fenceTex = new THREE.CanvasTexture(fencePanelCanvas);
    fenceTex.wrapS = THREE.RepeatWrapping; fenceTex.wrapT = THREE.RepeatWrapping;
    const fencePanelGeo = new THREE.PlaneGeometry(8, 2.5);
    const fencePanelMat = new THREE.MeshStandardMaterial({
      map: fenceTex, transparent: true, alphaTest: 0.1,
      side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3,
    });
    const fencePanelIM = new THREE.InstancedMesh(fencePanelGeo, fencePanelMat, FENCE_COUNT);

    let fencePostIdx = 0;
    let fencePanelIdx = 0;
    for (let i = 0; i < FENCE_COUNT; i++) {
      const t = (i + 0.5) / FENCE_COUNT;
      const kappa = estimateCurvature(spline, t);
      if (Math.abs(kappa) > 0.03) continue; // skip corners
      const p = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const rx = tangent.z, rz = -tangent.x;
      const side = i % 2 === 0 ? 1 : -1;
      const offset = ROAD_WIDTH / 2 + BARRIER_THICKNESS + 3;
      const x = p.x + rx * offset * side;
      const z = p.z + rz * offset * side;

      // Two posts per fence segment
      _m.identity(); _m.setPosition(x - tangent.x * 4, 1.5, z - tangent.z * 4);
      if (fencePostIdx < FENCE_COUNT * 2) fencePostIM.setMatrixAt(fencePostIdx++, _m);
      _m.setPosition(x + tangent.x * 4, 1.5, z + tangent.z * 4);
      if (fencePostIdx < FENCE_COUNT * 2) fencePostIM.setMatrixAt(fencePostIdx++, _m);

      // Panel between posts
      const panel = new THREE.Matrix4();
      panel.setPosition(x, 1.5, z);
      // Rotate to face perpendicular to road
      const angle = Math.atan2(tangent.x, tangent.z);
      panel.makeRotationY(angle);
      panel.setPosition(x, 1.5, z);
      if (fencePanelIdx < FENCE_COUNT) fencePanelIM.setMatrixAt(fencePanelIdx++, panel);
    }
    if (fencePostIdx > 0) {
      fencePostIM.count = fencePostIdx;
      fencePostIM.instanceMatrix.needsUpdate = true;
      group.add(fencePostIM);
    }
    if (fencePanelIdx > 0) {
      fencePanelIM.count = fencePanelIdx;
      fencePanelIM.instanceMatrix.needsUpdate = true;
      group.add(fencePanelIM);
    }
  }

  // ── Rocks & boulders (InstancedMesh) ──
  if (T.rockDensity > 0) {
    const ROCK_COUNT = Math.round(40 * T.rockDensity);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: T.rockColor, roughness: 0.95, metalness: 0 });
    const rockIM = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
    for (let i = 0; i < ROCK_COUNT; i++) {
      const t = rng();
      const p = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const rx = tangent.z, rz2 = -tangent.x;
      const side = rng() > 0.5 ? 1 : -1;
      const offset = ROAD_WIDTH / 2 + 8 + rng() * 35;
      const x = p.x + rx * offset * side;
      const z = p.z + rz2 * offset * side;
      const scale = 0.3 + rng() * 1.2;
      _m.makeScale(scale, scale * (0.5 + rng() * 0.5), scale);
      _m.setPosition(x, scale * 0.3 - 2, z);
      rockIM.setMatrixAt(i, _m);
      // Per-instance color variation
      const rc = new THREE.Color(T.rockColor);
      const v = 0.7 + rng() * 0.5;
      _c.setRGB(rc.r * v, rc.g * v, rc.b * v);
      rockIM.setColorAt(i, _c);
    }
    rockIM.instanceMatrix.needsUpdate = true;
    rockIM.instanceColor!.needsUpdate = true;
    group.add(rockIM);
  }

  // ── Bushes & shrubs (InstancedMesh — clustered near trees) ──
  if (T.bushDensity > 0 && T.treeCanopyStyle !== 'none') {
    const BUSH_COUNT = Math.round(60 * T.bushDensity);
    const bushGeo = new THREE.SphereGeometry(1.0, 4, 3);
    const bushMat = new THREE.MeshStandardMaterial({ color: T.treeCanopyColor, roughness: 0.85 });
    const bushIM = new THREE.InstancedMesh(bushGeo, bushMat, BUSH_COUNT);
    let bushIdx = 0;
    for (let i = 0; i < BUSH_COUNT && bushIdx < BUSH_COUNT; i++) {
      const t = rng();
      const p = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const rx = tangent.z, rz2 = -tangent.x;
      const side = rng() > 0.5 ? 1 : -1;
      const offset = ROAD_WIDTH / 2 + 4 + rng() * 25;
      const x = p.x + rx * offset * side;
      const z = p.z + rz2 * offset * side;
      const scale = 0.4 + rng() * 0.8;
      _m.makeScale(scale * (1 + rng() * 0.5), scale, scale * (1 + rng() * 0.5));
      _m.setPosition(x, scale * 0.4 - 1.5, z);
      bushIM.setMatrixAt(bushIdx, _m);
      const bc = new THREE.Color(T.treeCanopyColor);
      _c.setRGB(bc.r * (0.8 + rng() * 0.4), bc.g * (0.8 + rng() * 0.4), bc.b * (0.8 + rng() * 0.4));
      bushIM.setColorAt(bushIdx, _c);
      bushIdx++;
    }
    bushIM.count = bushIdx;
    bushIM.instanceMatrix.needsUpdate = true;
    bushIM.instanceColor!.needsUpdate = true;
    group.add(bushIM);
  }

  // ── Start/Finish line (road-conforming checkerboard + 3D gantry arch) ──
  {
    // ── 1. Road-conforming checkerboard strip ──
    // Build a strip of quads at closely-spaced t-values around t=0,
    // Each cross-section conforms to the actual spline surface (slopes & banking).
    const STRIP_SAMPLES = 16;
    const STRIP_T_RANGE = 0.008; // t range around 0 in each direction
    const stripVerts: number[] = [];
    const stripUVs: number[] = [];
    const stripNormals: number[] = [];
    const stripIndices: number[] = [];
    const halfW = ROAD_WIDTH / 2;

    // Measure the physical depth of the strip to compute correct UV scaling
    const tStart = (1 - STRIP_T_RANGE) % 1;
    const tEnd = STRIP_T_RANGE;
    const pStart = spline.getPointAt(tStart);
    const pEnd = spline.getPointAt(tEnd);
    const stripDepth = pStart.distanceTo(pEnd);
    const roadWidth = ROAD_WIDTH;
    // Number of checker squares across the road
    const CHECKER_COLS = 8;
    // Each square should be physically square, so rows = depth / (width / cols)
    const squareSize = roadWidth / CHECKER_COLS;
    const CHECKER_ROWS = Math.max(1, Math.round(stripDepth / squareSize));
    // V repeats so that V range [0,1] maps to CHECKER_ROWS squares of depth
    const vScale = CHECKER_ROWS;

    // Build the checkerboard strip by reading vertex positions directly from the
    // road mesh geometry. This guarantees perfect alignment regardless of banking,
    // slope, or spline sampling method. The road mesh has vertex pairs (left, right)
    // at each cross-section: vertex[i*2] = left, vertex[i*2+1] = right.
    if (roadMesh) {
      const roadPosAttr = roadMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const roadNormAttr = roadMesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const totalCrossSections = roadPosAttr.count / 2; // 2 verts per cross-section

      // Collect cross-section indices near the start (both ends of the loop wrap to t=0)
      // Road mesh: index 0 = t≈0, index N-1 = t≈1 (wraps back)
      const STRIP_HALF = 3; // cross-sections on each side of t=0
      const csIndices: number[] = [];
      for (let k = totalCrossSections - STRIP_HALF; k < totalCrossSections; k++) {
        csIndices.push(k);
      }
      for (let k = 0; k <= STRIP_HALF; k++) {
        csIndices.push(k);
      }

      for (let si = 0; si < csIndices.length; si++) {
        const cs = csIndices[si];
        const li = cs * 2;     // left vertex index
        const ri = cs * 2 + 1; // right vertex index

        // Read exact road surface vertex positions and add tiny Y offset
        stripVerts.push(roadPosAttr.getX(li), roadPosAttr.getY(li) + 0.01, roadPosAttr.getZ(li));
        stripVerts.push(roadPosAttr.getX(ri), roadPosAttr.getY(ri) + 0.01, roadPosAttr.getZ(ri));

        // UVs for checkerboard pattern
        const frac = si / (csIndices.length - 1);
        stripUVs.push(0, frac * vScale);
        stripUVs.push(1, frac * vScale);

        // Copy normals from road mesh
        stripNormals.push(
          roadNormAttr.getX(li), roadNormAttr.getY(li), roadNormAttr.getZ(li),
          roadNormAttr.getX(ri), roadNormAttr.getY(ri), roadNormAttr.getZ(ri),
        );

        if (si < csIndices.length - 1) {
          const base = si * 2;
          stripIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }
    } else {
      // Fallback: use spline sampling if no road mesh available
      const centerTan = spline.getTangentAt(0).normalize();
      const flatRight = new THREE.Vector3(centerTan.z, 0, -centerTan.x).normalize();
      const upVec = new THREE.Vector3(0, 1, 0);

      for (let i = 0; i <= STRIP_SAMPLES; i++) {
        const frac = i / STRIP_SAMPLES;
        const t = (1 - STRIP_T_RANGE + frac * 2 * STRIP_T_RANGE) % 1;
        const p = spline.getPointAt(t);
        const y = p.y + 0.02;
        stripVerts.push(p.x - flatRight.x * halfW, y, p.z - flatRight.z * halfW);
        stripVerts.push(p.x + flatRight.x * halfW, y, p.z + flatRight.z * halfW);
        stripUVs.push(0, frac * vScale);
        stripUVs.push(1, frac * vScale);
        stripNormals.push(upVec.x, upVec.y, upVec.z, upVec.x, upVec.y, upVec.z);
        if (i < STRIP_SAMPLES) {
          const base = i * 2;
          stripIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
      }
    }

    const stripGeo = new THREE.BufferGeometry();
    stripGeo.setAttribute('position', new THREE.Float32BufferAttribute(stripVerts, 3));
    stripGeo.setAttribute('uv', new THREE.Float32BufferAttribute(stripUVs, 2));
    stripGeo.setAttribute('normal', new THREE.Float32BufferAttribute(stripNormals, 3));
    stripGeo.setIndex(stripIndices);

    // Square checkerboard canvas texture (8×8 grid)
    const CHECKER_TEX_SIZE = 128;
    const CELL_SIZE = CHECKER_TEX_SIZE / CHECKER_COLS;
    const checkerCanvas = document.createElement('canvas');
    checkerCanvas.width = CHECKER_TEX_SIZE;
    checkerCanvas.height = CHECKER_TEX_SIZE;
    const checkerCtx = checkerCanvas.getContext('2d')!;
    for (let row = 0; row < CHECKER_COLS; row++) {
      for (let col = 0; col < CHECKER_COLS; col++) {
        checkerCtx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#111111';
        checkerCtx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
    const checkerTex = new THREE.CanvasTexture(checkerCanvas);
    checkerTex.wrapS = THREE.RepeatWrapping;
    checkerTex.wrapT = THREE.RepeatWrapping;

    const checkerMat = new THREE.MeshStandardMaterial({
      map: checkerTex,
      roughness: 0.6,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const checkerMesh = new THREE.Mesh(stripGeo, checkerMat);
    checkerMesh.renderOrder = 1;
    group.add(checkerMesh);

    // ── 2. 3D Gantry Arch ──
    const gantryT = 0;
    const gP = spline.getPointAt(gantryT);
    const gTangent = spline.getTangentAt(gantryT).normalize();
    const gRight = new THREE.Vector3(gTangent.z, 0, -gTangent.x).normalize();

    const postHeight = 7;
    const postWidth = 0.3;
    const crossbarHeight = 0.4;
    const archSpan = ROAD_WIDTH + 2; // slightly wider than road

    const postGeo = new THREE.BoxGeometry(postWidth, postHeight, postWidth);
    const crossbarGeo = new THREE.BoxGeometry(archSpan, crossbarHeight, postWidth * 1.5);
    const gantryMat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.8,
      roughness: 0.3,
    });

    // Left post
    const leftPost = new THREE.Mesh(postGeo, gantryMat);
    leftPost.position.set(
      gP.x - gRight.x * (archSpan / 2), gP.y + postHeight / 2, gP.z - gRight.z * (archSpan / 2)
    );
    group.add(leftPost);

    // Right post
    const rightPost = new THREE.Mesh(postGeo, gantryMat);
    rightPost.position.set(
      gP.x + gRight.x * (archSpan / 2), gP.y + postHeight / 2, gP.z + gRight.z * (archSpan / 2)
    );
    group.add(rightPost);

    // Crossbar
    const crossbar = new THREE.Mesh(crossbarGeo, gantryMat);
    crossbar.position.set(gP.x, gP.y + postHeight, gP.z);
    // Orient crossbar perpendicular to track
    const gantryAngle = Math.atan2(gRight.x, gRight.z);
    crossbar.rotation.y = gantryAngle;
    group.add(crossbar);

    // Banner on the crossbar ("START / FINISH")
    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 512; bannerCanvas.height = 64;
    const bannerCtx = bannerCanvas.getContext('2d')!;
    // Checkerboard border strip
    for (let col = 0; col < 32; col++) {
      bannerCtx.fillStyle = col % 2 === 0 ? '#ffffff' : '#111111';
      bannerCtx.fillRect(col * 16, 0, 16, 8);
      bannerCtx.fillRect(col * 16, 56, 16, 8);
    }
    bannerCtx.fillStyle = '#000000';
    bannerCtx.fillRect(0, 8, 512, 48);
    bannerCtx.fillStyle = '#ffffff';
    bannerCtx.font = 'bold 36px sans-serif';
    bannerCtx.textAlign = 'center';
    bannerCtx.fillText('START / FINISH', 256, 44);

    const bannerTex = new THREE.CanvasTexture(bannerCanvas);
    const bannerGeo = new THREE.PlaneGeometry(archSpan * 0.8, 1.2);
    const bannerMat = new THREE.MeshStandardMaterial({
      map: bannerTex,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 0.15,
      side: THREE.DoubleSide,
    });
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(gP.x, gP.y + postHeight - 1.2, gP.z);
    // Face against the track tangent (so drivers read it as they approach)
    banner.lookAt(gP.x - gTangent.x, gP.y + postHeight - 1.2, gP.z - gTangent.z);
    group.add(banner);

    // Emissive gantry lights (green)
    for (let li = 0; li < 4; li++) {
      const frac = (li + 0.5) / 4;
      const lx = gP.x + gRight.x * (frac - 0.5) * archSpan * 0.9;
      const lz = gP.z + gRight.z * (frac - 0.5) * archSpan * 0.9;
      const lightGeo = new THREE.SphereGeometry(0.12, 8, 8);
      const lightMat = new THREE.MeshStandardMaterial({
        color: 0x00ff44,
        emissive: new THREE.Color(0x00ff44),
        emissiveIntensity: 2,
      });
      const lightMesh = new THREE.Mesh(lightGeo, lightMat);
      lightMesh.position.set(lx, gP.y + postHeight + 0.15, lz);
      group.add(lightMesh);
    }

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
      _m.setPosition(x, 0.15 + s * 0.3, z);
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
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 256, 86);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    const slogans = ['OBEY', 'CONSUME', 'SUBMIT', 'CONFORM', 'STAY ASLEEP', 'NO THOUGHT', 'MARRY AND\nREPRODUCE', 'BUY', 'WATCH TV', 'DO NOT\nQUESTION', 'OBEY', 'CONSUME'];
    const msg = slogans[i % slogans.length];
    if (msg.includes('\n')) {
      const lines = msg.split('\n');
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(lines[0], 128, 40);
      ctx.fillText(lines[1], 128, 68);
    } else {
      ctx.fillText(msg, 128, 55);
    }
    // Border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 78);

    const adTex = new THREE.CanvasTexture(canvas);
    const adMat = new THREE.MeshStandardMaterial({
      map: adTex,
      emissive: new THREE.Color('#333333'),
      emissiveIntensity: 0.5,
    });

    const board = new THREE.Mesh(adGeo.clone(), adMat);
    board.position.set(x, 2.5, z);
    // Face approaching drivers: orient to road tangent direction
    const facing = p.clone().add(tangent.clone().multiplyScalar(-10));
    board.lookAt(facing);
    group.add(board);
  }

  // ── Procedural Box Cityscape (InstancedMesh) ──
  // BoxGeometry buildings with procedural canvas facade atlas.
  // Per-face UVs: sides = tiled facade, roof = dark surface.
  // Emissive window glow, height-proportional widths, per-tile sizing.
  const isMobile = window.matchMedia('(pointer: coarse)').matches;
  const density = isMobile ? Math.min(T.buildingDensity ?? 1.0, 0.5) : (T.buildingDensity ?? 1.0);
  const rowCount = isMobile ? 1 : Math.min(3, Math.max(1, T.buildingRowCount ?? 2));
  const gapChance = isMobile ? Math.max(T.buildingGapChance ?? 0.15, 0.3) : (T.buildingGapChance ?? 0.15);

  // ── AI-generated facade atlas (8×4 = 32 tiles, high-resolution PNGs) ──
  const ATLAS_COLS = 8, ATLAS_ROWS = 4;

  // Each environment has its own AI-generated atlas with photorealistic textures
  const STYLE_ATLAS: Record<string, string> = {
    modern:       '/buildings/facade_atlas_dc.png',
    adobe:        '/buildings/facade_atlas_mojave.png',
    beach_house:  '/buildings/facade_atlas_havana.png',
    cyberpunk:    '/buildings/facade_atlas_shibuya.png',
    weathered:    '/buildings/facade_atlas_weathered.png',
    chalet:       '/buildings/facade_atlas_zermatt.png',
    warehouse:    '/buildings/facade_atlas_warehouse.png',
    concrete:     '/buildings/facade_atlas_dc.png',       // reuse DC's concrete/glass
    bamboo_lodge: '/buildings/facade_atlas_zermatt.png',  // reuse Zermatt's wood/stone
  };

  const styleName = T.buildingStyle ?? 'modern';
  const atlasPath = STYLE_ATLAS[styleName] ?? '/buildings/facade_atlas_dc.png';
  const atlasTexture = new THREE.TextureLoader().load(atlasPath);
  atlasTexture.wrapS = THREE.RepeatWrapping;
  atlasTexture.wrapT = THREE.RepeatWrapping;
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  // Atlas layout: Row 0=windows, Row 1=walls, Row 2=ground floor, Row 3=trim/caps
  // Each row has 8 style variants (columns 0-7)
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
  interface BoxPlacement { x: number; z: number; w: number; h: number; d: number; rotY: number; tile: number; }

  const totalLength = spline.getLength();
  const sampleSpacing = Math.max(15, 30 / density);
  const totalSamples = Math.floor(totalLength / sampleSpacing);
  const MAX_PLACEMENTS = isMobile ? 60 : 400;

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
        // Pick a style variant column (0-3) deterministically from position
        const variant = ((Math.abs(Math.round(px * 73 + pz * 137))) & 0xFF) % VARIANT_COUNT;

        // Height from variant-specific range
        const [hMin, hMax] = VARIANT_HEIGHT[variant];
        const h = hMin + rng() * (hMax - hMin);
        const w = 8 + rng() * 10;
        const d = 8 + rng() * 10;

        const rotY = Math.atan2(tan.x, tan.z) + (side > 0 ? Math.PI : 0) + (rng() - 0.5) * 0.3;
        placements.push({ x: px, z: pz, w, h, d, rotY, tile: variant });
      }
    }
  }

  // Build InstancedMesh from placements
  if (placements.length > 0) {
    const tileW = 1 / ATLAS_COLS, tileH = 1 / ATLAS_ROWS;

    // Build a box with subdivided faces for facade tiling
    // Each face subdivision maps to the FULL tile sub-region, giving proper repetition
    // buildComposedBox: vertical facade composition
    // Multi-story: ground (Row 0) → mid repeating (Row 1) → roof cap (Row 2)
    // Single-story (repV ≤ 1): uses singleTile (Row 3) for entire face
    const buildComposedBox = (
      groundTile: number, midTile: number, roofCapTile: number,
      singleTile: number, flipU: boolean,
      repFB: number, repLR: number, repV: number,
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

      // Roof UV (flat top face) — uses roof cap tile
      const roofUVs = tileUV(roofCapTile);

      const addFlatFace = (
        origin: [number, number, number],
        axisU: [number, number, number],
        axisV: [number, number, number],
        isRoof: boolean,
      ) => {
        const baseIdx = positions.length / 3;
        for (let r = 0; r <= 1; r++) {
          for (let c = 0; c <= 1; c++) {
            positions.push(
              origin[0] + axisU[0] * c + axisV[0] * r,
              origin[1] + axisU[1] * c + axisV[1] * r,
              origin[2] + axisU[2] * c + axisV[2] * r,
            );
            if (isRoof) {
              uvs.push(roofUVs.uMin, roofUVs.vMin);
            } else {
              uvs.push(roofUVs.uMin, roofUVs.vMin);
            }
          }
        }
        indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
        indices.push(baseIdx + 1, baseIdx + 3, baseIdx + 2);
      };

      // addComposedFace: builds a wall face with ground/mid/roof zones
      const addComposedFace = (
        origin: [number, number, number],
        axisU: [number, number, number],
        axisV: [number, number, number],
        hRep: number, vRep: number,
      ) => {
        const isSingleStory = vRep <= 1;

        if (isSingleStory) {
          // Single-story: one tile covering the entire face
          const uv = tileUV(singleTile);
          const tW = uv.uMax - uv.uMin;
          const tH = uv.vMax - uv.vMin;
          const baseIdx = positions.length / 3;
          const cols = hRep;
          for (let r = 0; r <= 1; r++) {
            for (let c = 0; c <= cols; c++) {
              const u = c / cols;
              const v = r;
              positions.push(
                origin[0] + axisU[0] * u + axisV[0] * v,
                origin[1] + axisU[1] * u + axisV[1] * v,
                origin[2] + axisU[2] * u + axisV[2] * v,
              );
              const fracC = (c / cols) * hRep;
              let tU = fracC - Math.floor(fracC);
              if (c === cols) tU = 1.0;
              if (flipU) tU = 1 - tU;
              uvs.push(uv.uMin + tU * tW, uv.vMin + v * tH);
            }
          }
          for (let c = 0; c < cols; c++) {
            const i = baseIdx + c;
            indices.push(i, i + 1, i + cols + 1);
            indices.push(i + 1, i + cols + 2, i + cols + 1);
          }
          return;
        }

        // Multi-story: ground (1 band) + mid (repeating) + roof cap (1 band)
        // Vertical zones as fractions of total height:
        const groundFrac = 1 / vRep;         // bottom band
        const roofFrac = 1 / vRep;            // top band
        const midBands = Math.max(1, vRep - 2); // repeating middle
        const midFrac = 1 - groundFrac - roofFrac;

        // Zone definitions: [vStart, vEnd, tile, vRepeat]
        const zones: { vStart: number; vEnd: number; tile: number; vRepeats: number }[] = [];
        zones.push({ vStart: 0, vEnd: groundFrac, tile: groundTile, vRepeats: 1 });
        if (midBands > 0 && midFrac > 0) {
          zones.push({ vStart: groundFrac, vEnd: groundFrac + midFrac, tile: midTile, vRepeats: midBands });
        }
        zones.push({ vStart: 1 - roofFrac, vEnd: 1, tile: roofCapTile, vRepeats: 1 });

        const cols = hRep;

        for (const zone of zones) {
          const zUV = tileUV(zone.tile);
          const zTW = zUV.uMax - zUV.uMin;
          const zTH = zUV.vMax - zUV.vMin;
          const rows = zone.vRepeats;
          const baseIdx = positions.length / 3;

          for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
              const u = c / cols;
              const v = zone.vStart + (r / rows) * (zone.vEnd - zone.vStart);
              positions.push(
                origin[0] + axisU[0] * u + axisV[0] * v,
                origin[1] + axisU[1] * u + axisV[1] * v,
                origin[2] + axisU[2] * u + axisV[2] * v,
              );
              // Horizontal UV — sawtooth per hRep
              const fracC = (c / cols) * hRep;
              let tU = fracC - Math.floor(fracC);
              if (c === cols) tU = 1.0;
              // Vertical UV — sawtooth per zone vRepeats
              const fracR = (r / rows) * zone.vRepeats;
              let tV = fracR - Math.floor(fracR);
              if (r === rows) tV = 1.0;

              if (flipU) tU = 1 - tU;
              uvs.push(zUV.uMin + tU * zTW, zUV.vMin + tV * zTH);
            }
          }

          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const i = baseIdx + r * (cols + 1) + c;
              indices.push(i, i + 1, i + cols + 1);
              indices.push(i + 1, i + cols + 2, i + cols + 1);
            }
          }
        }
      };

      // 6 faces of a unit box centered at origin
      // Front (+Z)
      addComposedFace([-0.5, -0.5, 0.5], [1, 0, 0], [0, 1, 0], repFB, repV);
      // Back (-Z)
      addComposedFace([0.5, -0.5, -0.5], [-1, 0, 0], [0, 1, 0], repFB, repV);
      // Right (+X)
      addComposedFace([0.5, -0.5, 0.5], [0, 0, -1], [0, 1, 0], repLR, repV);
      // Left (-X)
      addComposedFace([-0.5, -0.5, -0.5], [0, 0, 1], [0, 1, 0], repLR, repV);
      // Top (+Y) — flat roof
      addFlatFace([-0.5, 0.5, 0.5], [1, 0, 0], [0, 0, -1], true);
      // Bottom (-Y)
      addFlatFace([-0.5, -0.5, -0.5], [1, 0, 0], [0, 0, 1], false);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    };

    // (tileGroups no longer needed — bucketing uses height only)

    // Material with emissive window glow + per-instance atlas column shader
    const windowGlow = T.windowLitChance ?? 0.5;
    const columnWidth = 1.0 / ATLAS_COLS; // 0.125 for 8-column atlas
    const buildingMat = new THREE.MeshStandardMaterial({
      map: atlasTexture,
      roughness: 0.75,
      metalness: 0.15,
      emissiveMap: atlasTexture,
      emissive: new THREE.Color(T.windowColor ?? 0xffcc66),
      emissiveIntensity: windowGlow * 0.4,
    });

    // Shader injection: per-instance atlas column + AO banding + interior mapping
    buildingMat.onBeforeCompile = (shader) => {
      shader.uniforms.colWidth = { value: columnWidth };

      // Vertex shader: pass atlasColumn, height, world position, and normal
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          attribute float atlasColumn;
          varying float vAtlasColumn;
          varying float vHeightFrac;
          varying vec3 vWPos;
          varying vec3 vWNormal;
        `)
        .replace('#include <uv_vertex>', `
          #include <uv_vertex>
          vAtlasColumn = atlasColumn;
          vHeightFrac = (position.y + 0.5);
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vWNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        `);

      // Fragment shader: atlas offset + AO + interior mapping
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          uniform float colWidth;
          varying float vAtlasColumn;
          varying float vHeightFrac;
          varying vec3 vWPos;
          varying vec3 vWNormal;

          // Simple hash for per-window interior color variation
          float hash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }

          // Interior mapping: ray-cast into virtual room behind wall
          vec3 interiorColor(vec3 worldPos, vec3 viewDir, vec3 wallNormal) {
            // Room grid: ~4m wide, ~3.5m tall rooms
            float roomW = 4.0;
            float roomH = 3.5;
            float roomDepth = 3.0;

            // Find position within current room cell
            vec3 tangent = abs(wallNormal.y) > 0.9
              ? normalize(cross(wallNormal, vec3(1.0, 0.0, 0.0)))
              : normalize(cross(wallNormal, vec3(0.0, 1.0, 0.0)));
            vec3 bitangent = cross(wallNormal, tangent);

            float u = dot(worldPos, tangent);
            float v = worldPos.y;

            // Room cell coordinates
            vec2 roomCell = vec2(floor(u / roomW), floor(v / roomH));
            float roomU = fract(u / roomW);
            float roomV = fract(v / roomH);

            // Ray direction in room space
            float dU = dot(viewDir, tangent);
            float dV = dot(viewDir, vec3(0.0, 1.0, 0.0));
            float dN = dot(viewDir, wallNormal);

            // Only trace if looking into the wall (dN < 0)
            if (dN >= 0.0) return vec3(0.05);

            // Find intersections with room walls
            float tBack = -roomDepth / dN;
            float tLeft = (dU > 0.0) ? ((1.0 - roomU) * roomW) / dU : (-roomU * roomW) / dU;
            float tRight = (dU < 0.0) ? ((1.0 - roomU) * roomW) / -dU : (-roomU * roomW) / -dU;
            float tFloor = (-roomV * roomH) / dV;
            float tCeil = ((1.0 - roomV) * roomH) / dV;

            float tMin = tBack;
            int hitFace = 0; // 0=back, 1=side, 2=floor, 3=ceiling
            if (tLeft > 0.0 && tLeft < tMin) { tMin = tLeft; hitFace = 1; }
            if (tFloor > 0.0 && tFloor < tMin) { tMin = tFloor; hitFace = 2; }
            if (tCeil > 0.0 && tCeil < tMin) { tMin = tCeil; hitFace = 3; }

            // Per-room deterministic variation
            float roomHash = hash21(roomCell);

            // Room interior colors based on which surface was hit
            vec3 backWall, sideWall, floorCol, ceilCol;

            if (roomHash < 0.3) {
              // Warm lit office
              backWall = vec3(0.85, 0.78, 0.65);
              sideWall = vec3(0.75, 0.68, 0.55);
              floorCol = vec3(0.45, 0.35, 0.25);
              ceilCol  = vec3(0.92, 0.90, 0.85);
            } else if (roomHash < 0.6) {
              // Cool blue office
              backWall = vec3(0.65, 0.72, 0.82);
              sideWall = vec3(0.55, 0.62, 0.72);
              floorCol = vec3(0.35, 0.35, 0.40);
              ceilCol  = vec3(0.88, 0.90, 0.92);
            } else if (roomHash < 0.8) {
              // Dark empty room
              backWall = vec3(0.15, 0.13, 0.12);
              sideWall = vec3(0.12, 0.10, 0.09);
              floorCol = vec3(0.08, 0.07, 0.06);
              ceilCol  = vec3(0.18, 0.16, 0.15);
            } else {
              // Warm lamp glow
              backWall = vec3(0.90, 0.75, 0.50);
              sideWall = vec3(0.80, 0.65, 0.40);
              floorCol = vec3(0.50, 0.38, 0.22);
              ceilCol  = vec3(0.95, 0.90, 0.80);
            }

            vec3 col;
            if (hitFace == 0) col = backWall;
            else if (hitFace == 1) col = sideWall;
            else if (hitFace == 2) col = floorCol;
            else col = ceilCol;

            // Depth-based darkening (further = darker)
            float depth = tMin / (roomDepth * 2.0);
            col *= mix(1.0, 0.4, clamp(depth, 0.0, 1.0));

            return col;
          }
        `)
        .replace('#include <map_fragment>', `
          #ifdef USE_MAP
            vec2 atlasUV = vMapUv;
            atlasUV.x = atlasUV.x + vAtlasColumn * colWidth;
            vec4 sampledDiffuseColor = texture2D(map, atlasUV);

            float camDist = length(vWPos - cameraPosition);
            float interiorFade = 1.0 - smoothstep(40.0, 60.0, camDist);
            bool isWallFace = abs(vWNormal.y) < 0.3;
            bool isMidZone = vHeightFrac > 0.15 && vHeightFrac < 0.85;

            if (interiorFade > 0.01 && isWallFace && isMidZone) {
              float texLum = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
              if (texLum < 0.15) {
                vec3 viewDir = normalize(vWPos - cameraPosition);
                vec3 roomCol = interiorColor(vWPos, viewDir, vWNormal);
                sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, roomCol, interiorFade);
              }
            }

            diffuseColor *= sampledDiffuseColor;
          #endif
        `)
        .replace('#include <emissivemap_fragment>', `
          #ifdef USE_EMISSIVEMAP
            vec2 emUV = vMapUv;
            emUV.x = emUV.x + vAtlasColumn * colWidth;
            vec4 emissiveColor = texture2D(emissiveMap, emUV);

            float emCamDist = length(vWPos - cameraPosition);
            float emFade = 1.0 - smoothstep(40.0, 60.0, emCamDist);
            float emLum = dot(emissiveColor.rgb, vec3(0.299, 0.587, 0.114));
            bool isEmWall = abs(vWNormal.y) < 0.3;
            bool isEmMid = vHeightFrac > 0.15 && vHeightFrac < 0.85;
            if (emFade > 0.01 && isEmWall && isEmMid && emLum < 0.15) {
              totalEmissiveRadiance *= mix(emissiveColor.rgb, vec3(0.9, 0.7, 0.4) * 0.6, emFade);
            } else {
              totalEmissiveRadiance *= emissiveColor.rgb;
            }
          #endif
          float ao = smoothstep(0.0, 0.12, vHeightFrac) *
                     mix(1.0, 0.88, smoothstep(0.85, 1.0, vHeightFrac));
          diffuseColor.rgb *= ao;
        `);
    };

    const dummy = new THREE.Object3D();
    const _instances: THREE.Vector3[] = [];

    // Group placements by HEIGHT BUCKET only (column picked per-instance in shader)
    const HEIGHT_BUCKET_SIZE = 10;
    const heightBuckets = new Map<number, BoxPlacement[]>();
    for (const pl of placements) {
      const hBucket = Math.floor(pl.h / HEIGHT_BUCKET_SIZE);
      const arr = heightBuckets.get(hBucket) ?? [];
      arr.push(pl);
      heightBuckets.set(hBucket, arr);
    }

    for (const [, bucketPlacements] of heightBuckets) {
      if (bucketPlacements.length === 0) continue;

      // Compute average dimensions for this height bucket
      const avgW = bucketPlacements.reduce((s, p) => s + p.w, 0) / bucketPlacements.length;
      const avgH = bucketPlacements.reduce((s, p) => s + p.h, 0) / bucketPlacements.length;
      const avgD = bucketPlacements.reduce((s, p) => s + p.d, 0) / bucketPlacements.length;
      const repFB = Math.max(1, Math.round(avgW / 8));
      const repLR = Math.max(1, Math.round(avgD / 8));
      const repV  = Math.max(1, Math.round(avgH / 8));

      // Tile mapping for new atlas layout:
      //   Row 0 = window variants (wall+window combined — used for mid-floors)
      //   Row 1 = wall surfaces (pure wall — used for side faces/fill)
      //   Row 2 = ground floor variants (shops, doors, lobbies)
      //   Row 3 = trim/cap variants (cornices, parapets, rooftops)
      const groundTile  = 2 * ATLAS_COLS + 0; // Row 2 = ground floor
      const midTile     = 0 * ATLAS_COLS + 0; // Row 0 = windows (repeating mid-floor)
      const roofCapTile = 3 * ATLAS_COLS + 0; // Row 3 = trim/caps
      const singleTile  = 0 * ATLAS_COLS + 0; // Row 0 = windows (for single-story)

      const geo0 = buildComposedBox(groundTile, midTile, roofCapTile, singleTile, false, repFB, repLR, repV);
      const geo1 = buildComposedBox(groundTile, midTile, roofCapTile, singleTile, true,  repFB, repLR, repV);

      // Split placements into 2 visual variants
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

        // Per-instance atlas column attribute (shader reads this to offset UVs)
        const columnAttr = new Float32Array(bucket.length);

        for (let j = 0; j < bucket.length; j++) {
          const pl = bucket[j];
          dummy.position.set(pl.x, pl.h / 2 - 2, pl.z);
          dummy.scale.set(pl.w, pl.h, pl.d);

          // Per-environment silhouette variation
          const hash = ((pl.x * 73 + pl.z * 137) & 0xFF) / 255; // deterministic 0-1
          if (styleName === 'beach_house' || styleName === 'weathered') {
            // Havana/weathered: subtle random lean (±2°) — crumbling colonial feel
            const leanX = (hash - 0.5) * 0.07;  // ±2° in radians
            const leanZ = (((pl.x * 31 + pl.z * 97) & 0xFF) / 255 - 0.5) * 0.05;
            dummy.rotation.set(leanX, pl.rotY, leanZ);
          } else if (styleName === 'cyberpunk' && pl.h > 25) {
            // Shibuya tall towers: slight taper (narrower at top) for megastructure feel
            const taper = 0.92 + hash * 0.08; // 92-100% width at top
            dummy.scale.set(pl.w * taper, pl.h, pl.d * taper);
            dummy.rotation.set(0, pl.rotY, 0);
          } else {
            dummy.rotation.set(0, pl.rotY, 0);
          }
          dummy.updateMatrix();
          instancedMesh.setMatrixAt(j, dummy.matrix);

          // Per-instance atlas column (variant 0-3 from placement)
          columnAttr[j] = pl.tile;

          // Per-instance color from environment buildingPalette
          const palette = T.buildingPalette;
          const palIdx = ((pl.x * 73 + pl.z * 137) & 0xFF) % palette.length;
          const palColor = new THREE.Color(palette[palIdx]);
          // Add ±10% luminance variation
          const lum = 0.9 + (((pl.x * 31 + pl.z * 97) & 0xFF) / 255) * 0.2;
          _c.setRGB(palColor.r * lum, palColor.g * lum, palColor.b * lum);
          instancedMesh.setColorAt(j, _c);
          _instances.push(new THREE.Vector3(pl.x, 0, pl.z));
        }
        instancedMesh.instanceMatrix.needsUpdate = true;
        if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
        // Attach per-instance atlas column attribute
        instancedMesh.geometry.setAttribute(
          'atlasColumn',
          new THREE.InstancedBufferAttribute(columnAttr, 1),
        );
        group.add(instancedMesh);
      }
    }

    _buildingInstances = _instances;
    _buildingInstancedMeshes = [];
    group.children.forEach((child: THREE.Object3D) => {
      if ((child as THREE.InstancedMesh).isInstancedMesh) {
        _buildingInstancedMeshes.push(child as THREE.InstancedMesh);
      }
    });

    // ── Phase 4: Peaked roof caps for chalet-style buildings (Zermatt) ──
    if (styleName === 'chalet' || styleName === 'bamboo_lodge') {
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
        dummy.position.set(pl.x, pl.h - 2, pl.z);
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
    if (styleName === 'cyberpunk') {
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
          dummy.position.set(pl.x, pl.h - 2 + setbackH / 2, pl.z);
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

    // ── Ground-level awnings / canopies ──
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
    // ~30% of buildings get awnings
    const awningPlacements = placements.filter(pl => ((pl.x * 53 + pl.z * 79) & 0xFF) < 77);
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
          1.5,
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
    // Skip for chalets (peaked roofs) and very short buildings
    if (styleName !== 'chalet' && styleName !== 'bamboo_lodge') {
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
          dummy.position.set(pl.x + offX, pl.h - 2 + propH / 2, pl.z + offZ);
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


  // ── Grandstand at start/finish (GLB model) ──
  {
    const startP = spline.getPointAt(0);
    const startTan = spline.getTangentAt(0).normalize();
    const right = new THREE.Vector3(startTan.z, 0, -startTan.x);
    const grandstandOffset = ROAD_WIDTH / 2 + 6;

    const grandstandGLB = T.grandstandModel ? `/buildings/${T.grandstandModel}` : '/buildings/spectator_stand.glb';
    const grandstandTargetWidth = T.grandstandModel ? 20 : 8; // landmarks need more room

    _asyncLoads.push(loadGLB(grandstandGLB).then((standModel) => {
      const bbox = new THREE.Box3().setFromObject(standModel);
      const size = bbox.getSize(new THREE.Vector3());
      const targetWidth = grandstandTargetWidth;
      const scaleFactor = targetWidth / Math.max(size.x, size.z, 1);
      standModel.scale.setScalar(scaleFactor);

      // Recompute after scaling
      const scaledBox = new THREE.Box3().setFromObject(standModel);
      standModel.position.set(
        startP.x + right.x * grandstandOffset,
        -scaledBox.min.y, // sit on ground
        startP.z + right.z * grandstandOffset,
      );
      standModel.lookAt(startP);

      standModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).castShadow = true;
        }
      });

      group.add(standModel);
    }).catch((err) => {
      console.warn('Failed to load spectator stand model:', err);
    }));
  }

  // ── Environment-specific landmarks (e.g. DC monuments) ──
  // Landmarks are placed prominently near the road with a clearance zone
  // so buildings don't obscure them.
  const _landmarkPositions: THREE.Vector3[] = []; // stored for building exclusion
  if (T.landmarks?.length) {
    const landmarkCount = T.landmarks.length;
    for (let li = 0; li < landmarkCount; li++) {
      const landmarkFile = T.landmarks[li];
      // Space landmarks evenly around the track (skip start/finish area)
      const lmT = (0.15 + (li / landmarkCount) * 0.7) % 1;
      const lmP = spline.getPointAt(lmT);
      const lmTan = spline.getTangentAt(lmT).normalize();
      const lmRight = new THREE.Vector3(lmTan.z, 0, -lmTan.x);
      const lmSide = li % 2 === 0 ? 1 : -1; // alternate sides
      const lmOffset = 22 + rng() * 6; // 22-28 units from center — close enough to see

      _asyncLoads.push(loadGLB(`/buildings/${landmarkFile}`).then((model) => {
        const bbox = new THREE.Box3().setFromObject(model);
        const size = bbox.getSize(new THREE.Vector3());
        // Scale landmark to ~25 world units wide (prominent, not oversized)
        const targetW = 25;
        const sf = targetW / Math.max(size.x, size.z, 1);
        model.scale.setScalar(sf);

        // Recompute bounding box after scaling to find ground offset
        const scaledBox = new THREE.Box3().setFromObject(model);
        const pos = new THREE.Vector3(
          lmP.x + lmRight.x * lmOffset * lmSide,
          -scaledBox.min.y - 2, // sit on ground plane matching building base (y=-2)
          lmP.z + lmRight.z * lmOffset * lmSide,
        );
        model.position.copy(pos);
        // Face the road using Y-axis rotation only (no tilt — keeps monuments upright)
        const toRoad = Math.atan2(lmP.x - pos.x, lmP.z - pos.z);
        model.rotation.set(0, toRoad, 0);

        // Store for building exclusion zone
        _landmarkPositions.push(pos);

        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            (child as THREE.Mesh).castShadow = true;
          }
        });

        group.add(model);
      }).catch((err) => {
        console.warn(`Failed to load landmark ${landmarkFile}:`, err);
      }));
    }
  }

  // ── Road direction chevrons (double-chevron decals along track) ──
  const CHEVRON_COUNT = 24;
  const chevronCanvas = document.createElement('canvas');
  chevronCanvas.width = 64; chevronCanvas.height = 128;
  {
    const ctx = chevronCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 128);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // First chevron (upper)
    ctx.beginPath();
    ctx.moveTo(12, 50);
    ctx.lineTo(32, 16);
    ctx.lineTo(52, 50);
    ctx.stroke();
    // Second chevron (lower)
    ctx.beginPath();
    ctx.moveTo(12, 90);
    ctx.lineTo(32, 56);
    ctx.lineTo(52, 90);
    ctx.stroke();
  }
  const chevronTex = new THREE.CanvasTexture(chevronCanvas);
  const chevronGeo = new THREE.PlaneGeometry(2.5, 5);
  const chevronMat = new THREE.MeshStandardMaterial({
    map: chevronTex,
    transparent: true,
    depthWrite: false,
    roughness: 0.8,
    emissive: 0xffffff,
    emissiveIntensity: 0.15,
  });

  for (let i = 0; i < CHEVRON_COUNT; i++) {
    const t = (i + 0.5) / CHEVRON_COUNT;
    const p = spline.getPointAt(t);
    const tangent = spline.getTangentAt(t).normalize();
    const chevron = new THREE.Mesh(chevronGeo, chevronMat);
    chevron.position.copy(p);
    chevron.position.y += 0.04;
    const rightVec = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
    chevron.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(rightVec, new THREE.Vector3(0, 1, 0), tangent)
    );
    chevron.rotateX(-Math.PI / 2);
    group.add(chevron);
  }

  // ── Distant mountain silhouettes (1 merged draw call) ──
  if (T.mountainHeight > 0) {
    const trackCenter = new THREE.Vector3();
    for (let t = 0; t < 1; t += 0.01) {
      trackCenter.add(spline.getPointAt(t));
    }
    trackCenter.multiplyScalar(0.01);

    const mountainGeos: THREE.BufferGeometry[] = [];
    const MOUNTAIN_COUNT = 24;
    const MOUNTAIN_RADIUS = 500;

    for (let i = 0; i < MOUNTAIN_COUNT; i++) {
      const angle = (i / MOUNTAIN_COUNT) * Math.PI * 2;
      const cx = trackCenter.x + Math.cos(angle) * MOUNTAIN_RADIUS;
      const cz = trackCenter.z + Math.sin(angle) * MOUNTAIN_RADIUS;

      // Generate jagged mountain profile (12 points)
      const PROFILE_PTS = 12;
      const mtnWidth = 60 + rng() * 40;
      const mtnHeight = (15 + rng() * 30) * T.mountainHeight;
      const vertices: number[] = [];
      const indices: number[] = [];

      // Bottom-left corner
      vertices.push(-mtnWidth / 2, 0, 0);
      for (let p = 0; p < PROFILE_PTS; p++) {
        const px = -mtnWidth / 2 + (mtnWidth * (p + 0.5)) / PROFILE_PTS;
        // Height profile: base sine + noise jitter
        const hNorm = 1 - Math.abs((p + 0.5) / PROFILE_PTS - 0.5) * 2; // peak at center
        const py = mtnHeight * hNorm * (0.7 + rng() * 0.6);
        vertices.push(px, py, 0);
      }
      // Bottom-right corner
      vertices.push(mtnWidth / 2, 0, 0);

      // Triangulate: fan from each profile point
      const totalVerts = PROFILE_PTS + 2;
      for (let p = 0; p < totalVerts - 1; p++) {
        if (p === 0) {
          indices.push(0, 1, totalVerts - 1);
        } else {
          indices.push(0, p, p + 1);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setIndex(indices);

      // Transform: rotate to face center and position
      const facingAngle = angle + Math.PI; // face inward
      const matrix = new THREE.Matrix4()
        .makeRotationY(facingAngle)
        .setPosition(cx, trackCenter.y - 25, cz);
      geo.applyMatrix4(matrix);

      mountainGeos.push(geo);
    }

    if (mountainGeos.length > 0) {
      const mergedGeo = mergeGeometries(mountainGeos);
      if (mergedGeo) {
        const mtnMat = new THREE.MeshBasicMaterial({
          color: T.mountainColor,
          fog: true,
          side: THREE.DoubleSide,
        });
        const mtnMesh = new THREE.Mesh(mergedGeo, mtnMat);
        group.add(mtnMesh);
      }
    }
  }

  // ── Billboard cloud sprites (InstancedMesh — 1 draw call) ──
  if (T.cloudOpacity > 0) {
    const CLOUD_COUNT = Math.round(40 * Math.min(T.cloudOpacity * 2, 2));
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = 64;
    cloudCanvas.height = 64;
    const ctx = cloudCanvas.getContext('2d')!;

    // Procedural soft cloud texture (radial gradient with noise perturbation)
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    const ct = new THREE.Color(T.cloudTint);
    const r = Math.round(ct.r * 255), g = Math.round(ct.g * 255), b = Math.round(ct.b * 255);
    const a1 = T.cloudOpacity;
    grad.addColorStop(0, `rgba(${r},${g},${b},${a1})`);
    grad.addColorStop(0.4, `rgba(${r},${g},${b},${a1 * 0.5})`);
    grad.addColorStop(0.7, `rgba(${r},${g},${b},${a1 * 0.15})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const cloudTex = new THREE.CanvasTexture(cloudCanvas);
    const cloudGeo = new THREE.PlaneGeometry(30, 12);
    const cloudMat = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });

    const cloudIM = new THREE.InstancedMesh(cloudGeo, cloudMat, CLOUD_COUNT);

    const trackCenter = new THREE.Vector3();
    for (let t = 0; t < 1; t += 0.01) trackCenter.add(spline.getPointAt(t));
    trackCenter.multiplyScalar(0.01);

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 150 + rng() * 400;
      const x = trackCenter.x + Math.cos(angle) * radius;
      const z = trackCenter.z + Math.sin(angle) * radius;
      const y = 120 + rng() * 80;
      const scale = 0.6 + rng() * 0.8;

      _m.makeScale(scale, scale * (0.3 + rng() * 0.4), scale);
      _m.setPosition(x, y, z);
      cloudIM.setMatrixAt(i, _m);
    }
    cloudIM.instanceMatrix.needsUpdate = true;
    group.add(cloudIM);
  }

  // ── Spectator crowd (billboard sprites in grandstand) ──
  if (T.spectatorDensity > 0) {
    const SPEC_COUNT = Math.round(25 * T.spectatorDensity);
    const specCanvas = document.createElement('canvas');
    specCanvas.width = 32; specCanvas.height = 64;
    const sctx = specCanvas.getContext('2d')!;
    sctx.clearRect(0, 0, 32, 64);
    // Simple silhouette figure
    sctx.fillStyle = '#333333';
    sctx.beginPath();
    sctx.arc(16, 12, 8, 0, Math.PI * 2); // head
    sctx.fill();
    sctx.fillRect(10, 20, 12, 30); // body
    sctx.fillRect(6, 50, 8, 14); // left leg
    sctx.fillRect(18, 50, 8, 14); // right leg
    const specTex = new THREE.CanvasTexture(specCanvas);
    const specGeo = new THREE.PlaneGeometry(0.5, 1.2);
    const specMat = new THREE.MeshBasicMaterial({
      map: specTex, transparent: true, alphaTest: 0.3,
      side: THREE.DoubleSide,
    });
    const specIM = new THREE.InstancedMesh(specGeo, specMat, SPEC_COUNT);
    // Place in grandstand area near start/finish
    const startP = spline.getPointAt(0);
    const startTan = spline.getTangentAt(0).normalize();
    const sRight = new THREE.Vector3(startTan.z, 0, -startTan.x);
    const grandOff = ROAD_WIDTH / 2 + 8;
    for (let i = 0; i < SPEC_COUNT; i++) {
      const row = Math.floor(i / 5);
      const col = (i % 5) - 2;
      const sx = startP.x + sRight.x * (grandOff + row * 1.5) + startTan.x * col * 1.2;
      const sz = startP.z + sRight.z * (grandOff + row * 1.5) + startTan.z * col * 1.2;
      const sy = row * 0.8 + 0.8;
      _m.identity();
      _m.setPosition(sx, sy, sz);
      specIM.setMatrixAt(i, _m);
      // Vary colors
      _c.setHSL(rng(), 0.4 + rng() * 0.3, 0.3 + rng() * 0.3);
      specIM.setColorAt(i, _c);
    }
    specIM.instanceMatrix.needsUpdate = true;
    specIM.instanceColor!.needsUpdate = true;
    group.add(specIM);
  }

  // ── Road surface details: oil stains (InstancedMesh decals) ──
  {
    const STAIN_COUNT = 15;
    const stainCanvas = document.createElement('canvas');
    stainCanvas.width = 64; stainCanvas.height = 64;
    const stctx = stainCanvas.getContext('2d')!;
    stctx.clearRect(0, 0, 64, 64);
    const stGrad = stctx.createRadialGradient(32, 32, 0, 32, 32, 28);
    stGrad.addColorStop(0, 'rgba(0,0,0,0.15)');
    stGrad.addColorStop(0.5, 'rgba(0,0,0,0.08)');
    stGrad.addColorStop(1, 'rgba(0,0,0,0)');
    stctx.fillStyle = stGrad;
    stctx.fillRect(0, 0, 64, 64);
    const stainTex = new THREE.CanvasTexture(stainCanvas);
    const stainGeo = new THREE.PlaneGeometry(2.5, 2.5);
    const stainMat = new THREE.MeshStandardMaterial({
      map: stainTex, transparent: true, depthWrite: false, roughness: 0.3,
    });
    const stainIM = new THREE.InstancedMesh(stainGeo, stainMat, STAIN_COUNT);
    let stainIdx = 0;
    for (let i = 0; i < STAIN_COUNT; i++) {
      const t = rng();
      const p = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const rightV = new THREE.Vector3(tangent.z, 0, -tangent.x);
      const laneOff = (rng() - 0.5) * ROAD_WIDTH * 0.6;
      _m.makeRotationX(-Math.PI / 2);
      _m.setPosition(p.x + rightV.x * laneOff, p.y + 0.03, p.z + rightV.z * laneOff);
      stainIM.setMatrixAt(stainIdx++, _m);
    }
    stainIM.count = stainIdx;
    stainIM.instanceMatrix.needsUpdate = true;
    group.add(stainIM);
  }

  // ══════════════════════════════════════════════════════════════
  // PHASE 3 ENHANCEMENTS — Per-Environment Nuance
  // ══════════════════════════════════════════════════════════════

  // ── Accent Props (previously defined but never rendered) ──
  if (T.accentProps.length > 0) {
    for (const propId of T.accentProps) {
      const PROP_COUNT = propId === 'smokestack' || propId === 'wind_turbine' ? 4
        : propId === 'ceiling_panel' ? 20
        : propId === 'neon_strip' ? 25
        : 10;

      let propGeo: THREE.BufferGeometry;
      let propMat: THREE.Material;
      let yOffset = 0;
      let placementOffset = ROAD_WIDTH / 2 + 4;
      let scaleRange: [number, number] = [0.8, 1.3];

      switch (propId) {
        case 'traffic_cone': {
          propGeo = new THREE.ConeGeometry(0.15, 0.5, 8);
          propMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.7 });
          yOffset = 0.25;
          placementOffset = ROAD_WIDTH / 2 + 2;
          scaleRange = [0.9, 1.2];
          break;
        }
        case 'dumpster': {
          propGeo = new THREE.BoxGeometry(1.5, 1.2, 1.0);
          propMat = new THREE.MeshStandardMaterial({ color: 0x2a4a2a, roughness: 0.85 });
          yOffset = 0.6;
          placementOffset = ROAD_WIDTH / 2 + 5;
          scaleRange = [0.8, 1.1];
          break;
        }
        case 'cactus': {
          propGeo = new THREE.CylinderGeometry(0.2, 0.25, 2.5, 6);
          propMat = new THREE.MeshStandardMaterial({ color: 0x2a6a2a, roughness: 0.8 });
          yOffset = 1.25;
          placementOffset = ROAD_WIDTH / 2 + 6;
          scaleRange = [0.6, 1.8];
          break;
        }
        case 'palm_trunk': {
          propGeo = new THREE.CylinderGeometry(0.2, 0.3, 6, 6);
          propMat = new THREE.MeshStandardMaterial({ color: 0x664422, roughness: 0.9 });
          yOffset = 3;
          placementOffset = ROAD_WIDTH / 2 + 5;
          scaleRange = [0.8, 1.2];
          break;
        }
        case 'neon_strip': {
          propGeo = new THREE.BoxGeometry(0.08, 0.08, 3);
          propMat = new THREE.MeshStandardMaterial({
            color: 0xff00ff,
            emissive: new THREE.Color(0xff00ff),
            emissiveIntensity: 1.5,
            roughness: 0.1,
          });
          yOffset = 1.5;
          placementOffset = ROAD_WIDTH / 2 + BARRIER_THICKNESS + 0.3;
          scaleRange = [1, 1];
          break;
        }
        case 'debris': {
          propGeo = new THREE.IcosahedronGeometry(0.3, 0);
          propMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.95 });
          yOffset = 0.05;
          placementOffset = ROAD_WIDTH / 2 + 2;
          scaleRange = [0.4, 1.2];
          break;
        }
        case 'snow_bollard': {
          propGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6);
          propMat = new THREE.MeshStandardMaterial({ color: 0xff3333, roughness: 0.7 });
          yOffset = 0.6;
          placementOffset = ROAD_WIDTH / 2 + 2;
          scaleRange = [0.9, 1.1];
          break;
        }
        case 'tiki_torch': {
          propGeo = new THREE.CylinderGeometry(0.06, 0.08, 2.5, 6);
          propMat = new THREE.MeshStandardMaterial({ color: 0x553322, roughness: 0.85 });
          yOffset = 1.25;
          placementOffset = ROAD_WIDTH / 2 + 3;
          scaleRange = [0.9, 1.1];
          break;
        }
        case 'smokestack': {
          propGeo = new THREE.CylinderGeometry(0.8, 1.2, 15, 8);
          propMat = new THREE.MeshStandardMaterial({ color: 0x555550, roughness: 0.9, metalness: 0.2 });
          yOffset = 7.5;
          placementOffset = ROAD_WIDTH / 2 + 60;
          scaleRange = [0.7, 1.3];
          break;
        }
        case 'wind_turbine': {
          propGeo = new THREE.CylinderGeometry(0.3, 0.5, 18, 8);
          propMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.4, metalness: 0.3 });
          yOffset = 9;
          placementOffset = ROAD_WIDTH / 2 + 80;
          scaleRange = [0.8, 1.2];
          break;
        }
        case 'ceiling_panel': {
          propGeo = new THREE.PlaneGeometry(6, 6);
          propMat = new THREE.MeshStandardMaterial({
            color: 0x333338,
            emissive: new THREE.Color(0xffffff),
            emissiveIntensity: 0.15,
            side: THREE.DoubleSide,
          });
          yOffset = 10;
          placementOffset = ROAD_WIDTH / 2 - 2;
          scaleRange = [1, 1];
          break;
        }
        default:
          continue;
      }

      const propIM = new THREE.InstancedMesh(propGeo, propMat, PROP_COUNT);
      let propIdx = 0;

      for (let i = 0; i < PROP_COUNT; i++) {
        const t = (i + rng() * 0.5) / PROP_COUNT;
        const p = spline.getPointAt(t % 1);
        const tangent = spline.getTangentAt(t % 1).normalize();
        const rx = tangent.z, rz = -tangent.x;
        const side = i % 2 === 0 ? 1 : -1;
        const off = placementOffset + rng() * 5;
        const x = p.x + rx * off * side;
        const z = p.z + rz * off * side;
        const scale = scaleRange[0] + rng() * (scaleRange[1] - scaleRange[0]);

        if (propId === 'ceiling_panel') {
          // Ceiling panels face downward
          _m.makeRotationX(Math.PI / 2);
          _m.setPosition(x, yOffset, z);
        } else if (propId === 'neon_strip') {
          // Neon strips align with track direction
          const angle = Math.atan2(tangent.x, tangent.z);
          _m.makeRotationY(angle);
          _m.setPosition(x, yOffset, z);
          // Alternate colors
          const neonColors = [0xff00ff, 0x00ffff, 0xff4400, 0x44ff00];
          (propIM as THREE.InstancedMesh).setColorAt(propIdx, _c.setHex(neonColors[i % neonColors.length]));
        } else {
          _m.makeScale(scale, scale, scale);
          _m.setPosition(x, yOffset * scale - 2, z);
        }
        propIM.setMatrixAt(propIdx++, _m);
      }

      propIM.count = propIdx;
      propIM.instanceMatrix.needsUpdate = true;
      if (propIM.instanceColor) propIM.instanceColor.needsUpdate = true;
      group.add(propIM);

      // Add emissive top for tiki torches
      if (propId === 'tiki_torch') {
        const flameGeo = new THREE.SphereGeometry(0.12, 6, 4);
        const flameMat = new THREE.MeshStandardMaterial({
          color: 0xff8833,
          emissive: new THREE.Color(0xff6600),
          emissiveIntensity: 2.0,
        });
        const flameIM = new THREE.InstancedMesh(flameGeo, flameMat, propIdx);
        for (let i = 0; i < propIdx; i++) {
          const mat4 = new THREE.Matrix4();
          propIM.getMatrixAt(i, mat4);
          const pos = new THREE.Vector3();
          pos.setFromMatrixPosition(mat4);
          pos.y += 1.3;
          _m.identity();
          _m.setPosition(pos.x, pos.y, pos.z);
          flameIM.setMatrixAt(i, _m);
        }
        flameIM.instanceMatrix.needsUpdate = true;
        group.add(flameIM);
      }

      // Add reflective sphere top for snow bollards
      if (propId === 'snow_bollard') {
        const topGeo = new THREE.SphereGeometry(0.1, 6, 4);
        const topMat = new THREE.MeshStandardMaterial({
          color: 0xff0000,
          emissive: new THREE.Color(0xff0000),
          emissiveIntensity: 0.5,
        });
        const topIM = new THREE.InstancedMesh(topGeo, topMat, propIdx);
        for (let i = 0; i < propIdx; i++) {
          const mat4 = new THREE.Matrix4();
          propIM.getMatrixAt(i, mat4);
          const pos = new THREE.Vector3();
          pos.setFromMatrixPosition(mat4);
          pos.y += 0.65;
          _m.identity();
          _m.setPosition(pos.x, pos.y, pos.z);
          topIM.setMatrixAt(i, _m);
        }
        topIM.instanceMatrix.needsUpdate = true;
        group.add(topIM);
      }
    }
  }

  // ── Road Decals (per-environment surface details) ──
  const roadDecals = T.roadDecals ?? [];
  for (const decalType of roadDecals) {
    const COUNT = decalType === 'lane_paint' ? 20 : decalType === 'frost' ? 18 : 12;
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 64);

    let geoW = 2.5, geoH = 2.5;
    let matOpts: THREE.MeshStandardMaterialParameters = { transparent: true, depthWrite: false };

    switch (decalType) {
      case 'puddle': {
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
        grad.addColorStop(0, 'rgba(60,80,100,0.2)');
        grad.addColorStop(0.6, 'rgba(50,70,90,0.12)');
        grad.addColorStop(1, 'rgba(40,60,80,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        matOpts.roughness = 0.1;
        matOpts.metalness = 0.3;
        geoW = 3; geoH = 2;
        break;
      }
      case 'crack': {
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(32, 8); ctx.lineTo(28, 24); ctx.lineTo(36, 32);
        ctx.lineTo(30, 44); ctx.lineTo(34, 56);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(28, 24); ctx.lineTo(18, 32);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(36, 32); ctx.lineTo(46, 40);
        ctx.stroke();
        matOpts.roughness = 0.9;
        geoW = 2; geoH = 3;
        break;
      }
      case 'lane_paint': {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(24, 4, 16, 56);
        matOpts.roughness = 0.5;
        geoW = 0.4; geoH = 3;
        break;
      }
      case 'manhole': {
        ctx.strokeStyle = 'rgba(100,100,100,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(32, 32, 24, 0, Math.PI * 2);
        ctx.stroke();
        // Cross pattern
        ctx.beginPath();
        ctx.moveTo(32, 8); ctx.lineTo(32, 56);
        ctx.moveTo(8, 32); ctx.lineTo(56, 32);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(80,80,80,0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(32, 32, 16, 0, Math.PI * 2);
        ctx.stroke();
        matOpts.roughness = 0.4;
        matOpts.metalness = 0.5;
        geoW = 1.5; geoH = 1.5;
        break;
      }
      case 'frost': {
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 28);
        grad.addColorStop(0, 'rgba(200,220,240,0.15)');
        grad.addColorStop(0.5, 'rgba(180,200,220,0.08)');
        grad.addColorStop(1, 'rgba(160,180,200,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        matOpts.roughness = 0.15;
        matOpts.metalness = 0.4;
        geoW = 3.5; geoH = 2.5;
        break;
      }
      case 'sand_drift': {
        const grad = ctx.createLinearGradient(0, 0, 64, 32);
        grad.addColorStop(0, 'rgba(160,140,100,0)');
        grad.addColorStop(0.3, 'rgba(160,140,100,0.12)');
        grad.addColorStop(0.7, 'rgba(160,140,100,0.08)');
        grad.addColorStop(1, 'rgba(160,140,100,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);
        matOpts.roughness = 0.9;
        geoW = 4; geoH = 1.5;
        break;
      }
      default: continue;
    }

    const tex = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(geoW, geoH);
    const mat = new THREE.MeshStandardMaterial({ map: tex, ...matOpts });
    const im = new THREE.InstancedMesh(geo, mat, COUNT);
    let idx = 0;

    for (let i = 0; i < COUNT; i++) {
      const t = rng();
      const p = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const rightV = new THREE.Vector3(tangent.z, 0, -tangent.x);
      const laneOff = decalType === 'lane_paint'
        ? (i % 2 === 0 ? -1 : 1) * ROAD_WIDTH * 0.15
        : (rng() - 0.5) * ROAD_WIDTH * 0.6;
      const angle = Math.atan2(tangent.x, tangent.z);

      _m.makeRotationX(-Math.PI / 2);
      const rotY = new THREE.Matrix4().makeRotationZ(angle);
      _m.multiply(rotY);
      _m.setPosition(
        p.x + rightV.x * laneOff,
        p.y + 0.025,
        p.z + rightV.z * laneOff
      );
      im.setMatrixAt(idx++, _m);
    }
    im.count = idx;
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }

  // ── Atmospheric Micro-Effects (vertex-shader animated, zero CPU cost) ──
  const atmoEffects = T.atmosphericEffects ?? [];
  for (const fx of atmoEffects) {
    let fxCount = 60;
    let fxGeo: THREE.BufferGeometry;
    let fxMat: THREE.MeshStandardMaterial;
    let spreadRadius = 200;
    let yRange: [number, number] = [1, 8];

    switch (fx) {
      case 'fireflies': {
        fxCount = 80;
        fxGeo = new THREE.SphereGeometry(0.04, 4, 3);
        fxMat = new THREE.MeshStandardMaterial({
          color: 0xeeff44,
          emissive: new THREE.Color(0xeeff44),
          emissiveIntensity: 2.5,
        });
        spreadRadius = 150;
        yRange = [0.5, 4];
        break;
      }
      case 'leaves': {
        fxCount = 50;
        fxGeo = new THREE.PlaneGeometry(0.2, 0.12);
        fxMat = new THREE.MeshStandardMaterial({
          color: 0x886633,
          side: THREE.DoubleSide,
          roughness: 0.9,
        });
        spreadRadius = 180;
        yRange = [2, 12];
        break;
      }
      case 'steam': {
        fxCount = 25;
        fxGeo = new THREE.PlaneGeometry(1.2, 2.0);
        fxMat = new THREE.MeshStandardMaterial({
          color: 0xaaaaaa,
          transparent: true,
          opacity: 0.06,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        spreadRadius = 100;
        yRange = [0.5, 6];
        break;
      }
      case 'dust': {
        fxCount = 70;
        fxGeo = new THREE.SphereGeometry(0.03, 3, 2);
        fxMat = new THREE.MeshStandardMaterial({
          color: 0xccbb88,
          emissive: new THREE.Color(0xccbb88),
          emissiveIntensity: 0.3,
        });
        spreadRadius = 200;
        yRange = [0.3, 5];
        break;
      }
      case 'snow_extra': {
        fxCount = 100;
        fxGeo = new THREE.SphereGeometry(0.025, 3, 2);
        fxMat = new THREE.MeshStandardMaterial({
          color: 0xeeeeff,
          emissive: new THREE.Color(0xaabbcc),
          emissiveIntensity: 0.2,
        });
        spreadRadius = 200;
        yRange = [0.5, 15];
        break;
      }
      case 'embers': {
        fxCount = 35;
        fxGeo = new THREE.SphereGeometry(0.04, 4, 3);
        fxMat = new THREE.MeshStandardMaterial({
          color: 0xff6600,
          emissive: new THREE.Color(0xff4400),
          emissiveIntensity: 2.0,
        });
        spreadRadius = 120;
        yRange = [0.2, 8];
        break;
      }
      case 'fog_wisps': {
        fxCount = 15;
        fxGeo = new THREE.PlaneGeometry(10, 3);
        fxMat = new THREE.MeshStandardMaterial({
          color: T.barrierColor,
          transparent: true,
          opacity: 0.04,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: true,
        });
        spreadRadius = 250;
        yRange = [-1, 2];
        break;
      }
      default: continue;
    }

    // Inject vertex-shader animation for floating/drifting
    fxMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = { value: 0 };
      shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 wp = instanceMatrix * vec4(transformed, 1.0);
         float hash = fract(sin(wp.x * 127.1 + wp.z * 311.7) * 43758.5);
         float bobY = sin(uWindTime * (0.8 + hash) + hash * 6.28) * 0.3;
         float driftX = sin(uWindTime * 0.3 + hash * 12.0) * 0.5;
         float driftZ = cos(uWindTime * 0.25 + hash * 8.0) * 0.4;
         transformed.x += driftX;
         transformed.y += bobY;
         transformed.z += driftZ;`
      );
      _windShaders.set(fxMat, shader as unknown as WindShaderRef);
    };

    const fxIM = new THREE.InstancedMesh(fxGeo, fxMat, fxCount);

    // Compute track center for spread
    const tc = new THREE.Vector3();
    for (let t = 0; t < 1; t += 0.02) tc.add(spline.getPointAt(t));
    tc.multiplyScalar(0.02);

    for (let i = 0; i < fxCount; i++) {
      // Spread particles around the track
      const t = rng();
      const p = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const rx = tangent.z, rz = -tangent.x;
      const side = rng() > 0.5 ? 1 : -1;
      const off = ROAD_WIDTH / 2 + rng() * spreadRadius * 0.5;
      const x = p.x + rx * off * side;
      const z = p.z + rz * off * side;
      const y = yRange[0] + rng() * (yRange[1] - yRange[0]);

      _m.identity();
      if (fx === 'fog_wisps' || fx === 'steam' || fx === 'leaves') {
        _m.makeRotationY(rng() * Math.PI * 2);
      }
      _m.setPosition(x, y, z);
      fxIM.setMatrixAt(i, _m);
    }
    fxIM.instanceMatrix.needsUpdate = true;
    group.add(fxIM);

    // Store material ref for wind time updates
    getGroupData(group).fxMats.push(fxMat);
  }

  // ── Ambient Lighting Accents ──
  const ambientLights = T.ambientLights ?? [];
  for (const lightType of ambientLights) {
    switch (lightType) {
      case 'window_spill': {
        // Warm light rectangles at building bases
        const spillCount = 8;
        const spillGeo = new THREE.PlaneGeometry(2, 3);
        const spillCanvas = document.createElement('canvas');
        spillCanvas.width = 32; spillCanvas.height = 64;
        const sctx = spillCanvas.getContext('2d')!;
        const spillGrad = sctx.createLinearGradient(0, 0, 0, 64);
        spillGrad.addColorStop(0, 'rgba(255,200,100,0.08)');
        spillGrad.addColorStop(1, 'rgba(255,200,100,0)');
        sctx.fillStyle = spillGrad;
        sctx.fillRect(0, 0, 32, 64);
        const spillTex = new THREE.CanvasTexture(spillCanvas);
        const spillMat = new THREE.MeshBasicMaterial({
          map: spillTex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const spillIM = new THREE.InstancedMesh(spillGeo, spillMat, spillCount);
        for (let i = 0; i < spillCount; i++) {
          const t = rng();
          const p = spline.getPointAt(t);
          const tangent = spline.getTangentAt(t).normalize();
          const rx = tangent.z, rz = -tangent.x;
          const side = i % 2 === 0 ? 1 : -1;
          const off = ROAD_WIDTH / 2 + 50 + rng() * 40;
          const x = p.x + rx * off * side;
          const z = p.z + rz * off * side;
          _m.identity();
          _m.setPosition(x, 0.5, z);
          spillIM.setMatrixAt(i, _m);
        }
        spillIM.instanceMatrix.needsUpdate = true;
        group.add(spillIM);
        break;
      }
      case 'hazard_flasher': {
        // Blinking orange spheres on barriers
        const hazCount = 15;
        const hazGeo = new THREE.SphereGeometry(0.1, 6, 4);
        const hazMat = new THREE.MeshStandardMaterial({
          color: 0xff8800,
          emissive: new THREE.Color(0xff6600),
          emissiveIntensity: 1.5,
        });
        // Pulse via onBeforeCompile
        hazMat.onBeforeCompile = (shader) => {
          shader.uniforms.uWindTime = { value: 0 };
          shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader;
          shader.fragmentShader = 'uniform float uWindTime;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
             vec4 hw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
             float blink = step(0.0, sin(uWindTime * 4.0 + hw.x * 3.0 + hw.z * 5.0));
             totalEmissiveRadiance *= blink;`
          );
          _windShaders.set(hazMat, shader as unknown as WindShaderRef);
        };
        const hazIM = new THREE.InstancedMesh(hazGeo, hazMat, hazCount);
        for (let i = 0; i < hazCount; i++) {
          const t = (i + 0.5) / hazCount;
          const p = spline.getPointAt(t);
          const tangent = spline.getTangentAt(t).normalize();
          const rx = tangent.z, rz = -tangent.x;
          const side = i % 2 === 0 ? 1 : -1;
          const off = ROAD_WIDTH / 2 + BARRIER_THICKNESS + 0.5;
          _m.identity();
          _m.setPosition(p.x + rx * off * side, 1.5, p.z + rz * off * side);
          hazIM.setMatrixAt(i, _m);
        }
        hazIM.instanceMatrix.needsUpdate = true;
        group.add(hazIM);
        getGroupData(group).fxMats.push(hazMat);
        break;
      }
      case 'neon_pool': {
        // Colored ground glow patches
        const poolCount = 6;
        const poolGeo = new THREE.PlaneGeometry(4, 4);
        const poolCanvas = document.createElement('canvas');
        poolCanvas.width = 64; poolCanvas.height = 64;
        const pctx = poolCanvas.getContext('2d')!;
        const poolGrad = pctx.createRadialGradient(32, 32, 0, 32, 32, 30);
        poolGrad.addColorStop(0, 'rgba(200,50,255,0.12)');
        poolGrad.addColorStop(0.5, 'rgba(100,0,200,0.05)');
        poolGrad.addColorStop(1, 'rgba(50,0,100,0)');
        pctx.fillStyle = poolGrad;
        pctx.fillRect(0, 0, 64, 64);
        const poolTex = new THREE.CanvasTexture(poolCanvas);
        const poolMat = new THREE.MeshBasicMaterial({
          map: poolTex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const poolIM = new THREE.InstancedMesh(poolGeo, poolMat, poolCount);
        const neonPoolColors = [0xcc44ff, 0x00ffff, 0xff0088, 0x44ff00, 0xff6600, 0x4488ff];
        for (let i = 0; i < poolCount; i++) {
          const t = rng();
          const p = spline.getPointAt(t);
          const tangent = spline.getTangentAt(t).normalize();
          const rx = tangent.z, rz = -tangent.x;
          const side = i % 2 === 0 ? 1 : -1;
          const off = ROAD_WIDTH / 2 + 20 + rng() * 30;
          _m.makeRotationX(-Math.PI / 2);
          _m.setPosition(p.x + rx * off * side, -1.8, p.z + rz * off * side);
          poolIM.setMatrixAt(i, _m);
          _c.setHex(neonPoolColors[i % neonPoolColors.length]);
          poolIM.setColorAt(i, _c);
        }
        poolIM.instanceMatrix.needsUpdate = true;
        poolIM.instanceColor!.needsUpdate = true;
        group.add(poolIM);
        break;
      }
      case 'neon_edge': {
        // Thin emissive strips on building edges
        const edgeCount = 16;
        const edgeGeo = new THREE.BoxGeometry(0.05, 1, 0.05);
        const edgeColors = [0xff00ff, 0x00ffff, 0x4400ff, 0xff4400];
        const edgeMat = new THREE.MeshStandardMaterial({
          color: 0xff00ff,
          emissive: new THREE.Color(0xff00ff),
          emissiveIntensity: 1.8,
        });
        const edgeIM = new THREE.InstancedMesh(edgeGeo, edgeMat, edgeCount);
        for (let i = 0; i < edgeCount; i++) {
          const t = rng();
          const p = spline.getPointAt(t);
          const tangent = spline.getTangentAt(t).normalize();
          const rx = tangent.z, rz = -tangent.x;
          const side = rng() > 0.5 ? 1 : -1;
          const off = ROAD_WIDTH / 2 + 50 + rng() * 50;
          const h = 5 + rng() * 15;
          _m.makeScale(1, h, 1);
          _m.setPosition(p.x + rx * off * side, -5 + h / 2, p.z + rz * off * side);
          edgeIM.setMatrixAt(i, _m);
          _c.setHex(edgeColors[i % edgeColors.length]);
          edgeIM.setColorAt(i, _c);
        }
        edgeIM.instanceMatrix.needsUpdate = true;
        edgeIM.instanceColor!.needsUpdate = true;
        group.add(edgeIM);
        break;
      }
      case 'torch_glow': {
        // Warm orange ground glow near torches/smokestacks
        const glowCount = 8;
        const glowGeo = new THREE.PlaneGeometry(3, 3);
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = 64; glowCanvas.height = 64;
        const gctx2 = glowCanvas.getContext('2d')!;
        const glowGrad = gctx2.createRadialGradient(32, 32, 0, 32, 32, 30);
        glowGrad.addColorStop(0, 'rgba(255,120,30,0.1)');
        glowGrad.addColorStop(0.5, 'rgba(255,80,0,0.04)');
        glowGrad.addColorStop(1, 'rgba(200,50,0,0)');
        gctx2.fillStyle = glowGrad;
        gctx2.fillRect(0, 0, 64, 64);
        const glowTex = new THREE.CanvasTexture(glowCanvas);
        const glowMat = new THREE.MeshBasicMaterial({
          map: glowTex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const glowIM = new THREE.InstancedMesh(glowGeo, glowMat, glowCount);
        for (let i = 0; i < glowCount; i++) {
          const t = rng();
          const p = spline.getPointAt(t);
          const tangent = spline.getTangentAt(t).normalize();
          const rx = tangent.z, rz = -tangent.x;
          const side = i % 2 === 0 ? 1 : -1;
          const off = ROAD_WIDTH / 2 + 4 + rng() * 6;
          _m.makeRotationX(-Math.PI / 2);
          _m.setPosition(p.x + rx * off * side, -1.8, p.z + rz * off * side);
          glowIM.setMatrixAt(i, _m);
        }
        glowIM.instanceMatrix.needsUpdate = true;
        group.add(glowIM);
        break;
      }
    }
  }

  // Expose async load promises so race-lifecycle can await them
  // before showing the scene (prevents scenery popping in during flyover)
  group.userData._asyncLoads = _asyncLoads;

  return group;
}

/** Update tree wind sway time. Call once per frame from game loop. */
export function updateSceneryWind(sceneryGroup: THREE.Group | null, timestamp: number) {
  if (!sceneryGroup) return;
  const t = timestamp * 0.001;
  const data = _sceneryGroupData.get(sceneryGroup);
  if (!data) return;

  // Update crown material wind time
  if (data.crownMat) {
    const ws = _windShaders.get(data.crownMat);
    if (ws) ws.uniforms.uWindTime.value = t;
  }
  // Update atmospheric effects + ambient light shader time uniforms
  for (const mat of data.fxMats) {
    const ws = _windShaders.get(mat);
    if (ws) ws.uniforms.uWindTime.value = t;
  }
}

/**
 * Dispose ALL Three.js resources in a scenery group to prevent GPU memory leaks.
 * Must be called before discarding a scenery group (race restart, environment switch).
 */
export function destroyScenery(sceneryGroup: THREE.Group | null) {
  if (!sceneryGroup) return;

  sceneryGroup.traverse((child) => {
    // Dispose geometries
    if ((child as THREE.Mesh).geometry) {
      (child as THREE.Mesh).geometry.dispose();
    }

    // Dispose materials (single or array)
    const mesh = child as THREE.Mesh;
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        // Dispose any texture maps on the material
        if ((mat as THREE.MeshStandardMaterial).map) (mat as THREE.MeshStandardMaterial).map!.dispose();
        if ((mat as THREE.MeshStandardMaterial).emissiveMap) (mat as THREE.MeshStandardMaterial).emissiveMap!.dispose();
        if ((mat as THREE.MeshStandardMaterial).normalMap) (mat as THREE.MeshStandardMaterial).normalMap!.dispose();
        if ((mat as THREE.MeshStandardMaterial).roughnessMap) (mat as THREE.MeshStandardMaterial).roughnessMap!.dispose();
        if ((mat as THREE.MeshStandardMaterial).aoMap) (mat as THREE.MeshStandardMaterial).aoMap!.dispose();
        mat.dispose();
      }
    }

    // Dispose InstancedMesh instance attributes
    if ((child as THREE.InstancedMesh).isInstancedMesh) {
      const im = child as THREE.InstancedMesh;
      if (im.instanceMatrix) im.instanceMatrix.array = new Float32Array(0);
      if (im.instanceColor) im.instanceColor.array = new Float32Array(0);
    }

    // Dispose lights
    if ((child as THREE.Light).isLight) {
      (child as THREE.Light).dispose?.();
    }
  });

  // Clear stored shader refs
  _sceneryGroupData.delete(sceneryGroup);

  // Remove all children
  while (sceneryGroup.children.length > 0) {
    sceneryGroup.remove(sceneryGroup.children[0]);
  }
}
