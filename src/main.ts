/* ── IRL Race — Main Entry Point & Game Orchestrator ── */

import * as THREE from 'three/webgpu';
import './index.css';

// ── Vercel Analytics ──
import { inject } from '@vercel/analytics';

import { GameState, CarDef, EventType, CAR_ROSTER } from './types';
import { initScene, getScene } from './scene';
import { showLapOverlay } from './hud';
import { playCheckpointSFX, playLapFanfare, playFinishFanfare, playPositionSFX, playTitleMusic, preloadTitleMusic, pauseMusic, resumeMusic, stopAllMusic } from './audio';
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
  lockLandscape, isFullscreenSupported,
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


// ── Initialize Vercel Analytics ──
inject({ mode: (import.meta as any).env?.PROD ? 'production' : 'development' });


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
// TITLE SCREEN — Cinematic 3-Phase Car Reveal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Title scene state
let titleScene: THREE.Scene | null = null;
let titleCamera: THREE.PerspectiveCamera | null = null;
let titleCarModel: THREE.Group | null = null;
let titleAnimFrame = 0;
let titleStartTime = 0;
let titleEmberCanvas: HTMLCanvasElement | null = null;
let titleEmberCtx: CanvasRenderingContext2D | null = null;
let titleEmberParticles: { x: number; y: number; vx: number; vy: number; size: number; alpha: number; hue: number }[] = [];

// Cinematic elements
let titleCyanRim: THREE.SpotLight | null = null;
let titleOrangeRim: THREE.SpotLight | null = null;
let titleOverhead: THREE.PointLight | null = null;
let titleKeyLight: THREE.DirectionalLight | null = null;
let titleUnderglow: THREE.PointLight | null = null;
let titleNeonStrip: THREE.Mesh | null = null;
let titleFogPlane: THREE.Mesh | null = null;
let titleAmbient: THREE.AmbientLight | null = null;
let titleMenuRevealed = false;

