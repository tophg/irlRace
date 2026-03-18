/* ── Hood Racer — Environment & Atmosphere VFX ── */

import * as THREE from 'three/webgpu';

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
    ambientPositions[idx]     += Math.sin(performance.now() * 0.001 + i) * 0.02 * dt;
    ambientPositions[idx + 1] += Math.cos(performance.now() * 0.0015 + i * 0.7) * 0.01 * dt;

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
 * Now nitro-aware: activates earlier during nitro and shows orange tint at high heat.
 * @param speedRatio — 0..1 current speed / max speed
 * @param isNitro — whether nitro is currently active
 * @param engineHeat — 0-100 engine temperature
 */
export function updateHeatShimmer(speedRatio: number, isNitro = false, engineHeat = 0) {
  if (!shimmerCanvas || !shimmerCtx) return;

  const threshold = isNitro ? 0.2 : 0.5;
  if (speedRatio < threshold && engineHeat < 50) {
    shimmerCanvas.style.opacity = '0';
    return;
  }

  const baseIntensity = speedRatio >= threshold ? (speedRatio - threshold) / (1 - threshold) : 0;
  const heatIntensity = Math.max(0, (engineHeat - 40) / 60); // 0 at 40, 1 at 100
  const intensity = Math.min(1, Math.max(baseIntensity, heatIntensity));
  const maxOpacity = isNitro ? 0.35 : 0.15;
  shimmerCanvas.style.opacity = (intensity * maxOpacity).toString();

  const ctx = shimmerCtx;
  const w = shimmerCanvas.width;
  const h = shimmerCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const time = performance.now() * 0.003;
  const lineCount = 8 + Math.floor(intensity * 12);
  const cx = w / 2;
  const bottomY = h * 0.75;
  const spread = isNitro ? 200 : 120; // wider during nitro

  for (let i = 0; i < lineCount; i++) {
    const y = bottomY - i * (h * 0.05);
    const amplitude = (3 + intensity * 8) * (1 - i / lineCount);
    const freq = 0.02 + i * 0.005;

    ctx.beginPath();
    ctx.moveTo(cx - spread, y);
    for (let x = cx - spread; x < cx + spread; x += 4) {
      const waveY = y + Math.sin(x * freq + time + i * 1.3) * amplitude;
      ctx.lineTo(x, waveY);
    }
    // Orange tint at high heat, warm white normally
    const heatTint = Math.min(engineHeat / 100, 1);
    const r = 255;
    const g = Math.floor(245 - heatTint * 100);
    const b = Math.floor(220 - heatTint * 180);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.06 * (1 - i / lineCount)})`;
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
    opacity: 0.3,
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
    mat.opacity = distFade * pulse * 0.3;

    // Scale up when closer for bloom effect
    const scale = 2 + distFade * 2.5;
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
  if (activeStreaks.length === 0) return;

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


// ── Near-Miss 3D Whoosh Mesh (air-displacement planes that sweep past camera) ──

let whooshMeshL: THREE.Mesh | null = null;
let whooshMeshR: THREE.Mesh | null = null;
let whooshLifeL = 0;
let whooshLifeR = 0;
const WHOOSH_DURATION = 0.3;
let whooshScene: THREE.Scene | null = null;

export function initNearMissWhoosh(scene: THREE.Scene) {
  whooshScene = scene;
  const geo = new THREE.PlaneGeometry(2.5, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  whooshMeshL = new THREE.Mesh(geo, mat.clone());
  whooshMeshR = new THREE.Mesh(geo, mat.clone());
  whooshMeshL.visible = false;
  whooshMeshR.visible = false;
  scene.add(whooshMeshL);
  scene.add(whooshMeshR);
}

export function triggerNearMissWhoosh(side: 'left' | 'right', cameraPos: THREE.Vector3, cameraHeading: number) {
  const mesh = side === 'left' ? whooshMeshL : whooshMeshR;
  if (!mesh) return;

  const sideSign = side === 'left' ? -1 : 1;
  const cosH = Math.cos(cameraHeading);
  const sinH = Math.sin(cameraHeading);
  // Start behind the camera, offset to the side
  mesh.position.set(
    cameraPos.x + cosH * sideSign * 3 - sinH * (-4),
    cameraPos.y + 0.5,
    cameraPos.z - sinH * sideSign * 3 - cosH * (-4),
  );
  mesh.rotation.y = cameraHeading + sideSign * 0.3;
  mesh.scale.set(0.5, 1, 1);
  mesh.visible = true;

  if (side === 'left') whooshLifeL = WHOOSH_DURATION;
  else whooshLifeR = WHOOSH_DURATION;
}

export function updateNearMissWhoosh(dt: number, cameraPos: THREE.Vector3, cameraHeading: number) {
  const sinH = Math.sin(cameraHeading);
  const cosH = Math.cos(cameraHeading);

  // Left whoosh
  if (whooshLifeL > 0 && whooshMeshL) {
    whooshLifeL -= dt;
    const t = 1 - whooshLifeL / WHOOSH_DURATION; // 0→1
    if (whooshLifeL <= 0) {
      whooshMeshL.visible = false;
    } else {
      // Sweep forward past camera
      const fwd = -4 + t * 12; // behind → ahead
      whooshMeshL.position.set(
        cameraPos.x + cosH * (-3) - sinH * fwd,
        cameraPos.y + 0.5,
        cameraPos.z - sinH * (-3) - cosH * fwd,
      );
      whooshMeshL.scale.set(0.5 + t * 1.5, 1 + t * 0.5, 1);
      const mat = whooshMeshL.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.15;
    }
  }

  // Right whoosh
  if (whooshLifeR > 0 && whooshMeshR) {
    whooshLifeR -= dt;
    const t = 1 - whooshLifeR / WHOOSH_DURATION;
    if (whooshLifeR <= 0) {
      whooshMeshR.visible = false;
    } else {
      const fwd = -4 + t * 12;
      whooshMeshR.position.set(
        cameraPos.x + cosH * 3 - sinH * fwd,
        cameraPos.y + 0.5,
        cameraPos.z - sinH * 3 - cosH * fwd,
      );
      whooshMeshR.scale.set(0.5 + t * 1.5, 1 + t * 0.5, 1);
      const mat = whooshMeshR.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.15;
    }
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
let _confettiContinuous = false;
let _confettiSpawnPos: THREE.Vector3 | null = null;
let _confettiPoolIdx = 0;

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

/** Enable/disable continuous confetti rain during results screen. */
export function setConfettiContinuous(enabled: boolean, pos?: THREE.Vector3) {
  _confettiContinuous = enabled;
  _confettiSpawnPos = pos ? pos.clone() : null;
}

export function updateVictoryConfetti(dt: number) {
  // Continuous rain: spawn 2 particles per frame while active
  if (_confettiContinuous && confettiPool.length > 0 && _confettiSpawnPos) {
    for (let n = 0; n < 2; n++) {
      const mesh = confettiPool[_confettiPoolIdx % confettiPool.length];
      _confettiPoolIdx++;
      mesh.position.set(
        _confettiSpawnPos.x + (Math.random() - 0.5) * 10,
        _confettiSpawnPos.y + 6 + Math.random() * 4,
        _confettiSpawnPos.z + (Math.random() - 0.5) * 10,
      );
      mesh.scale.setScalar(0.5 + Math.random() * 0.8);
      mesh.visible = true;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1.0;
      mat.color.setHex(CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]);
      activeConfetti.push({
        mesh,
        vx: (Math.random() - 0.5) * 3,
        vy: -1 - Math.random() * 2, // gentle downward
        vz: (Math.random() - 0.5) * 3,
        spin: (Math.random() - 0.5) * 8,
        spinAxis: Math.random() * 3,
        life: 3 + Math.random() * 2,
      });
    }
  }

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
    p.vx += Math.sin(performance.now() * 0.005 + j) * 0.3 * dt;
    p.vz += Math.cos(performance.now() * 0.004 + j * 0.7) * 0.3 * dt;

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


/** Cleanup all environment/atmosphere VFX. Called by destroyVFX(). */
export function destroyEnvironmentVFX() {
  // Impact flash
  impactFlashIntensity = 0;
  if (impactFlashDiv) { impactFlashDiv.remove(); impactFlashDiv = null; }

  // Rain droplets
  screenDroplets.length = 0;
  rainDropActive = false;
  if (rainDropResizeHandler) { window.removeEventListener('resize', rainDropResizeHandler); rainDropResizeHandler = null; }
  if (rainDropCanvas) { rainDropCanvas.remove(); rainDropCanvas = null; rainDropCtx = null; }

  // Ambient particles
  if (ambientParticles && ambientScene) {
    ambientScene.remove(ambientParticles);
    ambientParticles.geometry?.dispose();
    (ambientParticles.material as THREE.Material)?.dispose();
  }
  ambientParticles = null; ambientPositions = null; ambientVelocities = null; ambientScene = null;

  // Heat shimmer
  if (shimmerResizeHandler) { window.removeEventListener('resize', shimmerResizeHandler); shimmerResizeHandler = null; }
  if (shimmerCanvas) { shimmerCanvas.remove(); shimmerCanvas = null; shimmerCtx = null; }

  // Lens flares
  for (const sprite of flareSprites) { sprite.parent?.remove(sprite); (sprite.material as THREE.Material)?.dispose(); }
  flareSprites = []; flareLightPositions = [];

  // Lightning
  lightningIntensity = 0; lightningTimer = 0; lightningEnabled = false;
  if (lightningDiv) { lightningDiv.remove(); lightningDiv = null; }

  // Near-miss streaks
  activeStreaks.length = 0;
  if (nearMissResizeHandler) { window.removeEventListener('resize', nearMissResizeHandler); nearMissResizeHandler = null; }
  if (nearMissCanvas) { nearMissCanvas.remove(); nearMissCanvas = null; nearMissCtx = null; }

  // Near-miss whoosh
  for (const wm of [whooshMeshL, whooshMeshR]) {
    if (wm) { wm.parent?.remove(wm); wm.geometry?.dispose(); (wm.material as THREE.Material)?.dispose(); }
  }
  whooshMeshL = null; whooshMeshR = null; whooshLifeL = 0; whooshLifeR = 0; whooshScene = null;

  // Victory confetti
  _confettiContinuous = false; _confettiSpawnPos = null; _confettiPoolIdx = 0;
  for (const p of activeConfetti) p.mesh.visible = false;
  activeConfetti.length = 0;
  if (confettiScene) {
    for (const m of confettiPool) { confettiScene.remove(m); m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); }
  }
  confettiPool = []; confettiScene = null;
}
