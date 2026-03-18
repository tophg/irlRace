/* ── Hood Racer — VFX (Particles & Effects) ── */

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, vec4, mul, max, sub, clamp, mix, uniform as tslUniform } from 'three/tsl';
import { spawnGPUSparks, spawnGPUBackfire } from './gpu-particles';
import { initBoostFlame, updateBoostFlame, triggerBoostBurst, triggerBackfireSequence, initNitroTrail, spawnNitroTrail, updateNitroTrail, initBoostShockwave, initNitroFlash, triggerBoostShockwave, updateBoostShockwave, destroyBoostVFX } from './vfx-boost';
export { initBoostFlame, updateBoostFlame, triggerBoostBurst, triggerBackfireSequence, initNitroTrail, spawnNitroTrail, updateNitroTrail, initBoostShockwave, initNitroFlash, triggerBoostShockwave, updateBoostShockwave } from './vfx-boost';
import { initRainDroplets, updateRainDroplets, initImpactFlash, triggerImpactFlash, updateImpactFlash, initAmbientParticles, updateAmbientParticles, initHeatShimmer, updateHeatShimmer, initLensFlares, updateLensFlares, initLightning, setLightningEnabled, updateLightning, initNearMissStreaks, triggerNearMiss, updateNearMissStreaks, initNearMissWhoosh, triggerNearMissWhoosh, updateNearMissWhoosh, initVictoryConfetti, spawnVictoryConfetti, setConfettiContinuous, updateVictoryConfetti, destroyEnvironmentVFX } from './vfx-environment';
export { initRainDroplets, updateRainDroplets, initImpactFlash, triggerImpactFlash, updateImpactFlash, initAmbientParticles, updateAmbientParticles, initHeatShimmer, updateHeatShimmer, initLensFlares, updateLensFlares, initLightning, setLightningEnabled, updateLightning, initNearMissStreaks, triggerNearMiss, updateNearMissStreaks, initNearMissWhoosh, triggerNearMissWhoosh, updateNearMissWhoosh, initVictoryConfetti, spawnVictoryConfetti, setConfettiContinuous, updateVictoryConfetti } from './vfx-environment';


// ── Tire Smoke Pool ──
const SMOKE_POOL_SIZE = 60;
const smokePool: THREE.Mesh[] = [];
let smokeIdx = 0;
let smokeScene: THREE.Scene | null = null;