// Easing helpers
function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }
function easeInOutQuad(t: number) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function clamp01(t: number) { return Math.max(0, Math.min(1, t)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * clamp01(t); }

function createTitleScene() {
  titleScene = new THREE.Scene();
  titleScene.background = new THREE.Color(0x030308);
  titleStartTime = performance.now() / 1000;
  titleMenuRevealed = false;

  // ── Environment map (matches garage.ts for WebGPU compat) ──
  const pmremGen = new THREE.PMREMGenerator(renderer);
  try {
    const envMap = pmremGen.fromScene(new RoomEnvironment()).texture;
    titleScene.environment = envMap;
  } catch { /* fallback */ }
  pmremGen.dispose();

  titleCamera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);
  // Phase 1 start: low dramatic angle
  titleCamera.position.set(0, 0.4, 5);
  titleCamera.lookAt(0, 0.6, 0);

  // Resize handler for orientation changes on title screen
  window.addEventListener('resize', () => {
    if (titleCamera) {
      titleCamera.aspect = window.innerWidth / window.innerHeight;
      titleCamera.updateProjectionMatrix();
    }
  });

  // ── Lighting — starts dark, activates during reveal ──
  titleAmbient = new THREE.AmbientLight(0x334455, 0.15);
  titleScene.add(titleAmbient);

  // Key directional (starts off)
  titleKeyLight = new THREE.DirectionalLight(0xffffff, 0);
  titleKeyLight.position.set(3, 8, 5);
  titleScene.add(titleKeyLight);

  // Cyan rim (starts off)
  titleCyanRim = new THREE.SpotLight(0x00e5ff, 0, 20, Math.PI / 4, 0.5, 1.0);
  titleCyanRim.position.set(5, 4, 3);
  titleCyanRim.target.position.set(0, 0.5, 0);
  titleScene.add(titleCyanRim);
  titleScene.add(titleCyanRim.target);

  // Orange rim (starts off)
  titleOrangeRim = new THREE.SpotLight(0xff4d00, 0, 20, Math.PI / 4, 0.5, 1.0);
  titleOrangeRim.position.set(-5, 3, -3);
  titleOrangeRim.target.position.set(0, 0.5, 0);
  titleScene.add(titleOrangeRim);
  titleScene.add(titleOrangeRim.target);

  // Overhead fill (starts off)
  titleOverhead = new THREE.PointLight(0xaabbcc, 0, 15, 1.5);
  titleOverhead.position.set(0, 6, 0);
  titleScene.add(titleOverhead);

  // Underglow (cyan pulsing light under car)
  titleUnderglow = new THREE.PointLight(0x00e5ff, 0, 6, 2);
  titleUnderglow.position.set(0, 0.1, 0);
  titleScene.add(titleUnderglow);

  // ── Wet-look reflective floor ──
  const groundGeo = new THREE.PlaneGeometry(40, 40);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x060610,
    roughness: 0.08,
    metalness: 0.92,
    transparent: true,
    opacity: 0.9,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  titleScene.add(ground);

  // ── Neon floor strip (thin glowing line racing toward car) ──
  const stripGeo = new THREE.BoxGeometry(0.04, 0.005, 12);
  const stripMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: 0x00e5ff,
    emissiveIntensity: 3.0,
    transparent: true,
    opacity: 0,
  });
  titleNeonStrip = new THREE.Mesh(stripGeo, stripMat);
  titleNeonStrip.position.set(0, 0.003, 3);
  titleScene.add(titleNeonStrip);

  // ── Volumetric fog plane ──
  const fogGeo = new THREE.PlaneGeometry(30, 30);
  const fogMat = new THREE.MeshStandardMaterial({
    color: 0x112233,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  titleFogPlane = new THREE.Mesh(fogGeo, fogMat);
  titleFogPlane.rotation.x = -Math.PI / 2;
  titleFogPlane.position.y = 0.15;
  titleScene.add(titleFogPlane);

  // ── Load Lamborghini ──
  const titleCar = CAR_ROSTER.find(c => c.file === 'Lamborghini.glb') ?? CAR_ROSTER[CAR_ROSTER.length - 1];
  loadCarModel(titleCar.file).then((model: THREE.Group) => {
    if (!titleScene) return;
    model.position.y = -0.5; // start below, will float up
    // Start invisible for fade-in
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat && mat.isMeshStandardMaterial) {
          mat.transparent = true;
          mat.opacity = 0;
          mat.needsUpdate = true;
        }
      }
    });
    titleScene!.add(model);
    titleCarModel = model;
  }).catch((err) => {
    console.warn('[TitleScreen] Failed to load car:', err);
  });
}

