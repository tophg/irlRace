/* ── IRL Race — Weather System (v3 — Research-Enhanced) ──
 *
 * Player-relative precipitation (camera-attached rain volume),
 * dynamic intensity ramp, expanded splash pool, thunder audio.
 *
 * Key fix: precipMesh.position follows player each frame,
 * particles live in mesh-local space → instant full coverage.
 */

import * as THREE from 'three/webgpu';

export type WeatherType = 'clear' | 'light_rain' | 'heavy_rain' | 'snow' | 'blizzard' | 'ice';

// ── WeatherPhysics: per-frame modifiers sent to Vehicle.update() ──
export interface WeatherPhysics {
  gripScale: number;           // Pacejka D peak friction (1.0 dry → 0.12 ice)
  corneringStiffness: number;  // Pacejka B stiffness (1.0 → 0.25 ice)
  brakingScale: number;        // Braking force multiplier
  aquaplaneSpeed: number;      // Speed threshold for aquaplaning (0 = disabled)
  aquaplaneGripLoss: number;   // Grip loss above threshold (0–0.5)
  rollingResistance: number;   // Extra drag (0 dry → 0.6 blizzard)
  topSpeedScale: number;       // Max speed cap multiplier
  steerResponseScale: number;  // Steering responsiveness
  yawDamping: number;          // Angular recovery rate (lower = spins persist)
  driftScale: number;          // Visual drift amplification
  crosswindForce: number;      // Lateral push strength
  crosswindVariance: number;   // Gust randomness
  sprayDensity: number;        // Rooster tail intensity 0–1
  visibilityRange: number;     // Fog reduction multiplier
}

const WEATHER_PHYSICS: Record<WeatherType, WeatherPhysics> = {
  clear:      { gripScale: 1.00, corneringStiffness: 1.00, brakingScale: 1.00, aquaplaneSpeed: 0,  aquaplaneGripLoss: 0,    rollingResistance: 0,    topSpeedScale: 1.00, steerResponseScale: 1.0, yawDamping: 2.5, driftScale: 1.0, crosswindForce: 0,    crosswindVariance: 0,   sprayDensity: 0,   visibilityRange: 1.0 },
  light_rain: { gripScale: 0.78, corneringStiffness: 0.82, brakingScale: 0.85, aquaplaneSpeed: 50, aquaplaneGripLoss: 0.15, rollingResistance: 0.05, topSpeedScale: 0.95, steerResponseScale: 0.9, yawDamping: 2.3, driftScale: 1.3, crosswindForce: 0,    crosswindVariance: 0,   sprayDensity: 0.3, visibilityRange: 0.85 },
  heavy_rain: { gripScale: 0.55, corneringStiffness: 0.60, brakingScale: 0.65, aquaplaneSpeed: 35, aquaplaneGripLoss: 0.30, rollingResistance: 0.10, topSpeedScale: 0.88, steerResponseScale: 0.8, yawDamping: 2.0, driftScale: 1.6, crosswindForce: 0.2,  crosswindVariance: 0.2, sprayDensity: 0.8, visibilityRange: 0.65 },
  snow:       { gripScale: 0.40, corneringStiffness: 0.45, brakingScale: 0.50, aquaplaneSpeed: 0,  aquaplaneGripLoss: 0,    rollingResistance: 0.50, topSpeedScale: 0.78, steerResponseScale: 0.7, yawDamping: 2.8, driftScale: 1.5, crosswindForce: 0.15, crosswindVariance: 0.1, sprayDensity: 0,   visibilityRange: 0.70 },
  blizzard:   { gripScale: 0.32, corneringStiffness: 0.35, brakingScale: 0.42, aquaplaneSpeed: 0,  aquaplaneGripLoss: 0,    rollingResistance: 0.60, topSpeedScale: 0.72, steerResponseScale: 0.6, yawDamping: 2.6, driftScale: 1.7, crosswindForce: 0.40, crosswindVariance: 0.3, sprayDensity: 0,   visibilityRange: 0.45 },
  ice:        { gripScale: 0.12, corneringStiffness: 0.25, brakingScale: 0.30, aquaplaneSpeed: 0,  aquaplaneGripLoss: 0,    rollingResistance: 0.05, topSpeedScale: 0.70, steerResponseScale: 0.5, yawDamping: 1.2, driftScale: 2.0, crosswindForce: 0,    crosswindVariance: 0,   sprayDensity: 0,   visibilityRange: 0.80 },
};

