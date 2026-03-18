/* ── Hood Racer — GPU Particle System ──
 *
 * All particle data lives on the GPU via StorageBufferAttribute.
 * A TSL compute shader updates positions/velocities/lifetimes per frame.
 * Rendering uses a single InstancedMesh with SpriteNodeMaterial.
 *
 * CPU only writes to a staging ring-buffer when spawning; the compute
 * shader handles all per-frame simulation (gravity, fade, scale).
 *
 * Usage:
 *   import { initGPUParticles, spawnGPUSmoke, updateGPUParticles } from './gpu-particles';
 *   await initGPUParticles(renderer, scene);
 *   spawnGPUSmoke(position, intensity);
 *   updateGPUParticles(renderer, dt);
 */

import * as THREE from 'three/webgpu';
import { SpriteNodeMaterial } from 'three/webgpu';
import {
  storage, uniform, instanceIndex, compute, Fn,
  float, If,
} from 'three/tsl';

// ── Configuration ──
const MAX_PARTICLES = 8192;

// Particle type flags (stored in type channel)
export const PType = { NONE: 0, SMOKE: 1, SPARK: 2, FLAME: 3, GLASS: 4, DUST: 5, AMBIENT: 6 } as const;

// ── GPU Storage Arrays ──
// Each particle has: position(vec3), velocity(vec3), color(vec4), life(float), maxLife(float), type(float), size(float)
let positionBuffer: THREE.StorageBufferAttribute;
let velocityBuffer: THREE.StorageBufferAttribute;
let colorBuffer: THREE.StorageBufferAttribute;
let lifeBuffer: THREE.StorageBufferAttribute;
let maxLifeBuffer: THREE.StorageBufferAttribute;
let typeBuffer: THREE.StorageBufferAttribute;
let sizeBuffer: THREE.StorageBufferAttribute;

// CPU staging data for spawn writes
const cpuPositions = new Float32Array(MAX_PARTICLES * 3);
const cpuVelocities = new Float32Array(MAX_PARTICLES * 3);
const cpuColors = new Float32Array(MAX_PARTICLES * 4);
const cpuLife = new Float32Array(MAX_PARTICLES);
const cpuMaxLife = new Float32Array(MAX_PARTICLES);
const cpuType = new Float32Array(MAX_PARTICLES);
const cpuSize = new Float32Array(MAX_PARTICLES);

let spawnHead = 0;   // ring-buffer write head
let lastSpawnTime = 0; // for idle skip
const MAX_PARTICLE_LIFETIME = 3.0; // seconds — longest any particle lives
let instanceMesh: THREE.InstancedMesh | null = null;
let computeNode: ReturnType<typeof compute> | null = null;
let gpuScene: THREE.Scene | null = null;

// Uniforms written each frame from CPU
const uDt = uniform(0.016);
const uGravity = uniform(9.8);