export function initVFX(scene: THREE.Scene) {
  smokeScene = scene;

  const smokeGeo = new THREE.SphereGeometry(0.4, 6, 4);
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0xcccccc,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  for (let i = 0; i < SMOKE_POOL_SIZE; i++) {
    const mesh = new THREE.Mesh(smokeGeo, smokeMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    smokePool.push(mesh);
  }
}

interface SmokeParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

const activeSmoke: SmokeParticle[] = [];

const SMOKE_VEL_POOL_SIZE = 30;
const smokeVelPool: THREE.Vector3[] = [];
for (let i = 0; i < SMOKE_VEL_POOL_SIZE; i++) smokeVelPool.push(new THREE.Vector3());
let smokeVelIdx = 0;

export function spawnTireSmoke(pos: THREE.Vector3, driftIntensity: number, isNitroActive = false) {
  if (!smokeScene || driftIntensity < 0.15) return;

  const count = Math.floor(driftIntensity * 3);
  for (let i = 0; i < count; i++) {
    const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
    smokeIdx++;

    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 0.5;
    mesh.position.y = pos.y + 0.1;
    mesh.scale.setScalar(0.5 + Math.random() * 0.5);
    mesh.visible = true;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    // During nitro: cyan-tinted smoke with higher opacity
    if (isNitroActive) {
      mat.opacity = 0.35 + driftIntensity * 0.25;
      mat.color.setRGB(0.4 + Math.random() * 0.2, 0.7 + Math.random() * 0.15, 1);
    } else {
      mat.opacity = 0.25 + driftIntensity * 0.2;
      mat.color.setHex(0xcccccc);
    }

    const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
    smokeVelIdx++;
    vel.set(
      (Math.random() - 0.5) * 1.5,
      0.4 + Math.random() * 0.6,
      (Math.random() - 0.5) * 1.5,
    );

    const life = isNitroActive ? 1.0 + Math.random() * 0.5 : 0.8 + Math.random() * 0.6;
    activeSmoke.push({ mesh, velocity: vel, life, maxLife: life });
  }
}

export function updateVFX(dt: number) {
  // Swap-and-pop removal avoids O(N) splice shifts
  let i = 0;
  while (i < activeSmoke.length) {
    const p = activeSmoke[i];
    p.life -= dt;

    if (p.life <= 0) {
      p.mesh.visible = false;
      activeSmoke[i] = activeSmoke[activeSmoke.length - 1];
      activeSmoke.pop();
      continue;
    }

    p.mesh.position.addScaledVector(p.velocity, dt);
    p.velocity.y *= 0.98;

    const lifeFrac = p.life / p.maxLife;
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = lifeFrac * 0.3;
    p.mesh.scale.setScalar(1.5 - lifeFrac * 0.8);
    i++;
  }

  // Metal debris (tumble, gravity, bounce)
  updateDebris(dt);
}

// ── Speed Lines (screen-space, canvas 2D overlay) ──
let speedLinesCanvas: HTMLCanvasElement | null = null;
let speedLinesCtx: CanvasRenderingContext2D | null = null;
let speedLinesResizeHandler: (() => void) | null = null;

export function initSpeedLines(container: HTMLElement) {
  // Clean up any existing handler first (safety against re-init without destroy)
  if (speedLinesResizeHandler) {
    window.removeEventListener('resize', speedLinesResizeHandler);
  }
  if (speedLinesCanvas) speedLinesCanvas.remove();

  speedLinesCanvas = document.createElement('canvas');
  speedLinesCanvas.style.cssText = `
    position: absolute; inset: 0; pointer-events: none;
    z-index: 5; opacity: 0; transition: opacity 0.3s;
  `;
  speedLinesCanvas.width = window.innerWidth;
  speedLinesCanvas.height = window.innerHeight;
  container.appendChild(speedLinesCanvas);
  speedLinesCtx = speedLinesCanvas.getContext('2d')!;

  speedLinesResizeHandler = () => {
    if (speedLinesCanvas) {
      speedLinesCanvas.width = window.innerWidth;
      speedLinesCanvas.height = window.innerHeight;
    }
  };
  window.addEventListener('resize', speedLinesResizeHandler);
}

export function updateSpeedLines(speedRatio: number, isNitroActive = false) {
  if (!speedLinesCanvas || !speedLinesCtx) return;

  // Fade in/out based on speed (lower threshold during nitrous)
  const threshold = isNitroActive ? 0.3 : 0.7;
  const fadeRange = isNitroActive ? 0.2 : 0.3;
  const opacity = speedRatio > threshold ? Math.min(1, (speedRatio - threshold) / fadeRange) : 0;
  speedLinesCanvas.style.opacity = opacity.toString();

  // Skip canvas work when invisible
  if (opacity <= 0) return;

  const ctx = speedLinesCtx;
  const w = speedLinesCanvas.width;
  const h = speedLinesCanvas.height;
  const cx = w / 2;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);

  // During nitrous: 2× density, cyan tint, 1.5× length, higher opacity
  const numLines = isNitroActive ? 60 : 30;
  const lineAlpha = isNitroActive ? 0.14 : 0.08;
  const lengthMult = isNitroActive ? 1.5 : 1.0;
  ctx.strokeStyle = isNitroActive
    ? `rgba(100, 200, 255, ${lineAlpha})`
    : `rgba(255, 255, 255, ${lineAlpha})`;
  ctx.lineWidth = isNitroActive ? 1.5 : 1;

  for (let i = 0; i < numLines; i++) {
    const angle = (i / numLines) * Math.PI * 2 + performance.now() * 0.0005;
    // During nitrous: wider inner radius (tunnel vision — clear center)
    const baseInner = isNitroActive ? 60 : 80;
    const innerR = baseInner + Math.random() * 40;
    const outerR = innerR + (80 + Math.random() * 160) * lengthMult;

    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
    ctx.stroke();
  }
}

// BOOST FLAME SYSTEM — extracted to vfx-boost.ts
// initBoostFlame, updateBoostFlame, triggerBoostBurst, triggerBackfireSequence are re-exported above.


// ── Skid Marks (road-surface quads placed during drift) ──
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

// ── Remote player name tags ──
export function createNameTag(name: string, scene: THREE.Scene): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  // Background pill
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 56, 28);
  ctx.fill();

  // Name text
  ctx.fillStyle = '#ff6a2a';
  ctx.font = 'bold 28px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.substring(0, 14), 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.5, 0.9, 1);
  scene.add(sprite);
  return sprite;
}

export function updateNameTag(sprite: THREE.Sprite, pos: THREE.Vector3) {
  sprite.position.set(pos.x, pos.y + 3.5, pos.z);
}

// ── Collision Sparks ──
// ── Damage Smoke ──
let damageSmokeCooldown = 0;

