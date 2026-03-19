/* ── IRL Race — Garage / Car Selection Scene ── */

import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CAR_ROSTER, CarDef } from './types';
import { loadCarModel, loadCarModelWithProgress } from './loaders';
import { isCarUnlocked, getUnlockCost, unlockCar, getProgress, saveProgress } from './progression';
import { getSettings, saveSettings } from './settings';
import { initCalibrationStudio, onStudioCarLoaded } from './calibration-studio';
import { applyPaintToModel, restoreOriginalColors, shouldSkipForPaint } from './garage-paint';
import { playClickSfx, playConfirmSfx, playUnlockSfx, playSpraySfx } from './garage-audio';

let garageScene: THREE.Scene;
let garageCamera: THREE.PerspectiveCamera;
let garageRenderer: THREE.WebGPURenderer;
let currentIndex = 0;
let currentModel: THREE.Group | null = null;
let platform: THREE.Mesh;
let onSelectCallback: ((car: CarDef) => void) | null = null;
let uiEl: HTMLElement | null = null;

// Showroom environment objects
let ringMesh: THREE.Mesh | null = null;
let ringMat: THREE.MeshBasicMaterial | null = null;
let bokehPoints: THREE.Points | null = null;
let backdropGroup: THREE.Group | null = null;
let ringTime = 0;
let currentTierColor = new THREE.Color(0x44cc88);
let targetTierColor = new THREE.Color(0x44cc88);

// Interactive camera orbit
let orbitAngle = 0;
let orbitVelocity = 0;
let isDragging = false;
let lastPointerX = 0;
let lastInteractionTime = 0;
const AUTO_ROTATE_RESUME_DELAY = 3000; // ms
const AUTO_ROTATE_SPEED = 0.005;
const ORBIT_DAMPING = 0.92;
const ORBIT_RADIUS = 7.5;
const ORBIT_HEIGHT = 2.8;
const ORBIT_LOOK_Y = 0.8;

// Swipe navigation
let swipeStartX = 0;
const SWIPE_THRESHOLD = 60;

// Dot indicator element
let dotContainerEl: HTMLElement | null = null;

// Placeholder silhouette
let placeholderMesh: THREE.Object3D | null = null;

// Loading progress bar
let progressBarEl: HTMLElement | null = null;

// Stored event handlers for cleanup
let _pointerDownHandler: ((e: PointerEvent) => void) | null = null;
let _pointerMoveHandler: ((e: PointerEvent) => void) | null = null;
let _pointerUpHandler: ((e: PointerEvent) => void) | null = null;

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
  platform.position.y = -0.10; // height 0.2 -> top is perfectly 0.0
  platform.receiveShadow = true;
  garageScene.add(platform);

  // ── Animated Neon Ring (tier-colored) ──
  const ringGeo = new THREE.TorusGeometry(3.65, 0.04, 12, 96);
  ringMat = new THREE.MeshBasicMaterial({ color: 0x44cc88, transparent: true, opacity: 0.8 });
  ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.0;
  garageScene.add(ringMesh);

  // ── Reflective Floor with Radial Gradient Fade ──
  const floorSize = 40;
  const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize, 1, 1);
  // Create a radial alpha texture for the floor fade
  const fadeCanvas = document.createElement('canvas');
  fadeCanvas.width = 256;
  fadeCanvas.height = 256;
  const fadeCtx = fadeCanvas.getContext('2d')!;
  const grad = fadeCtx.createRadialGradient(128, 128, 20, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  fadeCtx.fillStyle = grad;
  fadeCtx.fillRect(0, 0, 256, 256);
  const fadeTex = new THREE.CanvasTexture(fadeCanvas);

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a18,
    roughness: 0.25,
    metalness: 0.7,
    alphaMap: fadeTex,
    transparent: true,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.0; // Must be exactly 0 since loaders.ts aligns tires to 0
  floor.receiveShadow = true;
  garageScene.add(floor);

  // ── Volumetric Bokeh Particles ──
  buildBokehParticles();

  // ── Showroom Backdrop Panels ──
  buildBackdropPanels();

  // Build placeholder silhouette (reused for all cars)
  buildPlaceholder();

  // UI
  buildGarageUI(overlay);

  // Wire canvas orbit + swipe interactions
  wireCanvasInteractions();

  // Wire keyboard navigation
  wireKeyboardNav();

  // Show the first car immediately (no preload-all wall)
  showCar(0);
}