// ── Init ──
export async function initGPUParticles(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
) {
  gpuScene = scene;

  // Create storage buffers only once to prevent VRAM growth across races
  if (!positionBuffer) {
    positionBuffer = new THREE.StorageBufferAttribute(cpuPositions, 3);
    velocityBuffer = new THREE.StorageBufferAttribute(cpuVelocities, 3);
    colorBuffer = new THREE.StorageBufferAttribute(cpuColors, 4);
    lifeBuffer = new THREE.StorageBufferAttribute(cpuLife, 1);
    maxLifeBuffer = new THREE.StorageBufferAttribute(cpuMaxLife, 1);
    typeBuffer = new THREE.StorageBufferAttribute(cpuType, 1);
    sizeBuffer = new THREE.StorageBufferAttribute(cpuSize, 1);
  }

  // TSL storage nodes for compute shader access
  const sPos = storage(positionBuffer, 'vec3', MAX_PARTICLES);
  const sVel = storage(velocityBuffer, 'vec3', MAX_PARTICLES);
  const sColor = storage(colorBuffer, 'vec4', MAX_PARTICLES);
  const sLife = storage(lifeBuffer, 'float', MAX_PARTICLES);
  const sMaxLife = storage(maxLifeBuffer, 'float', MAX_PARTICLES);
  const sType = storage(typeBuffer, 'float', MAX_PARTICLES);
  const sSize = storage(sizeBuffer, 'float', MAX_PARTICLES);

  // ── Compute kernel: update all particles per frame ──
  const updateParticles = Fn(() => {
    const i = instanceIndex;

    const life = sLife.element(i);
    const maxLife_ = sMaxLife.element(i);
    const pType = sType.element(i);

    // Skip dead particles
    If(life.greaterThan(0.0), () => {
      const pos = sPos.element(i);
      const vel = sVel.element(i);
      const dt = uDt;

      // Integrate position
      pos.addAssign(vel.mul(dt));

      // Gravity (sparks fall fast, smoke rises)
      If(pType.equal(float(PType.SPARK)), () => {
        vel.y.subAssign(uGravity.mul(dt).mul(1.5));
      }).Else(() => {
        vel.y.subAssign(uGravity.mul(dt).mul(-0.05)); // smoke rises slightly
      });

      // Drag
      vel.mulAssign(float(1.0).sub(dt.mul(0.5)));

      // Fade out: reduce life
      life.subAssign(dt);

      // Update color alpha based on remaining life fraction
      const lifeFrac = life.div(maxLife_);
      const col = sColor.element(i);
      col.w.assign(lifeFrac); // linear fade: life → 0 maps to alpha → 0

      // Update size: smoke grows, sparks shrink
      const sz = sSize.element(i);
      If(pType.equal(float(PType.SMOKE)), () => {
        sz.assign(sz.mul(float(1.0).add(dt.mul(2.0)))); // grow
      }).ElseIf(pType.equal(float(PType.SPARK)), () => {
        sz.assign(sz.mul(float(1.0).sub(dt.mul(1.5)))); // shrink
      });
    });
  });

  computeNode = compute(updateParticles(), MAX_PARTICLES);

  // ── Instanced sprite mesh for rendering ──
  const mat = new SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  // Per-instance position from storage buffer
  mat.positionNode = sPos.toAttribute();
  // Per-instance color from storage buffer
  mat.colorNode = sColor.toAttribute();
  // Per-instance scale from storage buffer (used as scaleNode)
  // SpriteNodeMaterial uses scaleNode for size
  mat.scaleNode = sSize.toAttribute();

  const geo = new THREE.PlaneGeometry(1, 1);
  instanceMesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
  instanceMesh.frustumCulled = false;
  instanceMesh.count = MAX_PARTICLES;
  scene.add(instanceMesh);

  // Initial compute pass to zero everything out
  await renderer.computeAsync(computeNode);
}

// ── Spawn helpers (CPU → GPU staging) ──

// Dirty range tracking — only upload changed region instead of full 8192-particle buffer
let _dirtyStart = Infinity;
let _dirtyEnd = -1;

function writeParticle(
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  r: number, g: number, b: number, a: number,
  life: number, type: number, size: number,
) {
  const idx = spawnHead % MAX_PARTICLES;
  const i3 = idx * 3;
  const i4 = idx * 4;

  cpuPositions[i3] = px; cpuPositions[i3 + 1] = py; cpuPositions[i3 + 2] = pz;
  cpuVelocities[i3] = vx; cpuVelocities[i3 + 1] = vy; cpuVelocities[i3 + 2] = vz;
  cpuColors[i4] = r; cpuColors[i4 + 1] = g; cpuColors[i4 + 2] = b; cpuColors[i4 + 3] = a;
  cpuLife[idx] = life;
  cpuMaxLife[idx] = life;
  cpuType[idx] = type;
  cpuSize[idx] = size;

  // Track dirty range
  if (idx < _dirtyStart) _dirtyStart = idx;
  if (idx > _dirtyEnd) _dirtyEnd = idx;

  spawnHead++;
  lastSpawnTime = performance.now() / 1000;
}

