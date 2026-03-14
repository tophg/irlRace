/* ── Hood Racer — Garage / Car Selection Scene ── */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAR_ROSTER, CarDef } from './types';
import { loadCarModel, loadCarModelWithProgress } from './loaders';

let garageScene: THREE.Scene;
let garageCamera: THREE.PerspectiveCamera;
let garageRenderer: THREE.WebGLRenderer;
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
  renderer: THREE.WebGLRenderer,
  overlay: HTMLElement,
  onSelect: (car: CarDef) => void,
) {
  garageRenderer = renderer;
  onSelectCallback = onSelect;

  // Dedicated scene for showroom
  garageScene = new THREE.Scene();
  garageScene.background = new THREE.Color(0x0c0c1a);
  garageScene.fog = new THREE.FogExp2(0x0c0c1a, 0.018);

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

  placeholderMesh = new THREE.Mesh(); // container
  placeholderMesh.visible = false;
  (placeholderMesh as any).add(body, cabin);
  // Store as a Group-like container
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
    if (onSelectCallback) onSelectCallback(CAR_ROSTER[currentIndex]);
  });

  progressBarEl = uiEl.querySelector('#garage-progress-bar') as HTMLElement;
}

let showCarRequestId = 0;

async function showCar(index: number) {
  const car = CAR_ROSTER[index];
  const requestId = ++showCarRequestId;

  const nameEl = document.getElementById('garage-car-name');
  if (nameEl) nameEl.textContent = car.name;

  const statsEl = document.getElementById('garage-stats');
  if (statsEl) {
    const maxStat = { speed: 80, accel: 36, handling: 3, drift: 0.5 };
    statsEl.innerHTML = `
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
        <div class="bar-track"><div class="bar-fill" style="width:${(car.driftFactor / maxStat.drift) * 100}%"></div></div>
        <label>Drift</label>
      </div>
    `;
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
  } catch (err) {
    if (requestId === showCarRequestId) {
      hidePlaceholder();
      showProgressBar(false);
      if (nameEl) nameEl.textContent = `${car.name}  (load failed)`;
    }
  }
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
  hidePlaceholder();
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
}

export function getSelectedCar(): CarDef {
  return CAR_ROSTER[currentIndex];
}

export function getGarageScene() { return garageScene; }
export function getGarageCamera() { return garageCamera; }