export function spawnDamageSmoke(pos: THREE.Vector3, intensity: number, dt = 0.016) {
  if (!smokeScene || intensity < 0.1) return;
  damageSmokeCooldown -= dt;
  if (damageSmokeCooldown > 0) return;
  damageSmokeCooldown = 0.15 - intensity * 0.1;

  if (smokePool.length === 0) return;
  const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
  smokeIdx++;
  mesh.position.copy(pos);
  mesh.position.y += 1.5;
  mesh.position.x += (Math.random() - 0.5) * 0.8;
  mesh.scale.setScalar(0.6 + intensity * 0.5);
  mesh.visible = true;
  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.opacity = 0.3;
  mat.color.setHex(0x333333);

  const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
  smokeVelIdx++;
  vel.set((Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.4, (Math.random() - 0.5) * 0.5);
  activeSmoke.push({ mesh, velocity: vel, life: 1.2, maxLife: 1.2 });
}

// ── Damage Flames (persistent fire on critically damaged zones) ──
let flameCooldown = 0;

export function spawnFlameParticle(pos: THREE.Vector3, intensity: number, dt = 0.016) {
  if (!smokeScene || intensity < 0.1) return;
  flameCooldown -= dt;
  if (flameCooldown > 0) return;
  flameCooldown = 0.03; // ~33 particles/sec at full intensity

  if (smokePool.length === 0) return;
  const count = Math.ceil(intensity * 2);
  for (let n = 0; n < count; n++) {
    const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
    smokeIdx++;
    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 0.6;
    mesh.position.y += 0.3 + Math.random() * 0.3;
    mesh.position.z += (Math.random() - 0.5) * 0.6;
    mesh.scale.setScalar(0.3 + intensity * 0.3);
    mesh.visible = true;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.7;
    // Cycle orange to yellow
    const r = 1.0;
    const g = 0.2 + Math.random() * 0.6;
    mat.color.setRGB(r, g, 0);

    const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
    smokeVelIdx++;
    vel.set(
      (Math.random() - 0.5) * 1.5,
      1.5 + Math.random() * 2.0,
      (Math.random() - 0.5) * 1.5,
    );
    activeSmoke.push({ mesh, velocity: vel, life: 0.3 + Math.random() * 0.2, maxLife: 0.5 });
  }
}

// ── Metal Debris (tumbling rectangular shards on heavy impacts) ──

const DEBRIS_POOL_SIZE = 30;
const debrisPool: THREE.Mesh[] = [];
let debrisIdx = 0;

interface DebrisParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; az: number;  // angular velocity
  life: number;
  bounced: boolean;
  active: boolean;
}

// Pre-allocated debris state pool (avoids per-spawn object allocation)
const debrisStates: DebrisParticle[] = [];
let debrisStatesReady = false;

function ensureDebrisStates() {
  if (debrisStatesReady) return;
  for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
    debrisStates.push({
      mesh: null!,
      vx: 0, vy: 0, vz: 0,
      ax: 0, ay: 0, az: 0,
      life: 0,
      bounced: false,
      active: false,
    });
  }
  debrisStatesReady = true;
}

function ensureDebrisPool() {
  if (debrisPool.length > 0 || !smokeScene) return;
  const geo = new THREE.BoxGeometry(0.12, 0.04, 0.08);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x999999,
    roughness: 0.4,
    metalness: 0.8,
    transparent: true,
    opacity: 1,
  });
  for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    smokeScene.add(m);
    debrisPool.push(m);
  }
  ensureDebrisStates();
}

/** Eagerly initialize debris pool at race start (avoids lazy-init stall on first explosion). */
export function warmupVFX() {
  ensureDebrisPool();
}

/** Spawn metal debris particles at impact point. force controls count + speed. */
export function spawnDebris(pos: THREE.Vector3, force: number, carVelX = 0, carVelZ = 0) {
  if (!smokeScene) return;
  ensureDebrisPool();

  const count = Math.min(Math.floor(force * 0.3), 8);
  for (let i = 0; i < count; i++) {
    const meshSlot = debrisIdx % DEBRIS_POOL_SIZE;
    const mesh = debrisPool[meshSlot];
    const state = debrisStates[meshSlot];
    debrisIdx++;
    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 0.5;
    mesh.position.y += 0.3 + Math.random() * 0.3;
    mesh.position.z += (Math.random() - 0.5) * 0.5;
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    mesh.scale.set(0.5 + Math.random(), 0.5 + Math.random(), 0.5 + Math.random());
    mesh.visible = true;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.opacity = 1;

    // Inherit car velocity + random burst
    const speed = 3 + Math.random() * force * 0.5;
    const theta = Math.random() * Math.PI * 2;
    // Reuse pre-allocated state (zero allocation)
    state.mesh = mesh;
    state.vx = carVelX * 0.3 + Math.cos(theta) * speed;
    state.vy = 2 + Math.random() * 4;
    state.vz = carVelZ * 0.3 + Math.sin(theta) * speed;
    state.ax = (Math.random() - 0.5) * 15;
    state.ay = (Math.random() - 0.5) * 15;
    state.az = (Math.random() - 0.5) * 15;
    state.life = 2.0 + Math.random() * 1.5;
    state.bounced = false;
    state.active = true;
  }
}

