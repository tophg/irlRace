/* ── Hood Racer — Garage / Car Selection Scene ── */

import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAR_ROSTER, CarDef } from './types';
import { loadCarModel, loadCarModelWithProgress } from './loaders';
import { isCarUnlocked, getUnlockCost, unlockCar, getProgress } from './progression';
import { getSettings, saveSettings } from './settings';

let garageScene: THREE.Scene;
let garageCamera: THREE.PerspectiveCamera;
let garageRenderer: THREE.WebGPURenderer;
let currentIndex = 0;
let currentModel: THREE.Group | null = null;
let platform: THREE.Mesh;
let rotationAngle = 0;
let onSelectCallback: ((car: CarDef) => void) | null = null;
let uiEl: HTMLElement | null = null;

// Placeholder silhouette
let placeholderMesh: THREE.Mesh | null = null;

// Loading progress bar
let progressBarEl: HTMLElement | null = null;

export function initGarage(
  renderer: THREE.WebGPURenderer,
  overlay: HTMLElement,
  onSelect: (car: CarDef) => void,
) {
  garageRenderer = renderer;
  onSelectCallback = onSelect;

  // Dedicated scene for showroom
  garageScene = new THREE.Scene();
  garageScene.background = new THREE.Color(0x0c0c1a);

  garageCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  garageCamera.position.set(0, 2.8, 7.5);
  garageCamera.lookAt(0, 0.8, 0);

  // ── Showroom Lighting — Bright Cinematic ──

  // Ambient base — visible shadow fill
  const ambient = new THREE.AmbientLight(0x667799, 1.2);
  garageScene.add(ambient);

  // Key light — bright cool-white spotlight from top-front-right
  const keySpot = new THREE.SpotLight(0xddeeff, 300, 30, Math.PI / 4, 0.5, 1.2);
  keySpot.position.set(4, 8, 5);
  keySpot.target.position.set(0, 0, 0);
  keySpot.castShadow = true;
  keySpot.shadow.mapSize.set(1024, 1024);
  garageScene.add(keySpot);
  garageScene.add(keySpot.target);

  // Fill light — warm from front-left
  const fillSpot = new THREE.SpotLight(0xffd4a0, 150, 25, Math.PI / 3, 0.6, 1.2);
  fillSpot.position.set(-5, 5, 4);
  fillSpot.target.position.set(0, 0.5, 0);
  garageScene.add(fillSpot);
  garageScene.add(fillSpot.target);

  // Front fill — broad wash so car is never dark from camera angle
  const frontFill = new THREE.DirectionalLight(0xccccdd, 1.5);
  frontFill.position.set(0, 4, 8);
  garageScene.add(frontFill);

  // Rim/accent light — neon orange from behind
  const rimSpot = new THREE.SpotLight(0xff6a2a, 200, 22, Math.PI / 5, 0.4, 1.2);
  rimSpot.position.set(0, 3, -7);
  rimSpot.target.position.set(0, 0.5, 0);
  garageScene.add(rimSpot);
  garageScene.add(rimSpot.target);

  // Overhead down-light (bright white wash for top reflections)
  const overhead = new THREE.PointLight(0xeeeeff, 60, 15, 1.5);
  overhead.position.set(0, 6, 0);
  garageScene.add(overhead);

  // Under-glow (cool blue for premium floor glow)
  const underglow = new THREE.PointLight(0x3366ff, 25, 8, 1.5);
  underglow.position.set(0, 0.15, 0);
  garageScene.add(underglow);

  // Environment map for reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    const env = pmrem.fromScene(new RoomEnvironment()).texture;
    garageScene.environment = env;
  } catch { /* fallback: no envmap */ }
  pmrem.dispose();

  // Turntable platform — polished dark surface
  const platGeo = new THREE.CylinderGeometry(3.5, 3.8, 0.12, 64);
  const platMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    metalness: 0.85,
    roughness: 0.15,
  });
  platform = new THREE.Mesh(platGeo, platMat);
  platform.position.y = -0.06;
  platform.receiveShadow = true;
  garageScene.add(platform);

  // Platform edge ring (neon accent)
  const ringGeo = new THREE.TorusGeometry(3.65, 0.03, 8, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6a2a });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  garageScene.add(ring);

  // Floor — large dark reflective surface
  const floorGeo = new THREE.PlaneGeometry(40, 40);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x080812,
    roughness: 0.6,
    metalness: 0.4,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.12;
  floor.receiveShadow = true;
  garageScene.add(floor);

  // Build placeholder silhouette (reused for all cars)
  buildPlaceholder();

  // UI
  buildGarageUI(overlay);

  // Show the first car immediately (no preload-all wall)
  showCar(0);
}