/**
 * Upload only the dirty region of particle buffers to GPU.
 * Call ONCE per frame after all spawn functions, NOT inside each spawn.
 * Uses addUpdateRange to avoid re-uploading the full 8192-particle buffer.
 */
export function flushToGPU() {
  if (_dirtyEnd < 0) return; // nothing written this frame

  // Per-buffer partial upload via addUpdateRange
  const buffers3 = [positionBuffer, velocityBuffer];
  const buffers4 = [colorBuffer];
  const buffers1 = [lifeBuffer, maxLifeBuffer, typeBuffer, sizeBuffer];

  for (const buf of buffers3) {
    buf.clearUpdateRanges();
    buf.addUpdateRange(_dirtyStart * 3, (_dirtyEnd - _dirtyStart + 1) * 3);
    buf.needsUpdate = true;
  }
  for (const buf of buffers4) {
    buf.clearUpdateRanges();
    buf.addUpdateRange(_dirtyStart * 4, (_dirtyEnd - _dirtyStart + 1) * 4);
    buf.needsUpdate = true;
  }
  for (const buf of buffers1) {
    buf.clearUpdateRanges();
    buf.addUpdateRange(_dirtyStart, _dirtyEnd - _dirtyStart + 1);
    buf.needsUpdate = true;
  }

  _dirtyStart = Infinity;
  _dirtyEnd = -1;
}