function updateTitleScene() {
  if (!titleScene || !titleCamera) return;

  const now = performance.now() / 1000;
  const elapsed = now - titleStartTime;

  // ═══════════════════════════════════════════
  // PHASE 1: THE APPROACH (0–3s)
  // Low dramatic camera, car fades in
  // ═══════════════════════════════════════════
  if (elapsed < 3) {
    const p = clamp01(elapsed / 3);
    const ep = easeOutCubic(p);

    // Camera: start low and close, slowly dolly back and rise slightly
    titleCamera.position.set(
      Math.sin(ep * 0.3) * 0.5,
      lerp(0.4, 0.8, ep),
      lerp(5, 5.5, ep)
    );
    titleCamera.lookAt(0, lerp(0.8, 0.7, ep), 0);

    // Ambient slowly brightens
    if (titleAmbient) titleAmbient.intensity = lerp(0.15, 0.4, ep);

    // Car fade-in and float up
    if (titleCarModel) {
      const carP = clamp01((elapsed - 0.5) / 2.0); // starts at 0.5s
      const carEp = easeOutCubic(carP);
      titleCarModel.position.y = lerp(-0.3, 0.5, carEp);
      titleCarModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat && mat.transparent) {
            mat.opacity = clamp01(carEp);
          }
        }
      });
    }

    // Neon strip races in
    if (titleNeonStrip) {
      const stripP = clamp01(elapsed / 1.5);
      const stripMat = titleNeonStrip.material as THREE.MeshStandardMaterial;
      stripMat.opacity = lerp(0, 0.8, easeOutCubic(stripP));
      titleNeonStrip.position.z = lerp(8, 0, easeOutCubic(stripP));
    }
  }

  // ═══════════════════════════════════════════
  // PHASE 2: THE REVEAL (3–5s)
  // Camera sweeps up, lights kick on
  // ═══════════════════════════════════════════
  else if (elapsed < 5) {
    const p = clamp01((elapsed - 3) / 2);
    const ep = easeInOutQuad(p);

    // Camera sweeps from low-front to high-side
    const angle = lerp(0, Math.PI * 0.4, ep);
    const height = lerp(0.8, 2.2, ep);
    const radius = lerp(5.5, 7, ep);
    titleCamera.position.set(
      Math.sin(angle) * radius,
      height,
      Math.cos(angle) * radius
    );
    titleCamera.lookAt(0, 0.6, 0);

    // Sequential light activation
    // t=3.0: Cyan rim fades in
    const cyanP = clamp01((elapsed - 3.0) / 0.5);
    if (titleCyanRim) titleCyanRim.intensity = lerp(0, 400, easeOutCubic(cyanP));

    // t=3.5: Orange rim fades in
    const orangeP = clamp01((elapsed - 3.5) / 0.5);
    if (titleOrangeRim) titleOrangeRim.intensity = lerp(0, 350, easeOutCubic(orangeP));

    // t=3.8: Overhead + directional + ambient
    const fillP = clamp01((elapsed - 3.8) / 0.7);
    if (titleOverhead) titleOverhead.intensity = lerp(0, 40, easeOutCubic(fillP));
    if (titleKeyLight) titleKeyLight.intensity = lerp(0, 3.0, easeOutCubic(fillP));
    if (titleAmbient) titleAmbient.intensity = lerp(0.4, 2.0, easeOutCubic(fillP));

    // Underglow starts
    if (titleUnderglow) titleUnderglow.intensity = lerp(0, 15, easeOutCubic(cyanP));

    // Neon strip pulses
    if (titleNeonStrip) {
      const stripMat = titleNeonStrip.material as THREE.MeshStandardMaterial;
      stripMat.emissiveIntensity = 3.0 + Math.sin(elapsed * 4) * 1.5;
    }

    // Fog fades in
    if (titleFogPlane) {
      const fogMat = titleFogPlane.material as THREE.MeshStandardMaterial;
      fogMat.opacity = lerp(0, 0.06, easeOutCubic(p));
    }

    // Ensure car is fully opaque
    if (titleCarModel) {
      titleCarModel.position.y = 0.5;
      titleCarModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
          if (mat && mat.transparent && mat.opacity < 1) {
            mat.opacity = 1;
            mat.transparent = false;
            mat.needsUpdate = true;
          }
        }
      });
    }

    // Trigger menu reveal at end of phase 2
    if (p > 0.7 && !titleMenuRevealed) {
      titleMenuRevealed = true;
      revealTitleMenu();
    }
  }

  // ═══════════════════════════════════════════
  // PHASE 3: THE SHOWCASE (5s+, loops)
  // Smooth orbit with underglow pulse
  // ═══════════════════════════════════════════
  else {
    const orbitTime = elapsed - 5;
    const orbitAngle = Math.PI * 0.4 + orbitTime * 0.15; // slow orbit
    const radius = 7;
    const height = 2.0 + Math.sin(orbitTime * 0.3) * 0.25; // gentle bob

    titleCamera.position.set(
      Math.sin(orbitAngle) * radius,
      height,
      Math.cos(orbitAngle) * radius
    );
    titleCamera.lookAt(0, 0.6, 0);

    // Underglow breathing pulse
    if (titleUnderglow) {
      titleUnderglow.intensity = 12 + Math.sin(elapsed * 1.5) * 8;
    }

    // Neon strip gentle pulse
    if (titleNeonStrip) {
      const stripMat = titleNeonStrip.material as THREE.MeshStandardMaterial;
      stripMat.emissiveIntensity = 2.5 + Math.sin(elapsed * 2) * 1.0;
    }
  }

  renderer.render(titleScene, titleCamera);
}

