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

    const vel = new THREE.Vector3(
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

    // Move upward and expand
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.velocity.y *= 0.98; // gravity-ish drag

    const lifeFrac = p.life / p.maxLife;
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.opacity = lifeFrac * 0.3;
    p.mesh.scale.setScalar(1.5 - lifeFrac * 0.8);
  }
}

// ── Speed Lines (screen-space, canvas 2D overlay) ──
let speedLinesCanvas: HTMLCanvasElement | null = null;
let speedLinesCtx: CanvasRenderingContext2D | null = null;

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

  window.addEventListener('resize', () => {
    if (speedLinesCanvas) {
      speedLinesCanvas.width = window.innerWidth;
      speedLinesCanvas.height = window.innerHeight;
    }
  });
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