/** Update debris physics (gravity, ground bounce, fade). Call in updateVFX. */
function updateDebris(dt: number) {
  for (let i = 0; i < DEBRIS_POOL_SIZE; i++) {
    const d = debrisStates[i];
    if (!d || !d.active) continue;
    d.life -= dt;
    if (d.life <= 0) {
      d.mesh.visible = false;
      d.active = false;
      continue;
    }

    // Gravity
    d.vy -= 12 * dt;

    // Position
    d.mesh.position.x += d.vx * dt;
    d.mesh.position.y += d.vy * dt;
    d.mesh.position.z += d.vz * dt;

    // Rotation (tumble)
    d.mesh.rotation.x += d.ax * dt;
    d.mesh.rotation.y += d.ay * dt;
    d.mesh.rotation.z += d.az * dt;

    // Ground bounce
    if (d.mesh.position.y < 0.05) {
      d.mesh.position.y = 0.05;
      d.vy = Math.abs(d.vy) * 0.3;
      d.vx *= 0.7;
      d.vz *= 0.7;
      d.ax *= 0.5;
      d.ay *= 0.5;
      d.az *= 0.5;
      d.bounced = true;
    }

    // Fade out in last 0.5s
    if (d.life < 0.5) {
      (d.mesh.material as THREE.MeshStandardMaterial).opacity = d.life * 2;
    }
  }
}

// ── Sustained Damage Zone Smoke (continuous trail from critically damaged zones) ──
let dmgSmokeCd = 0;

/**
 * Spawn continuous dark smoke from a critically damaged zone.
 * Call every frame for each zone with HP < 30%.
 * @param pos — world position of the damaged zone
 * @param severity — 0..1 (1 = zone at 0 HP)
 */
export function spawnDamageZoneSmoke(pos: THREE.Vector3, severity: number, dt: number) {
  if (!smokeScene || severity < 0.3) return;
  dmgSmokeCd -= dt;
  if (dmgSmokeCd > 0) return;
  dmgSmokeCd = 0.06; // ~16 puffs/sec

  if (smokePool.length === 0) return;
  const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
  smokeIdx++;
  mesh.position.copy(pos);
  mesh.position.x += (Math.random() - 0.5) * 0.4;
  mesh.position.y += 0.3;
  mesh.position.z += (Math.random() - 0.5) * 0.4;
  mesh.scale.setScalar(0.3 + severity * 0.5);
  mesh.visible = true;

  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.opacity = 0.3 + severity * 0.2;
  // Black smoke at severe damage, grey at moderate
  const grey = 0.15 + (1 - severity) * 0.2;
  mat.color.setRGB(grey, grey, grey);

  const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
  smokeVelIdx++;
  vel.set((Math.random() - 0.5) * 0.5, 0.5 + severity * 1.5, (Math.random() - 0.5) * 0.5);
  activeSmoke.push({ mesh, velocity: vel, life: 0.6 + severity * 0.4, maxLife: 1.0 });
}



// ── Tire Blowout VFX ──

/**
 * Spawn rubber debris particles at a blown tire position.
 * Uses the existing smoke pool with dark color for rubber chunks.
 */
export function spawnTireBlowout(pos: THREE.Vector3) {
  if (!smokeScene) return;

  // Dark rubber chunks
  for (let i = 0; i < 8; i++) {
    if (smokePool.length === 0) return;
    const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
    smokeIdx++;
    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 0.8;
    mesh.position.y += 0.2 + Math.random() * 0.3;
    mesh.position.z += (Math.random() - 0.5) * 0.8;
    mesh.scale.setScalar(0.3 + Math.random() * 0.4);
    mesh.visible = true;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.8;
    mat.color.setRGB(0.1, 0.1, 0.1); // Black rubber

    const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
    smokeVelIdx++;
    vel.set(
      (Math.random() - 0.5) * 6,
      2 + Math.random() * 4,
      (Math.random() - 0.5) * 6,
    );
    activeSmoke.push({ mesh, velocity: vel, life: 1.2, maxLife: 1.2 });
  }
}

// ── Neon Underglow (colored PointLight under car body) ──

const UNDERGLOW_COLORS = [
  0x00aaff, // Blue
  0xff00aa, // Pink
  0x00ffaa, // Cyan-green
  0xff6600, // Orange
  0xaa00ff, // Purple
  0xff0044, // Red
];

export function createUnderglow(carGroup: THREE.Group, colorIndex: number): THREE.PointLight {
  const color = UNDERGLOW_COLORS[colorIndex % UNDERGLOW_COLORS.length];
  const light = new THREE.PointLight(color, 2.5, 8, 2);
  light.position.set(0, -0.3, 0); // Under the car body
  carGroup.add(light);
  return light;
}