/** Build a generic car-shaped silhouette for instant display while loading */
function buildPlaceholder() {
  const bodyGeo = new THREE.BoxGeometry(2.0, 0.7, 4.0);
  const cabinGeo = new THREE.BoxGeometry(1.6, 0.6, 2.0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x222244,
    transparent: true,
    opacity: 0.5,
    roughness: 0.3,
    metalness: 0.7,
  });

  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.6;

  const cabin = new THREE.Mesh(cabinGeo, bodyMat);
  cabin.position.y = 1.15;
  cabin.position.z = -0.2;

  const group = new THREE.Group();
  group.add(body);
  group.add(cabin);

  placeholderMesh = group as any;
  placeholderMesh!.visible = false;
}

/** Lazy preload: load neighbors first, then background-load the rest */
function lazyPreloadModels(startIndex: number) {
  const total = CAR_ROSTER.length;
  const order: number[] = [];

  // Immediate neighbors first
  const prev = (startIndex - 1 + total) % total;
  const next = (startIndex + 1) % total;
  order.push(prev, next);

  // Then the rest
  for (let i = 0; i < total; i++) {
    if (i !== startIndex && i !== prev && i !== next) {
      order.push(i);
    }
  }

  // Staggered load — one at a time to avoid bandwidth contention
  let i = 0;
  const loadNext = () => {
    if (i >= order.length) return;
    const idx = order[i++];
    loadCarModel(CAR_ROSTER[idx].file)
      .catch(() => null)
      .finally(() => setTimeout(loadNext, 50));
  };
  loadNext();
}

function buildGarageUI(overlay: HTMLElement) {
  uiEl = document.createElement('div');
  uiEl.className = 'garage-ui';
  uiEl.id = 'garage-ui';

  uiEl.innerHTML = `
    <div class="car-name" id="garage-car-name"></div>
    <div class="garage-progress-bar" id="garage-progress-bar"><div class="garage-progress-fill" id="garage-progress-fill"></div></div>
    <div class="car-stats" id="garage-stats"></div>
    <div class="car-nav">
      <button class="car-nav-btn" id="garage-prev">◀</button>
      <button class="select-btn" id="garage-select">SELECT</button>
      <button class="car-nav-btn" id="garage-next">▶</button>
    </div>
    <div style="margin-top:10px;text-align:center;">
      <label style="font-size:11px;color:rgba(255,255,255,0.6);letter-spacing:1px;">PAINT COLOR</label>
      <input type="range" min="0" max="360" value="${getSettings().paintHue >= 0 ? getSettings().paintHue : 180}" id="garage-paint"
             style="width:160px;-webkit-appearance:none;height:8px;border-radius:4px;
                    background:linear-gradient(to right,hsl(0,85%,45%),hsl(60,85%,45%),hsl(120,85%,45%),hsl(180,85%,45%),hsl(240,85%,45%),hsl(300,85%,45%),hsl(360,85%,45%));">
      <button id="garage-paint-reset" style="font-size:10px;background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.5);padding:2px 8px;border-radius:4px;cursor:pointer;margin-left:6px;">RESET</button>
    </div>
  `;

  overlay.appendChild(uiEl);

  uiEl.querySelector('#garage-prev')!.addEventListener('click', () => {
    currentIndex = (currentIndex - 1 + CAR_ROSTER.length) % CAR_ROSTER.length;
    showCar(currentIndex);
  });

  uiEl.querySelector('#garage-next')!.addEventListener('click', () => {
    currentIndex = (currentIndex + 1) % CAR_ROSTER.length;
    showCar(currentIndex);
  });

  uiEl.querySelector('#garage-select')!.addEventListener('click', () => {
    const car = CAR_ROSTER[currentIndex];
    if (!isCarUnlocked(car.id)) {
      // Try to unlock
      if (unlockCar(car.id)) {
        showCar(currentIndex); // Refresh display
      }
      return;
    }
    if (onSelectCallback) onSelectCallback(car);
  });

  // Paint hue slider — live preview
  const paintSlider = uiEl.querySelector('#garage-paint') as HTMLInputElement;
  if (paintSlider) {
    paintSlider.addEventListener('input', () => {
      const hue = parseInt(paintSlider.value);
      // Persist immediately
      const s = getSettings();
      s.paintHue = hue;
      saveSettings(s);
      // Recolor the current model in the garage
      applyPaintToGarageModel(hue);
    });
  }

  // Reset paint
  uiEl.querySelector('#garage-paint-reset')?.addEventListener('click', () => {
    const s = getSettings();
    s.paintHue = -1;
    saveSettings(s);
    if (paintSlider) paintSlider.value = '180';
    // Reload model to restore original colors
    showCar(currentIndex);
  });

  progressBarEl = uiEl.querySelector('#garage-progress-bar') as HTMLElement;
}

