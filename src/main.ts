/* ── Race IRL — Main Entry Point & Game Orchestrator ── */

import * as THREE from 'three/webgpu';
import './index.css';

import { GameState, CarDef, EventType, CAR_ROSTER } from './types';
import { initScene, getScene } from './scene';
import { showLapOverlay } from './hud';
import { playCheckpointSFX, playLapFanfare, playFinishFanfare, playPositionSFX, playTitleMusic, pauseMusic, resumeMusic, stopAllMusic } from './audio';
import { showResults, resolvePlayerName } from './results-screen';
import { enterSpectatorMode, cycleSpectateTarget, destroySpectateHUD } from './spectator';
import { initGarage, destroyGarage } from './garage';
import { loadCarModel } from './loaders';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { showTrackEditor, destroyTrackEditor } from './track-editor';
import { loadProgress } from './progression';
import { initInput, showTouchControls } from './input';
import { loadSettings, getSettings, showSettings } from './settings';
import { startReplayPlayback as startReplayUI } from './replay-ui';

// ── Shared state ──
import { G } from './game-context';

// ── Extracted UI ──
import {
  showPositionCallout, showEmoteBubble, spawnConfetti,
  togglePause, showRaceConfig, showControlsRef,
} from './ui-screens';
import { notifyPositionChanged } from './hud';

// ── Extracted Multiplayer ──
import { initMultiplayerHandler, enterMultiplayerLobby } from './multiplayer-handler';

// ── Event Bus ──
import { bus } from './event-bus';

// ── Extracted Game Loop ──
import { initGameLoop, startGameLoop, destroyLeaderboard } from './game-loop';

// ── Extracted Race Lifecycle ──
import { initRaceLifecycle, startRace, clearRaceObjects } from './race-lifecycle';


// ── DOM ──
const container = document.getElementById('game-container')!;
const uiOverlay = document.getElementById('ui-overlay')!;


// ── Scene (async — WebGPU renderer init) ──
const { renderer, scene, camera } = await initScene(container);

// ── Input ──
initInput();

// ── Keyboard listener for spectator cycling + emotes ──
const EMOTE_MAP: Record<string, string> = { '1': '👍', '2': '😂', '3': '💨', '4': '🔥' };
window.addEventListener('keydown', (e) => {
  if (G.gameState === GameState.RESULTS && G.vehicleCamera?.mode === 'follow') {
    if (e.key === 'ArrowLeft') cycleSpectateTarget(-1);
    else if (e.key === 'ArrowRight') cycleSpectateTarget(1);
  }
  // Quick emotes during racing (1-4 keys)
  if (G.gameState === GameState.RACING && EMOTE_MAP[e.key]) {
    const emoji = EMOTE_MAP[e.key];
    G.netPeer?.broadcastEvent(EventType.EMOTE, { emoji });
    showEmoteBubble(emoji);
  }
});





// ── Debug Overlay ──


window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') {
    G.debugVisible = !G.debugVisible;
    if (G.debugEl) G.debugEl.style.display = G.debugVisible ? 'block' : 'none';
  }
  if (e.code === 'Escape') {
    if (G.gameState === GameState.RACING || G.gameState === GameState.PAUSED) {
      const wasPaused = G.gameState === GameState.PAUSED;
      togglePause({ onRestart: () => startRace(), onQuit: () => showTitleScreen() });
      // Pause/resume music based on the transition direction
      if (wasPaused) resumeMusic();
      else pauseMusic();
    }
  }
});



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TITLE SCREEN — 3D Car Showcase
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Title scene state
let titleScene: THREE.Scene | null = null;
let titleCamera: THREE.PerspectiveCamera | null = null;
let titleCarModel: THREE.Group | null = null;
let titleOrbitAngle = 0;
let titleAnimFrame = 0;
let titleEmberCanvas: HTMLCanvasElement | null = null;
let titleEmberCtx: CanvasRenderingContext2D | null = null;
let titleEmberParticles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number; hue: number }[] = [];

