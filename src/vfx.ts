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

export function updateSpeedLines(speedRatio: number, isNitroActive = false) {
  if (!speedLinesCanvas || !speedLinesCtx) return;

  // Fade in/out based on speed (lower threshold during nitrous)
  const threshold = isNitroActive ? 0.3 : 0.7;
  const fadeRange = isNitroActive ? 0.2 : 0.3;
  speedLinesCanvas.style.opacity = (speedRatio > threshold ? Math.min(1, (speedRatio - threshold) / fadeRange) : 0).toString();

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
    const angle = (i / numLines) * Math.PI * 2 + Date.now() * 0.0005;
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

// ── Nitrous Afterburner (dual blue-purple exhaust cones + dynamic lights) ──
let boostFlameL: THREE.Mesh | null = null;
let boostFlameR: THREE.Mesh | null = null;
let boostLightL: THREE.PointLight | null = null;
let boostLightR: THREE.PointLight | null = null;
let boostFlameScene: THREE.Scene | null = null;

export function initBoostFlame(scene: THREE.Scene): THREE.Mesh {
  boostFlameScene = scene;
  const geo = new THREE.ConeGeometry(0.15, 1.4, 8);
  const matL = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const matR = matL.clone();

  boostFlameL = new THREE.Mesh(geo, matL);
  boostFlameR = new THREE.Mesh(geo, matR);
  boostFlameL.rotation.x = Math.PI / 2;
  boostFlameR.rotation.x = Math.PI / 2;
  boostFlameL.visible = false;
  boostFlameR.visible = false;
  scene.add(boostFlameL);
  scene.add(boostFlameR);

  // Dynamic point lights at each exhaust
  boostLightL = new THREE.PointLight(0x3388ff, 0, 6, 2);
  boostLightR = new THREE.PointLight(0x3388ff, 0, 6, 2);
  scene.add(boostLightL);
  scene.add(boostLightR);

  return boostFlameL; // backward compat — returns a mesh
}

export function updateBoostFlame(
  active: boolean,
  carPos: THREE.Vector3,
  heading: number,
  time: number,
) {
  if (!boostFlameL || !boostFlameR) return;

  boostFlameL.visible = active;
  boostFlameR.visible = active;
  if (boostLightL) boostLightL.intensity = active ? 3 : 0;
  if (boostLightR) boostLightR.intensity = active ? 3 : 0;
  if (!active) return;

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const exhaust = 2.3; // distance behind car
  const sideOffset = 0.4; // left/right offset

  // Left exhaust
  boostFlameL.position.set(
    carPos.x - sinH * exhaust - cosH * sideOffset,
    carPos.y + 0.45,
    carPos.z - cosH * exhaust + sinH * sideOffset,
  );
  boostFlameL.rotation.y = heading;

  // Right exhaust
  boostFlameR.position.set(
    carPos.x - sinH * exhaust + cosH * sideOffset,
    carPos.y + 0.45,
    carPos.z - cosH * exhaust - sinH * sideOffset,
  );
  boostFlameR.rotation.y = heading;

  // Position lights at flame bases
  if (boostLightL) boostLightL.position.copy(boostFlameL.position);
  if (boostLightR) boostLightR.position.copy(boostFlameR.position);

  // Aggressive 25Hz flicker
  const flicker = 0.6 + Math.sin(time * 25) * 0.2 + Math.sin(time * 37) * 0.15;
  boostFlameL.scale.set(flicker, flicker * (0.9 + Math.sin(time * 31) * 0.1), flicker);
  boostFlameR.scale.set(flicker, flicker * (0.9 + Math.sin(time * 29) * 0.1), flicker);

  // Color-over-lifetime: cycle white → cyan → blue → purple
  const cycle = (time * 8) % 1;
  let r: number, g: number, b: number;
  if (cycle < 0.25) {
    // White → cyan
    const t = cycle / 0.25;
    r = 1 - t * 0.7;  g = 1 - t * 0.1;  b = 1;
  } else if (cycle < 0.5) {
    // Cyan → blue
    const t = (cycle - 0.25) / 0.25;
    r = 0.3 - t * 0.1;  g = 0.9 - t * 0.5;  b = 1;
  } else if (cycle < 0.75) {
    // Blue → purple
    const t = (cycle - 0.5) / 0.25;
    r = 0.2 + t * 0.4;  g = 0.4 - t * 0.2;  b = 1 - t * 0.2;
  } else {
    // Purple → white (restart)
    const t = (cycle - 0.75) / 0.25;
    r = 0.6 + t * 0.4;  g = 0.2 + t * 0.8;  b = 0.8 + t * 0.2;
  }

  const matL = boostFlameL.material as THREE.MeshBasicMaterial;
  const matR = boostFlameR.material as THREE.MeshBasicMaterial;
  matL.opacity = 0.8 * flicker;
  matR.opacity = 0.8 * flicker;
  matL.color.setRGB(r, g, b);
  matR.color.setRGB(r, g, b);

  // Sync light color with flame
  if (boostLightL) boostLightL.color.setRGB(r * 0.5, g * 0.5, b);
  if (boostLightR) boostLightR.color.setRGB(r * 0.5, g * 0.5, b);
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

// ── Nitrous Exhaust Trail (enhanced: 50 particles, color gradient, dual emission) ──

const NITRO_TRAIL_POOL = 50;
interface NitroParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
}
let nitroTrailPool: THREE.Mesh[] = [];
const activeNitroTrail: NitroParticle[] = [];
let nitroTrailScene: THREE.Scene | null = null;

export function initNitroTrail(scene: THREE.Scene) {
  nitroTrailScene = scene;
  const geo = new THREE.SphereGeometry(0.12, 6, 4);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x4488ff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  nitroTrailPool = [];
  for (let i = 0; i < NITRO_TRAIL_POOL; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.visible = false;
    scene.add(m);
    nitroTrailPool.push(m);
  }
}

let nitroTrailIdx = 0;

/**
 * Spawn nitrous trail fire particles from both exhaust pipes.
 * Call every frame while nitrous is active.
 */
export function spawnNitroTrail(
  carPos: THREE.Vector3,
  heading: number,
  speed: number,
) {
  if (!nitroTrailScene || nitroTrailPool.length === 0) return;

  const sinH = Math.sin(heading);
  const cosH = Math.cos(heading);
  const exhaust = 2.4;
  const sideOffset = 0.4;

  // Spawn from both exhaust pipes (3 particles per frame for dense trail)
  for (let pipe = -1; pipe <= 1; pipe += 2) {
    const count = speed > 30 ? 2 : 1; // More particles at high speed
    for (let i = 0; i < count; i++) {
      const mesh = nitroTrailPool[nitroTrailIdx % NITRO_TRAIL_POOL];
      nitroTrailIdx++;

      const spread = (Math.random() - 0.5) * 0.15;
      mesh.position.set(
        carPos.x - sinH * exhaust + cosH * (sideOffset * pipe + spread),
        carPos.y + 0.4 + Math.random() * 0.15,
        carPos.z - cosH * exhaust - sinH * (sideOffset * pipe + spread),
      );
      mesh.scale.setScalar(0.6 + Math.random() * 0.6);
      mesh.visible = true;

      const maxLife = 0.25 + Math.random() * 0.35;
      // Velocity inherits from car speed for longer streaks at high speed
      const speedFactor = Math.max(0.2, speed * 0.01);
      activeNitroTrail.push({
        mesh,
        vx: -sinH * (-speed * 0.25 * speedFactor) + (Math.random() - 0.5) * 1.5,
        vy: 1.2 + Math.random() * 1.5,
        vz: -cosH * (-speed * 0.25 * speedFactor) + (Math.random() - 0.5) * 1.5,
        life: maxLife,
        maxLife,
      });
    }
  }
}

export function updateNitroTrail(dt: number) {
  let j = 0;
  while (j < activeNitroTrail.length) {
    const p = activeNitroTrail[j];
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      activeNitroTrail[j] = activeNitroTrail[activeNitroTrail.length - 1];
      activeNitroTrail.pop();
      continue;
    }

    // Physics: drag + slight gravity
    p.vx *= 0.94;
    p.vy -= 2.5 * dt;
    p.vz *= 0.94;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    // Size-over-lifetime: grows then shrinks
    const t = p.life / p.maxLife;
    const sizeCurve = t > 0.7 ? (1 - t) / 0.3 : t / 0.7; // ramp up then sustain
    p.mesh.scale.setScalar(sizeCurve * 0.9);

    // Color-over-lifetime: white → cyan → blue → purple → transparent
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = t * 0.85;
    if (t > 0.75) {
      // White core
      mat.color.setRGB(1, 1, 1);
    } else if (t > 0.5) {
      // Cyan
      const f = (t - 0.5) / 0.25;
      mat.color.setRGB(0.3 + f * 0.7, 0.8 + f * 0.2, 1);
    } else if (t > 0.25) {
      // Blue
      const f = (t - 0.25) / 0.25;
      mat.color.setRGB(0.2 + f * 0.1, 0.4 + f * 0.4, 1);
    } else {
      // Purple → fade
      const f = t / 0.25;
      mat.color.setRGB(0.5 + (1 - f) * 0.1, 0.2 * f, 0.7 + f * 0.3);
    }

    j++;
  }
}

