/**
 * Offline script to compute per-model light positions for each car GLB.
 * Replicates processCarModel's scale/center/rotate pipeline, then computes
 * bounding box in wrapper space and raycasts to find headlight/taillight
 * surface positions.
 *
 * Usage: node scripts/detect-lights.mjs
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(__dirname, '..', 'public', 'models');

// Set up Draco decoder
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf/'));
dracoLoader.preload();

const CAR_FILES = [
  'white_camry.glb',
  'Nissan_Altima.glb',
  'Nissan_Maxima.glb',
  'Ferrari.glb',
  'Porsche_911.glb',
  'Subaru_WRX3.glb',
  'Lamborghini.glb',
];

function processModel(model) {
  // Replicate processCarModel exactly
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = 4.0 / maxDim;
  model.scale.setScalar(scale);

  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());

  // Tire contact detection (same as processCarModel)
  const wheelProbes = [
    { x:  1.3, z: -0.85 },
    { x:  1.3, z:  0.85 },
    { x: -1.3, z: -0.85 },
    { x: -1.3, z:  0.85 },
  ];

  const probeRaycaster = new THREE.Raycaster();
  probeRaycaster.far = 10;
  const downDir = new THREE.Vector3(0, -1, 0);
  const meshes = [];
  model.traverse(c => { if (c.isMesh) meshes.push(c); });

  let tireContactY = box.min.y;
  const wheelHits = [];

  for (const probe of wheelProbes) {
    const origin = new THREE.Vector3(
      center.x + probe.x,
      box.max.y + 1,
      center.z + probe.z,
    );
    probeRaycaster.set(origin, downDir);
    let bestY = box.min.y;
    for (const mesh of meshes) {
      const hits = probeRaycaster.intersectObject(mesh, false);
      if (hits.length > 0) {
        const lowestHit = hits[hits.length - 1].point.y;
        if (lowestHit > bestY) bestY = lowestHit;
      }
    }
    wheelHits.push(bestY);
  }

  if (wheelHits.length > 0) {
    tireContactY = wheelHits.reduce((a, b) => a + b, 0) / wheelHits.length;
  }

  model.position.set(-center.x, -tireContactY, -center.z);

  // Wrap with rotation
  const wrapper = new THREE.Group();
  model.rotation.y = Math.PI / 2;
  wrapper.add(model);
  wrapper.updateMatrixWorld(true);

  return { wrapper, meshes };
}

function probeSurface(meshes, origin, dir) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 20;
  raycaster.set(origin, dir);
  for (const mesh of meshes) {
    const hits = raycaster.intersectObject(mesh, false);
    if (hits.length > 0) return hits[0].point.clone();
  }
  return null;
}

async function loadGLB(filepath) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    const buffer = fs.readFileSync(filepath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    loader.parse(arrayBuffer, '', (gltf) => resolve(gltf), reject);
  });
}

async function main() {
  const results = {};

  for (const filename of CAR_FILES) {
    const filepath = path.join(modelsDir, filename);
    if (!fs.existsSync(filepath)) {
      console.warn(`SKIP: ${filename} not found`);
      continue;
    }

    console.log(`Processing ${filename}...`);
    const gltf = await loadGLB(filepath);
    const model = gltf.scene;

    const { wrapper, meshes } = processModel(model);

    // Compute bounding box in wrapper space
    const wBox = new THREE.Box3().setFromObject(wrapper);
    const wSize = wBox.getSize(new THREE.Vector3());

    // Light probe positions
    const halfW = wSize.x * 0.35;
    const lightY = wBox.min.y + wSize.y * 0.35;

    // Probe front surface (headlights)
    const frontDir = new THREE.Vector3(0, 0, -1);
    const frontProbeZ = wBox.max.z + 0.5;
    const hlL = probeSurface(meshes, new THREE.Vector3(-halfW, lightY, frontProbeZ), frontDir);
    const hlR = probeSurface(meshes, new THREE.Vector3( halfW, lightY, frontProbeZ), frontDir);

    // Probe rear surface (taillights)
    const rearDir = new THREE.Vector3(0, 0, 1);
    const rearProbeZ = wBox.min.z - 0.5;
    const tlL = probeSurface(meshes, new THREE.Vector3(-halfW, lightY, rearProbeZ), rearDir);
    const tlR = probeSurface(meshes, new THREE.Vector3( halfW, lightY, rearProbeZ), rearDir);

    // Also probe at different heights for better shape detection
    const lightYHigh = wBox.min.y + wSize.y * 0.45;
    const lightYLow  = wBox.min.y + wSize.y * 0.28;
    const hlLH = probeSurface(meshes, new THREE.Vector3(-halfW, lightYHigh, frontProbeZ), frontDir);
    const hlLLow = probeSurface(meshes, new THREE.Vector3(-halfW, lightYLow, frontProbeZ), frontDir);
    const tlLH = probeSurface(meshes, new THREE.Vector3(-halfW, lightYHigh, rearProbeZ), rearDir);
    const tlLLow = probeSurface(meshes, new THREE.Vector3(-halfW, lightYLow, rearProbeZ), rearDir);

    const r = (v) => v ? [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)] : null;

    results[filename] = {
      bbox: {
        frontZ: +wBox.max.z.toFixed(4),
        rearZ: +wBox.min.z.toFixed(4),
        halfWidth: +halfW.toFixed(4),
        height: +wSize.y.toFixed(4),
        width: +wSize.x.toFixed(4),
        lightY: +lightY.toFixed(4),
      },
      headlights: {
        left: r(hlL),
        right: r(hlR),
        leftHigh: r(hlLH),
        leftLow: r(hlLLow),
      },
      taillights: {
        left: r(tlL),
        right: r(tlR),
        leftHigh: r(tlLH),
        leftLow: r(tlLLow),
      },
    };

    console.log(`  bbox: frontZ=${results[filename].bbox.frontZ}, rearZ=${results[filename].bbox.rearZ}, w=${results[filename].bbox.width}`);
    console.log(`  HL left:  ${JSON.stringify(r(hlL))}`);
    console.log(`  HL right: ${JSON.stringify(r(hlR))}`);
    console.log(`  TL left:  ${JSON.stringify(r(tlL))}`);
    console.log(`  TL right: ${JSON.stringify(r(tlR))}`);
  }

  console.log('\n\n=== FULL RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
