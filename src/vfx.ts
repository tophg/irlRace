/* ── Hood Racer — VFX (Particles & Effects) ── */

import * as THREE from 'three';

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

export function spawnTireSmoke(pos: THREE.Vector3, driftIntensity: number) {
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
    mat.opacity = 0.25 + driftIntensity * 0.2;
    mat.color.setHex(0xcccccc);

    const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
    smokeVelIdx++;
    vel.set(
      (Math.random() - 0.5) * 1.5,
      0.4 + Math.random() * 0.6,
      (Math.random() - 0.5) * 1.5,
    );

    const life = 0.8 + Math.random() * 0.6;
    activeSmoke.push({ mesh, velocity: vel, life, maxLife: life });
  }
}

export function updateVFX(dt: number) {
  for (let i = activeSmoke.length - 1; i >= 0; i--) {
    const p = activeSmoke[i];
    p.life -= dt;

    if (p.life <= 0) {
      p.mesh.visible = false;
      activeSmoke.splice(i, 1);
      continue;
    }

    p.mesh.position.addScaledVector(p.velocity, dt);
    p.velocity.y *= 0.98;

    const lifeFrac = p.life / p.maxLife;
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = lifeFrac * 0.3;
    p.mesh.scale.setScalar(1.5 - lifeFrac * 0.8);
  }

  // Sparks
  for (let i = activeSparks.length - 1; i >= 0; i--) {
    const s = activeSparks[i];
    s.life -= dt;
    if (s.life <= 0) {
      s.mesh.visible = false;
      activeSparks.splice(i, 1);
      continue;
    }
    s.mesh.position.addScaledVector(s.velocity, dt);
    s.velocity.y -= 15 * dt; // gravity
    const mat = s.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = s.life * 3;
    s.mesh.scale.setScalar(0.5 + (1 - s.life) * 0.5);
  }
}

// ── Speed Lines (screen-space, canvas 2D overlay) ──
let speedLinesCanvas: HTMLCanvasElement | null = null;
let speedLinesCtx: CanvasRenderingContext2D | null = null;
let speedLinesResizeHandler: (() => void) | null = null;

export function initSpeedLines(container: HTMLElement) {
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

export function updateSpeedLines(speedRatio: number) {
  if (!speedLinesCanvas || !speedLinesCtx) return;

  // Fade in/out based on speed
  speedLinesCanvas.style.opacity = (speedRatio > 0.7 ? (speedRatio - 0.7) / 0.3 : 0).toString();

  const ctx = speedLinesCtx;
  const w = speedLinesCanvas.width;
  const h = speedLinesCanvas.height;
  const cx = w / 2;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);

  const numLines = 30;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;

  for (let i = 0; i < numLines; i++) {
    const angle = (i / numLines) * Math.PI * 2 + Date.now() * 0.0005;
    const innerR = 80 + Math.random() * 40;
    const outerR = innerR + 80 + Math.random() * 160;

    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
    ctx.stroke();
  }
}

// ── Boost flame (emissive cone behind car) ──
let boostFlame: THREE.Mesh | null = null;

export function initBoostFlame(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.18, 1.2, 8);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff4400,
    transparent: true,
    opacity: 0,
  });
  boostFlame = new THREE.Mesh(geo, mat);
  boostFlame.rotation.x = Math.PI / 2; // point backwards
  boostFlame.visible = false;
  scene.add(boostFlame);
  return boostFlame;
}

export function updateBoostFlame(
  active: boolean,
  carPos: THREE.Vector3,
  heading: number,
  time: number,
) {
  if (!boostFlame) return;

  boostFlame.visible = active;
  if (!active) return;

  // Position behind car
  boostFlame.position.set(
    carPos.x - Math.sin(heading) * 2.2,
    carPos.y + 0.5,
    carPos.z - Math.cos(heading) * 2.2,
  );
  boostFlame.rotation.y = heading;

  // Flicker
  const flicker = 0.7 + Math.sin(time * 30) * 0.3;
  boostFlame.scale.setScalar(flicker);

  const mat = boostFlame.material as THREE.MeshBasicMaterial;
  mat.opacity = 0.7 * flicker;
  // Cycle through orange/yellow/white
  const r = 1;
  const g = 0.2 + flicker * 0.6;
  mat.color.setRGB(r, g, 0);
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
const SPARK_POOL_SIZE = 30;
const sparkPool: THREE.Mesh[] = [];
let sparkIdx = 0;
const sparkVelPool: THREE.Vector3[] = [];
for (let i = 0; i < SPARK_POOL_SIZE; i++) sparkVelPool.push(new THREE.Vector3());
let sparkVelIdx = 0;

interface SparkParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}
const activeSparks: SparkParticle[] = [];

export function spawnCollisionSparks(pos: THREE.Vector3, force: number) {
  if (!smokeScene) return;

  if (sparkPool.length === 0) {
    const geo = new THREE.SphereGeometry(0.08, 4, 3);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 1, depthWrite: false });
    for (let i = 0; i < SPARK_POOL_SIZE; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      smokeScene.add(m);
      sparkPool.push(m);
    }
  }

  const count = Math.min(Math.floor(force * 0.8), 12);
  for (let i = 0; i < count; i++) {
    const mesh = sparkPool[sparkIdx % SPARK_POOL_SIZE];
    sparkIdx++;
    mesh.position.copy(pos);
    mesh.visible = true;
    (mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(Math.random() > 0.5 ? 0xffaa33 : 0xffee66);

    const vel = sparkVelPool[sparkVelIdx % SPARK_POOL_SIZE];
    sparkVelIdx++;
    vel.set(
      (Math.random() - 0.5) * 8,
      1 + Math.random() * 4,
      (Math.random() - 0.5) * 8,
    );
    activeSparks.push({ mesh, velocity: vel, life: 0.3 + Math.random() * 0.3 });
  }
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

/** Remove all VFX objects from the scene and DOM. Call between races. */
export function destroyVFX() {
  const sceneRef = smokeScene;

  // Clear smoke particles
  for (const p of activeSmoke) p.mesh.visible = false;
  activeSmoke.length = 0;

  // Clear sparks (before nulling scene)
  for (const s of activeSparks) s.mesh.visible = false;
  activeSparks.length = 0;
  if (sceneRef) {
    for (const mesh of sparkPool) sceneRef.remove(mesh);
  }
  sparkPool.length = 0;
  sparkIdx = 0;
  sparkVelIdx = 0;
  damageSmokeCooldown = 0;

  if (sceneRef) {
    for (const mesh of smokePool) sceneRef.remove(mesh);
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

  // Remove boost flame
  if (boostFlame) {
    boostFlame.parent?.remove(boostFlame);
    boostFlame = null;
  }
}