function createTitleScene() {
  titleScene = new THREE.Scene();
  titleScene.background = new THREE.Color(0x060610);

  // ── Environment map (must match garage.ts pattern exactly for WebGPU compatibility) ──
  const pmremGen = new THREE.PMREMGenerator(renderer);
  try {
    const envMap = pmremGen.fromScene(new RoomEnvironment()).texture;
    titleScene.environment = envMap;
  } catch { /* fallback: no envmap */ }
  pmremGen.dispose();

  titleCamera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
  titleCamera.position.set(0, 2.0, 7);
  titleCamera.lookAt(0, 0.4, 0);

  // ── Lighting — must be very bright to combat WebGPU PBR darkness ──
  const ambient = new THREE.AmbientLight(0x445566, 2.0);
  titleScene.add(ambient);

  // Key directional light (strong white overhead)
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.0);
  keyLight.position.set(3, 8, 5);
  titleScene.add(keyLight);

  // Cyan rim light (right/front) — matches IRL glow
  const cyanRim = new THREE.SpotLight(0x00e5ff, 400, 20, Math.PI / 4, 0.5, 1.0);
  cyanRim.position.set(5, 4, 3);
  cyanRim.target.position.set(0, 0.5, 0);
  titleScene.add(cyanRim);
  titleScene.add(cyanRim.target);

  // Orange rim light (left/back) — matches RACE accent
  const orangeRim = new THREE.SpotLight(0xff4d00, 350, 20, Math.PI / 4, 0.5, 1.0);
  orangeRim.position.set(-5, 3, -3);
  orangeRim.target.position.set(0, 0.5, 0);
  titleScene.add(orangeRim);
  titleScene.add(orangeRim.target);

  // Soft overhead fill
  const overhead = new THREE.PointLight(0xaabbcc, 40, 15, 1.5);
  overhead.position.set(0, 6, 0);
  titleScene.add(overhead);

  // ── Reflective ground plane ──
  const groundGeo = new THREE.PlaneGeometry(30, 30);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x080812,
    roughness: 0.15,
    metalness: 0.85,
    transparent: true,
    opacity: 0.8,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  titleScene.add(ground);

  // Always show the Ferrari — best visual showcase car
  const titleCar = CAR_ROSTER.find(c => c.file === 'Ferrari.glb') ?? CAR_ROSTER[CAR_ROSTER.length - 1];
  console.log('[TitleScreen] Loading car:', titleCar.file);
  loadCarModel(titleCar.file).then((model: THREE.Group) => {
    if (!titleScene) return; // cleaned up before load finished
    // Raise slightly so wheels sit on the ground plane (processCarModel centers at tire contact)
    model.position.y = 0.15;
    titleScene!.add(model);
    titleCarModel = model;
    console.log('[TitleScreen] Car loaded successfully:', titleCar.file);
  }).catch((err) => {
    console.warn('[TitleScreen] Failed to load car:', titleCar.file, err);
  });
}

function updateTitleScene() {
  if (!titleScene || !titleCamera) return;

  // Slow orbit
  titleOrbitAngle += 0.003;
  const radius = 7;
  titleCamera.position.x = Math.sin(titleOrbitAngle) * radius;
  titleCamera.position.z = Math.cos(titleOrbitAngle) * radius;
  titleCamera.position.y = 2.0 + Math.sin(titleOrbitAngle * 0.5) * 0.3; // gentle bob
  titleCamera.lookAt(0, 0.4, 0);

  renderer.render(titleScene, titleCamera);
}

function destroyTitleScene() {
  if (titleCarModel && titleScene) {
    titleScene.remove(titleCarModel);
    titleCarModel = null;
  }
  titleScene = null;
  titleCamera = null;
  cancelAnimationFrame(titleAnimFrame);

  // Clean up ember canvas
  if (titleEmberCanvas) {
    titleEmberCanvas.remove();
    titleEmberCanvas = null;
    titleEmberCtx = null;
    titleEmberParticles = [];
  }
}

// ── Ember Particle Overlay ──

function createEmberOverlay() {
  titleEmberCanvas = document.createElement('canvas');
  titleEmberCanvas.className = 'title-ember-canvas';
  titleEmberCanvas.width = window.innerWidth;
  titleEmberCanvas.height = window.innerHeight;
  titleEmberCtx = titleEmberCanvas.getContext('2d')!;

  // Create particles
  titleEmberParticles = [];
  for (let i = 0; i < 35; i++) {
    titleEmberParticles.push({
      x: Math.random() * titleEmberCanvas.width,
      y: Math.random() * titleEmberCanvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -(0.2 + Math.random() * 0.6), // upward drift
      size: 1 + Math.random() * 2.5,
      alpha: 0.1 + Math.random() * 0.25,
      hue: Math.random() > 0.5 ? 20 : 190, // warm orange or cool cyan
    });
  }

  const titleEl = document.getElementById('title-screen');
  if (titleEl) titleEl.appendChild(titleEmberCanvas);
}