let showCarRequestId = 0;

async function showCar(index: number) {
  const car = CAR_ROSTER[index];
  const requestId = ++showCarRequestId;

  const nameEl = document.getElementById('garage-car-name');
  if (nameEl) nameEl.textContent = car.name;

  // Determine tier from roster position
  const tierInfo = index < 3 ? { label: 'ENTRY', color: '#6b8' }
                 : index < 6 ? { label: 'MID', color: '#8af' }
                 : index < 9 ? { label: 'EXOTIC', color: '#f8a' }
                 :             { label: 'ELITE', color: '#fd4' };

  const statsEl = document.getElementById('garage-stats');
  if (statsEl) {
    const maxStat = { speed: 92, accel: 38, handling: 3.4, drift: 0.52, grip: 1.12 };
    const locked = !isCarUnlocked(car.id);
    const unlockCost = getUnlockCost(car.id);
    const lockLabel = locked ? `🔒 ${unlockCost} CR` : 'UNLOCKED';
    const lockColor = locked ? '#ff4444' : tierInfo.color;
    const prog = getProgress();

    statsEl.innerHTML = `
      <div style="text-align:center;margin-bottom:8px">
        <span style="background:${tierInfo.color};color:#111;padding:2px 10px;border-radius:3px;font-weight:700;font-size:11px;letter-spacing:1px">${tierInfo.label}</span>
        <span style="background:${lockColor};color:#fff;padding:2px 8px;border-radius:3px;font-weight:700;font-size:10px;letter-spacing:1px;margin-left:6px">${lockLabel}</span>
      </div>
      <div class="stat-bar">
        <div class="bar-track"><div class="bar-fill" style="width:${(car.maxSpeed / maxStat.speed) * 100}%"></div></div>
        <label>Speed</label>
      </div>
      <div class="stat-bar">
        <div class="bar-track"><div class="bar-fill" style="width:${(car.acceleration / maxStat.accel) * 100}%"></div></div>
        <label>Accel</label>
      </div>
      <div class="stat-bar">
        <div class="bar-track"><div class="bar-fill" style="width:${(car.handling / maxStat.handling) * 100}%"></div></div>
        <label>Handle</label>
      </div>
      <div class="stat-bar">
        <div class="bar-track"><div class="bar-fill" style="width:${(car.gripCoeff / maxStat.grip) * 100}%"></div></div>
        <label>Grip</label>
      </div>
      <div class="stat-bar">
        <div class="bar-track"><div class="bar-fill" style="width:${(car.driftFactor / maxStat.drift) * 100}%"></div></div>
        <label>Drift</label>
      </div>
      <div style="text-align:center;margin-top:6px;font-size:11px;color:rgba(255,255,255,0.5)">
        Credits: <span style="color:#ffcc00;font-weight:700">${prog.credits} CR</span>
      </div>
    `;

    // Update select button label
    const selectBtn = document.getElementById('garage-select');
    if (selectBtn) {
      selectBtn.textContent = locked ? `UNLOCK ${unlockCost} CR` : 'SELECT';
      selectBtn.style.opacity = (locked && prog.credits < unlockCost) ? '0.5' : '1';
    }
  }

  if (currentModel) {
    garageScene.remove(currentModel);
    currentModel = null;
  }

  // Show placeholder silhouette immediately
  showPlaceholder();
  showProgressBar(true);
  updateProgress(0);

  try {
    const model = await loadCarModelWithProgress(car.file, (pct) => {
      if (requestId === showCarRequestId) updateProgress(pct);
    });
    // Guard against rapid navigation — only apply if this is still the current request
    if (requestId !== showCarRequestId) return;
    model.position.y = 0.25;
    garageScene.add(model);
    currentModel = model;
    hidePlaceholder();
    showProgressBar(false);
    if (nameEl) nameEl.textContent = car.name;

    // Start lazy preloading neighbors + rest after first car loads
    lazyPreloadModels(index);

    // Apply saved paint color if set
    const savedHue = getSettings().paintHue;
    if (savedHue >= 0) applyPaintToGarageModel(savedHue);
  } catch (err) {
    if (requestId === showCarRequestId) {
      hidePlaceholder();
      showProgressBar(false);
      if (nameEl) nameEl.textContent = `${car.name}  (load failed)`;
    }
  }
}

