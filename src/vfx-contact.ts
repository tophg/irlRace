/* ── IRL Race — Contact & Surface VFX ──
 *
 * Extracted from vfx.ts. Contains VFX systems for car-surface interactions:
 *   • Rim sparks — persistent sparking on blown tires
 *   • Exhaust backfire — flame bursts on deceleration
 *   • Brake disc glow — temperature-based emissive discs
 *   • Shoulder dust — dirt particles on road edge
 */

import * as THREE from 'three/webgpu';
import { spawnGPUSparks } from './gpu-particles';

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
