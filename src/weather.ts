/* ── Hood Racer — Weather System ── */

import * as THREE from 'three';

export type WeatherType = 'clear' | 'light_rain' | 'heavy_rain';

interface RainConfig {
  dropCount: number;
  dropSpeed: number;
  dropLength: number;
  gripMultiplier: number;
  driftMultiplier: number;
  roadSpecular: number;
  opacity: number;
}

const RAIN_CONFIGS: Record<WeatherType, RainConfig> = {
  clear: { dropCount: 0, dropSpeed: 0, dropLength: 0, gripMultiplier: 1.0, driftMultiplier: 1.0, roadSpecular: 0, opacity: 0 },
  light_rain: { dropCount: 300, dropSpeed: 40, dropLength: 1.5, gripMultiplier: 0.82, driftMultiplier: 1.3, roadSpecular: 0.2, opacity: 0.3 },
  heavy_rain: { dropCount: 600, dropSpeed: 55, dropLength: 2.5, gripMultiplier: 0.65, driftMultiplier: 1.6, roadSpecular: 0.5, opacity: 0.5 },
};

let currentWeather: WeatherType = 'clear';
let rainMesh: THREE.LineSegments | null = null;
let rainPositions: Float32Array | null = null;
let rainVelocities: Float32Array | null = null;
let rainScene: THREE.Scene | null = null;
let rainConfig: RainConfig = RAIN_CONFIGS.clear;

// Splashes (pooled sprites)
const SPLASH_POOL = 40;
let splashPool: THREE.Mesh[] = [];
let splashIdx = 0;
interface SplashParticle { mesh: THREE.Mesh; life: number; }
const activeSplashes: SplashParticle[] = [];

export function getWeatherForSeed(seed: number): WeatherType {
  const r = ((seed * 2654435761) >>> 0) % 100;
  if (r < 50) return 'clear';
  if (r < 80) return 'light_rain';
  return 'heavy_rain';
}

export function getWeatherGripMultiplier(): number {
  return rainConfig.gripMultiplier;
}

export function getWeatherDriftMultiplier(): number {
  return rainConfig.driftMultiplier;
}

export function getCurrentWeather(): WeatherType {
  return currentWeather;
}

export function initWeather(scene: THREE.Scene, weather: WeatherType) {
  destroyWeather();
  currentWeather = weather;
  rainConfig = RAIN_CONFIGS[weather];
  rainScene = scene;

  if (rainConfig.dropCount === 0) return;

  // Build rain line segments
  const count = rainConfig.dropCount;
  const geo = new THREE.BufferGeometry();
  rainPositions = new Float32Array(count * 6); // 2 vertices per line × 3 components
  rainVelocities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 120;
    const y = Math.random() * 60;
    const z = (Math.random() - 0.5) * 120;
    const len = rainConfig.dropLength;
    rainPositions[i * 6]     = x;
    rainPositions[i * 6 + 1] = y;
    rainPositions[i * 6 + 2] = z;
    rainPositions[i * 6 + 3] = x;
    rainPositions[i * 6 + 4] = y - len;
    rainPositions[i * 6 + 5] = z;
    rainVelocities[i] = rainConfig.dropSpeed * (0.8 + Math.random() * 0.4);
  }

  geo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));

  const mat = new THREE.LineBasicMaterial({
    color: 0xaaccff,
    transparent: true,
    opacity: rainConfig.opacity,
    depthWrite: false,
  });

  rainMesh = new THREE.LineSegments(geo, mat);
  rainMesh.frustumCulled = false;
  scene.add(rainMesh);

  // Splash pool
  const splashGeo = new THREE.CircleGeometry(0.15, 6);
  const splashMat = new THREE.MeshBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < SPLASH_POOL; i++) {
    const m = new THREE.Mesh(splashGeo, splashMat.clone());
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    splashPool.push(m);
  }
}

export function updateWeather(dt: number, playerPos: THREE.Vector3) {
  if (!rainPositions || !rainVelocities || !rainMesh) return;

  const count = rainVelocities.length;
  const len = rainConfig.dropLength;
  const attr = rainMesh.geometry.getAttribute('position') as THREE.BufferAttribute;

  for (let i = 0; i < count; i++) {
    const vel = rainVelocities[i];
    const base = i * 6;
    rainPositions[base + 1] -= vel * dt;
    rainPositions[base + 4] -= vel * dt;

    // Reset drops that fall below ground — recenter around player
    if (rainPositions[base + 1] < -2) {
      const x = playerPos.x + (Math.random() - 0.5) * 120;
      const z = playerPos.z + (Math.random() - 0.5) * 120;
      const y = 40 + Math.random() * 20;
      rainPositions[base]     = x;
      rainPositions[base + 1] = y;
      rainPositions[base + 2] = z;
      rainPositions[base + 3] = x;
      rainPositions[base + 4] = y - len;
      rainPositions[base + 5] = z;

      // Spawn splash occasionally
      if (Math.random() < 0.15 && splashPool.length > 0) {
        const mesh = splashPool[splashIdx % SPLASH_POOL];
        splashIdx++;
        mesh.position.set(x, playerPos.y + 0.05, z);
        mesh.scale.setScalar(0.5);
        mesh.visible = true;
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.4;
        activeSplashes.push({ mesh, life: 0.3 });
      }
    }
  }

  attr.needsUpdate = true;

  // Update splash particles
  let j = 0;
  while (j < activeSplashes.length) {
    const s = activeSplashes[j];
    s.life -= dt;
    if (s.life <= 0) {
      s.mesh.visible = false;
      activeSplashes[j] = activeSplashes[activeSplashes.length - 1];
      activeSplashes.pop();
      continue;
    }
    s.mesh.scale.setScalar(0.5 + (0.3 - s.life) * 3);
    (s.mesh.material as THREE.MeshBasicMaterial).opacity = s.life * 1.3;
    j++;
  }

  // Keep rain centered on player
  rainMesh.position.set(0, 0, 0);
}

export function applyWetRoad(roadMesh: THREE.Mesh) {
  if (rainConfig.roadSpecular <= 0) return;
  const mat = roadMesh.material as THREE.MeshStandardMaterial;
  mat.roughness = Math.max(0.2, mat.roughness - rainConfig.roadSpecular);
  mat.metalness = Math.min(0.4, mat.metalness + rainConfig.roadSpecular * 0.3);
}

export function destroyWeather() {
  if (rainMesh && rainScene) {
    rainScene.remove(rainMesh);
    rainMesh.geometry.dispose();
    (rainMesh.material as THREE.Material).dispose();
    rainMesh = null;
  }
  for (const s of activeSplashes) s.mesh.visible = false;
  activeSplashes.length = 0;
  if (rainScene) {
    for (const m of splashPool) {
      rainScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  splashPool = [];
  splashIdx = 0;
  rainPositions = null;
  rainVelocities = null;
  rainScene = null;
  currentWeather = 'clear';
  rainConfig = RAIN_CONFIGS.clear;
}
