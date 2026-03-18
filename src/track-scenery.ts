/* ── Hood Racer — Track Scenery Generation ── */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROAD_WIDTH, BARRIER_THICKNESS, estimateCurvature } from './track';

export function generateScenery(spline: THREE.CatmullRomCurve3, rng: () => number): THREE.Group {
  const group = new THREE.Group();

  // ── Ground plane (large flat grass surface) ──
  {
    const groundGeo = new THREE.PlaneGeometry(800, 800);
    // Procedural grass texture
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 256;
    groundCanvas.height = 256;
    const gctx = groundCanvas.getContext('2d')!;
    // Base grass color
    gctx.fillStyle = '#2a5a1a';
    gctx.fillRect(0, 0, 256, 256);
    // Subtle variation patches
    for (let i = 0; i < 200; i++) {
      const px = Math.random() * 256;
      const py = Math.random() * 256;
      const shade = Math.random() > 0.5 ? '#2e6420' : '#245216';
      gctx.fillStyle = shade;
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
    trees.push({ x, y: 0, z, trunkH: 2 + rng() * 3, crownR: 1.5 + rng() * 2, green: Math.floor(rng() * 255) });
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

    // ── Tree crowns (InstancedMesh with per-instance color + wind sway) ──
    const crownGeo = new THREE.SphereGeometry(2.0, 8, 6);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2a6d2a, roughness: 0.8 });

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
      (crownMat as any)._windShader = shader;
    };

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

    // Store crown material ref for wind time updates from game loop
    (group as any)._crownMat = crownMat;
  }

  // ── Enhancement 6: Ground cover grass patches (InstancedMesh — 1 draw call) ──
  {
    const GRASS_COUNT = 6000;

    // Procedural grass texture (canvas with blade silhouettes)
    const grassCanvas = document.createElement('canvas');
    grassCanvas.width = 32;
    grassCanvas.height = 32;
    const gctx = grassCanvas.getContext('2d')!;
    gctx.clearRect(0, 0, 32, 32);
    // Draw 4 blade silhouettes
    gctx.fillStyle = '#3a7a3a';
    for (let b = 0; b < 4; b++) {
      const bx = 6 + b * 6;
      gctx.beginPath();
      gctx.moveTo(bx, 30);
      gctx.lineTo(bx + 2, 30);
      gctx.lineTo(bx + 1 + (b % 2 ? 2 : -2), 4 + b * 2);
      gctx.closePath();
      gctx.fill();
    }
    const grassTex = new THREE.CanvasTexture(grassCanvas);

    // Cross-shaped geometry (2 intersecting planes for all-angle viewing)
    const halfW = 0.5, halfH = 0.7;
    const verts = new Float32Array([
      // Plane 1 (XY)
      -halfW, 0, 0,  halfW, 0, 0,  halfW, halfH * 2, 0,  -halfW, halfH * 2, 0,
      // Plane 2 (ZY, rotated 90°)
      0, 0, -halfW,  0, 0, halfW,  0, halfH * 2, halfW,  0, halfH * 2, -halfW,
    ]);
    const uvs = new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
    ]);
    const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    const grassGeo = new THREE.BufferGeometry();
    grassGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    grassGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    grassGeo.setIndex(idx);

    const grassMat = new THREE.MeshStandardMaterial({
      map: grassTex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.9,
    });

    const grassIM = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
    let grassIdx = 0;

    for (let i = 0; i < GRASS_COUNT && grassIdx < GRASS_COUNT; i++) {
      const t = rng();
      const p = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const rx = tangent.z, rz = -tangent.x;
      const side = rng() > 0.5 ? 1 : -1;
      const offset = ROAD_WIDTH / 2 + 2 + rng() * 50;
      const x = p.x + rx * offset * side;
      const z = p.z + rz * offset * side;
      const scale = 1.0 + rng() * 1.5;
      const rotY = rng() * Math.PI;

      _m.makeRotationY(rotY);
      _m.scale(new THREE.Vector3(scale, scale, scale));
      _m.setPosition(x, -0.3, z);
      grassIM.setMatrixAt(grassIdx, _m);

      // Vary grass color slightly
      _c.setHSL(0.28 + rng() * 0.08, 0.45 + rng() * 0.25, 0.2 + rng() * 0.2);
      grassIM.setColorAt(grassIdx, _c);
      grassIdx++;
    }

    if (grassIdx > 0) {
      grassIM.count = grassIdx;
      grassIM.instanceMatrix.needsUpdate = true;
      grassIM.instanceColor!.needsUpdate = true;
      group.add(grassIM);
    }
  }

  // ── Street lights (InstancedMesh — NO PointLights) ──
  const LIGHT_COUNT = 30;

  // Poles
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 6, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555566, metalness: 0.6, roughness: 0.3 });
  const poleIM = new THREE.InstancedMesh(poleGeo, poleMat, LIGHT_COUNT);

  // Fixtures (emissive glow — replaces PointLight)
  const fixGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const fixMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffdd66, emissiveIntensity: 0.8, roughness: 0.2 });
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
    _m.setPosition(x, 3, z);
    poleIM.setMatrixAt(i, _m);

    _m.setPosition(x, 6, z);
    fixIM.setMatrixAt(i, _m);

    // Add real PointLights to every 10th lamp for visible road illumination pools
    if (i % 10 === 0) {
      const light = new THREE.PointLight(0xffdd88, 1.5, 14, 2);
      light.position.set(x, 5.8, z);
      group.add(light);
    }
  }
  poleIM.instanceMatrix.needsUpdate = true;
  fixIM.instanceMatrix.needsUpdate = true;
  group.add(poleIM);
  group.add(fixIM);

  // ── Start/Finish line (road-conforming checkerboard + 3D gantry arch) ──
  {
    // ── 1. Road-conforming checkerboard strip ──
    // Build a narrow strip of quads at closely-spaced t-values around t=0,
    // using the same banked right/up vectors as the road mesh so the pattern
    // matches the road surface exactly.
    const STRIP_SAMPLES = 6;
    const STRIP_T_RANGE = 0.003; // t range around 0 in each direction
    const stripVerts: number[] = [];
    const stripUVs: number[] = [];
    const stripNormals: number[] = [];
    const stripIndices: number[] = [];
    const halfW = ROAD_WIDTH / 2;

    for (let i = 0; i <= STRIP_SAMPLES; i++) {
      const frac = i / STRIP_SAMPLES;
      const t = ((1 - frac) * (1 - STRIP_T_RANGE) + frac * STRIP_T_RANGE) % 1;
      // wrap-safe: at frac=0 → t≈0.997, at frac=1 → t=0.003 
      const p = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const right = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      const kappa = estimateCurvature(spline, t);
      const bankQuat = new THREE.Quaternion().setFromAxisAngle(tangent, -kappa * 2.5);
      const bankedRight = right.clone().applyQuaternion(bankQuat);
      const up = new THREE.Vector3().crossVectors(bankedRight, tangent).normalize();

      // Left edge
      stripVerts.push(
        p.x - bankedRight.x * halfW, p.y + 0.02 - bankedRight.y * halfW, p.z - bankedRight.z * halfW
      );
      // Right edge
      stripVerts.push(
        p.x + bankedRight.x * halfW, p.y + 0.02 + bankedRight.y * halfW, p.z + bankedRight.z * halfW
      );
      stripUVs.push(0, frac);
      stripUVs.push(1, frac);
      stripNormals.push(up.x, up.y, up.z, up.x, up.y, up.z);

      if (i < STRIP_SAMPLES) {
        const base = i * 2;
        stripIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }

    const stripGeo = new THREE.BufferGeometry();
    stripGeo.setAttribute('position', new THREE.Float32BufferAttribute(stripVerts, 3));
    stripGeo.setAttribute('uv', new THREE.Float32BufferAttribute(stripUVs, 2));
    stripGeo.setAttribute('normal', new THREE.Float32BufferAttribute(stripNormals, 3));
    stripGeo.setIndex(stripIndices);

    // Checkerboard canvas texture
    const checkerCanvas = document.createElement('canvas');
    checkerCanvas.width = 128; checkerCanvas.height = 32;
    const checkerCtx = checkerCanvas.getContext('2d')!;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 8; col++) {
        checkerCtx.fillStyle = (row + col) % 2 === 0 ? '#ffffff' : '#111111';
        checkerCtx.fillRect(col * 16, row * 16, 16, 16);
      }
    }
    const checkerTex = new THREE.CanvasTexture(checkerCanvas);
    checkerTex.wrapS = THREE.RepeatWrapping;
    checkerTex.wrapT = THREE.RepeatWrapping;

    const checkerMat = new THREE.MeshStandardMaterial({
      map: checkerTex,
      roughness: 0.6,
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
    // Face along the track tangent
    banner.lookAt(gP.x + gTangent.x, gP.y + postHeight - 1.2, gP.z + gTangent.z);
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

    // ── 3. Grid box lane markings ──
    // Paint 2 columns × 3 rows of grid boxes behind the start line
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = 128; gridCanvas.height = 128;
    const gridCtx = gridCanvas.getContext('2d')!;
    gridCtx.fillStyle = 'rgba(0,0,0,0)';
    gridCtx.clearRect(0, 0, 128, 128);
    gridCtx.strokeStyle = '#ffffff';
    gridCtx.lineWidth = 3;
    // Grid box outline
    gridCtx.strokeRect(8, 8, 112, 112);
    // Center divider
    gridCtx.beginPath();
    gridCtx.moveTo(64, 8);
    gridCtx.lineTo(64, 120);
    gridCtx.stroke();
    // Row number
    gridCtx.fillStyle = '#ffffff';
    gridCtx.font = 'bold 40px sans-serif';
    gridCtx.textAlign = 'center';

    const gridTex = new THREE.CanvasTexture(gridCanvas);
    const gridBoxGeo = new THREE.PlaneGeometry(3.5, 5);

    // Place grid boxes at t slightly behind start (t = 0.002 to 0.008)
    const gridTs = [0.003, 0.003, 0.006, 0.006, 0.009, 0.009];
    const gridLanes = [-1, 1, -1, 1, -1, 1];

    for (let gi = 0; gi < 6; gi++) {
      const gt = gridTs[gi];
      const gPt = spline.getPointAt(gt);
      const gTan = spline.getTangentAt(gt).normalize();
      const gRt = new THREE.Vector3(gTan.z, 0, -gTan.x).normalize();
      const kappa2 = estimateCurvature(spline, gt);
      const bankQuat2 = new THREE.Quaternion().setFromAxisAngle(gTan, -kappa2 * 2.5);
      const bankedRt = gRt.clone().applyQuaternion(bankQuat2);
      const upVec = new THREE.Vector3().crossVectors(bankedRt, gTan).normalize();

      const laneX = gridLanes[gi] * 3.0; // ±3m from center

      const gridMat2 = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      });

      const gridMesh = new THREE.Mesh(gridBoxGeo.clone(), gridMat2);
      gridMesh.position.set(
        gPt.x + bankedRt.x * laneX,
        gPt.y + 0.015 + bankedRt.y * laneX,
        gPt.z + bankedRt.z * laneX,
      );
      gridMesh.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(bankedRt, upVec, gTan)
      );
      gridMesh.rotateX(-Math.PI / 2);
      gridMesh.renderOrder = 1;
      group.add(gridMesh);
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
    // Buildings sit on the ground plane (y=-5), not floating at spline height
    _m.setPosition(x, -5 + h / 2, z);
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
      0,
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

  // ── Distant mountain silhouettes (1 merged draw call) ──
  {
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
      const mtnHeight = 15 + rng() * 30;
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
          color: 0x1a1a2e, // dark silhouette — fog will blend naturally
          fog: true,
          side: THREE.DoubleSide,
        });
        const mtnMesh = new THREE.Mesh(mergedGeo, mtnMat);
        group.add(mtnMesh);
      }
    }
  }

  // ── Billboard cloud sprites (InstancedMesh — 1 draw call) ──
  {
    const CLOUD_COUNT = 40;
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = 64;
    cloudCanvas.height = 64;
    const ctx = cloudCanvas.getContext('2d')!;

    // Procedural soft cloud texture (radial gradient with noise perturbation)
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.5)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.08)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
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

  return group;
}

/** Update tree wind sway time. Call once per frame from game loop. */
export function updateSceneryWind(sceneryGroup: THREE.Group | null, timestamp: number) {
  if (!sceneryGroup) return;
  const crownMat = (sceneryGroup as any)._crownMat;
  if (crownMat?._windShader) {
    crownMat._windShader.uniforms.uWindTime.value = timestamp * 0.001;
  }
}