// ── Nitrous Activation Shockwave Ring ──

let shockwaveMesh: THREE.Mesh | null = null;
let shockwaveLife = 0;
const SHOCKWAVE_DURATION = 0.35;
let shockwaveScene: THREE.Scene | null = null;

export function initBoostShockwave(scene: THREE.Scene) {
  shockwaveScene = scene;
  const geo = new THREE.TorusGeometry(1, 0.06, 8, 32);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x66ccff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  shockwaveMesh = new THREE.Mesh(geo, mat);
  shockwaveMesh.rotation.x = -Math.PI / 2; // Lay flat
  shockwaveMesh.visible = false;
  scene.add(shockwaveMesh);
}

/** Trigger one-shot shockwave at car position. Call on nitrous activation only. */
export function triggerBoostShockwave(carPos: THREE.Vector3, heading: number) {
  if (!shockwaveMesh) return;
  shockwaveMesh.position.set(
    carPos.x - Math.sin(heading) * 1.5,
    carPos.y + 0.3,
    carPos.z - Math.cos(heading) * 1.5,
  );
  shockwaveMesh.visible = true;
  shockwaveMesh.scale.setScalar(0.1);
  shockwaveLife = SHOCKWAVE_DURATION;
}

export function updateBoostShockwave(dt: number) {
  if (!shockwaveMesh || shockwaveLife <= 0) return;

  shockwaveLife -= dt;
  if (shockwaveLife <= 0) {
    shockwaveMesh.visible = false;
    return;
  }

  const t = 1 - shockwaveLife / SHOCKWAVE_DURATION; // 0→1
  // Expand rapidly: ease-out curve
  const scale = t * t * 4.0; // 0 → 4 radius
  shockwaveMesh.scale.setScalar(scale);

  // Fade out as it expands
  const mat = shockwaveMesh.material as THREE.MeshBasicMaterial;
  mat.opacity = (1 - t) * 0.7;

  // Color shift: white → cyan as it expands
  mat.color.setRGB(0.4 + (1 - t) * 0.6, 0.8 + (1 - t) * 0.2, 1);
}

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

