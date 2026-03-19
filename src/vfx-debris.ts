/* ── IRL Race — Debris, Glass & Engine Smoke VFX ──
 *
 * Extracted from vfx.ts. Contains three independent pooled particle systems:
 * 1. Metal debris — tumbling shards on heavy impacts
 * 2. Glass shards — burst on windshield/window impacts
 * 3. Engine smoke — continuous hood smoke on front damage
 */

import * as THREE from 'three/webgpu';

// ── Shared scene ref (set by initDebrisVFX) ──
let _debrisScene: THREE.Scene | null = null;

export function initDebrisVFX(scene: THREE.Scene) {
  _debrisScene = scene;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// METAL DEBRIS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
  if (debrisPool.length > 0 || !_debrisScene) return;
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
    _debrisScene.add(m);
    debrisPool.push(m);
  }
  ensureDebrisStates();
}

/** Eagerly initialize debris pool at race start (avoids lazy-init stall on first explosion). */
export function warmupDebrisVFX() {
  ensureDebrisPool();
}

/** Spawn metal debris particles at impact point. force controls count + speed. */
export function spawnDebris(pos: THREE.Vector3, force: number, carVelX = 0, carVelZ = 0) {
  if (!_debrisScene) return;
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

/** Update debris physics (gravity, ground bounce, fade). */
export function updateDebris(dt: number) {
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GLASS SHARD BURST (pooled)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GLASS_POOL_SIZE = 15;

interface GlassShardState {
  active: boolean;
  vx: number; vy: number; vz: number;
  life: number;
}

const _glassGeo = new THREE.PlaneGeometry(0.08, 0.08);
const _glassPool: THREE.Mesh[] = [];
const _glassStates: GlassShardState[] = [];
let _glassPoolReady = false;
let _glassScene: THREE.Scene | null = null;
let _glassWriteIdx = 0;

function ensureGlassPool(scene: THREE.Scene) {
  if (_glassPoolReady) return;
  _glassPoolReady = true;
  _glassScene = scene;
  for (let i = 0; i < GLASS_POOL_SIZE; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xaaddff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      roughness: 0.1,
      metalness: 0.8,
    });
    const mesh = new THREE.Mesh(_glassGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    _glassPool.push(mesh);
    _glassStates.push({ active: false, vx: 0, vy: 0, vz: 0, life: 0 });
  }
}

export function triggerGlassShardBurst(scene: THREE.Scene, x: number, y: number, z: number) {
  ensureGlassPool(scene);
  const SHARD_COUNT = 10;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const idx = _glassWriteIdx % GLASS_POOL_SIZE;
    _glassWriteIdx++;
    const mesh = _glassPool[idx];
    const st = _glassStates[idx];
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.scale.setScalar(0.5 + Math.random() * 1.5);
    (mesh.material as THREE.MeshStandardMaterial).opacity = 0.6;
    mesh.visible = true;
    st.active = true;
    st.vx = (Math.random() - 0.5) * 6;
    st.vy = 2 + Math.random() * 4;
    st.vz = (Math.random() - 0.5) * 6;
    st.life = 1.5;
  }
}