function revealTitleMenu() {
  // Trigger CSS animations on the menu elements
  const content = document.querySelector('.title-content') as HTMLElement;
  if (content) {
    content.classList.add('title-content--revealed');
  }
}

function destroyTitleScene() {
  if (titleCarModel && titleScene) {
    titleScene.remove(titleCarModel);
    titleCarModel = null;
  }
  titleScene = null;
  titleCamera = null;
  titleCyanRim = null;
  titleOrangeRim = null;
  titleOverhead = null;
  titleKeyLight = null;
  titleUnderglow = null;
  titleNeonStrip = null;
  titleFogPlane = null;
  titleAmbient = null;
  titleMenuRevealed = false;
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
  for (let i = 0; i < 40; i++) {
    titleEmberParticles.push({
      x: Math.random() * titleEmberCanvas.width,
      y: Math.random() * titleEmberCanvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -(0.2 + Math.random() * 0.8), // upward drift
      size: 1 + Math.random() * 2.5,
      alpha: 0.08 + Math.random() * 0.2,
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

  // Start preloading audio immediately
  const audioReady = preloadTitleMusic();

  // ── Splash screen: gate on user tap + audio ready ──
  const splashEl = document.createElement('div');
  splashEl.className = 'title-screen title-splash';
  splashEl.id = 'title-splash';
  splashEl.innerHTML = `
    <div class="title-content">
      <div class="title-logo"><span class="title-race">IRL</span> <span class="title-irl">RACE</span></div>
      <div class="title-subtitle">INDOOR RACING LEAGUE</div>
      <div class="splash-tap" id="splash-tap">TAP TO START</div>
    </div>
  `;
  uiOverlay.appendChild(splashEl);

  // Create 3D title scene behind the splash
  createTitleScene();
  titleLoop();

  const launchTitle = async () => {
    // Wait for audio to finish downloading
    await audioReady;
    // Auto-fullscreen + landscape lock on first user gesture (mobile)
    if (window.matchMedia('(pointer: coarse)').matches && isFullscreenSupported() && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => lockLandscape()).catch(() => {});
    } else {
      lockLandscape();
    }
    // Start music immediately — we're inside a user gesture so autoplay is allowed
    playTitleMusic();
    // Reset the cinematic animation timeline so it replays from scratch
    titleStartTime = performance.now() / 1000;
    titleMenuRevealed = false;
    // Remove splash and show full title
    splashEl.remove();
    renderFullTitleScreen();
  };

  splashEl.addEventListener('click', () => launchTitle(), { once: true });
  splashEl.addEventListener('touchstart', () => launchTitle(), { once: true });
}

function renderFullTitleScreen() {
  const titleEl = document.createElement('div');
  titleEl.className = 'title-screen';
  titleEl.id = 'title-screen';
  titleEl.innerHTML = `
    <div class="title-speed-lines"></div>
    <div class="title-content">
      <div class="title-logo"><span class="title-race">IRL</span> <span class="title-irl">RACE</span></div>
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
      <div class="title-version">v0.9 — irlrace.com</div>
      <div class="title-teaser">🏠 Race your actual neighborhood — Coming Soon</div>
    </div>
  `;
  uiOverlay.appendChild(titleEl);

  // Create ember overlay
  createEmberOverlay();

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