// ── Brake Disc Glow (red emissive behind wheels on hard braking) ──

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

  return materials;
}

/**
 * Update brake disc glow intensity based on braking force.
 * @param discMats — array of 4 materials from createBrakeDiscs
 * @param brakeForce — 0..1 brake input
 * @param speed — current speed (glow only visible at speed)
 */
export function updateBrakeDiscs(
  discMats: THREE.MeshStandardMaterial[],
  brakeForce: number,
  speed: number,
) {
  const absSpeed = Math.abs(speed);
  // Glow only when actually braking at speed
  const glowIntensity = brakeForce > 0.1 && absSpeed > 5
    ? Math.min(brakeForce * 3, 4) * Math.min(absSpeed / 20, 1)
    : 0;

  for (const mat of discMats) {
    mat.emissiveIntensity = glowIntensity;
  }
}

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

// ── Ambient Floating Particles (dust motes / embers drifting in scene) ──

const AMBIENT_COUNT = 50;
let ambientParticles: THREE.Points | null = null;
let ambientPositions: Float32Array | null = null;
let ambientVelocities: Float32Array | null = null;
let ambientScene: THREE.Scene | null = null;

export function initAmbientParticles(scene: THREE.Scene) {
  ambientScene = scene;
  const count = AMBIENT_COUNT;
  ambientPositions = new Float32Array(count * 3);
  ambientVelocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    ambientPositions[i * 3]     = (Math.random() - 0.5) * 80;
    ambientPositions[i * 3 + 1] = 1 + Math.random() * 12;
    ambientPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
    // Gentle drift velocities
    ambientVelocities[i * 3]     = (Math.random() - 0.5) * 0.8;
    ambientVelocities[i * 3 + 1] = (Math.random() - 0.5) * 0.3;
    ambientVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(ambientPositions, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xffaa66,
    size: 0.15,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    sizeAttenuation: true,
  });

  ambientParticles = new THREE.Points(geo, mat);
  ambientParticles.frustumCulled = false;
  scene.add(ambientParticles);
}