/** Spawn tire smoke particles at the given world position. */
export function spawnGPUSmoke(pos: THREE.Vector3, driftIntensity: number) {
  if (driftIntensity < 0.15) return;
  const count = Math.floor(driftIntensity * 3);
  for (let i = 0; i < count; i++) {
    writeParticle(
      pos.x + (Math.random() - 0.5) * 0.5,
      pos.y + 0.1,
      pos.z + (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 1.5,
      0.4 + Math.random() * 0.6,
      (Math.random() - 0.5) * 1.5,
      0.8, 0.8, 0.8, 0.3,   // light gray, semi-transparent
      0.8 + Math.random() * 0.6,
      PType.SMOKE,
      0.5 + Math.random() * 0.5,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn collision spark particles at the given world position. */
export function spawnGPUSparks(pos: THREE.Vector3, force: number) {
  const count = Math.min(Math.floor(force * 0.8), 12);
  for (let i = 0; i < count; i++) {
    const isOrange = Math.random() > 0.5;
    writeParticle(
      pos.x, pos.y + 0.5, pos.z,
      (Math.random() - 0.5) * 8,
      1 + Math.random() * 4,
      (Math.random() - 0.5) * 8,
      1.0, isOrange ? 0.65 : 0.93, isOrange ? 0.2 : 0.4, 1.0,
      0.3 + Math.random() * 0.3,
      PType.SPARK,
      0.15 + Math.random() * 0.1,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn explosion burst particles (sparks + dark smoke + molten debris). */
export function spawnGPUExplosion(pos: THREE.Vector3, force: number) {
  const sparkCount = Math.min(Math.floor(force * 0.8), 25);
  for (let i = 0; i < sparkCount; i++) {
    const speed = 5 + Math.random() * 12;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const roll = Math.random();

    // Temperature-gradient coloring: white-hot → orange → deep red
    let r: number, g: number, b: number, size: number;
    if (roll < 0.3) {
      // White-hot core sparks (brightest, fastest)
      r = 1.0; g = 0.95; b = 0.7;
      size = 0.3 + Math.random() * 0.2;
    } else if (roll < 0.7) {
      // Standard orange sparks
      r = 1.0; g = 0.4 + Math.random() * 0.3; b = 0.1;
      size = 0.4 + Math.random() * 0.3;
    } else {
      // Deep red trailing embers (slower, longer-lived)
      r = 0.8; g = 0.12 + Math.random() * 0.1; b = 0.05;
      size = 0.5 + Math.random() * 0.4;
    }

    writeParticle(
      pos.x, pos.y + 0.5, pos.z,
      Math.sin(phi) * Math.cos(theta) * speed,
      Math.abs(Math.cos(phi)) * speed * 0.7 + 2,
      Math.sin(phi) * Math.sin(theta) * speed,
      r, g, b, 1.0,
      0.4 + Math.random() * 0.4,
      PType.SPARK,
      size,
    );
  }

  // Molten debris chunks (large, slow, dark gray)
  for (let i = 0; i < 3; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 4;
    writeParticle(
      pos.x, pos.y + 0.5, pos.z,
      Math.cos(angle) * spd,
      1 + Math.random() * 3,
      Math.sin(angle) * spd,
      0.25, 0.2, 0.15, 0.8,
      1.4 + Math.random() * 0.6,
      PType.SMOKE,
      1.2 + Math.random() * 0.6,
    );
  }

  // Dark smoke cloud
  for (let i = 0; i < 6; i++) {
    writeParticle(
      pos.x + (Math.random() - 0.5) * 1.5,
      pos.y + 0.5 + Math.random() * 0.5,
      pos.z + (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 3,
      1 + Math.random() * 2,
      (Math.random() - 0.5) * 3,
      0.13, 0.13, 0.13, 0.5,
      1.2 + Math.random() * 0.3,
      PType.SMOKE,
      1.5 + Math.random(),
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn outward dust/dirt kick-up wave from explosion concussion. */
export function spawnExplosionDust(pos: THREE.Vector3, force: number) {
  const count = Math.min(Math.floor(force * 0.6), 20);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 8 + Math.random() * 7;
    writeParticle(
      pos.x + Math.cos(angle) * 0.5,
      pos.y + 0.1,
      pos.z + Math.sin(angle) * 0.5,
      Math.cos(angle) * speed,
      0.3 + Math.random() * 0.7,  // stays near ground
      Math.sin(angle) * speed,
      0.65, 0.55, 0.35, 0.4,      // tan/dirt color
      0.8 + Math.random() * 0.4,
      PType.DUST,
      1.8 + Math.random() * 1.0,   // large
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn damage smoke (throttled). */
let damageSmokeCD = 0;
export function spawnGPUDamageSmoke(pos: THREE.Vector3, intensity: number, dt = 0.016) {
  if (intensity < 0.1) return;
  damageSmokeCD -= dt;
  if (damageSmokeCD > 0) return;
  damageSmokeCD = 0.15 - intensity * 0.1;

  writeParticle(
    pos.x + (Math.random() - 0.5) * 0.8,
    pos.y + 1.5,
    pos.z + (Math.random() - 0.5) * 0.8,
    (Math.random() - 0.5) * 0.5,
    0.8 + Math.random() * 0.4,
    (Math.random() - 0.5) * 0.5,
    0.2, 0.2, 0.2, 0.3,
    1.2,
    PType.SMOKE,
    0.6 + intensity * 0.5,
  );
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn flame particles (fire on critical damage). */
let flameCD = 0;
export function spawnGPUFlame(pos: THREE.Vector3, intensity: number, dt = 0.016) {
  if (intensity < 0.1) return;
  flameCD -= dt;
  if (flameCD > 0) return;
  flameCD = 0.03;

  const count = Math.ceil(intensity * 2);
  for (let n = 0; n < count; n++) {
    const g = 0.2 + Math.random() * 0.6;
    writeParticle(
      pos.x + (Math.random() - 0.5) * 0.6,
      pos.y + 0.3 + Math.random() * 0.3,
      pos.z + (Math.random() - 0.5) * 0.6,
      (Math.random() - 0.5) * 1.5,
      1.5 + Math.random() * 2.0,
      (Math.random() - 0.5) * 1.5,
      1.0, g, 0.0, 0.7,
      0.3 + Math.random() * 0.2,
      PType.FLAME,
      0.3 + intensity * 0.3,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn scrape sparks along a barrier contact line. */
export function spawnGPUScrapeSparks(pos: THREE.Vector3, speed: number, heading: number) {
  const count = Math.min(Math.floor(Math.abs(speed) * 0.15), 6);
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  for (let i = 0; i < count; i++) {
    const isOrange = Math.random() > 0.4;
    writeParticle(
      pos.x + (Math.random() - 0.5) * 0.5,
      pos.y + 0.3 + Math.random() * 0.3,
      pos.z + (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 6 + sinH * 2,
      1 + Math.random() * 3,
      (Math.random() - 0.5) * 6 + cosH * 2,
      1.0, isOrange ? 0.6 : 0.9, isOrange ? 0.15 : 0.35, 1.0,
      0.25 + Math.random() * 0.2,
      PType.SPARK,
      0.1 + Math.random() * 0.08,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn glass shard burst (translucent blue shards with gravity). */
export function spawnGPUGlassShards(pos: THREE.Vector3) {
  for (let i = 0; i < 10; i++) {
    const speed = 3 + Math.random() * 5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.6;
    writeParticle(
      pos.x, pos.y + 0.5, pos.z,
      Math.sin(phi) * Math.cos(theta) * speed,
      Math.abs(Math.cos(phi)) * speed * 0.5 + 2,
      Math.sin(phi) * Math.sin(theta) * speed,
      0.6, 0.8, 1.0, 0.5,
      1.0 + Math.random() * 0.5,
      PType.GLASS,
      0.08 + Math.random() * 0.06,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn shoulder dust when near barriers at speed. */
export function spawnGPUShoulderDust(pos: THREE.Vector3, speed: number, heading: number) {
  const count = Math.min(Math.floor(Math.abs(speed) * 0.08), 4);
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  for (let i = 0; i < count; i++) {
    writeParticle(
      pos.x + (Math.random() - 0.5) * 2,
      pos.y + 0.1 + Math.random() * 0.3,
      pos.z + (Math.random() - 0.5) * 2,
      -sinH * Math.abs(speed) * 0.15 + (Math.random() - 0.5) * 2,
      0.3 + Math.random() * 0.5,
      -cosH * Math.abs(speed) * 0.15 + (Math.random() - 0.5) * 2,
      0.65, 0.55, 0.4, 0.25,
      0.8 + Math.random() * 0.4,
      PType.DUST,
      0.4 + Math.random() * 0.3,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn nitro exhaust trail particles. */
export function spawnGPUNitroTrail(pos: THREE.Vector3, heading: number, speed: number) {
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const count = 2;
  for (let i = 0; i < count; i++) {
    const g = 0.3 + Math.random() * 0.5;
    writeParticle(
      pos.x - sinH * 2.2 + (Math.random() - 0.5) * 0.3,
      pos.y + 0.4 + Math.random() * 0.2,
      pos.z - cosH * 2.2 + (Math.random() - 0.5) * 0.3,
      -sinH * Math.abs(speed) * 0.3 + (Math.random() - 0.5) * 1.5,
      0.5 + Math.random() * 1.0,
      -cosH * Math.abs(speed) * 0.3 + (Math.random() - 0.5) * 1.5,
      0.2, 0.5, 1.0, 0.8,
      0.3 + Math.random() * 0.2,
      PType.FLAME,
      0.25 + Math.random() * 0.15,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn rim sparks for blown-out tires. */
export function spawnGPURimSparks(pos: THREE.Vector3, speed: number) {
  const count = Math.min(Math.ceil(Math.abs(speed) * 0.1), 3);
  for (let i = 0; i < count; i++) {
    const isOrange = Math.random() > 0.3;
    writeParticle(
      pos.x + (Math.random() - 0.5) * 0.3,
      pos.y + 0.05,
      pos.z + (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 5,
      0.5 + Math.random() * 2,
      (Math.random() - 0.5) * 5,
      1.0, isOrange ? 0.55 : 0.85, isOrange ? 0.1 : 0.3, 1.0,
      0.2 + Math.random() * 0.15,
      PType.SPARK,
      0.06 + Math.random() * 0.04,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn backfire exhaust pop. */
export function spawnGPUBackfire(carPos: THREE.Vector3, heading: number) {
  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  for (let i = 0; i < 5; i++) {
    const isFlame = i < 3;
    const g = isFlame ? (0.2 + Math.random() * 0.5) : 0.13;
    const a = isFlame ? 0.7 : 0.4;
    writeParticle(
      carPos.x - sinH * 2.4 + (Math.random() - 0.5) * 0.3,
      carPos.y + 0.35,
      carPos.z - cosH * 2.4 + (Math.random() - 0.5) * 0.3,
      -sinH * (4 + Math.random() * 3) + (Math.random() - 0.5) * 2,
      0.3 + Math.random() * 1.0,
      -cosH * (4 + Math.random() * 3) + (Math.random() - 0.5) * 2,
      1.0, g, 0.0, a,
      0.2 + Math.random() * 0.15,
      isFlame ? PType.FLAME : PType.SMOKE,
      isFlame ? 0.2 + Math.random() * 0.1 : 0.3 + Math.random() * 0.2,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

/** Spawn slipstream air-streak particles from AI car's rear during drafting. */
export function spawnGPUSlipstream(
  aiPos: THREE.Vector3, aiHeading: number, carSpeed: number,
) {
  const sinH = Math.sin(aiHeading);
  const cosH = Math.cos(aiHeading);
  const count = 3 + (Math.random() > 0.5 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.8;
    writeParticle(
      aiPos.x - sinH * 2.5 + cosH * spread,
      aiPos.y + 0.3 + Math.random() * 0.8,
      aiPos.z - cosH * 2.5 - sinH * spread,
      -sinH * Math.abs(carSpeed) * 0.4 + (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 0.5,
      -cosH * Math.abs(carSpeed) * 0.4 + (Math.random() - 0.5) * 1.5,
      0.85, 0.9, 1.0, 0.08,
      0.3 + Math.random() * 0.15,
      PType.DUST,
      0.3 + Math.random() * 0.3,
    );
  }
  // flushToGPU() removed — caller is responsible for batched flush
}

// ── Per-frame update ──

export function updateGPUParticles(
  renderer: THREE.WebGPURenderer,
  dt: number,
) {
  if (!computeNode) return;
  // Skip compute dispatch if no particles are alive
  const now = performance.now() / 1000;
  if (lastSpawnTime > 0 && (now - lastSpawnTime) > MAX_PARTICLE_LIFETIME) return;
  uDt.value = dt;
  // Fire-and-forget: no await — GPU runs compute in parallel with CPU
  // Eliminates the CPU-GPU sync stall that blocked the event loop
  renderer.computeAsync(computeNode);
}

// ── Cleanup ──

export function destroyGPUParticles() {
  if (instanceMesh) {
    instanceMesh.parent?.remove(instanceMesh);
    instanceMesh.geometry.dispose();
    (instanceMesh.material as THREE.Material).dispose();
    instanceMesh = null;
  }
  computeNode = null;
  gpuScene = null;
  spawnHead = 0;
  damageSmokeCD = 0;
  flameCD = 0;

  // Zero out CPU staging buffers
  cpuPositions.fill(0);
  cpuVelocities.fill(0);
  cpuColors.fill(0);
  cpuLife.fill(0);
  cpuMaxLife.fill(0);
  cpuType.fill(0);
  cpuSize.fill(0);
}
