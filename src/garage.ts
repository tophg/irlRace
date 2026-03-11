/* ── Hood Racer — Garage / Car Selection Scene ── */

import * as THREE from 'three';
import { CAR_ROSTER, CarDef } from './types';
import { loadCarModel } from './loaders';

let garageScene: THREE.Scene;
let garageCamera: THREE.PerspectiveCamera;
let garageRenderer: THREE.WebGLRenderer;
let currentIndex = 0;
let currentModel: THREE.Group | null = null;
let platform: THREE.Mesh;
let rotationAngle = 0;
let onSelectCallback: ((car: CarDef) => void) | null = null;
let uiEl: HTMLElement | null = null;

export function initGarage(
  renderer: THREE.WebGLRenderer,
  overlay: HTMLElement,
  onSelect: (car: CarDef) => void,
) {
  garageRenderer = renderer;
  onSelectCallback = onSelect;

  // Dedicated scene for showroom
  garageScene = new THREE.Scene();
  garageScene.background = new THREE.Color(0x0a0a14);

  garageCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  garageCamera.position.set(0, 3, 7);
  garageCamera.lookAt(0, 1, 0);

  // Lighting
  const ambient = new THREE.AmbientLight(0x666688, 0.6);
  garageScene.add(ambient);

  const key = new THREE.DirectionalLight(0xffeedd, 2.5);
  key.position.set(5, 8, 5);
  garageScene.add(key);

  const fill = new THREE.DirectionalLight(0x8888ff, 0.8);
  fill.position.set(-5, 4, -3);
  garageScene.add(fill);

  const rim = new THREE.DirectionalLight(0xff6600, 1.2);
  rim.position.set(0, 2, -6);
  garageScene.add(rim);

  // Environment map
  const { RoomEnvironment } = THREE as any;
  if (THREE.PMREMGenerator) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    try {
      const RoomEnvCtor = (THREE as any).RoomEnvironment;
        const env = pmrem.fromScene(RoomEnvCtor ? new RoomEnvCtor() : new THREE.Scene()).texture;
      garageScene.environment = env;
    } catch { /* fallback: no envmap */ }
    pmrem.dispose();
  }

  // Turntable platform
  const platGeo = new THREE.CylinderGeometry(3.5, 3.5, 0.15, 48);
  const platMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2a,
    metalness: 0.6,
    roughness: 0.3,
  });
  platform = new THREE.Mesh(platGeo, platMat);
  platform.position.y = -0.075;
  garageScene.add(platform);

  // Floor
  const floorGeo = new THREE.PlaneGeometry(30, 30);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.9 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.15;
  garageScene.add(floor);

  // UI
  buildGarageUI(overlay);
  showCar(0);
}

function buildGarageUI(overlay: HTMLElement) {
  uiEl = document.createElement('div');
  uiEl.className = 'garage-ui';
  uiEl.id = 'garage-ui';

  uiEl.innerHTML = `
    <div class="car-name" id="garage-car-name"></div>
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
}

async function showCar(index: number) {
  const car = CAR_ROSTER[index];

  // Update name
  const nameEl = document.getElementById('garage-car-name');
  if (nameEl) nameEl.textContent = car.name;

  // Update stat bars
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

  // Load 3D model
  if (currentModel) {
    garageScene.remove(currentModel);
    currentModel = null;
  }

  try {
    const model = await loadCarModel(car.file);
    model.position.y = 0.25;
    garageScene.add(model);
    currentModel = model;
  } catch (err) {
    console.warn('Failed to load car model:', car.file, err);
  }
}

export function updateGarage() {
  rotationAngle += 0.005;
  if (currentModel) {
    currentModel.rotation.y = rotationAngle;
  }

  garageRenderer.render(garageScene, garageCamera);
}

export function destroyGarage() {
  if (uiEl) { uiEl.remove(); uiEl = null; }
  if (currentModel) garageScene.remove(currentModel);
}

export function getSelectedCar(): CarDef {
  return CAR_ROSTER[currentIndex];
}

export function getGarageScene() { return garageScene; }
export function getGarageCamera() { return garageCamera; }