// ── Precipitation visual config ──
interface PrecipConfig {
  dropCount: number;
  dropSpeed: number;
  dropLength: number;
  roadSpecular: number;
  opacity: number;
  color: number;
  windDriftX: number;
}

const PRECIP_CONFIGS: Record<WeatherType, PrecipConfig> = {
  clear:      { dropCount: 0,   dropSpeed: 0,  dropLength: 0,   roadSpecular: 0,   opacity: 0,   color: 0xaaccff, windDriftX: 0 },
  light_rain: { dropCount: 300, dropSpeed: 40, dropLength: 1.5, roadSpecular: 0.2, opacity: 0.3, color: 0xaaccff, windDriftX: 0 },
  heavy_rain: { dropCount: 600, dropSpeed: 55, dropLength: 2.5, roadSpecular: 0.5, opacity: 0.5, color: 0xaaccff, windDriftX: 0 },
  snow:       { dropCount: 400, dropSpeed: 12, dropLength: 0.3, roadSpecular: 0,   opacity: 0.6, color: 0xeeeeff, windDriftX: 3 },
  blizzard:   { dropCount: 800, dropSpeed: 18, dropLength: 0.4, roadSpecular: 0,   opacity: 0.7, color: 0xddddee, windDriftX: 8 },
  ice:        { dropCount: 0,   dropSpeed: 0,  dropLength: 0,   roadSpecular: 0.6, opacity: 0,   color: 0xaaccff, windDriftX: 0 },
};

// ── Precipitation volume dimensions ──
const PRECIP_WIDTH = 160;   // was 120 — wider rain curtain
const PRECIP_HEIGHT = 80;   // was 60 — taller rain column

let currentWeather: WeatherType = 'clear';
let precipMesh: THREE.LineSegments | null = null;
let precipPositions: Float32Array | null = null;
let precipVelocities: Float32Array | null = null;
let precipScene: THREE.Scene | null = null;
let precipConfig: PrecipConfig = PRECIP_CONFIGS.clear;
let precipMat: THREE.LineBasicMaterial | null = null;

// Dynamic intensity ramp (Forza-inspired: rain builds over ~3s)
let _intensityRamp = 0;
const INTENSITY_RAMP_SPEED = 0.33; // reaches 1.0 in ~3s

// Splashes (pooled sprites — rain only)
const SPLASH_POOL = 80; // was 40
let splashPool: THREE.Mesh[] = [];
let splashIdx = 0;
interface SplashParticle { mesh: THREE.Mesh; life: number; }
const activeSplashes: SplashParticle[] = [];

// Thunder audio — uses the shared AudioContext from audio.ts to avoid Safari's 6-context limit
let _thunderTimer = 0;
let _sharedAudioCtx: AudioContext | null = null;
let _sharedMasterGain: GainNode | null = null;

/** Provide the shared AudioContext for thunder SFX (call from audio.ts initAudio). */
export function setThunderAudioContext(ctx: AudioContext, masterGain: GainNode) {
  _sharedAudioCtx = ctx;
  _sharedMasterGain = masterGain;
}

export function getWeatherForSeed(seed: number): WeatherType {
  const r = ((seed * 2654435761) >>> 0) % 100;
  if (r < 40) return 'clear';
  if (r < 60) return 'light_rain';
  if (r < 75) return 'heavy_rain';
  if (r < 88) return 'snow';
  if (r < 95) return 'blizzard';
  return 'ice';
}

/** Get full weather physics struct for Vehicle.update() */
export function getWeatherPhysics(): WeatherPhysics {
  return WEATHER_PHYSICS[currentWeather];
}

// Keep legacy getters for backward compat
function getWeatherGripMultiplier(): number {
  return WEATHER_PHYSICS[currentWeather].gripScale;
}

function getWeatherDriftMultiplier(): number {
  return WEATHER_PHYSICS[currentWeather].driftScale;
}

export function getCurrentWeather(): WeatherType {
  return currentWeather;
}