function updateEmbers() {
  if (!titleEmberCtx || !titleEmberCanvas) return;
  const w = titleEmberCanvas.width;
  const h = titleEmberCanvas.height;

  titleEmberCtx.clearRect(0, 0, w, h);

  for (const p of titleEmberParticles) {
    p.x += p.vx;
    p.y += p.vy;

    // Wrap around
    if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
    if (p.x < -10) p.x = w + 10;
    if (p.x > w + 10) p.x = -10;

    titleEmberCtx.beginPath();
    titleEmberCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    const sat = p.hue < 100 ? '80%' : '70%';
    const light = p.hue < 100 ? '55%' : '60%';
    titleEmberCtx.fillStyle = `hsla(${p.hue}, ${sat}, ${light}, ${p.alpha})`;
    titleEmberCtx.fill();
  }
}

// ── Title Screen Loop ──

function titleLoop() {
  if (G.gameState !== GameState.TITLE) return;
  updateTitleScene();
  updateEmbers();
  titleAnimFrame = requestAnimationFrame(titleLoop);
}

function showTitleScreen() {
  G.gameState = GameState.TITLE;
  showTouchControls(false);
  playTitleMusic();

  // Create 3D scene
  createTitleScene();

  const titleEl = document.createElement('div');
  titleEl.className = 'title-screen';
  titleEl.id = 'title-screen';
  titleEl.innerHTML = `
    <div class="title-speed-lines"></div>
    <div class="title-content">
      <div class="title-logo"><span class="title-race">RACE</span> <span class="title-irl">IRL</span></div>
      <div class="title-subtitle">INDOOR RACING LEAGUE</div>
      <div class="menu-buttons">
        <button class="menu-btn" id="btn-singleplayer">SINGLEPLAYER</button>
        <button class="menu-btn" id="btn-multiplayer">MULTIPLAYER</button>
        <button class="menu-btn menu-btn--accent" id="btn-track-editor">🏁 TRACK EDITOR</button>
        <button class="menu-btn menu-btn--cyan" id="btn-calibrate">✨ CALIBRATION STUDIO</button>
        <div class="menu-row-secondary">
          <button class="menu-btn menu-btn--small" id="btn-controls">CONTROLS</button>
          <button class="menu-btn menu-btn--small" id="btn-settings">SETTINGS</button>
        </div>
      </div>
      <div class="title-version">v0.9 — raceirl.com</div>
      <div class="title-teaser">🏠 Race your actual neighborhood — Coming Soon</div>
    </div>
  `;
  uiOverlay.appendChild(titleEl);

  // Create ember overlay
  createEmberOverlay();

  // Start title render loop
  titleLoop();

  // Browser autoplay policy blocks music at page load; retry on first user click
  titleEl.addEventListener('click', () => playTitleMusic(), { once: true });

  const cleanupAndDo = (fn: () => void) => {
    destroyTitleScene();
    titleEl.remove();
    fn();
  };

  document.getElementById('btn-singleplayer')!.addEventListener('click', () => {
    cleanupAndDo(() => enterGarage('singleplayer'));
  });

  document.getElementById('btn-multiplayer')!.addEventListener('click', () => {
    cleanupAndDo(() => enterGarage('multiplayer'));
  });

  document.getElementById('btn-track-editor')!.addEventListener('click', () => {
    cleanupAndDo(() => enterTrackEditor());
  });

  document.getElementById('btn-controls')!.addEventListener('click', showControlsRef);

  document.getElementById('btn-settings')!.addEventListener('click', () => {
    showSettings(uiOverlay, () => {
      G.localPlayerName = getSettings().playerName || G.localPlayerName;
      applySettingsToRenderer();
    });
  });

  document.getElementById('btn-calibrate')!.addEventListener('click', () => {
    destroyTitleScene();
    window.location.href = '?calibrate=1';
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TRACK EDITOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function enterTrackEditor() {
  G.gameState = GameState.TRACK_EDITOR;
  stopAllMusic();

  showTrackEditor(uiOverlay, {
    onTestDrive: (track) => {
      destroyTrackEditor();
      G.totalLaps = 1;
      G.aiCount = 0;
      G.aiDifficulty = 'easy';
      G._customTrack = track;
      startRace();
    },
    onRaceWithTrack: (track) => {
      destroyTrackEditor();
      G._customTrack = track;
      enterGarage('singleplayer');
    },
    onBack: () => {
      destroyTrackEditor();
      showTitleScreen();
    },
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GARAGE (car selection)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function enterGarage(mode: 'singleplayer' | 'multiplayer') {
  G.gameState = GameState.GARAGE;

  initGarage(renderer, uiOverlay, (car: CarDef) => {
    G.selectedCar = car;
    // Hide renderer canvas during garage teardown to prevent empty scene flash
    renderer.domElement.style.visibility = 'hidden';
    destroyGarage();
    // Restore after a frame so the race config dialog renders on top
    requestAnimationFrame(() => { renderer.domElement.style.visibility = ''; });

    if (mode === 'singleplayer') {
      showRaceConfig((laps, ai, difficulty, seed, weather, environment) => {
        G.totalLaps = laps;
        G.aiCount = ai;
        G.aiDifficulty = difficulty;
        G._selectedWeather = weather;
        G._selectedEnvironment = environment;
        if (seed.length > 0) {
          const parsed = parseInt(seed, 10);
          G.trackSeed = Number.isNaN(parsed) ? Math.floor(Math.random() * 99999) : parsed;
        }
        startRace();
      }, () => showTitleScreen());
    } else {
      enterMultiplayerLobby();
    }
  });
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETTINGS APPLICATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function applySettingsToRenderer() {
  const s = getSettings();
  renderer.shadowMap.enabled = s.shadowQuality > 0;
  if (s.shadowQuality === 1) {
    renderer.shadowMap.type = THREE.BasicShadowMap;
  } else if (s.shadowQuality >= 2) {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const savedSettings = loadSettings();
loadProgress();
if (savedSettings.playerName) G.localPlayerName = savedSettings.playerName;
applySettingsToRenderer();

// Wire race lifecycle with renderer/scene/camera references
initRaceLifecycle({ renderer, scene, camera, uiOverlay, container });

// Wire multiplayer handler with main orchestrator callbacks
initMultiplayerHandler(uiOverlay, scene, {
  startRace,
  showTitleScreen,
  showResults: callShowResults,
  clearRaceObjects,
  destroyLeaderboard,
  destroySpectateHUD,
  resolvePlayerName: (id: string) => resolvePlayerName(id, G),
});

// ── Local wrappers for game-loop callbacks ──
function callShowResults() {
  showResults(G, uiOverlay, {
    startRace,
    showTitleScreen,
    startReplayPlayback,
    clearRaceObjects,
    destroyLeaderboard,
    destroySpectateHUD,
  });
}

function startReplayPlayback() {
  startReplayUI({
    G: G as any,
    camera,
    renderer,
    uiOverlay,
    getScene,
    onShowResults: callShowResults,
  });
}

// ── Init & start game loop ──
initGameLoop({
  renderer, scene, camera, uiOverlay,
  callShowResults,
  startRace,
  showTitleScreen,
  clearRaceObjects,
});

G.lastTime = performance.now();
showTitleScreen();

// ── Event Bus Consumer Registrations ──
bus.on('checkpoint', (e) => {
  playCheckpointSFX();
  G.netPeer?.broadcastEvent(EventType.CHECKPOINT_HIT, { lap: e.lap, cp: e.index });
});

bus.on('lap', (e) => {
  playLapFanfare();
  G.netPeer?.broadcastEvent(EventType.LAP_COMPLETE, { lap: e.lapIndex });
  showLapOverlay(uiOverlay, e.lapIndex, e.lapTime, e.isBest);
});

bus.on('finish', (e) => {
  G.netPeer?.broadcastEvent(EventType.RACE_FINISH, { finishTime: e.finishTime });
  destroyLeaderboard();
  playFinishFanfare();
  spawnConfetti();
  if (G.vehicleCamera && G.playerVehicle) {
    G.vehicleCamera.startOrbit(G.playerVehicle.group.position.clone());
  }
  setTimeout(() => {
    enterSpectatorMode();
    callShowResults();
  }, 3000);
});

bus.on('position_change', (e) => {
  showPositionCallout(e.gained, e.newRank);
  playPositionSFX(e.gained);
  notifyPositionChanged();
});

startGameLoop();