/** Recolor the current garage model's body panels with a hue (0–360). */
function applyPaintToGarageModel(hue: number) {
  if (!currentModel) return;
  const color = new THREE.Color().setHSL(hue / 360, 0.85, 0.45);
  currentModel.traverse((child: any) => {
    if (!(child instanceof THREE.Mesh)) return;
    const mat = child.material;
    if (!mat || Array.isArray(mat)) return;
    if (mat.transparent && mat.opacity < 0.9) return;
    // Skip emissive-dominant meshes (headlights, taillights, indicators)
    if (mat.emissiveIntensity && mat.emissiveIntensity > 0.5) return;
    if (mat.color) {
      const hsl = { h: 0, s: 0, l: 0 };
      mat.color.getHSL(hsl);
      if (hsl.l > 0.1 && hsl.l < 0.9) {
        mat.color.copy(color);
      }
    }
  });
}

function showPlaceholder() {
  if (placeholderMesh) {
    placeholderMesh.visible = true;
    placeholderMesh.position.y = 0.25;
    if (!placeholderMesh.parent) garageScene.add(placeholderMesh);
  }
}

function hidePlaceholder() {
  if (placeholderMesh) {
    placeholderMesh.visible = false;
  }
}

function showProgressBar(visible: boolean) {
  if (progressBarEl) {
    progressBarEl.style.display = visible ? 'block' : 'none';
  }
}

function updateProgress(pct: number) {
  const fill = document.getElementById('garage-progress-fill');
  if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
}

export function updateGarage() {
  rotationAngle += 0.005;
  if (currentModel) {
    currentModel.rotation.y = rotationAngle;
  }
  if (placeholderMesh?.visible) {
    placeholderMesh.rotation.y = rotationAngle;
  }

  garageRenderer.render(garageScene, garageCamera);
}

export function destroyGarage() {
  if (uiEl) { uiEl.remove(); uiEl = null; }
  progressBarEl = null;

  // Dispose current car model
  if (currentModel) {
    garageScene.remove(currentModel);
    currentModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      }
    });
    currentModel = null;
  }

  // Dispose placeholder
  if (placeholderMesh) {
    garageScene.remove(placeholderMesh);
    placeholderMesh.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      }
    });
    placeholderMesh = null;
  }

  // Dispose environment map
  if (garageScene?.environment) {
    garageScene.environment.dispose();
    garageScene.environment = null;
  }

  // Dispose remaining scene objects (lights, platform, floor, ring)
  if (garageScene) {
    garageScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      }
    });
  }
}

export function getSelectedCar(): CarDef {
  return CAR_ROSTER[currentIndex];
}

export function getGarageScene() { return garageScene; }
export function getGarageCamera() { return garageCamera; }