export function initWeather(scene: THREE.Scene, weather: WeatherType) {
  destroyWeather();
  currentWeather = weather;
  precipConfig = PRECIP_CONFIGS[weather];
  precipScene = scene;
  _intensityRamp = 0; // start at 0, ramp up over ~3s
  _thunderTimer = 8 + Math.random() * 12; // first thunder in 8-20s

  if (precipConfig.dropCount === 0) return;

  // Build precipitation line segments in MESH-LOCAL space
  // (mesh will follow player each frame → instant full coverage)
  const count = precipConfig.dropCount;
  const geo = new THREE.BufferGeometry();
  precipPositions = new Float32Array(count * 6);
  precipVelocities = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * PRECIP_WIDTH;
    const y = Math.random() * PRECIP_HEIGHT;
    const z = (Math.random() - 0.5) * PRECIP_WIDTH;
    const len = precipConfig.dropLength;
    precipPositions[i * 6]     = x;
    precipPositions[i * 6 + 1] = y;
    precipPositions[i * 6 + 2] = z;
    precipPositions[i * 6 + 3] = x;
    precipPositions[i * 6 + 4] = y - len;
    precipPositions[i * 6 + 5] = z;
    precipVelocities[i] = precipConfig.dropSpeed * (0.8 + Math.random() * 0.4);
  }

  geo.setAttribute('position', new THREE.BufferAttribute(precipPositions, 3));

  precipMat = new THREE.LineBasicMaterial({
    color: precipConfig.color,
    transparent: true,
    opacity: 0, // start at 0, ramp up
    depthWrite: false,
  });

  precipMesh = new THREE.LineSegments(geo, precipMat);
  precipMesh.frustumCulled = false;
  scene.add(precipMesh);

  // Splash pool (rain types only)
  const isRain = weather === 'light_rain' || weather === 'heavy_rain';
  if (isRain) {
    for (let i = 0; i < SPLASH_POOL; i++) {
      const radius = 0.1 + Math.random() * 0.15; // size variation
      const splashGeo = new THREE.CircleGeometry(radius, 6);
      const splashMat = new THREE.MeshBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(splashGeo, splashMat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      splashPool.push(m);
    }
  }
}

export function updateWeather(dt: number, playerPos: THREE.Vector3) {
  if (!precipPositions || !precipVelocities || !precipMesh || !precipMat) return;

  // ── Dynamic intensity ramp: rain builds over ~3s ──
  _intensityRamp = Math.min(1, _intensityRamp + dt * INTENSITY_RAMP_SPEED);
  precipMat.opacity = precipConfig.opacity * _intensityRamp;

  // ── Move precipitation mesh to follow player (camera-attached rain volume) ──
  // Particles live in mesh-local space; mesh follows player → instant full coverage
  precipMesh.position.set(playerPos.x, 0, playerPos.z);

  const count = precipVelocities.length;
  const len = precipConfig.dropLength;
  const windDriftX = precipConfig.windDriftX;
  const isRain = currentWeather === 'light_rain' || currentWeather === 'heavy_rain';
  const attr = precipMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const halfW = PRECIP_WIDTH / 2;

  for (let i = 0; i < count; i++) {
    const vel = precipVelocities[i];
    const base = i * 6;
    precipPositions[base + 1] -= vel * dt;
    precipPositions[base + 4] -= vel * dt;

    // Snow/blizzard: lateral wind drift with coherent pattern
    if (windDriftX !== 0) {
      const drift = windDriftX * dt * (0.5 + Math.sin(i * 0.3 + performance.now() * 0.001) * 0.5);
      precipPositions[base]     += drift;
      precipPositions[base + 3] += drift;
    }

    // Reset drops that fall below ground — respawn in LOCAL coords
    if (precipPositions[base + 1] < -2) {
      const x = (Math.random() - 0.5) * PRECIP_WIDTH;
      const z = (Math.random() - 0.5) * PRECIP_WIDTH;
      const y = PRECIP_HEIGHT * 0.5 + Math.random() * PRECIP_HEIGHT * 0.5;
      precipPositions[base]     = x;
      precipPositions[base + 1] = y;
      precipPositions[base + 2] = z;
      precipPositions[base + 3] = x;
      precipPositions[base + 4] = y - len;
      precipPositions[base + 5] = z;

      // Spawn splash (rain only) — world position = local + mesh offset
      if (isRain && Math.random() < 0.15 && splashPool.length > 0) {
        const mesh = splashPool[splashIdx % SPLASH_POOL];
        splashIdx++;
        mesh.position.set(playerPos.x + x, playerPos.y + 0.05, playerPos.z + z);
        mesh.scale.setScalar(0.5);
        mesh.visible = true;
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.4 * _intensityRamp;
        activeSplashes.push({ mesh, life: 0.3 });
      }
    }

    // Wrap particles that drift laterally out of volume (for wind)
    if (precipPositions[base] > halfW) precipPositions[base] -= PRECIP_WIDTH;
    if (precipPositions[base] < -halfW) precipPositions[base] += PRECIP_WIDTH;
    precipPositions[base + 3] = precipPositions[base]; // sync line end X
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
    (s.mesh.material as THREE.MeshBasicMaterial).opacity = s.life * 1.3 * _intensityRamp;
    j++;
  }

  // ── Thunder audio (heavy_rain / blizzard only) ──
  if (currentWeather === 'heavy_rain' || currentWeather === 'blizzard') {
    _thunderTimer -= dt;
    if (_thunderTimer <= 0) {
      playThunder();
      _thunderTimer = 8 + Math.random() * 12; // next in 8-20s
    }
  }
}

