/* ── Hood Racer — VFX Hub (Particles & Effects) ──
 *
 * This file contains smoke-pool-based effects (tire smoke, damage smoke,
 * damage flames, damage zone smoke, tire blowout), speed lines, name tags,
 * and underglow. All other VFX are extracted into focused modules.
 */

import * as THREE from 'three/webgpu';


// ── Re-exports from extracted modules ──
import { initBoostFlame, updateBoostFlame, triggerBoostBurst, triggerBackfireSequence, initNitroTrail, spawnNitroTrail, updateNitroTrail, initBoostShockwave, initNitroFlash, triggerBoostShockwave, updateBoostShockwave, destroyBoostVFX } from './vfx-boost';
export { initBoostFlame, updateBoostFlame, triggerBoostBurst, triggerBackfireSequence, initNitroTrail, spawnNitroTrail, updateNitroTrail, initBoostShockwave, initNitroFlash, triggerBoostShockwave, updateBoostShockwave } from './vfx-boost';
import { initRainDroplets, updateRainDroplets, initImpactFlash, triggerImpactFlash, updateImpactFlash, initAmbientParticles, updateAmbientParticles, initHeatShimmer, updateHeatShimmer, initLensFlares, updateLensFlares, initLightning, setLightningEnabled, updateLightning, initNearMissStreaks, triggerNearMiss, updateNearMissStreaks, initNearMissWhoosh, triggerNearMissWhoosh, updateNearMissWhoosh, initVictoryConfetti, spawnVictoryConfetti, setConfettiContinuous, updateVictoryConfetti, destroyEnvironmentVFX } from './vfx-environment';
export { initRainDroplets, updateRainDroplets, initImpactFlash, triggerImpactFlash, updateImpactFlash, initAmbientParticles, updateAmbientParticles, initHeatShimmer, updateHeatShimmer, initLensFlares, updateLensFlares, initLightning, setLightningEnabled, updateLightning, initNearMissStreaks, triggerNearMiss, updateNearMissStreaks, initNearMissWhoosh, triggerNearMissWhoosh, updateNearMissWhoosh, initVictoryConfetti, spawnVictoryConfetti, setConfettiContinuous, updateVictoryConfetti } from './vfx-environment';
export { initRimSparks, spawnRimSparks, updateRimSparks, initBackfire, spawnBackfire, updateBackfire, createBrakeDiscs, updateBrakeDiscs, initShoulderDust, spawnShoulderDust, updateShoulderDust } from './vfx-contact';

// Skid marks
import { initDebrisVFX, warmupDebrisVFX, destroyDebrisVFX} from './vfx-debris';
export { initSkidMarks, addSkidQuad, updateSkidMarks, destroySkidMarks, updateSkidGlowTime } from './vfx-skidmarks';

// Debris + glass + engine smoke
export { spawnDebris, updateDebris, triggerGlassShardBurst, updateGlassShards, updateEngineSmoke } from './vfx-debris';


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

  // Init debris scene ref
  initDebrisVFX(scene);
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

// ── Sustained Damage Zone Smoke ──
let dmgSmokeCd = 0;

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

// ── Neon Underglow ──

const _nitroCyanColor = new THREE.Color(0x44aaff);
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
  light.position.set(0, -0.3, 0);
  carGroup.add(light);
  return light;
}

export function updateUnderglow(light: THREE.PointLight, speed: number, time: number, isNitroActive = false) {
  const speedFactor = Math.min(Math.abs(speed) / 40, 1);

  if (isNitroActive) {
    const pulse = 0.8 + Math.sin(time * 8) * 0.15 + Math.sin(time * 13) * 0.05;
    light.intensity = (4.5 + speedFactor * 3.0) * pulse;
    light.distance = 10 + speedFactor * 5;
    light.color.lerp(_nitroCyanColor, 0.15);
  } else {
    const pulse = 0.7 + Math.sin(time * 3) * 0.15 + Math.sin(time * 7.3) * 0.08;
    light.intensity = (1.5 + speedFactor * 2.0) * pulse;
    light.distance = 6 + speedFactor * 4;
  }
}

// ── Warmup (eagerly initialize all pools) ──

export function warmupVFX() {
  warmupDebrisVFX();
}

/** Remove all VFX objects from the scene and DOM. Call between races. */
export function destroyVFX() {
  // Clear smoke particles
  for (const p of activeSmoke) p.mesh.visible = false;
  activeSmoke.length = 0;

  damageSmokeCooldown = 0;
  flameCooldown = 0;

  if (smokeScene) {
    for (const mesh of smokePool) {
      smokeScene.remove(mesh);
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

  // Debris + glass + engine smoke cleanup
  destroyDebrisVFX();

  // Boost + nitro cleanup
  destroyBoostVFX();

  // Environment + atmosphere cleanup
  destroyEnvironmentVFX();
}
