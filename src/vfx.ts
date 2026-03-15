/* ── Hood Racer — VFX (Particles & Effects) ── */

import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, vec4, mul } from 'three/tsl';

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

  // Sparks (swap-and-pop)
  let j = 0;
  while (j < activeSparks.length) {
    const s = activeSparks[j];
    s.life -= dt;
    if (s.life <= 0) {
      s.mesh.visible = false;
      activeSparks[j] = activeSparks[activeSparks.length - 1];
      activeSparks.pop();
      continue;
    }
    s.mesh.position.addScaledVector(s.velocity, dt);
    s.velocity.y -= 15 * dt;
    const mat = s.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = s.life * 3;
    s.mesh.scale.setScalar(0.5 + (1 - s.life) * 0.5);
    j++;
  }

  // Metal debris (tumble, gravity, bounce)
  updateDebris(dt);
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

// ── Skid Marks (road-surface quads placed during drift) ──
const SKID_MAX_QUADS = 200;
const SKID_VERTS = SKID_MAX_QUADS * 6; // 2 triangles per quad = 6 verts
let skidMesh: THREE.Mesh | null = null;
let skidPositions: Float32Array | null = null;
let skidAlphas: Float32Array | null = null;
let skidIdx = 0;
let skidCount = 0;
const _skidRight = new THREE.Vector3();