export function updateAmbientParticles(dt: number, playerPos: THREE.Vector3) {
  if (!ambientPositions || !ambientVelocities || !ambientParticles) return;

  const count = AMBIENT_COUNT;
  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    // Wind drift
    ambientPositions[idx]     += ambientVelocities[idx] * dt;
    ambientPositions[idx + 1] += ambientVelocities[idx + 1] * dt;
    ambientPositions[idx + 2] += ambientVelocities[idx + 2] * dt;

    // Add gentle sine wobble
    ambientPositions[idx]     += Math.sin(Date.now() * 0.001 + i) * 0.02 * dt;
    ambientPositions[idx + 1] += Math.cos(Date.now() * 0.0015 + i * 0.7) * 0.01 * dt;

    // Reset if too far from player
    const dx = ambientPositions[idx] - playerPos.x;
    const dz = ambientPositions[idx + 2] - playerPos.z;
    if (dx * dx + dz * dz > 50 * 50 || ambientPositions[idx + 1] < 0) {
      ambientPositions[idx]     = playerPos.x + (Math.random() - 0.5) * 60;
      ambientPositions[idx + 1] = 1 + Math.random() * 12;
      ambientPositions[idx + 2] = playerPos.z + (Math.random() - 0.5) * 60;
    }
  }

  (ambientParticles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
}

// ── Heat Shimmer (canvas overlay for exhaust distortion at high speed) ──

let shimmerCanvas: HTMLCanvasElement | null = null;
let shimmerCtx: CanvasRenderingContext2D | null = null;
let shimmerResizeHandler: (() => void) | null = null;