export function updateGlassShards(dt: number) {
  for (let i = 0; i < GLASS_POOL_SIZE; i++) {
    const st = _glassStates[i];
    if (!st.active) continue;
    st.life -= dt;
    if (st.life <= 0) {
      st.active = false;
      _glassPool[i].visible = false;
      continue;
    }
    st.vy -= 9.8 * dt;
    const mesh = _glassPool[i];
    mesh.position.x += st.vx * dt;
    mesh.position.y += st.vy * dt;
    mesh.position.z += st.vz * dt;
    mesh.rotation.x += dt * 5;
    mesh.rotation.z += dt * 3;
    (mesh.material as THREE.MeshStandardMaterial).opacity = Math.min(0.6, st.life / 0.5);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENGINE SMOKE (pooled)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SMOKE_ENG_POOL_SIZE = 30;

interface EngineSmokeState {
  active: boolean;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
}

const _smokeEngGeo = new THREE.PlaneGeometry(0.5, 0.5);
const _smokeEngPool: THREE.Mesh[] = [];
const _smokeEngStates: EngineSmokeState[] = [];
let _smokeEngPoolReady = false;
let _smokeEngWriteIdx = 0;

function ensureSmokeEngPool(scene: THREE.Scene) {
  if (_smokeEngPoolReady) return;
  _smokeEngPoolReady = true;
  for (let i = 0; i < SMOKE_ENG_POOL_SIZE; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(_smokeEngGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    _smokeEngPool.push(mesh);
    _smokeEngStates.push({ active: false, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 });
  }
}

export function updateEngineSmoke(
  scene: THREE.Scene,
  dt: number,
  frontHP: number,
  carX: number, carY: number, carZ: number,
  heading: number,
) {
  ensureSmokeEngPool(scene);

  // Emit new smoke if front HP < 30%
  if (frontHP < 30) {
    const severity = 1 - frontHP / 30;
    const emitCount = Math.min(1 + Math.floor(severity * 2), 3);
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    const hoodX = carX + sinH * (-1.0);
    const hoodZ = carZ + cosH * (-1.0);
    const hoodY = carY + 1.2;

    for (let e = 0; e < emitCount; e++) {
      const idx = _smokeEngWriteIdx % SMOKE_ENG_POOL_SIZE;
      _smokeEngWriteIdx++;
      const mesh = _smokeEngPool[idx];
      const st = _smokeEngStates[idx];
      mesh.position.set(
        hoodX + (Math.random() - 0.5) * 0.4,
        hoodY,
        hoodZ + (Math.random() - 0.5) * 0.4,
      );
      mesh.rotation.z = Math.random() * Math.PI;
      mesh.scale.setScalar(0.3);
      mesh.visible = true;
      const maxLife = 1.0 + Math.random() * 0.8;
      st.active = true;
      st.vx = (Math.random() - 0.5) * 0.8;
      st.vy = 2 + Math.random() * 2;
      st.vz = (Math.random() - 0.5) * 0.8;
      st.life = maxLife;
      st.maxLife = maxLife;
    }
  }

  // Update existing smoke
  for (let i = 0; i < SMOKE_ENG_POOL_SIZE; i++) {
    const st = _smokeEngStates[i];
    if (!st.active) continue;
    st.life -= dt;
    if (st.life <= 0) {
      st.active = false;
      _smokeEngPool[i].visible = false;
      continue;
    }
    const mesh = _smokeEngPool[i];
    mesh.position.x += st.vx * dt;
    mesh.position.y += st.vy * dt;
    mesh.position.z += st.vz * dt;
    const age = 1 - st.life / st.maxLife;
    mesh.scale.setScalar(0.3 + age * 1.5);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.opacity = (1 - age) * 0.25;
    const grey = 0.8 - age * 0.4;
    mat.color.setRGB(grey, grey, grey);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLEANUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function destroyDebrisVFX() {
  // Clear debris
  for (const d of debrisStates) {
    if (d.active && d.mesh) d.mesh.visible = false;
    d.active = false;
  }
  if (_debrisScene) {
    for (const mesh of debrisPool) {
      _debrisScene.remove(mesh);
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
  }
  debrisPool.length = 0;
  debrisIdx = 0;

  // Clear glass pool
  for (let i = 0; i < _glassPool.length; i++) {
    _glassPool[i].visible = false;
    _glassStates[i].active = false;
    _glassScene?.remove(_glassPool[i]);
    _glassPool[i].geometry?.dispose();
    (_glassPool[i].material as THREE.Material)?.dispose();
  }
  _glassPool.length = 0;
  _glassStates.length = 0;
  _glassPoolReady = false;
  _glassWriteIdx = 0;

  // Clear engine smoke pool
  for (let i = 0; i < _smokeEngPool.length; i++) {
    _smokeEngPool[i].visible = false;
    _smokeEngStates[i].active = false;
  }
  _smokeEngPool.length = 0;
  _smokeEngStates.length = 0;
  _smokeEngPoolReady = false;
  _smokeEngWriteIdx = 0;

  _debrisScene = null;
}