/**
 * Update underglow pulsing effect.
 * @param light — the PointLight from createUnderglow
 * @param speed — current car speed (for intensity variation)
 * @param time — current timestamp in seconds
 * @param isNitroActive — whether nitrous is currently burning
 */
export function updateUnderglow(light: THREE.PointLight, speed: number, time: number, isNitroActive = false) {
  const speedFactor = Math.min(Math.abs(speed) / 40, 1);

  if (isNitroActive) {
    // Nitrous mode: shift to bright cyan-blue, 3× intensity, 8Hz rapid pulse
    const pulse = 0.8 + Math.sin(time * 8) * 0.15 + Math.sin(time * 13) * 0.05;
    light.intensity = (4.5 + speedFactor * 3.0) * pulse;
    light.distance = 10 + speedFactor * 5;
    light.color.lerp(new THREE.Color(0x44aaff), 0.15); // Smooth shift to cyan
  } else {
    // Normal mode: gentle pulse
    const pulse = 0.7 + Math.sin(time * 3) * 0.15 + Math.sin(time * 7.3) * 0.08;
    light.intensity = (1.5 + speedFactor * 2.0) * pulse;
    light.distance = 6 + speedFactor * 4;
  }
}

// NITRO TRAIL + SHOCKWAVE — extracted to vfx-boost.ts
// initNitroTrail, spawnNitroTrail, updateNitroTrail, initBoostShockwave, initNitroFlash, triggerBoostShockwave, updateBoostShockwave are re-exported above.


// ── Continuous Rim Sparks (persistent sparking on blown tires) ──

const RIM_SPARK_POOL = 20;
interface RimSpark {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number;
}
let rimSparkPool: THREE.Mesh[] = [];
const activeRimSparks: RimSpark[] = [];
let rimSparkScene: THREE.Scene | null = null;

export function initRimSparks(scene: THREE.Scene) {
  rimSparkScene = scene;
  const geo = new THREE.SphereGeometry(0.04, 4, 3);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 1.0,
    depthWrite: false,
  });
  rimSparkPool = [];
  for (let i = 0; i < RIM_SPARK_POOL; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    rimSparkPool.push(m);
  }
}

let rimSparkIdx = 0;

/**
 * Spawn continuous rim sparks at a blown tire position.
 * Call every frame for each blown tire while car is moving.
 */
export function spawnRimSparks(pos: THREE.Vector3, speed: number) {
  if (!rimSparkScene || rimSparkPool.length === 0 || Math.abs(speed) < 3) return;

  // Spawn 2-3 sparks per frame based on speed
  const count = Math.abs(speed) > 15 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const mesh = rimSparkPool[rimSparkIdx % RIM_SPARK_POOL];
    rimSparkIdx++;

    mesh.position.copy(pos);
    mesh.position.y += 0.1;
    mesh.scale.setScalar(0.6 + Math.random() * 0.8);
    mesh.visible = true;

    activeRimSparks.push({
      mesh,
      vx: (Math.random() - 0.5) * 6,
      vy: 1 + Math.random() * 4,
      vz: (Math.random() - 0.5) * 6,
      life: 0.15 + Math.random() * 0.2,
    });
  }
}

export function updateRimSparks(dt: number) {
  let j = 0;
  while (j < activeRimSparks.length) {
    const s = activeRimSparks[j];
    s.life -= dt;
    if (s.life <= 0) {
      s.mesh.visible = false;
      activeRimSparks[j] = activeRimSparks[activeRimSparks.length - 1];
      activeRimSparks.pop();
      continue;
    }

    // Physics: gravity + bounce
    s.vy -= 15 * dt;
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.y += s.vy * dt;
    s.mesh.position.z += s.vz * dt;

    // Bounce off ground
    if (s.mesh.position.y < 0.05) {
      s.mesh.position.y = 0.05;
      s.vy = Math.abs(s.vy) * 0.3;
    }

    const mat = s.mesh.material as THREE.MeshBasicMaterial;
    const t = s.life / 0.35;
    mat.opacity = t;
    // Orange → red as sparks cool
    mat.color.setRGB(1, 0.4 * t + 0.2, 0.1 * t);

    j++;
  }
}

// ── Exhaust Backfire Flames (burst from exhaust on decel/gear shift) ──

const BACKFIRE_POOL = 12;
interface BackfireFlame {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
}
let backfirePool: THREE.Mesh[] = [];
const activeBackfires: BackfireFlame[] = [];
let backfireScene: THREE.Scene | null = null;