// ── Tier Color Map ──
const TIER_COLORS: Record<string, number> = {
  ENTRY: 0x44cc88,
  MID: 0x4488ff,
  EXOTIC: 0xff44aa,
  ELITE: 0xffcc00,
};

function setTierColor(index: number) {
  const tier = index < 3 ? 'ENTRY' : index < 5 ? 'MID' : index < 8 ? 'EXOTIC' : 'ELITE';
  targetTierColor.setHex(TIER_COLORS[tier] ?? 0x44cc88);
}

// ── Volumetric Bokeh Particles ──
function buildBokehParticles() {
  const count = 80;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = Math.random() * 8 - 1;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20 - 5; // mostly behind car
    sizes[i] = 2 + Math.random() * 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  // Create a soft circular sprite texture
  const spriteCanvas = document.createElement('canvas');
  spriteCanvas.width = 64;
  spriteCanvas.height = 64;
  const sCtx = spriteCanvas.getContext('2d')!;
  const sGrad = sCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
  sGrad.addColorStop(0, 'rgba(255,200,150,0.6)');
  sGrad.addColorStop(0.4, 'rgba(255,180,120,0.2)');
  sGrad.addColorStop(1, 'rgba(255,160,100,0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 64, 64);
  const spriteTex = new THREE.CanvasTexture(spriteCanvas);

  const mat = new THREE.PointsMaterial({
    map: spriteTex,
    size: 0.4,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  bokehPoints = new THREE.Points(geo, mat);
  garageScene.add(bokehPoints);
}

// ── Showroom Backdrop Panels ──
function buildBackdropPanels() {
  backdropGroup = new THREE.Group();
  const panelCount = 5;
  const radius = 12;
  const panelWidth = 3;
  const panelHeight = 10;

  for (let i = 0; i < panelCount; i++) {
    const angle = (i / panelCount) * Math.PI - Math.PI / 2; // semicircle behind car
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;

    // Main dark panel
    const panelGeo = new THREE.PlaneGeometry(panelWidth, panelHeight);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a18,
      roughness: 0.8,
      metalness: 0.3,
      transparent: true,
      opacity: 0.6,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(x, panelHeight / 2 - 1, z);
    panel.lookAt(0, panelHeight / 2 - 1, 0);
    backdropGroup.add(panel);

    // Emissive edge stripe (thin vertical line)
    const stripeGeo = new THREE.PlaneGeometry(0.02, panelHeight * 0.8);
    const stripeMat = new THREE.MeshBasicMaterial({
      color: 0xff6a2a,
      transparent: true,
      opacity: 0.25,
    });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(x + Math.cos(angle) * (panelWidth / 2 - 0.1), panelHeight / 2 - 1, z + Math.sin(angle) * (panelWidth / 2 - 0.1));
    stripe.lookAt(0, panelHeight / 2 - 1, 0);
    backdropGroup.add(stripe);
  }

  garageScene.add(backdropGroup);
}

// ── Canvas Interactions (pointer events) ──
function wireCanvasInteractions() {
  // Unified pointer events handling mouse and touch
  _pointerDownHandler = (e: PointerEvent) => {
    // Only handle primary pointer (usually touches[0] or left click)
    if (!e.isPrimary) return;
    
    // Ignore if clicking on interactive UI layers instead of the 3D canvas
    const target = e.target as HTMLElement;
    if (target.closest('.garage-ui > div, #calibration-studio')) return;

    isDragging = true;
    lastPointerX = e.clientX;
    swipeStartX = e.clientX;
    lastInteractionTime = performance.now();
    
    // Check if calibration studio is active and dragging gizmo
    if (document.body.classList.contains('gizmo-active')) {
      isDragging = false;
    }
  };
  window.addEventListener('pointerdown', _pointerDownHandler);

  _pointerMoveHandler = (e: PointerEvent) => {
    if (!isDragging || !e.isPrimary) return;
    if (document.body.classList.contains('gizmo-active')) {
      isDragging = false;
      return;
    }
    const dx = e.clientX - lastPointerX;
    orbitVelocity = dx * 0.003;
    lastPointerX = e.clientX;
    lastInteractionTime = performance.now();
  };
  window.addEventListener('pointermove', _pointerMoveHandler);

  _pointerUpHandler = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    
    if (isDragging) {
      isDragging = false;
      const totalDx = e.clientX - swipeStartX;
      // Swipe navigation (quick horizontal swipe - mostly used on touch)
      if (Math.abs(totalDx) > SWIPE_THRESHOLD && e.pointerType === 'touch') {
        if (totalDx < 0) {
          currentIndex = (currentIndex + 1) % CAR_ROSTER.length;
        } else {
          currentIndex = (currentIndex - 1 + CAR_ROSTER.length) % CAR_ROSTER.length;
        }
        showCar(currentIndex);
      }
    }
  };

  window.addEventListener('pointerup', _pointerUpHandler);
  window.addEventListener('pointercancel', _pointerUpHandler);

  // ── Setup Calibration Studio ──
  initCalibrationStudio(garageRenderer, uiEl!);
}

// ── Car Dot Indicators ──
function buildDotIndicators(container: HTMLElement) {
  dotContainerEl = document.createElement('div');
  dotContainerEl.className = 'garage-dots';
  dotContainerEl.id = 'garage-dots';
  for (let i = 0; i < CAR_ROSTER.length; i++) {
    const dot = document.createElement('span');
    dot.className = 'garage-dot';
    dot.dataset.index = String(i);
    dotContainerEl.appendChild(dot);
  }
  container.appendChild(dotContainerEl);
}

function updateDots(index: number) {
  if (!dotContainerEl) return;
  const dots = dotContainerEl.querySelectorAll('.garage-dot');
  dots.forEach((d, i) => {
    const dot = d as HTMLElement;
    const unlocked = isCarUnlocked(CAR_ROSTER[i].id);
    dot.classList.toggle('active', i === index);
    dot.classList.toggle('locked', !unlocked);
  });
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

  placeholderMesh = group;
  placeholderMesh.visible = false;
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
    <div class="paint-shop" id="paint-shop">
      <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:6px">
        <div id="paint-swatch" style="width:28px;height:28px;border-radius:50%;border:2px solid rgba(255,255,255,0.3);background:hsl(180,85%,45%)"></div>
        <input type="range" min="0" max="360" value="${getSettings().paintHue >= 0 ? getSettings().paintHue : 180}" id="garage-paint"
               style="width:140px;-webkit-appearance:none;height:8px;border-radius:4px;
                      background:linear-gradient(to right,hsl(0,85%,45%),hsl(60,85%,45%),hsl(120,85%,45%),hsl(180,85%,45%),hsl(240,85%,45%),hsl(300,85%,45%),hsl(360,85%,45%))">
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:8px">
        <button id="garage-paint-buy" style="font-size:11px;padding:5px 14px;border-radius:4px;border:none;
                background:linear-gradient(135deg,#ff8800,#ff6600);color:#fff;font-weight:700;cursor:pointer;
                letter-spacing:0.5px;transition:opacity 0.2s">BUY PAINT — 100 CR</button>
        <button id="garage-paint-reset" style="font-size:10px;background:none;border:1px solid rgba(255,255,255,0.2);
                color:rgba(255,255,255,0.5);padding:4px 10px;border-radius:4px;cursor:pointer">RESET</button>
      </div>
      <div id="paint-balance" style="text-align:center;margin-top:4px;font-size:10px;color:rgba(255,255,255,0.4)"></div>
      <div id="paint-toast" style="text-align:center;font-size:11px;font-weight:700;margin-top:4px;height:16px;transition:opacity 0.3s;opacity:0"></div>
    </div>
  `;

  overlay.appendChild(uiEl);

  uiEl.querySelector('#garage-prev')!.addEventListener('click', () => {
    currentIndex = (currentIndex - 1 + CAR_ROSTER.length) % CAR_ROSTER.length;
    showCar(currentIndex);
    playClickSfx();
  });

  uiEl.querySelector('#garage-next')!.addEventListener('click', () => {
    currentIndex = (currentIndex + 1) % CAR_ROSTER.length;
    showCar(currentIndex);
    playClickSfx();
  });

  uiEl.querySelector('#garage-select')!.addEventListener('click', () => {
    const car = CAR_ROSTER[currentIndex];
    if (!isCarUnlocked(car.id)) {
      if (unlockCar(car.id)) {
        playUnlockSfx();
        showCar(currentIndex);
      }
      return;
    }
    playConfirmSfx();
    if (onSelectCallback) onSelectCallback(car);
  });

  // ── Paint Shop Logic ──
  const PAINT_COST = 100;
  const paintSlider = uiEl.querySelector('#garage-paint') as HTMLInputElement;
  const paintSwatch = uiEl.querySelector('#paint-swatch') as HTMLElement;
  const paintBuyBtn = uiEl.querySelector('#garage-paint-buy') as HTMLButtonElement;
  const paintBalanceEl = uiEl.querySelector('#paint-balance') as HTMLElement;
  const paintToastEl = uiEl.querySelector('#paint-toast') as HTMLElement;
  let _previewHue = getSettings().paintHue >= 0 ? getSettings().paintHue : 180;

  function updatePaintBalance() {
    const prog = getProgress();
    paintBalanceEl.textContent = `Credits: ${prog.credits} CR`;
    paintBuyBtn.style.opacity = prog.credits >= PAINT_COST ? '1' : '0.4';
    paintBuyBtn.style.pointerEvents = prog.credits >= PAINT_COST ? 'auto' : 'none';
  }

  function showPaintToast(msg: string, color: string) {
    paintToastEl.textContent = msg;
    paintToastEl.style.color = color;
    paintToastEl.style.opacity = '1';
    setTimeout(() => { paintToastEl.style.opacity = '0'; }, 2000);
  }

  // Live preview on drag (free)
  if (paintSlider) {
    paintSlider.addEventListener('input', () => {
      _previewHue = parseInt(paintSlider.value);
      applyPaintToModel(currentModel, _previewHue);
      paintSwatch.style.background = `hsl(${_previewHue},85%,45%)`;
    });
  }

  // Buy paint button
  paintBuyBtn?.addEventListener('click', () => {
    const prog = getProgress();
    if (prog.credits < PAINT_COST) {
      showPaintToast('Not enough credits!', '#ff4444');
      return;
    }
    prog.credits -= PAINT_COST;
    saveProgress();
    const s = getSettings();
    s.paintHue = _previewHue;
    saveSettings(s);
    applyPaintToModel(currentModel, _previewHue);
    updatePaintBalance();
    showPaintToast('Paint applied!', '#44ff88');
    playSpraySfx();
    // Update credit display in stats
    const creditEl = document.querySelector('#garage-stats [style*="color:#ffcc00"]');
    if (creditEl) creditEl.textContent = `${prog.credits} CR`;
  });

  // Reset paint (free)
  uiEl.querySelector('#garage-paint-reset')?.addEventListener('click', () => {
    const s = getSettings();
    s.paintHue = -1;
    saveSettings(s);
    _previewHue = 180;
    if (paintSlider) paintSlider.value = '180';
    paintSwatch.style.background = 'hsl(180,85%,45%)';
    restoreOriginalColors(currentModel);
    showPaintToast('Paint reset!', '#aaaaaa');
  });

  updatePaintBalance();
  progressBarEl = uiEl.querySelector('#garage-progress-bar') as HTMLElement;

  // ── Dot Indicators ──
  buildDotIndicators(uiEl);
}

let showCarRequestId = 0;

async function showCar(index: number) {
  const car = CAR_ROSTER[index];
  const requestId = ++showCarRequestId;

  const nameEl = document.getElementById('garage-car-name');
  if (nameEl) nameEl.textContent = car.name;

  // Update dot indicator highlights
  updateDots(index);

  // Determine tier from roster position
  const tierInfo = index < 3 ? { label: 'ENTRY', color: '#6b8' }
                 : index < 6 ? { label: 'MID', color: '#8af' }
                 : index < 9 ? { label: 'EXOTIC', color: '#f8a' }
                 :             { label: 'ELITE', color: '#fd4' };

  // Update ring color to match tier
  setTierColor(index);

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

    // ── Entrance Animation (drop-in with scale) ──
    model.position.y = 2.5; // start above
    model.scale.setScalar(0.01); // start tiny
    garageScene.add(model);
    currentModel = model;
    hidePlaceholder();
    showProgressBar(false);

    // Platform landing height — model geometry extends ~0.3 below origin,
    // so raise above floor (y=0) to prevent tires clipping through
    const platformY = 0.35;

    // Animate entrance over ~400ms
    const entranceStart = performance.now();
    const entranceDuration = 400;
    const animateEntrance = () => {
      const elapsed = performance.now() - entranceStart;
      const t = Math.min(elapsed / entranceDuration, 1);
      // Cubic ease-out: 1 - (1-t)^3
      const ease = 1 - Math.pow(1 - t, 3);
      model.position.y = 2.5 - (2.5 - platformY) * ease;
      model.scale.setScalar(0.01 + 0.99 * ease);
      if (t < 1) {
        requestAnimationFrame(animateEntrance);
      } else {
        model.position.y = platformY;
        model.scale.setScalar(1);
        // Brief ring flash on landing
        if (ringMat) {
          ringMat.opacity = 1.0;
        }
      }
    };
    requestAnimationFrame(animateEntrance);

    // ── Clearcoat Paint Upgrade ──
    model.traverse((child: any) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat.isMeshStandardMaterial && !shouldSkipForPaint(mat, child.name)) {
          // Upgrade to physical material properties for clearcoat gloss
          mat.clearcoat = 0.9;
          mat.clearcoatRoughness = 0.03;
          mat.envMapIntensity = 1.2;
          mat.needsUpdate = true;
        }
      }
    });
    if (nameEl) nameEl.textContent = car.name;

    // Start lazy preloading neighbors + rest after first car loads
    lazyPreloadModels(index);

    // Apply saved paint color if set
    const savedHue = getSettings().paintHue;
    if (savedHue >= 0) {
      applyPaintToModel(currentModel, savedHue);
      // Sync slider + swatch
      const slider = document.getElementById('garage-paint') as HTMLInputElement;
      const swatch = document.getElementById('paint-swatch');
      if (slider) slider.value = String(savedHue);
      if (swatch) swatch.style.background = `hsl(${savedHue},85%,45%)`;
    }
    // Update paint balance display
    const balEl = document.getElementById('paint-balance');
    if (balEl) balEl.textContent = `Credits: ${getProgress().credits} CR`;
    
    // Notify calibration studio
    onStudioCarLoaded(model, car);
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
    placeholderMesh.position.y = 0.09;
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
  // ── Spring-damped orbit camera ──
  const now = performance.now();
  const idleTime = now - lastInteractionTime;

  if (isDragging) {
    // User is actively dragging — apply velocity directly
    orbitAngle += orbitVelocity;
  } else {
    // Apply damping to momentum
    orbitVelocity *= ORBIT_DAMPING;

    // Resume auto-rotate after idle delay
    const isCalibrating = new URLSearchParams(window.location.search).has('calibrate');
    if (idleTime > AUTO_ROTATE_RESUME_DELAY && !isCalibrating) {
      orbitAngle += AUTO_ROTATE_SPEED;
    } else {
      orbitAngle += orbitVelocity;
    }
  }

  // Position camera on orbit circle
  garageCamera.position.x = Math.sin(orbitAngle) * ORBIT_RADIUS;
  garageCamera.position.z = Math.cos(orbitAngle) * ORBIT_RADIUS;
  garageCamera.position.y = ORBIT_HEIGHT;
  garageCamera.lookAt(0, ORBIT_LOOK_Y, 0);

  // Animate neon ring pulse + tier color lerp
  ringTime += 0.016;
  if (ringMat) {
    ringMat.opacity = 0.6 + 0.4 * Math.sin(ringTime * 1.5);
    currentTierColor.lerp(targetTierColor, 0.05);
    ringMat.color.copy(currentTierColor);
  }

  // Animate bokeh particles (gentle drift)
  if (bokehPoints) {
    const positions = (bokehPoints.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] += 0.003; // slow rise
      if (positions[i + 1] > 8) positions[i + 1] = -1; // wrap around
    }
    (bokehPoints.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  garageRenderer.render(garageScene, garageCamera);
}

export function destroyGarage() {
  if (uiEl) { uiEl.remove(); uiEl = null; }
  progressBarEl = null;
  dotContainerEl = null;

  // Unwire keyboard navigation
  unwireKeyboardNav();

  // Unwire pointer event listeners
  if (_pointerDownHandler) { window.removeEventListener('pointerdown', _pointerDownHandler); _pointerDownHandler = null; }
  if (_pointerMoveHandler) { window.removeEventListener('pointermove', _pointerMoveHandler); _pointerMoveHandler = null; }
  if (_pointerUpHandler) {
    window.removeEventListener('pointerup', _pointerUpHandler);
    window.removeEventListener('pointercancel', _pointerUpHandler);
    _pointerUpHandler = null;
  }

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

  // Dispose showroom extras
  if (bokehPoints) {
    garageScene.remove(bokehPoints);
    bokehPoints.geometry.dispose();
    (bokehPoints.material as THREE.Material).dispose();
    bokehPoints = null;
  }
  if (backdropGroup) {
    garageScene.remove(backdropGroup);
    backdropGroup.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach(x => x.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      }
    });
    backdropGroup = null;
  }
  ringMesh = null;
  ringMat = null;
  ringTime = 0;

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


// ── Keyboard Navigation ──

let keyboardHandler: ((e: KeyboardEvent) => void) | null = null;

function wireKeyboardNav() {
  keyboardHandler = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        currentIndex = (currentIndex - 1 + CAR_ROSTER.length) % CAR_ROSTER.length;
        showCar(currentIndex);
        playClickSfx();
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        currentIndex = (currentIndex + 1) % CAR_ROSTER.length;
        showCar(currentIndex);
        playClickSfx();
        e.preventDefault();
        break;
      case 'Enter':
      case 'Space': {
        const car = CAR_ROSTER[currentIndex];
        if (!isCarUnlocked(car.id)) {
          if (unlockCar(car.id)) {
            playUnlockSfx();
            showCar(currentIndex);
          }
          return;
        }
        playConfirmSfx();
        if (onSelectCallback) onSelectCallback(car);
        e.preventDefault();
        break;
      }
}
  };
  window.addEventListener('keydown', keyboardHandler);
}

function unwireKeyboardNav() {
  if (keyboardHandler) {
    window.removeEventListener('keydown', keyboardHandler);
    keyboardHandler = null;
  }
}