// ── Thunder: procedural Web Audio rumble (routed through shared AudioContext) ──
function playThunder() {
  if (!_sharedAudioCtx || !_sharedMasterGain) return;
  try {
    const ctx = _sharedAudioCtx;
    const now = ctx.currentTime;
    const duration = 1.5 + Math.random() * 1.5;

    // White noise burst filtered to low-frequency rumble
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.4));
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Low-pass filter for rumble
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 150 + Math.random() * 100;
    filter.Q.value = 0.5;

    // Gain envelope: quick attack, slow decay
    const gain = ctx.createGain();
    const volume = 0.15 + Math.random() * 0.1; // subtle
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(_sharedMasterGain);
    source.start(now);
    source.stop(now + duration);
  } catch {
    // Audio context may not be available
  }
}

// ── Saved road material state (for restoration on weather change) ──
let savedRoadMat: { roughness: number; metalness: number; color: THREE.Color } | null = null;
let savedRoadMesh: THREE.Mesh | null = null;

const _snowRoadColor = new THREE.Color(0xcccccc);
const _iceRoadColor = new THREE.Color(0x88aacc);

/**
 * Apply weather-dependent road surface material changes.
 * Rain → wet glossy; Snow → white-dusted; Ice → mirror-glossy.
 */
export function applyWetRoad(roadMesh: THREE.Mesh) {
  const mat = roadMesh.material as THREE.MeshStandardMaterial;
  const w = currentWeather;

  if (!savedRoadMat) {
    savedRoadMat = { roughness: mat.roughness, metalness: mat.metalness, color: mat.color.clone() };
    savedRoadMesh = roadMesh;
  }

  if (w === 'light_rain' || w === 'heavy_rain') {
    mat.roughness = Math.max(0.6, savedRoadMat.roughness - precipConfig.roadSpecular * 0.5);
    mat.metalness = Math.min(0.08, savedRoadMat.metalness + precipConfig.roadSpecular * 0.05);
  } else if (w === 'snow' || w === 'blizzard') {
    mat.roughness = Math.min(0.95, savedRoadMat.roughness + 0.15);
    mat.color.copy(savedRoadMat.color).lerp(_snowRoadColor, 0.15);
  } else if (w === 'ice') {
    mat.roughness = 0.35;
    mat.metalness = 0.15;
    mat.color.copy(savedRoadMat.color).lerp(_iceRoadColor, 0.2);
  }
}

/** Get the precipitation mesh (for hiding during mirror render). */
export function getPrecipMesh(): THREE.LineSegments | null {
  return precipMesh;
}

export function destroyWeather() {
  // Restore road material to original state
  if (savedRoadMat && savedRoadMesh) {
    const mat = savedRoadMesh.material as THREE.MeshStandardMaterial;
    mat.roughness = savedRoadMat.roughness;
    mat.metalness = savedRoadMat.metalness;
    mat.color.copy(savedRoadMat.color);
    savedRoadMat = null;
    savedRoadMesh = null;
  }

  if (precipMesh && precipScene) {
    precipScene.remove(precipMesh);
    precipMesh.geometry.dispose();
    (precipMesh.material as THREE.Material).dispose();
    precipMesh = null;
  }
  precipMat = null;
  for (const s of activeSplashes) s.mesh.visible = false;
  activeSplashes.length = 0;
  if (precipScene) {
    for (const m of splashPool) {
      precipScene.remove(m);
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
  }
  splashPool = [];
  splashIdx = 0;
  precipPositions = null;
  precipVelocities = null;
  precipScene = null;
  currentWeather = 'clear';
  precipConfig = PRECIP_CONFIGS.clear;
  _intensityRamp = 0;
  _thunderTimer = 0;

  // Thunder shared context references are cleared (but not closed — audio.ts owns the lifecycle)
  _sharedAudioCtx = null;
  _sharedMasterGain = null;
}