export function initBackfire(scene: THREE.Scene) {
  backfireScene = scene;
  const geo = new THREE.SphereGeometry(0.15, 6, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff4400,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  backfirePool = [];
  for (let i = 0; i < BACKFIRE_POOL; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    backfirePool.push(m);
  }
}

let backfireIdx = 0;

/**
 * Trigger an exhaust backfire burst.
 * Call on gear shift or deceleration events.
 */
export function spawnBackfire(carPos: THREE.Vector3, heading: number) {
  if (!backfireScene || backfirePool.length === 0) return;

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);

  // Spawn 4-6 flame particles from the exhaust
  const count = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const mesh = backfirePool[backfireIdx % BACKFIRE_POOL];
    backfireIdx++;

    const spread = (Math.random() - 0.5) * 0.3;
    mesh.position.set(
      carPos.x - sinH * 2.5 + cosH * spread,
      carPos.y + 0.35 + Math.random() * 0.15,
      carPos.z - cosH * 2.5 - sinH * spread,
    );
    mesh.scale.setScalar(0.5 + Math.random() * 0.8);
    mesh.visible = true;

    const maxLife = 0.1 + Math.random() * 0.15;
    activeBackfires.push({
      mesh,
      vx: -sinH * (-3 + Math.random() * 4) + (Math.random() - 0.5) * 2,
      vy: 0.5 + Math.random() * 1.5,
      vz: -cosH * (-3 + Math.random() * 4) + (Math.random() - 0.5) * 2,
      life: maxLife,
      maxLife,
    });
  }
}

export function updateBackfire(dt: number) {
  let j = 0;
  while (j < activeBackfires.length) {
    const p = activeBackfires[j];
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      activeBackfires[j] = activeBackfires[activeBackfires.length - 1];
      activeBackfires.pop();
      continue;
    }

    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    const t = p.life / p.maxLife;
    p.mesh.scale.setScalar(t * 1.2);

    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = t * 0.95;
    // Orange → blue flame tip transition
    mat.color.setRGB(1, 0.3 * t, 0.1 + (1 - t) * 0.6);

    j++;
  }
}

// ── Brake Disc Glow (temperature accumulation model) ──

let _brakeTemp = 0; // 0..1 accumulated thermal energy
const _darkRed = new THREE.Color(0x8b0000);
const _brightOrange = new THREE.Color(0xff6600);
const _brakeEmissiveColor = new THREE.Color();

/**
 * Add brake disc glow meshes to a car's body group.
 * Returns array of 4 disc materials (FL, FR, RL, RR) for per-frame intensity control.
 */
export function createBrakeDiscs(bodyGroup: THREE.Group): THREE.MeshStandardMaterial[] {
  const discGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.03, 12);
  const materials: THREE.MeshStandardMaterial[] = [];

  // Approximate wheel positions (from vehicle.ts bounding box logic)
  const positions = [
    { x: -0.6, z: 0.9 },  // FL
    { x: 0.6, z: 0.9 },   // FR
    { x: -0.6, z: -0.9 }, // RL
    { x: 0.6, z: -0.9 },  // RR
  ];

  for (const pos of positions) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x333333,
      emissive: 0xff2200,
      emissiveIntensity: 0,
      roughness: 0.4,
      metalness: 0.8,
    });
    const disc = new THREE.Mesh(discGeo, mat);
    disc.rotation.z = Math.PI / 2;
    disc.position.set(pos.x, 0.22, pos.z);
    bodyGroup.add(disc);
    materials.push(mat);
  }

  _brakeTemp = 0;
  return materials;
}

/**
 * Update brake disc glow using a temperature accumulation model.
 * Heat builds with braking force × speed and decays exponentially.
 * @param discMats — array of 4 materials from createBrakeDiscs
 * @param brakeForce — 0..1 brake input
 * @param speed — current speed
 * @param dt — frame delta in seconds
 * @param maxSpeed — car's max speed for ratio computation
 * @param carPos — car position for hot spark spawning
 */