export function initSkidMarks(scene: THREE.Scene) {
  const geo = new THREE.BufferGeometry();
  skidPositions = new Float32Array(SKID_VERTS * 3);
  skidAlphas = new Float32Array(SKID_VERTS);
  geo.setAttribute('position', new THREE.BufferAttribute(skidPositions, 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(skidAlphas, 1));
  geo.setDrawRange(0, 0);

  const skidMat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  const vertAlpha = float(attribute('alpha'));
  skidMat.colorNode = vec4(0.08, 0.08, 0.08, 1.0);
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

  skidIdx++;
  skidCount = Math.min(skidCount + 1, SKID_MAX_QUADS);

  const geo = skidMesh!.geometry;
  geo.setDrawRange(0, skidCount * 6);
  (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  (geo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
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

// ── Explosion Burst (one-shot on severe impact) ──

export function spawnExplosion(pos: THREE.Vector3, force: number) {
  if (!smokeScene) return;

  const count = Math.min(Math.floor(force * 0.6), 20);

  // Bright expanding particles
  for (let i = 0; i < count; i++) {
    if (sparkPool.length === 0) {
      // Lazy-init spark pool if needed
      const geo = new THREE.SphereGeometry(0.08, 4, 3);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 1, depthWrite: false });
      for (let j = 0; j < SPARK_POOL_SIZE; j++) {
        const m = new THREE.Mesh(geo, mat.clone());
        m.visible = false;
        smokeScene.add(m);
        sparkPool.push(m);
      }
    }

    const mesh = sparkPool[sparkIdx % SPARK_POOL_SIZE];
    sparkIdx++;
    mesh.position.copy(pos);
    mesh.position.y += 0.5;
    mesh.visible = true;
    mesh.scale.setScalar(1.0 + Math.random());

    const sMat = mesh.material as THREE.MeshBasicMaterial;
    sMat.opacity = 1;
    // White center → orange → dark
    const brightness = Math.random();
    sMat.color.setRGB(1, 0.5 + brightness * 0.5, brightness * 0.3);

    const vel = sparkVelPool[sparkVelIdx % SPARK_POOL_SIZE];
    sparkVelIdx++;
    const speed = 5 + Math.random() * 10;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    vel.set(
      Math.sin(phi) * Math.cos(theta) * speed,
      Math.abs(Math.cos(phi)) * speed * 0.7 + 2,
      Math.sin(phi) * Math.sin(theta) * speed,
    );
    activeSparks.push({ mesh, velocity: vel, life: 0.4 + Math.random() * 0.3 });
  }

  // Dark smoke cloud after explosion
  for (let i = 0; i < 5; i++) {
    if (smokePool.length === 0) return;
    const mesh = smokePool[smokeIdx % SMOKE_POOL_SIZE];
    smokeIdx++;
    mesh.position.copy(pos);
    mesh.position.y += 0.5;
    mesh.scale.setScalar(1.5 + Math.random());
    mesh.visible = true;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.5;
    mat.color.setHex(0x222222);

    const vel = smokeVelPool[smokeVelIdx % SMOKE_VEL_POOL_SIZE];
    smokeVelIdx++;
    vel.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3);
    activeSmoke.push({ mesh, velocity: vel, life: 1.0, maxLife: 1.0 });
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
}

const activeDebris: DebrisParticle[] = [];

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
}

/** Spawn metal debris particles at impact point. force controls count + speed. */
export function spawnDebris(pos: THREE.Vector3, force: number, carVelX = 0, carVelZ = 0) {
  if (!smokeScene) return;
  ensureDebrisPool();

  const count = Math.min(Math.floor(force * 0.3), 8);
  for (let i = 0; i < count; i++) {
    const mesh = debrisPool[debrisIdx % DEBRIS_POOL_SIZE];
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
    activeDebris.push({
      mesh,
      vx: carVelX * 0.3 + Math.cos(theta) * speed,
      vy: 2 + Math.random() * 4,
      vz: carVelZ * 0.3 + Math.sin(theta) * speed,
      ax: (Math.random() - 0.5) * 15,
      ay: (Math.random() - 0.5) * 15,
      az: (Math.random() - 0.5) * 15,
      life: 2.0 + Math.random() * 1.5,
      bounced: false,
    });
  }
}

/** Update debris physics (gravity, ground bounce, fade). Call in updateVFX. */
function updateDebris(dt: number) {
  let i = 0;
  while (i < activeDebris.length) {
    const d = activeDebris[i];
    d.life -= dt;
    if (d.life <= 0) {
      d.mesh.visible = false;
      activeDebris[i] = activeDebris[activeDebris.length - 1];
      activeDebris.pop();
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

    i++;
  }
}

// ── Scrape Sparks (continuous stream during barrier contact) ──
let scrapeCooldown = 0;

/**
 * Spawn continuous scrape sparks along a barrier tangent.
 * Call every frame while the car is scraping a barrier.
 */
export function spawnScrapeSparks(
  pos: THREE.Vector3,
  tangentX: number,
  tangentZ: number,
  speed: number,
  dt: number,
) {
  if (!smokeScene || speed < 3) return;
  scrapeCooldown -= dt;
  if (scrapeCooldown > 0) return;
  scrapeCooldown = 0.02; // ~50 sparks/sec

  if (sparkPool.length === 0) return;
  const count = Math.ceil(Math.min(speed * 0.2, 3));
  for (let i = 0; i < count; i++) {
    const mesh = sparkPool[sparkIdx % SPARK_POOL_SIZE];
    sparkIdx++;
    mesh.position.copy(pos);
    mesh.position.x += (Math.random() - 0.5) * 0.3;
    mesh.position.y += Math.random() * 0.2;
    mesh.position.z += (Math.random() - 0.5) * 0.3;
    mesh.visible = true;
    mesh.scale.setScalar(0.3 + Math.random() * 0.3);

    const sMat = mesh.material as THREE.MeshBasicMaterial;
    sMat.opacity = 1;
    sMat.color.setRGB(1, 0.7 + Math.random() * 0.3, 0.2);

    const vel = sparkVelPool[sparkVelIdx % SPARK_POOL_SIZE];
    sparkVelIdx++;
    // Sparks fly along the tangent + upward
    const tangentSpeed = speed * 0.5 + Math.random() * 3;
    vel.set(
      tangentX * tangentSpeed + (Math.random() - 0.5) * 2,
      1.5 + Math.random() * 2,
      tangentZ * tangentSpeed + (Math.random() - 0.5) * 2,
    );
    activeSparks.push({ mesh, velocity: vel, life: 0.15 + Math.random() * 0.15 });
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

// ── Windshield Crack Overlay (canvas-based fracture pattern) ──

let crackCanvas: HTMLCanvasElement | null = null;
let crackCtx: CanvasRenderingContext2D | null = null;
let crackResizeHandler: (() => void) | null = null;
let crackSeverity = 0; // 0 = none, 1 = fully shattered
let cracksDrawn = 0;   // number of crack lines already rendered

// Seed for deterministic-looking cracks
const crackSeeds: Array<{ angle: number; len: number; branches: number }> = [];

export function initWindshieldCracks(container: HTMLElement) {
  crackCanvas = document.createElement('canvas');
  crackCanvas.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:12;opacity:0;
  `;
  crackCanvas.width = window.innerWidth;
  crackCanvas.height = window.innerHeight;
  container.appendChild(crackCanvas);
  crackCtx = crackCanvas.getContext('2d')!;
  crackSeverity = 0;
  cracksDrawn = 0;
  crackSeeds.length = 0;

  crackResizeHandler = () => {
    if (crackCanvas) {
      crackCanvas.width = window.innerWidth;
      crackCanvas.height = window.innerHeight;
      // Redraw existing cracks after resize
      if (crackSeverity > 0) redrawCracks();
    }
  };
  window.addEventListener('resize', crackResizeHandler);
}

function redrawCracks() {
  if (!crackCtx || !crackCanvas) return;
  const ctx = crackCtx;
  const w = crackCanvas.width;
  const h = crackCanvas.height;
  ctx.clearRect(0, 0, w, h);

  // Impact center (slightly offset from dead center for realism)
  const cx = w * 0.5 + w * 0.05;
  const cy = h * 0.35;

  for (const seed of crackSeeds) {
    drawCrackLine(ctx, cx, cy, seed.angle, seed.len * Math.min(w, h), seed.branches);
  }
}

function drawCrackLine(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  angle: number, length: number,
  branches: number,
) {
  ctx.beginPath();
  ctx.moveTo(x, y);

  let cx = x;
  let cy = y;
  const segments = Math.floor(length / 8);
  const segLen = length / segments;

  for (let i = 0; i < segments; i++) {
    // Add slight random wobble to crack path
    const wobble = (Math.random() - 0.5) * 0.3;
    const a = angle + wobble;
    cx += Math.cos(a) * segLen;
    cy += Math.sin(a) * segLen;
    ctx.lineTo(cx, cy);

    // Branch off sub-cracks
    if (branches > 0 && i > 2 && Math.random() < 0.3) {
      const branchAngle = angle + (Math.random() - 0.5) * 1.2;
      const branchLen = (length - i * segLen) * 0.4;
      drawCrackLine(ctx, cx, cy, branchAngle, branchLen, branches - 1);
    }
  }

  // Thicker lines for main cracks, thinner for branches
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 + (3 - branches) * 0.15})`;
  ctx.lineWidth = Math.max(0.5, 2.5 - (3 - branches) * 0.7);
  ctx.stroke();
}

/**
 * Add windshield cracks based on frontal damage severity.
 * @param severity — 0..1 (1 = front zone at 0 HP)
 */
export function updateWindshieldCracks(severity: number) {
  if (!crackCanvas || !crackCtx) return;
  if (severity <= 0.3) return; // No cracks below 30% damage

  crackSeverity = severity;
  crackCanvas.style.opacity = Math.min(severity * 1.2, 0.85).toString();

  // Add new cracks progressively
  const targetCracks = Math.floor(severity * 12); // up to 12 main crack lines
  while (cracksDrawn < targetCracks) {
    crackSeeds.push({
      angle: Math.random() * Math.PI * 2,
      len: 0.15 + Math.random() * 0.25, // 15-40% of screen
      branches: 2 + Math.floor(Math.random() * 2),
    });
    cracksDrawn++;
  }

  redrawCracks();
}

/** Reset windshield cracks (between races). */
export function resetWindshieldCracks() {
  crackSeverity = 0;
  cracksDrawn = 0;
  crackSeeds.length = 0;
  if (crackCanvas) crackCanvas.style.opacity = '0';
  if (crackCtx && crackCanvas) crackCtx.clearRect(0, 0, crackCanvas.width, crackCanvas.height);
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

  // Spark burst from rim scraping
  if (sparkPool.length === 0) return;
  for (let i = 0; i < 5; i++) {
    const mesh = sparkPool[sparkIdx % SPARK_POOL_SIZE];
    sparkIdx++;
    mesh.position.copy(pos);
    mesh.visible = true;
    mesh.scale.setScalar(0.4 + Math.random() * 0.3);
    const sMat = mesh.material as THREE.MeshBasicMaterial;
    sMat.opacity = 1;
    sMat.color.setRGB(1, 0.6, 0.1);
    const vel = sparkVelPool[sparkVelIdx % SPARK_POOL_SIZE];
    sparkVelIdx++;
    vel.set(
      (Math.random() - 0.5) * 8,
      1 + Math.random() * 3,
      (Math.random() - 0.5) * 8,
    );
    activeSparks.push({ mesh, velocity: vel, life: 0.3 + Math.random() * 0.2 });
  }
}

// ── Rain Screen Droplets (canvas overlay with sliding water drops) ──

let rainDropCanvas: HTMLCanvasElement | null = null;
let rainDropCtx: CanvasRenderingContext2D | null = null;
let rainDropResizeHandler: (() => void) | null = null;

interface ScreenDroplet {
  x: number; y: number;
  speed: number;
  size: number;
  opacity: number;
  streak: number; // tail length
}
const screenDroplets: ScreenDroplet[] = [];
let rainDropActive = false;

export function initRainDroplets(container: HTMLElement) {
  rainDropCanvas = document.createElement('canvas');
  rainDropCanvas.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:11;opacity:0;
  `;
  rainDropCanvas.width = window.innerWidth;
  rainDropCanvas.height = window.innerHeight;
  container.appendChild(rainDropCanvas);
  rainDropCtx = rainDropCanvas.getContext('2d')!;
  screenDroplets.length = 0;
  rainDropActive = false;

  rainDropResizeHandler = () => {
    if (rainDropCanvas) {
      rainDropCanvas.width = window.innerWidth;
      rainDropCanvas.height = window.innerHeight;
    }
  };
  window.addEventListener('resize', rainDropResizeHandler);
}

/**
 * Update rain screen droplets. Call every frame during rain.
 * @param intensity 0 = no rain, 0.3 = light, 0.5 = heavy
 * @param dt frame delta in seconds
 */
export function updateRainDroplets(intensity: number, dt: number) {
  if (!rainDropCanvas || !rainDropCtx) return;

  if (intensity <= 0) {
    rainDropCanvas.style.opacity = '0';
    rainDropActive = false;
    screenDroplets.length = 0;
    return;
  }

  rainDropActive = true;
  rainDropCanvas.style.opacity = Math.min(intensity * 1.5, 0.7).toString();

  const ctx = rainDropCtx;
  const w = rainDropCanvas.width;
  const h = rainDropCanvas.height;
  ctx.clearRect(0, 0, w, h);

  // Spawn new droplets
  const spawnRate = intensity * 8; // drops per frame
  for (let i = 0; i < spawnRate; i++) {
    if (screenDroplets.length >= 80) break;
    screenDroplets.push({
      x: Math.random() * w,
      y: -10 - Math.random() * 30,
      speed: 150 + Math.random() * 250,
      size: 1.5 + Math.random() * 3,
      opacity: 0.3 + Math.random() * 0.5,
      streak: 8 + Math.random() * 20,
    });
  }

  // Update and draw droplets
  let j = 0;
  while (j < screenDroplets.length) {
    const d = screenDroplets[j];
    d.y += d.speed * dt;

    // Slight horizontal wobble
    d.x += (Math.random() - 0.5) * 0.5;

    if (d.y > h + 20) {
      screenDroplets[j] = screenDroplets[screenDroplets.length - 1];
      screenDroplets.pop();
      continue;
    }

    // Draw droplet body (circular highlight)
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.size * 0.6, d.size, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180, 210, 255, ${d.opacity * 0.6})`;
    ctx.fill();

    // Draw streak (water trail behind droplet)
    const grad = ctx.createLinearGradient(d.x, d.y - d.streak, d.x, d.y);
    grad.addColorStop(0, `rgba(180, 210, 255, 0)`);
    grad.addColorStop(1, `rgba(180, 210, 255, ${d.opacity * 0.3})`);
    ctx.strokeStyle = grad;
    ctx.lineWidth = d.size * 0.4;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y - d.streak);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();

    // Highlight dot (refraction point)
    ctx.beginPath();
    ctx.arc(d.x - d.size * 0.2, d.y - d.size * 0.2, d.size * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${d.opacity * 0.5})`;
    ctx.fill();

    j++;
  }
}

// ── Impact Flash Overlay (full-screen white flash on heavy collisions) ──

let impactFlashDiv: HTMLDivElement | null = null;
let impactFlashIntensity = 0;

export function initImpactFlash(container: HTMLElement) {
  impactFlashDiv = document.createElement('div');
  impactFlashDiv.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:13;
    background:white;opacity:0;
    transition:opacity 0.05s ease-out;
  `;
  container.appendChild(impactFlashDiv);
  impactFlashIntensity = 0;
}

/**
 * Trigger a screen flash on heavy impact.
 * @param force — impact force (0..1)
 */
export function triggerImpactFlash(force: number) {
  if (!impactFlashDiv || force < 0.3) return;
  impactFlashIntensity = Math.min(force, 0.8);
  impactFlashDiv.style.opacity = impactFlashIntensity.toString();
}

/** Call each frame to decay the flash. */
export function updateImpactFlash(dt: number) {
  if (!impactFlashDiv || impactFlashIntensity <= 0) return;
  impactFlashIntensity *= Math.exp(-15 * dt); // fast exponential decay
  if (impactFlashIntensity < 0.01) impactFlashIntensity = 0;
  impactFlashDiv.style.opacity = impactFlashIntensity.toString();
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
 */
export function updateUnderglow(light: THREE.PointLight, speed: number, time: number) {
  // Pulse intensity based on speed + gentle sine wave
  const speedFactor = Math.min(Math.abs(speed) / 40, 1);
  const pulse = 0.7 + Math.sin(time * 3) * 0.15 + Math.sin(time * 7.3) * 0.08;
  light.intensity = (1.5 + speedFactor * 2.0) * pulse;
  light.distance = 6 + speedFactor * 4;
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
    for (const mesh of sparkPool) {
      sceneRef.remove(mesh);
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
  }
  sparkPool.length = 0;
  sparkIdx = 0;
  sparkVelIdx = 0;
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

  // Remove boost flame
  if (boostFlame) {
    boostFlame.parent?.remove(boostFlame);
    boostFlame.geometry?.dispose();
    (boostFlame.material as THREE.Material)?.dispose();
    boostFlame = null;
  }

  // Remove windshield crack overlay
  resetWindshieldCracks();
  if (crackResizeHandler) {
    window.removeEventListener('resize', crackResizeHandler);
    crackResizeHandler = null;
  }
  if (crackCanvas) {
    crackCanvas.remove();
    crackCanvas = null;
    crackCtx = null;
  }

  // Remove rain droplets overlay
  screenDroplets.length = 0;
  rainDropActive = false;
  if (rainDropResizeHandler) {
    window.removeEventListener('resize', rainDropResizeHandler);
    rainDropResizeHandler = null;
  }
  if (rainDropCanvas) {
    rainDropCanvas.remove();
    rainDropCanvas = null;
    rainDropCtx = null;
  }

  // Remove impact flash
  impactFlashIntensity = 0;
  if (impactFlashDiv) {
    impactFlashDiv.remove();
    impactFlashDiv = null;
  }
}
