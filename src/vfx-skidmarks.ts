/* ── IRL Race — Skid Marks VFX ──
 *
 * Extracted from vfx.ts. TSL-based road-surface quads placed during drift
 * with time-decay burn glow (orange→dark over 0.8s).
 */

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, vec4, mul, max, sub, clamp, mix, uniform as tslUniform } from 'three/tsl';

const SKID_MAX_QUADS = 200;
const SKID_VERTS = SKID_MAX_QUADS * 6; // 2 triangles per quad = 6 verts
let skidMesh: THREE.Mesh | null = null;
let skidPositions: Float32Array | null = null;
let skidAlphas: Float32Array | null = null;
let skidAges: Float32Array | null = null; // per-vertex spawn timestamp
let skidIdx = 0;
let skidCount = 0;
const _skidRight = new THREE.Vector3();

// TSL uniform for current time — updated each frame via updateSkidGlowTime()
const uSkidTime = tslUniform(0.0);

/** Call once per frame before render to drive skid burn glow decay. */
export function updateSkidGlowTime() {
  uSkidTime.value = performance.now() / 1000;
}

export function initSkidMarks(scene: THREE.Scene) {
  const geo = new THREE.BufferGeometry();
  skidPositions = new Float32Array(SKID_VERTS * 3);
  skidAlphas = new Float32Array(SKID_VERTS);
  skidAges = new Float32Array(SKID_VERTS);
  geo.setAttribute('position', new THREE.BufferAttribute(skidPositions, 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(skidAlphas, 1));
  geo.setAttribute('spawnTime', new THREE.BufferAttribute(skidAges, 1));
  geo.setDrawRange(0, 0);

  const skidMat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  const vertAlpha = float(attribute('alpha'));

  // Burn glow: compute age from spawnTime, fade orange→dark over 0.8s
  const spawnT = float(attribute('spawnTime'));
  const age = max(sub(uSkidTime, spawnT), float(0));
  const glowFrac = clamp(sub(float(1), age.div(0.8)), 0, 1); // 1→0 over 0.8s
  const glowR = mix(float(0.08), float(1.0), glowFrac);
  const glowG = mix(float(0.08), float(0.45), glowFrac);
  const glowB = float(0.08);
  skidMat.colorNode = vec4(glowR, glowG, glowB, float(1));
  skidMat.opacityNode = mul(vertAlpha, 0.6);

  skidMesh = new THREE.Mesh(geo, skidMat);
  skidMesh.frustumCulled = false;
  scene.add(skidMesh);
}

export function addSkidQuad(
  posL: THREE.Vector3, posR: THREE.Vector3,
  prevL: THREE.Vector3, prevR: THREE.Vector3,
  alpha: number,
) {
  if (!skidPositions || !skidAlphas) return;

  const base = (skidIdx % SKID_MAX_QUADS) * 18; // 6 verts × 3 components
  const aBase = (skidIdx % SKID_MAX_QUADS) * 6;

  // Triangle 1: prevL, prevR, posL
  skidPositions[base]     = prevL.x; skidPositions[base + 1] = prevL.y + 0.02; skidPositions[base + 2] = prevL.z;
  skidPositions[base + 3] = prevR.x; skidPositions[base + 4] = prevR.y + 0.02; skidPositions[base + 5] = prevR.z;
  skidPositions[base + 6] = posL.x;  skidPositions[base + 7] = posL.y + 0.02;  skidPositions[base + 8] = posL.z;
  // Triangle 2: prevR, posR, posL
  skidPositions[base + 9]  = prevR.x; skidPositions[base + 10] = prevR.y + 0.02; skidPositions[base + 11] = prevR.z;
  skidPositions[base + 12] = posR.x;  skidPositions[base + 13] = posR.y + 0.02;  skidPositions[base + 14] = posR.z;
  skidPositions[base + 15] = posL.x;  skidPositions[base + 16] = posL.y + 0.02;  skidPositions[base + 17] = posL.z;

  const a = Math.min(alpha, 1);
  for (let i = 0; i < 6; i++) skidAlphas[aBase + i] = a;

  // Record spawn timestamp for burn glow decay
  const now = performance.now() / 1000;
  for (let i = 0; i < 6; i++) skidAges![aBase + i] = now;

  skidIdx++;
  skidCount = Math.min(skidCount + 1, SKID_MAX_QUADS);

  const geo = skidMesh!.geometry;
  geo.setDrawRange(0, skidCount * 6);
  (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  (geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  (geo.attributes.spawnTime as THREE.BufferAttribute).needsUpdate = true;
}

const _skidPrevL = new THREE.Vector3();
const _skidPrevR = new THREE.Vector3();
const _skidCurL = new THREE.Vector3();
const _skidCurR = new THREE.Vector3();
let _skidHasPrev = false;

export function updateSkidMarks(
  carPos: THREE.Vector3, heading: number,
  driftIntensity: number, carY: number,
) {
  if (!skidMesh || driftIntensity < 0.15) {
    _skidHasPrev = false;
    return;
  }

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const rearX = carPos.x - sinH * 1.3;
  const rearZ = carPos.z - cosH * 1.3;

  _skidRight.set(cosH * 0.7, 0, -sinH * 0.7);
  _skidCurL.set(rearX - _skidRight.x, carY, rearZ - _skidRight.z);
  _skidCurR.set(rearX + _skidRight.x, carY, rearZ + _skidRight.z);

  if (_skidHasPrev) {
    addSkidQuad(_skidCurL, _skidCurR, _skidPrevL, _skidPrevR, driftIntensity);
  }

  _skidPrevL.copy(_skidCurL);
  _skidPrevR.copy(_skidCurR);
  _skidHasPrev = true;
}

export function destroySkidMarks() {
  if (skidMesh) {
    skidMesh.parent?.remove(skidMesh);
    skidMesh.geometry.dispose();
    (skidMesh.material as THREE.Material).dispose();
    skidMesh = null;
  }
  skidPositions = null;
  skidAlphas = null;
  skidAges = null;
  skidIdx = 0;
  skidCount = 0;
  _skidHasPrev = false;
}