export function updateBrakeDiscs(
  discMats: THREE.MeshStandardMaterial[],
  brakeForce: number,
  speed: number,
  dt: number,
  maxSpeed: number,
  carPos?: THREE.Vector3,
) {
  const absSpeed = Math.abs(speed);
  const speedRatio = Math.min(absSpeed / Math.max(maxSpeed, 1), 1);

  // Accumulate heat: brake force × speed ratio
  if (brakeForce > 0.1 && absSpeed > 5) {
    _brakeTemp = Math.min(_brakeTemp + brakeForce * speedRatio * dt * 3, 1);
  }
  // Thermal decay (exponential cooling)
  _brakeTemp *= Math.exp(-2 * dt);
  if (_brakeTemp < 0.005) _brakeTemp = 0;

  // Emissive intensity driven by temperature
  const glowIntensity = _brakeTemp * 4.0;

  // Color ramp: dark red → bright orange based on temperature
  _brakeEmissiveColor.copy(_darkRed).lerp(_brightOrange, _brakeTemp);

  for (const mat of discMats) {
    mat.emissiveIntensity = glowIntensity;
    mat.emissive.copy(_brakeEmissiveColor);
  }

  // Hot sparks at high temperature + high speed
  if (_brakeTemp > 0.6 && speedRatio > 0.7 && carPos) {
    // Spawn 1-2 sparks from a random wheel position
    const count = Math.random() > 0.5 ? 2 : 1;
    const positions = [
      { x: -0.6, z: 0.9 }, { x: 0.6, z: 0.9 },
      { x: -0.6, z: -0.9 }, { x: 0.6, z: -0.9 },
    ];
    for (let i = 0; i < count; i++) {
      const wp = positions[Math.floor(Math.random() * 4)];
      _brakeSparksPos.set(carPos.x + wp.x, carPos.y + 0.22, carPos.z + wp.z);
      spawnGPUSparks(_brakeSparksPos, 8 + _brakeTemp * 12);
    }
  }
}
const _brakeSparksPos = new THREE.Vector3();

// ── Shoulder Dust (dirt particles when car rides on road edge) ──

const DUST_POOL = 25;
interface DustParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
}
let dustPool: THREE.Mesh[] = [];
const activeDust: DustParticle[] = [];
let dustScene: THREE.Scene | null = null;

export function initShoulderDust(scene: THREE.Scene) {
  dustScene = scene;
  const geo = new THREE.SphereGeometry(0.1, 5, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x886644,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  dustPool = [];
  for (let i = 0; i < DUST_POOL; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    dustPool.push(m);
  }
}

let dustIdx = 0;

/**
 * Spawn shoulder dust at car wheels when riding on road edge.
 * @param pos — car position
 * @param speed — car speed
 * @param side — 'left' or 'right' (which side is on the shoulder)
 */
export function spawnShoulderDust(pos: THREE.Vector3, speed: number, heading: number) {
  if (!dustScene || dustPool.length === 0 || Math.abs(speed) < 8) return;

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);

  // Spawn 1-2 dust puffs from rear wheels
  const count = Math.abs(speed) > 20 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const mesh = dustPool[dustIdx % DUST_POOL];
    dustIdx++;

    const side = (Math.random() > 0.5 ? 1 : -1);
    mesh.position.set(
      pos.x - sinH * (-1.2) + cosH * side * 0.8,
      pos.y + 0.1,
      pos.z - cosH * (-1.2) - sinH * side * 0.8,
    );
    mesh.scale.setScalar(0.3 + Math.random() * 0.5);
    mesh.visible = true;

    const maxLife = 0.5 + Math.random() * 0.5;
    activeDust.push({
      mesh,
      vx: (Math.random() - 0.5) * 3,
      vy: 0.5 + Math.random() * 1.5,
      vz: (Math.random() - 0.5) * 3,
      life: maxLife,
      maxLife,
    });
  }
}

export function updateShoulderDust(dt: number) {
  let j = 0;
  while (j < activeDust.length) {
    const p = activeDust[j];
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      activeDust[j] = activeDust[activeDust.length - 1];
      activeDust.pop();
      continue;
    }

    // Physics: expand + float upward
    p.vx *= 0.97;
    p.vy -= 0.5 * dt;
    p.vz *= 0.97;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    const t = p.life / p.maxLife;
    // Expand as cloud dissipates
    p.mesh.scale.setScalar((1 - t) * 1.5 + 0.3);

    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = t * 0.4;
    // Brown → tan as dust thins out
    const shade = 0.4 + (1 - t) * 0.3;
    mat.color.setRGB(shade, shade * 0.7, shade * 0.4);

    j++;
  }
}

// ── Glass Shard Burst VFX ──
interface GlassShard {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number;
}
const glassShards: GlassShard[] = [];
let _glassScene: THREE.Scene | null = null;
const _glassGeo = new THREE.PlaneGeometry(0.08, 0.08);
const _glassMat = new THREE.MeshStandardMaterial({
  color: 0xaaddff,
  transparent: true,
  opacity: 0.6,
  side: THREE.DoubleSide,
  roughness: 0.1,
  metalness: 0.8,
});

export function triggerGlassShardBurst(scene: THREE.Scene, x: number, y: number, z: number) {
  _glassScene = scene;
  const SHARD_COUNT = 10;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const mesh = new THREE.Mesh(_glassGeo, _glassMat.clone());
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.scale.setScalar(0.5 + Math.random() * 1.5);
    scene.add(mesh);
    glassShards.push({
      mesh,
      vx: (Math.random() - 0.5) * 6,
      vy: 2 + Math.random() * 4,
      vz: (Math.random() - 0.5) * 6,
      life: 1.5,
    });
  }
}