export function initHeatShimmer(container: HTMLElement) {
  shimmerCanvas = document.createElement('canvas');
  shimmerCanvas.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:10;opacity:0;
    mix-blend-mode:overlay;
  `;
  shimmerCanvas.width = window.innerWidth;
  shimmerCanvas.height = window.innerHeight;
  container.appendChild(shimmerCanvas);
  shimmerCtx = shimmerCanvas.getContext('2d')!;

  shimmerResizeHandler = () => {
    if (shimmerCanvas) {
      shimmerCanvas.width = window.innerWidth;
      shimmerCanvas.height = window.innerHeight;
    }
  };
  window.addEventListener('resize', shimmerResizeHandler);
}

/**
 * Update heat shimmer overlay. Draws wavering distortion lines.
 * @param speedRatio — 0..1 current speed / max speed
 */
export function updateHeatShimmer(speedRatio: number) {
  if (!shimmerCanvas || !shimmerCtx) return;

  if (speedRatio < 0.5) {
    shimmerCanvas.style.opacity = '0';
    return;
  }

  const intensity = (speedRatio - 0.5) * 2; // 0..1 over top half of speed
  shimmerCanvas.style.opacity = (intensity * 0.15).toString();

  const ctx = shimmerCtx;
  const w = shimmerCanvas.width;
  const h = shimmerCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const time = Date.now() * 0.003;
  const lineCount = 8 + Math.floor(intensity * 12);
  const cx = w / 2;
  const bottomY = h * 0.75;

  for (let i = 0; i < lineCount; i++) {
    const y = bottomY - i * (h * 0.05);
    const amplitude = (3 + intensity * 8) * (1 - i / lineCount);
    const freq = 0.02 + i * 0.005;

    ctx.beginPath();
    ctx.moveTo(cx - 120, y);
    for (let x = cx - 120; x < cx + 120; x += 4) {
      const waveY = y + Math.sin(x * freq + time + i * 1.3) * amplitude;
      ctx.lineTo(x, waveY);
    }
    ctx.strokeStyle = `rgba(255, 245, 220, ${0.06 * (1 - i / lineCount)})`;
    ctx.lineWidth = 2 + intensity * 2;
    ctx.stroke();
  }
}

// ── Lens Flare Sprites (billboard sprites at street light positions) ──

let flareSprites: THREE.Sprite[] = [];
let flareLightPositions: THREE.Vector3[] = [];

export function initLensFlares(scene: THREE.Scene, lightPositions: THREE.Vector3[]) {
  flareLightPositions = lightPositions;
  flareSprites = [];

  // Create canvas texture for flare
  const flareCanvas = document.createElement('canvas');
  flareCanvas.width = 64;
  flareCanvas.height = 64;
  const ctx = flareCanvas.getContext('2d')!;

  // Radial gradient — bright center, soft falloff
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
  grad.addColorStop(0.2, 'rgba(255, 220, 150, 0.4)');
  grad.addColorStop(0.5, 'rgba(255, 200, 100, 0.1)');
  grad.addColorStop(1, 'rgba(255, 180, 80, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const flareTex = new THREE.CanvasTexture(flareCanvas);
  const flareMat = new THREE.SpriteMaterial({
    map: flareTex,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  for (const pos of lightPositions) {
    const sprite = new THREE.Sprite(flareMat.clone());
    sprite.position.copy(pos);
    sprite.scale.set(4, 4, 1);
    scene.add(sprite);
    flareSprites.push(sprite);
  }
}

/**
 * Update lens flare intensity based on camera distance and angle.
 */
export function updateLensFlares(cameraPos: THREE.Vector3, time: number) {
  for (let i = 0; i < flareSprites.length; i++) {
    const sprite = flareSprites[i];
    const pos = flareLightPositions[i];
    const dx = cameraPos.x - pos.x;
    const dy = cameraPos.y - pos.y;
    const dz = cameraPos.z - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Fade based on distance — brighter when closer
    const distFade = Math.max(0, 1 - dist / 50);
    // Gentle pulsing
    const pulse = 0.8 + Math.sin(time * 2 + i * 1.7) * 0.15;

    const mat = sprite.material as THREE.SpriteMaterial;
    mat.opacity = distFade * pulse * 0.6;

    // Scale up when closer for bloom effect
    const scale = 3 + distFade * 4;
    sprite.scale.set(scale, scale, 1);
  }
}

// ── Lightning Flashes (screen + scene flash during storms) ──

let lightningDiv: HTMLDivElement | null = null;
let lightningIntensity = 0;
let lightningTimer = 0;
let lightningInterval = 5; // seconds between flashes
let lightningEnabled = false;

export function initLightning(container: HTMLElement) {
  lightningDiv = document.createElement('div');
  lightningDiv.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:12;
    background:rgba(200,210,255,0);opacity:0;
  `;
  container.appendChild(lightningDiv);
  lightningIntensity = 0;
  lightningTimer = 2 + Math.random() * 3;
  lightningEnabled = false;
}

export function setLightningEnabled(enabled: boolean) {
  lightningEnabled = enabled;
  if (!enabled && lightningDiv) lightningDiv.style.opacity = '0';
}

/**
 * Update lightning. Returns true momentarily when a flash occurs
 * (so caller can boost scene lights if desired).
 */
export function updateLightning(dt: number): boolean {
  if (!lightningDiv || !lightningEnabled) return false;

  lightningTimer -= dt;
  let flashed = false;

  if (lightningTimer <= 0) {
    // Flash!
    lightningIntensity = 0.5 + Math.random() * 0.4;
    lightningDiv.style.opacity = lightningIntensity.toString();
    lightningDiv.style.background = `rgba(200, 210, 255, ${lightningIntensity})`;
    lightningTimer = 3 + Math.random() * 5; // Next flash in 3-8 seconds
    flashed = true;

    // Double flash (common in real lightning)
    if (Math.random() > 0.5) {
      setTimeout(() => {
        if (lightningDiv) {
          lightningDiv.style.opacity = (lightningIntensity * 0.6).toString();
        }
      }, 80);
    }
  }

  // Decay
  if (lightningIntensity > 0) {
    lightningIntensity *= Math.exp(-8 * dt);
    if (lightningIntensity < 0.01) lightningIntensity = 0;
    lightningDiv.style.opacity = lightningIntensity.toString();
  }

  return flashed;
}

// ── Near-Miss Screen Streaks (screen edge flash on close passes) ──

let nearMissCanvas: HTMLCanvasElement | null = null;
let nearMissCtx: CanvasRenderingContext2D | null = null;
let nearMissResizeHandler: (() => void) | null = null;

interface NearMissStreak {
  side: 'left' | 'right';
  intensity: number;
  life: number;
}
const activeStreaks: NearMissStreak[] = [];