export function updateGlassShards(dt: number) {
  for (let i = glassShards.length - 1; i >= 0; i--) {
    const s = glassShards[i];
    s.life -= dt;
    if (s.life <= 0) {
      if (_glassScene) _glassScene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      glassShards.splice(i, 1);
      continue;
    }
    s.vy -= 9.8 * dt; // gravity
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.y += s.vy * dt;
    s.mesh.position.z += s.vz * dt;
    s.mesh.rotation.x += dt * 5;
    s.mesh.rotation.z += dt * 3;
    (s.mesh.material as THREE.MeshStandardMaterial).opacity = Math.min(0.6, s.life / 0.5);
  }
}

// ── Engine Smoke VFX ──
interface EngineSmokeParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
}
const engineSmokeParticles: EngineSmokeParticle[] = [];
let _smokeEngScene: THREE.Scene | null = null;
const _smokeEngGeo = new THREE.PlaneGeometry(0.5, 0.5);
const _smokeEngMat = new THREE.MeshStandardMaterial({
  color: 0xcccccc,
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const SMOKE_POOL_MAX = 30;

export function updateEngineSmoke(
  scene: THREE.Scene,
  dt: number,
  frontHP: number,
  carX: number, carY: number, carZ: number,
  heading: number,
) {
  _smokeEngScene = scene;

  // Emit new smoke if front HP < 30%
  if (frontHP < 30 && engineSmokeParticles.length < SMOKE_POOL_MAX) {
    const severity = 1 - frontHP / 30; // 0 at 30%, 1 at 0%
    // Emit 1-3 particles per frame based on severity
    const emitCount = Math.min(1 + Math.floor(severity * 2), 3);
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    // Hood position: slightly forward and up from CG
    const hoodX = carX + sinH * (-1.0);
    const hoodZ = carZ + cosH * (-1.0);
    const hoodY = carY + 1.2;

    for (let e = 0; e < emitCount; e++) {
      const mesh = new THREE.Mesh(_smokeEngGeo, _smokeEngMat.clone());
      mesh.position.set(
        hoodX + (Math.random() - 0.5) * 0.4,
        hoodY,
        hoodZ + (Math.random() - 0.5) * 0.4,
      );
      mesh.rotation.z = Math.random() * Math.PI;
      scene.add(mesh);
      const maxLife = 1.0 + Math.random() * 0.8;
      engineSmokeParticles.push({
        mesh,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 2 + Math.random() * 2,
        vz: (Math.random() - 0.5) * 0.8,
        life: maxLife,
        maxLife,
      });
    }
  }

  // Update existing smoke
  for (let i = engineSmokeParticles.length - 1; i >= 0; i--) {
    const p = engineSmokeParticles[i];
    p.life -= dt;
    if (p.life <= 0) {
      if (_smokeEngScene) _smokeEngScene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
      engineSmokeParticles.splice(i, 1);
      continue;
    }
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    // Grow over lifetime
    const age = 1 - p.life / p.maxLife;
    p.mesh.scale.setScalar(0.3 + age * 1.5);
    // Fade out
    const mat = p.mesh.material as THREE.MeshStandardMaterial;
    mat.opacity = (1 - age) * 0.25;
    // Grey-shift over time (white → dark grey)
    const grey = 0.8 - age * 0.4;
    mat.color.setRGB(grey, grey, grey);
  }
}

/** Remove all VFX objects from the scene and DOM. Call between races. */
export function destroyVFX() {
  const sceneRef = smokeScene;

  // Clear smoke particles
  for (const p of activeSmoke) p.mesh.visible = false;
  activeSmoke.length = 0;

  // Clear debris
  for (const d of debrisStates) {
    if (d.active && d.mesh) d.mesh.visible = false;
    d.active = false;
  }
  if (sceneRef) {
    for (const mesh of debrisPool) {
      sceneRef.remove(mesh);
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
  }
  debrisPool.length = 0;
  debrisIdx = 0;

  damageSmokeCooldown = 0;
  flameCooldown = 0;

  if (sceneRef) {
    for (const mesh of smokePool) {
      sceneRef.remove(mesh);
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
  }
  smokePool.length = 0;
  smokeIdx = 0;
  smokeScene = null;

  // Remove speed lines canvas + resize listener
  if (speedLinesResizeHandler) {
    window.removeEventListener('resize', speedLinesResizeHandler);
    speedLinesResizeHandler = null;
  }
  if (speedLinesCanvas) {
    speedLinesCanvas.remove();
    speedLinesCanvas = null;
    speedLinesCtx = null;
  }

  // Boost + nitro cleanup (extracted to vfx-boost.ts)
  destroyBoostVFX();

  // Environment + atmosphere cleanup (extracted to vfx-environment.ts)
  destroyEnvironmentVFX();
}