export function initNearMissStreaks(container: HTMLElement) {
  nearMissCanvas = document.createElement('canvas');
  nearMissCanvas.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    pointer-events:none;z-index:11;opacity:1;
  `;
  nearMissCanvas.width = window.innerWidth;
  nearMissCanvas.height = window.innerHeight;
  container.appendChild(nearMissCanvas);
  nearMissCtx = nearMissCanvas.getContext('2d')!;
  activeStreaks.length = 0;

  nearMissResizeHandler = () => {
    if (nearMissCanvas) {
      nearMissCanvas.width = window.innerWidth;
      nearMissCanvas.height = window.innerHeight;
    }
  };
  window.addEventListener('resize', nearMissResizeHandler);
}

/**
 * Trigger a near-miss streak on one side of the screen.
 * @param side — which side the AI car passed on
 */
export function triggerNearMiss(side: 'left' | 'right') {
  activeStreaks.push({
    side,
    intensity: 0.8 + Math.random() * 0.2,
    life: 0.3,
  });
}

export function updateNearMissStreaks(dt: number) {
  if (!nearMissCanvas || !nearMissCtx) return;

  const ctx = nearMissCtx;
  const w = nearMissCanvas.width;
  const h = nearMissCanvas.height;
  ctx.clearRect(0, 0, w, h);

  let j = 0;
  while (j < activeStreaks.length) {
    const s = activeStreaks[j];
    s.life -= dt;
    if (s.life <= 0) {
      activeStreaks[j] = activeStreaks[activeStreaks.length - 1];
      activeStreaks.pop();
      continue;
    }

    const t = s.life / 0.3;
    const alpha = t * s.intensity * 0.4;

    // Draw gradient streak on the corresponding side
    const gradient = s.side === 'left'
      ? ctx.createLinearGradient(0, 0, w * 0.15, 0)
      : ctx.createLinearGradient(w, 0, w * 0.85, 0);

    gradient.addColorStop(0, `rgba(255, 220, 100, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(255, 200, 80, ${alpha * 0.3})`);
    gradient.addColorStop(1, 'rgba(255, 200, 80, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    j++;
  }
}

// ── Victory Confetti (colorful particles on race finish) ──

const CONFETTI_COUNT = 80;
interface ConfettiParticle {
  mesh: THREE.Mesh;
  vx: number; vy: number; vz: number;
  spin: number; spinAxis: number;
  life: number;
}
let confettiPool: THREE.Mesh[] = [];
const activeConfetti: ConfettiParticle[] = [];
let confettiScene: THREE.Scene | null = null;

const CONFETTI_COLORS = [
  0xff4444, 0x44ff44, 0x4488ff,
  0xffaa00, 0xff44ff, 0x44ffff,
  0xffff44, 0xff8800, 0x88ff44,
];

export function initVictoryConfetti(scene: THREE.Scene) {
  confettiScene = scene;
  const geo = new THREE.PlaneGeometry(0.15, 0.25);
  confettiPool = [];

  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    confettiPool.push(m);
  }
}

/**
 * Trigger confetti burst at a position (call once on race finish).
 */
export function spawnVictoryConfetti(pos: THREE.Vector3) {
  if (!confettiScene) return;

  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const mesh = confettiPool[i];
    mesh.position.set(
      pos.x + (Math.random() - 0.5) * 6,
      pos.y + 2 + Math.random() * 3,
      pos.z + (Math.random() - 0.5) * 6,
    );
    mesh.scale.setScalar(0.5 + Math.random() * 1.0);
    mesh.visible = true;

    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = 1.0;
    mat.color.setHex(CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]);

    activeConfetti.push({
      mesh,
      vx: (Math.random() - 0.5) * 8,
      vy: 5 + Math.random() * 8,
      vz: (Math.random() - 0.5) * 8,
      spin: (Math.random() - 0.5) * 10,
      spinAxis: Math.random() * 3,
      life: 3 + Math.random() * 2,
    });
  }
}

export function updateVictoryConfetti(dt: number) {
  let j = 0;
  while (j < activeConfetti.length) {
    const p = activeConfetti[j];
    p.life -= dt;
    if (p.life <= 0) {
      p.mesh.visible = false;
      activeConfetti[j] = activeConfetti[activeConfetti.length - 1];
      activeConfetti.pop();
      continue;
    }

    // Physics: gravity + air drag + flutter
    p.vy -= 6 * dt;
    p.vx *= 0.99;
    p.vz *= 0.99;
    // Flutter effect (confetti tumble)
    p.vx += Math.sin(Date.now() * 0.005 + j) * 0.3 * dt;
    p.vz += Math.cos(Date.now() * 0.004 + j * 0.7) * 0.3 * dt;

    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    // Spinning
    if (p.spinAxis < 1) p.mesh.rotation.x += p.spin * dt;
    else if (p.spinAxis < 2) p.mesh.rotation.y += p.spin * dt;
    else p.mesh.rotation.z += p.spin * dt;

    // Fade out in last second
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = p.life < 1 ? p.life : 1;

    // Floor bounce
    if (p.mesh.position.y < 0.05) {
      p.mesh.position.y = 0.05;
      p.vy = Math.abs(p.vy) * 0.2;
    }

    j++;
  }
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

  // Remove boost flames + lights
  for (const flame of [boostFlameL, boostFlameR]) {
    if (flame) {
      flame.parent?.remove(flame);
      flame.geometry?.dispose();
      (flame.material as THREE.Material)?.dispose();
    }
  }
  boostFlameL = null;
  boostFlameR = null;
  for (const light of [boostLightL, boostLightR]) {
    if (light) light.parent?.remove(light);
  }
  boostLightL = null;
  boostLightR = null;
  boostFlameScene = null;

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

  // Clear nitro trail
  for (const p of activeNitroTrail) p.mesh.visible = false;
  activeNitroTrail.length = 0;
  if (nitroTrailScene) {
    for (const m of nitroTrailPool) {
      nitroTrailScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  nitroTrailPool = [];
  nitroTrailIdx = 0;
  nitroTrailScene = null;

  // Clear rim sparks
  for (const s of activeRimSparks) s.mesh.visible = false;
  activeRimSparks.length = 0;
  if (rimSparkScene) {
    for (const m of rimSparkPool) {
      rimSparkScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  rimSparkPool = [];
  rimSparkIdx = 0;
  rimSparkScene = null;

  // Clear backfire flames
  for (const p of activeBackfires) p.mesh.visible = false;
  activeBackfires.length = 0;
  if (backfireScene) {
    for (const m of backfirePool) {
      backfireScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  backfirePool = [];
  backfireIdx = 0;
  backfireScene = null;

  // Clear shoulder dust
  for (const p of activeDust) p.mesh.visible = false;
  activeDust.length = 0;
  if (dustScene) {
    for (const m of dustPool) {
      dustScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  dustPool = [];
  dustIdx = 0;
  dustScene = null;

  // Clear ambient particles
  if (ambientParticles && ambientScene) {
    ambientScene.remove(ambientParticles);
    ambientParticles.geometry?.dispose();
    (ambientParticles.material as THREE.Material)?.dispose();
  }
  ambientParticles = null;
  ambientPositions = null;
  ambientVelocities = null;
  ambientScene = null;

  // Clear heat shimmer
  if (shimmerResizeHandler) {
    window.removeEventListener('resize', shimmerResizeHandler);
    shimmerResizeHandler = null;
  }
  if (shimmerCanvas) {
    shimmerCanvas.remove();
    shimmerCanvas = null;
    shimmerCtx = null;
  }

  // Clear lens flares
  for (const sprite of flareSprites) {
    sprite.parent?.remove(sprite);
    (sprite.material as THREE.Material)?.dispose();
  }
  flareSprites = [];
  flareLightPositions = [];

  // Clear lightning
  lightningIntensity = 0;
  lightningTimer = 0;
  lightningEnabled = false;
  if (lightningDiv) {
    lightningDiv.remove();
    lightningDiv = null;
  }

  // Clear near-miss streaks
  activeStreaks.length = 0;
  if (nearMissResizeHandler) {
    window.removeEventListener('resize', nearMissResizeHandler);
    nearMissResizeHandler = null;
  }
  if (nearMissCanvas) {
    nearMissCanvas.remove();
    nearMissCanvas = null;
    nearMissCtx = null;
  }

  // Clear victory confetti
  for (const p of activeConfetti) p.mesh.visible = false;
  activeConfetti.length = 0;
  if (confettiScene) {
    for (const m of confettiPool) {
      confettiScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  confettiPool = [];
  confettiScene = null;
}
