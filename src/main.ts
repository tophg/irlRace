/* ── Hood Racer — Main Entry Point & Game Orchestrator ── */

import * as THREE from 'three';
import './index.css';

import { GameState, CAR_ROSTER, CarDef, EventType } from './types';
import type { TrackData } from './types';
import { initScene, getRenderer, getScene, getCamera, getDirLight, applyEnvironment, getEnvironmentForSeed } from './scene';
import { loadCarModel } from './loaders';
import { generateTrack, buildCheckpointMarkers, getClosestSplinePoint } from './track';
import { Vehicle } from './vehicle';
import { VehicleCamera } from './vehicle-camera';
import { RaceEngine } from './race-engine';
import { createHUD, updateHUD, updateMinimap, updateDamageHUD, updateGapHUD, showHUD, destroyHUD, showLapOverlay } from './hud';
import { runCountdown } from './countdown';
import { initAudio, updateEngineAudio, playCheckpointSFX, playLapFanfare, playDriftSFX, playCollisionSFX, playPositionSFX, stopAudio } from './audio';
import { AIRacer, OpponentInfo } from './ai-racer';
import { initGarage, updateGarage, destroyGarage } from './garage';
import { NetPeer } from './net-peer';
import { showLobby, updatePlayerList, destroyLobby, showToast, appendChatMessage } from './mp-lobby';
import {
  initVFX, spawnTireSmoke, updateVFX,
  initSpeedLines, updateSpeedLines,
  initBoostFlame, updateBoostFlame,
  createNameTag, updateNameTag,
  destroyVFX, spawnCollisionSparks, spawnDamageSmoke,
  initSkidMarks, updateSkidMarks, destroySkidMarks,
  spawnFlameParticle, spawnExplosion,
} from './vfx';
import { initInput, showTouchControls, getInput } from './input';
import { loadSettings, getSettings, showSettings } from './settings';
import { ReplayRecorder, ReplayPlayer } from './replay';
import { resolveCarCollisions, CarCollider, CollisionEvent } from './bvh';
import { getWeatherForSeed, initWeather, updateWeather, applyWetRoad, destroyWeather, getWeatherGripMultiplier, getWeatherDriftMultiplier, getCurrentWeather } from './weather';

// ── DOM ──
const container = document.getElementById('game-container')!;
const uiOverlay = document.getElementById('ui-overlay')!;

// ── Scene ──
const { renderer, scene, camera } = initScene(container);

// ── Game State ──
let gameState: GameState = GameState.TITLE;
let totalLaps = 3;
let selectedCar: CarDef = CAR_ROSTER[0];
let trackSeed: number | null = null;
let localPlayerName = localStorage.getItem('hr-player-name') || `Racer_${Math.floor(Math.random() * 9999)}`;

// ── Player vehicle ──
let playerVehicle: Vehicle | null = null;
let vehicleCamera: VehicleCamera | null = null;

// ── Track ──
let trackData: TrackData | null = null;
let checkpointMarkers: THREE.Group | null = null;

// ── AI ──
const aiRacers: AIRacer[] = [];

// ── Rear-View Mirror ──
let mirrorCamera: THREE.PerspectiveCamera | null = null;
let mirrorTarget: THREE.WebGLRenderTarget | null = null;
let mirrorCanvas: HTMLCanvasElement | null = null;
let mirrorCtx: CanvasRenderingContext2D | null = null;

// ── Race engine ──
let raceEngine: RaceEngine | null = null;

// ── Race Stats ──
interface RaceStats {
  topSpeed: number;
  totalDriftTime: number;
  collisionCount: number;
  avgPosition: number;
  positionSampleCount: number;
}
let raceStats: RaceStats = { topSpeed: 0, totalDriftTime: 0, collisionCount: 0, avgPosition: 0, positionSampleCount: 0 };

function resetRaceStats() {
  raceStats = { topSpeed: 0, totalDriftTime: 0, collisionCount: 0, avgPosition: 0, positionSampleCount: 0 };
}

// ── Multiplayer ──
let netPeer: NetPeer | null = null;
const remoteMeshes = new Map<string, THREE.Group>();
const remoteNameTags = new Map<string, THREE.Sprite>();

// ── Input ──
const input = initInput();

// ── Keyboard listener for spectator cycling + emotes ──
const EMOTE_MAP: Record<string, string> = { '1': '👍', '2': '😂', '3': '💨', '4': '🔥' };
window.addEventListener('keydown', (e) => {
  if (gameState === GameState.RESULTS && vehicleCamera?.mode === 'follow') {
    if (e.key === 'ArrowLeft') cycleSpectateTarget(-1);
    else if (e.key === 'ArrowRight') cycleSpectateTarget(1);
  }
  // Quick emotes during racing (1-4 keys)
  if (gameState === GameState.RACING && EMOTE_MAP[e.key]) {
    const emoji = EMOTE_MAP[e.key];
    netPeer?.broadcastEvent(EventType.EMOTE, { emoji });
    showEmoteBubble(emoji);
  }
});

// ── Timing ──
let lastTime = 0;
let raceStarting = false;

// ── Collision ──
const carHalf = new THREE.Vector3(1.0, 0.8, 2.2); // approximate car half-extents

// ── Reusable temps (avoid per-frame allocations) ──
const _rPos = new THREE.Vector3();
const _defaultTangent = new THREE.Vector3(0, 0, 1);
const _remoteRayOrigin = new THREE.Vector3();
const _remoteRayDir = new THREE.Vector3(0, -1, 0);
const _remoteRaycaster = new THREE.Raycaster();
const _impactDir = new THREE.Vector3();
const _sparkPos = new THREE.Vector3();
let driftSfxCooldown = 0;
const remotePrevPos = new Map<string, { x: number; z: number }>();
let replayRecorder: ReplayRecorder | null = null;
let replayPlayer: ReplayPlayer | null = null;
let spectateTargetId: string | null = null;

let posCalloutTimer: number | null = null;
function showPositionCallout(gained: boolean, newRank: number) {
  if (posCalloutTimer) clearTimeout(posCalloutTimer);
  let el = document.getElementById('pos-callout');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pos-callout';
    uiOverlay.appendChild(el);
  }
  const suffix = newRank === 1 ? 'st' : newRank === 2 ? 'nd' : newRank === 3 ? 'rd' : 'th';
  const arrow = gained ? '▲' : '▼';
  el.className = `pos-callout ${gained ? 'pos-up' : 'pos-down'}`;
  el.innerHTML = `<span class="pos-arrow">${arrow}</span> ${newRank}<sup>${suffix}</sup>`;
  el.style.display = 'block';
  posCalloutTimer = window.setTimeout(() => {
    el!.style.display = 'none';
    posCalloutTimer = null;
  }, 1500);
}
const sessionWins = new Map<string, number>();
let spectateHudEl: HTMLElement | null = null;
let prevMyRank = 0;

function showEmoteBubble(emoji: string, screenX?: number) {
  const el = document.createElement('div');
  el.className = 'emote-bubble';
  el.textContent = emoji;
  el.style.left = `${screenX ?? window.innerWidth / 2}px`;
  el.style.top = `${window.innerHeight * 0.3}px`;
  uiOverlay.appendChild(el);
  setTimeout(() => el.remove(), 2100);
}

function spawnConfetti() {
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:100;pointer-events:none;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const particles: { x: number; y: number; vx: number; vy: number; color: string; size: number; rot: number; rv: number; }[] = [];
  const colors = ['#ff6600', '#00e5ff', '#ffcc00', '#ff1744', '#76ff03', '#e040fb', '#ffffff'];
  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height * 0.3,
      vx: (Math.random() - 0.5) * 6,
      vy: Math.random() * 4 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 4,
      rot: Math.random() * Math.PI * 2,
      rv: (Math.random() - 0.5) * 0.2,
    });
  }

  let frame = 0;
  const animate = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.06; // gravity
      p.rot += p.rv;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.4);
      ctx.restore();
    }
    frame++;
    if (frame < 180) requestAnimationFrame(animate);
    else canvas.remove();
  };
  requestAnimationFrame(animate);
}

// Detached car parts (tumbling debris)
interface DetachedPart { mesh: THREE.Mesh; vx: number; vy: number; vz: number; ax: number; ay: number; az: number; life: number; }
const detachedParts: DetachedPart[] = [];
const _flamePos = new THREE.Vector3();

// ── Debug Overlay ──
let debugVisible = false;
let debugEl: HTMLElement | null = null;

let pauseOverlay: HTMLElement | null = null;
let aiCount = 4;
let aiDifficulty: 'easy' | 'medium' | 'hard' = 'medium';

window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') {
    debugVisible = !debugVisible;
    if (debugEl) debugEl.style.display = debugVisible ? 'block' : 'none';
  }
  if (e.code === 'Escape') {
    if (gameState === GameState.RACING) togglePause();
    else if (gameState === GameState.PAUSED) togglePause();
  }
});

function updateDebugOverlay() {
  if (!debugVisible || !playerVehicle) return;

  if (!debugEl) {
    debugEl = document.createElement('pre');
    debugEl.id = 'debug-overlay';
    debugEl.style.cssText = `
      position:fixed; top:70px; left:24px; z-index:999;
      background:rgba(0,0,0,0.75); color:#0f0; font:12px/1.5 monospace;
      padding:10px 14px; border-radius:6px; pointer-events:none;
      min-width:260px; white-space:pre;
    `;
    document.body.appendChild(debugEl);
  }

  const t = playerVehicle.telemetry;
  const d = playerVehicle.damage;
  const deg = (r: number) => (r * 180 / Math.PI).toFixed(1);
  const f1 = (v: number) => v.toFixed(1);
  const f2 = (v: number) => v.toFixed(2);
  const pct = (v: number) => Math.round(v) + '%';

  debugEl.textContent =
`== PHYSICS TELEMETRY ==
Speed:      ${f1(playerVehicle.speed)} u/s  (${Math.floor(Math.abs(playerVehicle.speed) * 2.5)} MPH)
Steer:      ${f2(playerVehicle.steer)}
AngVel:     ${f2(playerVehicle.driftAngle)} rad/s
SlipAngle:  ${deg(t.slipAngle)}°

-- AXLE SLIP --
Front α:    ${deg(t.alphaFront)}°
Rear  α:    ${deg(t.alphaRear)}°

-- LATERAL FORCES --
Front Lat:  ${f1(t.frontLatF)}
Rear  Lat:  ${f1(t.rearLatF)}
Yaw Torque: ${f1(t.yawTorque)}
Long Force: ${f1(t.longForce)}

-- WEIGHT DIST --
Front Grip: ${f2(t.frontGrip)}
Rear  Grip: ${f2(t.rearGrip)}
Kin Blend:  ${pct(t.kinBlend * 100)}

-- DAMAGE --
Front HP:   ${pct(d.front.hp)}
Rear  HP:   ${pct(d.rear.hp)}
Left  HP:   ${pct(d.left.hp)}
Right HP:   ${pct(d.right.hp)}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAUSE MENU
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function togglePause() {
  if (gameState === GameState.RACING) {
    gameState = GameState.PAUSED;
    pauseOverlay = document.createElement('div');
    pauseOverlay.className = 'pause-overlay';
    pauseOverlay.innerHTML = `
      <div class="pause-title">PAUSED</div>
      <div class="menu-buttons" style="width:240px;">
        <button class="menu-btn" id="btn-resume">RESUME</button>
        <button class="menu-btn" id="btn-restart">RESTART</button>
        <button class="menu-btn" id="btn-quit">MAIN MENU</button>
      </div>
    `;
    uiOverlay.appendChild(pauseOverlay);

    document.getElementById('btn-resume')!.addEventListener('click', togglePause);
    document.getElementById('btn-restart')!.addEventListener('click', () => {
      destroyPause();
      trackSeed = currentRaceSeed;
      clearRaceObjects();
      destroyLeaderboard();
      startRace();
    });
    document.getElementById('btn-quit')!.addEventListener('click', () => {
      destroyPause();
      netPeer?.destroy();
      netPeer = null;
      clearRaceObjects();
      destroyLeaderboard();
      showTitleScreen();
    });
  } else if (gameState === GameState.PAUSED) {
    destroyPause();
    gameState = GameState.RACING;
  }
}

function destroyPause() {
  if (pauseOverlay) { pauseOverlay.remove(); pauseOverlay = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOADING SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let loadingEl: HTMLElement | null = null;

function showLoading() {
  loadingEl = document.createElement('div');
  loadingEl.className = 'loading-overlay';
  loadingEl.innerHTML = '<div class="loading-text">GENERATING TRACK...</div>';
  uiOverlay.appendChild(loadingEl);
}

function hideLoading() {
  if (loadingEl) { loadingEl.remove(); loadingEl = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RACE CONFIGURATION (singleplayer only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function showRaceConfig(onStart: (laps: number, ai: number, difficulty: 'easy' | 'medium' | 'hard', seed: string) => void) {
  const el = document.createElement('div');
  el.className = 'race-config-overlay';
  el.innerHTML = `
    <div class="settings-panel" style="max-width:360px;">
      <div class="settings-title">RACE SETUP</div>
      <label class="settings-row">
        <span>Laps</span>
        <select id="cfg-laps">
          <option value="1">1</option>
          <option value="3" selected>3</option>
          <option value="5">5</option>
          <option value="10">10</option>
        </select>
      </label>
      <label class="settings-row">
        <span>AI Opponents</span>
        <select id="cfg-ai">
          <option value="0">None</option>
          <option value="2">2</option>
          <option value="4" selected>4</option>
        </select>
      </label>
      <label class="settings-row">
        <span>AI Difficulty</span>
        <select id="cfg-difficulty">
          <option value="easy">Easy</option>
          <option value="medium" selected>Medium</option>
          <option value="hard">Hard</option>
        </select>
      </label>
      <label class="settings-row">
        <span>Track Seed</span>
        <input type="text" id="cfg-seed" placeholder="Random" maxlength="5"
               class="lobby-input" style="width:100px;font-size:14px;padding:4px 8px;letter-spacing:2px;">
      </label>
      <div style="display:flex;gap:12px;justify-content:center;margin-top:16px;">
        <button class="select-btn" id="cfg-go">START RACE</button>
        <button class="menu-btn" id="cfg-back" style="padding:10px 24px;">BACK</button>
      </div>
    </div>
  `;
  uiOverlay.appendChild(el);

  document.getElementById('cfg-back')!.addEventListener('click', () => {
    el.remove();
    showTitleScreen();
  });

  document.getElementById('cfg-go')!.addEventListener('click', () => {
    const laps = parseInt((el.querySelector('#cfg-laps') as HTMLSelectElement).value);
    const ai = parseInt((el.querySelector('#cfg-ai') as HTMLSelectElement).value);
    const difficulty = (el.querySelector('#cfg-difficulty') as HTMLSelectElement).value as 'easy' | 'medium' | 'hard';
    const seed = (el.querySelector('#cfg-seed') as HTMLInputElement).value.trim();
    el.remove();
    onStart(laps, ai, difficulty, seed);
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONTROLS REFERENCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function showControlsRef() {
  if (uiOverlay.querySelector('.controls-overlay')) return;
  const el = document.createElement('div');
  el.className = 'controls-overlay';
  el.innerHTML = `
    <div class="settings-panel" style="max-width:400px;">
      <div class="settings-title">CONTROLS</div>
      <div class="controls-section">
        <div class="controls-heading">KEYBOARD</div>
        <div class="controls-row"><span>Steer</span><span>WASD / Arrow Keys</span></div>
        <div class="controls-row"><span>Boost</span><span>Shift / Space</span></div>
        <div class="controls-row"><span>Pause</span><span>Escape</span></div>
        <div class="controls-row"><span>Debug</span><span>Backtick (\`)</span></div>
      </div>
      <div class="controls-section">
        <div class="controls-heading">MOBILE</div>
        <div class="controls-row"><span>Steer</span><span>Drag left side of screen</span></div>
        <div class="controls-row"><span>Gas / Brake / Boost</span><span>Right side buttons</span></div>
        <div class="controls-row"><span>Tilt steering</span><span>Enable in Settings</span></div>
      </div>
      <button class="select-btn" id="ctrl-close" style="margin-top:16px;">CLOSE</button>
    </div>
  `;
  uiOverlay.appendChild(el);
  document.getElementById('ctrl-close')!.addEventListener('click', () => el.remove());
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TITLE SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function showTitleScreen() {
  gameState = GameState.TITLE;
  showTouchControls(false);

  const titleEl = document.createElement('div');
  titleEl.className = 'title-screen';
  titleEl.id = 'title-screen';
  titleEl.innerHTML = `
    <div class="title-logo">HOOD RACER</div>
    <div class="title-subtitle">Street Legends Never Stop</div>
    <div class="menu-buttons">
      <button class="menu-btn" id="btn-singleplayer">SINGLEPLAYER</button>
      <button class="menu-btn" id="btn-multiplayer">MULTIPLAYER</button>
      <button class="menu-btn" id="btn-controls" style="border-color:var(--col-text-dim);font-size:16px;">CONTROLS</button>
      <button class="menu-btn" id="btn-settings" style="border-color:var(--col-text-dim);font-size:16px;">SETTINGS</button>
    </div>
  `;
  uiOverlay.appendChild(titleEl);

  document.getElementById('btn-singleplayer')!.addEventListener('click', () => {
    titleEl.remove();
    enterGarage('singleplayer');
  });

  document.getElementById('btn-multiplayer')!.addEventListener('click', () => {
    titleEl.remove();
    enterGarage('multiplayer');
  });

  document.getElementById('btn-controls')!.addEventListener('click', showControlsRef);

  document.getElementById('btn-settings')!.addEventListener('click', () => {
    showSettings(uiOverlay, () => {
      localPlayerName = getSettings().playerName || localPlayerName;
      applySettingsToRenderer();
    });
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GARAGE (car selection)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function enterGarage(mode: 'singleplayer' | 'multiplayer') {
  gameState = GameState.GARAGE;

  initGarage(renderer, uiOverlay, (car: CarDef) => {
    selectedCar = car;
    destroyGarage();

    if (mode === 'singleplayer') {
      showRaceConfig((laps, ai, difficulty, seed) => {
        totalLaps = laps;
        aiCount = ai;
        aiDifficulty = difficulty;
        if (seed.length > 0) {
          const parsed = parseInt(seed, 10);
          trackSeed = Number.isNaN(parsed) ? Math.floor(Math.random() * 99999) : parsed;
        }
        startRace();
      });
    } else {
      enterMultiplayerLobby();
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MULTIPLAYER LOBBY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function enterMultiplayerLobby() {
  gameState = GameState.LOBBY;

  // Show initial choose screen (no room code yet)
  showLobby(uiOverlay, {
    isHost: false,
    roomCode: '',
    onNameChange: (name: string) => { localPlayerName = name; },
    onHost: async () => {
      netPeer = new NetPeer();

      // Wire callbacks BEFORE creating room (eager wiring pattern)
      wireNetworkCallbacks();

      const code = await netPeer.createRoom();
      // playerName comes from module-level localPlayerName

      destroyLobby();
      showLobby(uiOverlay, {
        isHost: true,
        roomCode: code,
        onHost: () => {},
        onJoin: () => {},
        onChat: (text) => {
          netPeer?.broadcastEvent(EventType.CHAT, { text, name: localPlayerName });
          appendChatMessage(localPlayerName, text);
        },
        onLapsChange: (laps) => { totalLaps = laps; },
        onSeedChange: (seed) => {
          if (seed.length > 0) {
            const parsed = parseInt(seed, 10);
            trackSeed = Number.isNaN(parsed) ? null : parsed;
          } else {
            trackSeed = null;
          }
        },
        onKick: (id) => {
          netPeer?.kickPlayer(id);
        },
        onStart: () => {
          destroyLobby();
          raceReadyCount = 0;
          trackSeed = Math.floor(Math.random() * 99999);
          const players = [{ id: netPeer!.getLocalId(), name: localPlayerName, carId: selectedCar.id }];
          for (const rp of netPeer!.getRemotePlayers()) players.push({ id: rp.id, name: rp.name, carId: rp.carId });
          mpPlayersList = players;
          netPeer!.broadcastEvent(EventType.COUNTDOWN_START, { laps: totalLaps, seed: trackSeed, players });
          startRace();
        },
        onBack: () => { netPeer?.destroy(); netPeer = null; destroyLobby(); showTitleScreen(); },
      });

      // Send initial player list to connected guests
      broadcastPlayerList();
    },

    onJoin: async (code: string) => {
      netPeer = new NetPeer();
      wireNetworkCallbacks();

      try {
        showToast(uiOverlay, 'Connecting...');
        await netPeer.joinRoom(code, localPlayerName, selectedCar.id);

        destroyLobby();
        showLobby(uiOverlay, {
          isHost: false,
          roomCode: code,
          onHost: () => {},
          onJoin: () => {},
          onStart: () => {},
          onChat: (text) => {
            netPeer?.broadcastEvent(EventType.CHAT, { text, name: localPlayerName });
            appendChatMessage(localPlayerName, text);
          },
          onReady: () => {
            netPeer?.broadcastEvent(EventType.PLAYER_READY, { ready: true });
          },
          onBack: () => { netPeer?.destroy(); netPeer = null; destroyLobby(); showTitleScreen(); },
        });

        showToast(uiOverlay, 'Connected to room');
      } catch (err) {
        showToast(uiOverlay, `Could not connect: ${(err as Error).message}`);
        destroyLobby();
        enterMultiplayerLobby();
      }
    },

    onStart: () => {},
    onBack: () => { destroyLobby(); showTitleScreen(); },
  });
}

function broadcastPlayerList() {
  if (!netPeer?.getIsHost()) return;
  const players = netPeer.getRemotePlayers().map(p => ({
    id: p.id, name: p.name, ready: p.ready,
  }));
  netPeer.broadcastEvent(EventType.PLAYER_LIST, { players });
}

function wireNetworkCallbacks() {
  if (!netPeer) return;

  netPeer.onState = (fromId, snap) => {
    netPeer!.addToBuffer(fromId, snap);
  };

  netPeer.onEvent = (fromId, type, data) => {
    switch (type) {
      case EventType.COUNTDOWN_START:
        destroyLobby();
        totalLaps = data.laps ?? 3;
        trackSeed = data.seed ?? Math.floor(Math.random() * 99999);
        // Store full player list for spawning (includes guests we don't have direct connections to)
        mpPlayersList = data.players ?? [];
        if (data.players) {
          for (const p of data.players) {
            const rp = netPeer!.getRemotePlayers().find(r => r.id === p.id);
            if (rp) rp.carId = p.carId;
          }
        }
        startRace();
        break;

      case EventType.CHECKPOINT_HIT:
        raceEngine?.updateRemoteProgress(fromId, data.lap, data.cp);
        break;

      case EventType.LAP_COMPLETE:
        raceEngine?.updateRemoteProgress(fromId, data.lap, 0);
        break;

      case EventType.REMATCH_REQUEST:
        raceReadyCount = 0;
        trackSeed = data.seed ?? Math.floor(Math.random() * 99999);
        totalLaps = data.laps ?? totalLaps;
        if (data.players) mpPlayersList = data.players;
        destroyLeaderboard();
        uiOverlay.querySelector('.results-overlay')?.remove();
        startRace();
        break;

      case EventType.RACE_FINISH:
        if (raceEngine) {
          const racer = raceEngine.getProgress(fromId);
          if (racer && !racer.finished) {
            racer.finished = true;
            racer.finishTime = data.finishTime ?? 0;
            racer.lapIndex = totalLaps;
            racer.checkpointIndex = 0;
          }
        }
        break;

      case EventType.PLAYER_READY:
        netPeer!.setPlayerReady(fromId, data.ready ?? true);
        updatePlayerList(netPeer!.getRemotePlayers().map(p => ({
          id: p.id, name: p.name, ready: p.ready,
        })));
        broadcastPlayerList();
        break;

      case EventType.PLAYER_LIST:
        if (data.players) {
          updatePlayerList(data.players);
        }
        break;

      case EventType.RACE_READY:
        if (!netPeer?.getIsHost()) break;
        raceReadyCount++;
        if (raceReadyCount >= (netPeer?.getConnectionCount() ?? 0) && raceGoResolve) {
          raceGoResolve();
        }
        break;

      case EventType.RACE_GO:
        if (raceGoResolve) raceGoResolve();
        break;

      case EventType.CAR_SELECT: {
        const rp = netPeer!.getRemotePlayers().find(r => r.id === fromId);
        if (rp && data.carId) {
          rp.carId = data.carId;
        }
        break;
      }

      case EventType.REMATCH_ACCEPT:
        if (netPeer!.getIsHost() && gameState === GameState.RESULTS) {
          uiOverlay.querySelector('.results-overlay')?.remove();
          if (postWinnerTimer) { clearTimeout(postWinnerTimer); postWinnerTimer = null; }
          raceReadyCount = 0;
          trackSeed = Math.floor(Math.random() * 99999);
          const rematchPlayers = [{ id: netPeer!.getLocalId(), name: localPlayerName, carId: selectedCar.id }];
          for (const rp of netPeer!.getRemotePlayers()) rematchPlayers.push({ id: rp.id, name: rp.name, carId: rp.carId });
          mpPlayersList = rematchPlayers;
          netPeer!.broadcastEvent(EventType.REMATCH_REQUEST, { seed: trackSeed, laps: totalLaps, players: rematchPlayers });
          destroyLeaderboard();
          startRace();
        }
        break;

      case EventType.CHAT: {
        const senderName = data.name || resolvePlayerName(fromId);
        appendChatMessage(senderName, data.text ?? '');
        break;
      }

      case EventType.KICK: {
        // Guest was kicked by host — return to title
        showToast(uiOverlay, 'You were kicked from the lobby');
        netPeer?.destroy();
        netPeer = null;
        destroyLobby();
        clearRaceObjects();
        destroyLeaderboard();
        destroySpectateHUD();
        showTitleScreen();
        break;
      }

      case EventType.EMOTE: {
        const emoji = data.emoji ?? '👍';
        showEmoteBubble(emoji, Math.random() * window.innerWidth * 0.6 + window.innerWidth * 0.2);
        break;
      }
    }
  };

  netPeer.onPlayerJoin = (id, name) => {
    showToast(uiOverlay, `${name} joined`);
    updatePlayerList(netPeer!.getRemotePlayers().map(p => ({ id: p.id, name: p.name, ready: p.ready })));
    broadcastPlayerList();
  };

  netPeer.onPlayerLeave = (id, disconnectedName) => {
    const name = disconnectedName || 'Player';

    // Mark as DNF if race is in progress
    if (gameState === GameState.RACING || gameState === GameState.COUNTDOWN) {
      raceEngine?.markDnf(id);
      showToast(uiOverlay, `${name} disconnected (DNF)`);

      // Auto-finish if all opponents are DNF (only in multiplayer with no AI)
      if (raceEngine && netPeer && aiRacers.length === 0) {
        const rankings = raceEngine.getRankings();
        const allOpponentsDnf = rankings
          .filter(r => r.id !== 'local')
          .every(r => r.dnf);
        if (allOpponentsDnf && gameState === GameState.RACING) {
          destroyLeaderboard();
          showResults();
        }
      }
    } else {
      showToast(uiOverlay, `${name} disconnected`);
    }

    // Clean up remote mesh and tracking data
    const mesh = remoteMeshes.get(id);
    if (mesh) { scene.remove(mesh); remoteMeshes.delete(id); }
    remotePrevPos.delete(id);

    const tag = remoteNameTags.get(id);
    if (tag) { scene.remove(tag); remoteNameTags.delete(id); };
  };

  netPeer.onReconnecting = (id, name) => {
    showToast(uiOverlay, `${name} reconnecting...`);
  };

  netPeer.onReconnected = (id, name) => {
    showToast(uiOverlay, `${name} reconnected`);
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RACE SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let currentRaceSeed = 0;
let raceReadyCount = 0;
let mpPlayersList: { id: string; name: string; carId: string }[] = [];
let raceGoResolve: (() => void) | null = null;

async function startRace() {
  if (raceStarting) return;
  raceStarting = true;

  try {
    gameState = GameState.COUNTDOWN;
    showLoading();

    clearRaceObjects();

    // Generate track (preserve seed for restart)
    const seed = trackSeed ?? Math.floor(Math.random() * 99999);
    currentRaceSeed = seed;
    trackSeed = null;
    trackData = generateTrack(seed);
    applyEnvironment(getEnvironmentForSeed(seed));
    initWeather(scene, getWeatherForSeed(seed));
    if (getCurrentWeather() !== 'clear') applyWetRoad(trackData.roadMesh);
    scene.add(trackData.roadMesh);
    scene.add(trackData.barrierLeft);
    scene.add(trackData.barrierRight);
    scene.add(trackData.shoulderMesh);
    scene.add(trackData.kerbGroup);
    scene.add(trackData.sceneryGroup);

    checkpointMarkers = buildCheckpointMarkers(trackData.checkpoints);
    scene.add(checkpointMarkers);

    raceEngine = new RaceEngine(trackData.checkpoints, totalLaps);

    const playerModel = await loadCarModel(selectedCar.file);
    playerVehicle = new Vehicle(selectedCar);
    playerVehicle.setModel(playerModel);
    scene.add(playerVehicle.group);
    playerVehicle.placeOnTrack(trackData.spline, 0, -3.5);
    playerVehicle.setRoadMesh(trackData.roadMesh);
    raceEngine.addRacer('local');

    vehicleCamera = new VehicleCamera(camera);

    initVFX(scene);
    initBoostFlame(scene);
    initSpeedLines(container);
    initSkidMarks(scene);

    if (!netPeer) await spawnAI(trackData);

    if (netPeer) {
      await spawnRemoteVehicles();

      netPeer.startBroadcasting(() => ({
        x: playerVehicle!.group.position.x,
        z: playerVehicle!.group.position.z,
        heading: playerVehicle!.heading,
        speed: playerVehicle!.speed,
        dmgFront: playerVehicle!.damage.front.hp,
        dmgRear: playerVehicle!.damage.rear.hp,
        dmgLeft: playerVehicle!.damage.left.hp,
        dmgRight: playerVehicle!.damage.right.hp,
      }));

      netPeer.startPinging();
      netPeer.startHeartbeat();
    }

    createHUD(uiOverlay);
    showHUD(true);

    // Rear-view mirror
    mirrorCamera = new THREE.PerspectiveCamera(50, 320 / 120, 0.5, 500);
    mirrorTarget = new THREE.WebGLRenderTarget(320, 120, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    mirrorCanvas = document.createElement('canvas');
    mirrorCanvas.width = 320;
    mirrorCanvas.height = 120;
    mirrorCanvas.className = 'hud-mirror';
    mirrorCanvas.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      border: 2px solid rgba(255,255,255,0.2); border-radius: 6px;
      pointer-events: none; z-index: 20; opacity: 0.85;
    `;
    uiOverlay.appendChild(mirrorCanvas);
    mirrorCtx = mirrorCanvas.getContext('2d')!;
    showTouchControls(true);
    initAudio();
    hideLoading();

    // ── Synchronized start (multiplayer ready barrier) ──
    if (netPeer) {
      if (netPeer.getIsHost()) {
        const guestCount = netPeer.getConnectionCount();
        if (guestCount > 0 && raceReadyCount < guestCount) {
          await Promise.race([
            new Promise<void>(resolve => {
              raceGoResolve = resolve;
              if (raceReadyCount >= guestCount) resolve();
            }),
            new Promise<void>(resolve => setTimeout(resolve, 10000)),
          ]);
          raceGoResolve = null;
        }
        netPeer.broadcastEvent(EventType.RACE_GO, {});
      } else {
        netPeer.broadcastEvent(EventType.RACE_READY, {});
        await Promise.race([
          new Promise<void>(resolve => { raceGoResolve = resolve; }),
          new Promise<void>(resolve => setTimeout(resolve, 10000)),
        ]);
        raceGoResolve = null;
      }
    }

    await runCountdown(uiOverlay);

    resetRaceStats();
    raceEngine.start();
    replayRecorder = new ReplayRecorder();
    replayRecorder.start();
    gameState = GameState.RACING;
  } finally {
    raceStarting = false;
  }
}

async function spawnAI(trackData: TrackData) {
  // Defensive: clear any leftover AI from previous race
  for (const ai of aiRacers) {
    scene.remove(ai.vehicle.group);
  }
  aiRacers.length = 0;

  const available = CAR_ROSTER.filter(c => c.id !== selectedCar.id);
  const count = Math.min(aiCount, available.length);
  const aiCars = available.slice(0, count);
  const laneOffsets = [3.5, -3.5, 3.5, -3.5, 3.5, -3.5];
  const startTs = [0.02, 0.02, 0.04, 0.04, 0.06, 0.06];

  console.log(`[spawnAI] aiCount=${aiCount}, spawning ${aiCars.length} AI racers`);

  for (let i = 0; i < aiCars.length; i++) {
    const def = aiCars[i];
    const ai = new AIRacer(`ai_${i}`, { ...def }, i);
    ai.applyDifficulty(aiDifficulty);
    raceEngine!.addRacer(`ai_${i}`);

    try {
      const model = await loadCarModel(def.file);
      ai.vehicle.setModel(model);
    } catch {}

    ai.place(trackData!.spline, startTs[i] ?? 0.02, laneOffsets[i] ?? 0, trackData!.bvh);
    ai.setSpeedProfile(trackData!.speedProfile);
    ai.vehicle.setRoadMesh(trackData!.roadMesh);
    scene.add(ai.vehicle.group);
    aiRacers.push(ai);
  }
}

async function spawnRemoteVehicles() {
  if (!netPeer || !trackData) return;

  // Use the full players list from COUNTDOWN_START (includes guests we have no direct connection to)
  // Filter out our own local ID
  const localId = netPeer.getLocalId();
  const allPlayers = mpPlayersList.length > 0
    ? mpPlayersList.filter(p => p.id !== localId)
    : netPeer.getRemotePlayers().map(r => ({ id: r.id, name: r.name, carId: r.carId }));

  const laneOffsets = [3.5, -3.5, 3.5, -3.5, 3.5, -3.5];

  for (let ri = 0; ri < allPlayers.length; ri++) {
    const player = allPlayers[ri];
    if (remoteMeshes.has(player.id)) continue;

    const def = CAR_ROSTER.find(c => c.id === player.carId) ?? CAR_ROSTER[0];
    try {
      const model = await loadCarModel(def.file);
      const startT = 0.02 + ri * 0.02;
      const pt = trackData.spline.getPointAt(startT);
      const tangent = trackData.spline.getTangentAt(startT).normalize();
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const lane = laneOffsets[ri % laneOffsets.length];
      model.position.copy(pt);
      model.position.x += right.x * lane;
      model.position.z += right.z * lane;
      model.position.y += 0.05;
      model.rotation.y = Math.atan2(tangent.x, tangent.z);
      scene.add(model);
      remoteMeshes.set(player.id, model);

      const tag = createNameTag(player.name || 'Racer', scene);
      remoteNameTags.set(player.id, tag);
    } catch {}

    raceEngine!.addRacer(player.id);
  }
}

function disposeMaterial(mat: THREE.Material) {
  const std = mat as THREE.MeshStandardMaterial;
  if (std.map) std.map.dispose();
  if (std.normalMap) std.normalMap.dispose();
  if (std.aoMap) std.aoMap.dispose();
  if (std.emissiveMap) std.emissiveMap.dispose();
  mat.dispose();
}

function disposeMesh(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => disposeMaterial(m));
      else if (mat) disposeMaterial(mat as THREE.Material);
      // Dispose InstancedMesh GPU buffers (instanceMatrix, instanceColor)
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
        (mesh as THREE.InstancedMesh).dispose();
      }
    }
  });
}

function clearRaceObjects() {
  // Stop network broadcasting before nulling vehicles
  netPeer?.stopBroadcasting();
  netPeer?.stopPinging();
  netPeer?.clearBuffers();

  // Stop replay recorder
  replayRecorder?.stop();
  replayRecorder = null;

  // Remove and dispose old track
  if (trackData) {
    destroyWeather();
    scene.remove(trackData.roadMesh);
    scene.remove(trackData.barrierLeft);
    scene.remove(trackData.barrierRight);
    scene.remove(trackData.shoulderMesh);
    scene.remove(trackData.kerbGroup);
    scene.remove(trackData.sceneryGroup);
    disposeMesh(trackData.roadMesh);
    disposeMesh(trackData.barrierLeft);
    disposeMesh(trackData.barrierRight);
    disposeMesh(trackData.shoulderMesh);
    disposeMesh(trackData.kerbGroup);
    disposeMesh(trackData.sceneryGroup);
    trackData = null;
  }
  if (checkpointMarkers) {
    scene.remove(checkpointMarkers);
    disposeMesh(checkpointMarkers);
    checkpointMarkers = null;
  }

  // Destroy mirror
  if (mirrorCanvas) { mirrorCanvas.remove(); mirrorCanvas = null; mirrorCtx = null; }
  if (mirrorTarget) { mirrorTarget.dispose(); mirrorTarget = null; }
  mirrorCamera = null;

  // Remove player
  if (playerVehicle) {
    scene.remove(playerVehicle.group);
    disposeMesh(playerVehicle.group);
    playerVehicle = null;
  }

  // Remove AI
  for (const ai of aiRacers) {
    scene.remove(ai.vehicle.group);
    disposeMesh(ai.vehicle.group);
  }
  aiRacers.length = 0;

  // Remove remote meshes
  for (const mesh of remoteMeshes.values()) {
    scene.remove(mesh);
    disposeMesh(mesh);
  }
  remoteMeshes.clear();
  for (const tag of remoteNameTags.values()) {
    scene.remove(tag);
    if ((tag as THREE.Sprite).material) {
      const spMat = (tag as THREE.Sprite).material as THREE.SpriteMaterial;
      spMat.map?.dispose();
      spMat.dispose();
    }
  }
  remoteNameTags.clear();

  remotePrevPos.clear();

  // Clean up detached parts
  for (const dp of detachedParts) {
    scene.remove(dp.mesh);
    dp.mesh.geometry?.dispose();
    (dp.mesh.material as THREE.Material)?.dispose();
  }
  detachedParts.length = 0;

  // Clean up VFX (smoke, speed lines, boost flame, skid marks)
  destroyVFX();
  destroySkidMarks();

  // Stop audio
  stopAudio();

  destroyHUD();
  destroyLeaderboard();

  // Clean up debug overlay
  if (debugEl) { debugEl.remove(); debugEl = null; }

  // Reset cooldowns
  driftSfxCooldown = 0;
  lbLastUpdate = 0;
  spectateTargetId = null;
  prevMyRank = 0;
  destroySpectateHUD();
}

function enterSpectatorMode() {
  if (!vehicleCamera || !raceEngine) return;

  // Find the closest unfinished racer to follow
  const rankings = raceEngine.getRankings();
  const unfinished = rankings.filter(r => !r.finished && !r.dnf && r.id !== 'local');

  if (unfinished.length > 0) {
    spectateTargetId = unfinished[0].id;
    vehicleCamera.startFollow();
    showSpectateHUD();
  } else {
    // No one left to follow — orbit the track center
    spectateTargetId = null;
    if (playerVehicle) {
      vehicleCamera.startOrbit(playerVehicle.group.position);
    }
  }
}

function cycleSpectateTarget(direction: 1 | -1) {
  if (!raceEngine || !vehicleCamera) return;
  const rankings = raceEngine.getRankings();
  const targets = rankings.filter(r => !r.finished && !r.dnf && r.id !== 'local');
  if (targets.length === 0) {
    // Everyone finished — switch to orbit
    spectateTargetId = null;
    vehicleCamera.startOrbit(playerVehicle!.group.position);
    destroySpectateHUD();
    return;
  }

  const curIdx = targets.findIndex(r => r.id === spectateTargetId);
  let nextIdx = curIdx + direction;
  if (nextIdx < 0) nextIdx = targets.length - 1;
  if (nextIdx >= targets.length) nextIdx = 0;
  spectateTargetId = targets[nextIdx].id;
  vehicleCamera.startFollow();
  updateSpectateHUD();
}

function showSpectateHUD() {
  destroySpectateHUD();
  spectateHudEl = document.createElement('div');
  spectateHudEl.className = 'spectate-hud';
  uiOverlay.appendChild(spectateHudEl);

  spectateHudEl.querySelector('.arrow-left')?.addEventListener('click', () => cycleSpectateTarget(-1));
  spectateHudEl.querySelector('.arrow-right')?.addEventListener('click', () => cycleSpectateTarget(1));

  updateSpectateHUD();
}

function updateSpectateHUD() {
  if (!spectateHudEl || !spectateTargetId) return;
  const name = resolvePlayerName(spectateTargetId);
  spectateHudEl.innerHTML = `
    <span class="spectate-label">SPECTATING</span>
    <span class="arrow arrow-left" id="spec-left">◀</span>
    <span class="spectate-name">${name}</span>
    <span class="arrow arrow-right" id="spec-right">▶</span>
  `;
  // Re-wire click events after innerHTML update
  spectateHudEl.querySelector('#spec-left')?.addEventListener('click', () => cycleSpectateTarget(-1));
  spectateHudEl.querySelector('#spec-right')?.addEventListener('click', () => cycleSpectateTarget(1));
}

function destroySpectateHUD() {
  if (spectateHudEl) { spectateHudEl.remove(); spectateHudEl = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESULTS SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function resolvePlayerName(id: string): string {
  if (id === 'local') return 'You';
  if (id.startsWith('ai_')) return `AI ${id.replace('ai_', '')}`;
  const netName = netPeer?.getRemotePlayers().find(rp => rp.id === id)?.name;
  if (netName && netName !== 'Racer') return netName;
  const mpName = mpPlayersList.find(p => p.id === id)?.name;
  return mpName || netName || id.slice(0, 8);
}

let postWinnerTimer: number | null = null;

function showResults() {
  gameState = GameState.RESULTS;

  // Record session wins
  const preRankings = raceEngine?.getRankings() ?? [];
  if (preRankings.length > 0 && !preRankings[0].dnf && preRankings[0].finished) {
    const winnerId = preRankings[0].id;
    sessionWins.set(winnerId, (sessionWins.get(winnerId) || 0) + 1);
  }
  netPeer?.stopBroadcasting();
  netPeer?.stopPinging();
  showTouchControls(false);
  replayRecorder?.stop();

  if (postWinnerTimer) clearTimeout(postWinnerTimer);
  postWinnerTimer = window.setTimeout(() => {
    if (raceEngine) {
      for (const r of raceEngine.getRankings()) {
        if (!r.finished) raceEngine.markDnf(r.id);
      }
    }
    postWinnerTimer = null;
  }, 15000);

  const rankings = raceEngine?.getRankings() ?? [];
  const winner = rankings[0];
  const winnerName = winner ? resolvePlayerName(winner.id) : '???';
  const isMultiplayer = !!netPeer;
  const isHost = netPeer?.getIsHost() ?? false;
  const hasReplay = replayRecorder?.hasData() ?? false;

  const el = document.createElement('div');
  el.className = 'results-overlay';
  // Build per-lap breakdown for the local player
  const localProgress = raceEngine?.getProgress('local');
  const localBestLap = raceEngine?.getBestLap('local');
  const lapBreakdownHtml = localProgress && localProgress.lapTimes.length > 0
    ? `<div class="lap-breakdown">
        <div class="lap-breakdown-title">YOUR LAPS</div>
        ${localProgress.lapTimes.map((t, i) => {
          const isBest = localBestLap != null && t <= localBestLap;
          return `<div class="lap-breakdown-row${isBest ? ' best' : ''}">
            <span>Lap ${i + 1}</span>
            <span>${RaceEngine.formatTime(t)}${isBest ? ' ★' : ''}</span>
          </div>`;
        }).join('')}
       </div>` : '';

  el.innerHTML = `
    <div class="results-title">${winner?.dnf ? 'RACE COMPLETE' : `${winnerName.toUpperCase()} WINS!`}</div>
    <table class="results-table">
      <thead><tr>
        <th>POS</th>
        <th>RACER</th>
        <th>TIME</th>
        <th>BEST LAP</th>
      </tr></thead>
      <tbody>
        ${rankings.map((r, i) => {
          const name = resolvePlayerName(r.id);
          const isSelf = r.id === 'local';
          const isDnf = r.dnf;
          const bestLap = r.lapTimes.length > 0 ? Math.min(...r.lapTimes) : null;
          const delayMs = (i + 1) * 150;
          const wins = sessionWins.get(r.id) || 0;
          const winsHtml = wins > 0 ? ` <span class="session-wins">${wins}W</span>` : '';
          const crownHtml = sessionWins.size > 0 && wins === Math.max(...sessionWins.values()) && wins > 0 ? ' 👑' : '';
          return `
            <tr class="${isSelf ? 'local' : ''} ${isDnf ? 'dnf' : ''} ${i === 0 && !isDnf ? 'winner' : ''}" style="animation-delay:${delayMs}ms;">
              <td>${isDnf ? '—' : i + 1}</td>
              <td>${name}${crownHtml}${winsHtml}${isDnf ? ' <span style="color:#ff4444;font-size:11px;">DNF</span>' : ''}</td>
              <td>${isDnf ? '—' : r.finished ? RaceEngine.formatTime(r.finishTime) : 'Racing...'}</td>
              <td>${bestLap !== null ? RaceEngine.formatTime(bestLap) : '—'}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    ${lapBreakdownHtml}
    <div class="lap-breakdown" style="margin-top:8px;">
      <div class="lap-breakdown-title">RACE STATS</div>
      <div class="lap-breakdown-row"><span>Top Speed</span><span>${Math.floor(raceStats.topSpeed)} MPH</span></div>
      <div class="lap-breakdown-row"><span>Drift Time</span><span>${raceStats.totalDriftTime.toFixed(1)}s</span></div>
      <div class="lap-breakdown-row"><span>Avg Position</span><span>${raceStats.positionSampleCount > 0 ? (raceStats.avgPosition / raceStats.positionSampleCount).toFixed(1) : '—'}</span></div>
      <div class="lap-breakdown-row"><span>Collisions</span><span>${raceStats.collisionCount}</span></div>
    </div>
    <div class="menu-buttons" style="width:240px; margin-top:8px;">
      ${hasReplay ? '<button class="menu-btn" id="btn-replay" style="border-color:var(--col-cyan);color:var(--col-cyan);">WATCH REPLAY</button>' : ''}
      ${isMultiplayer ? '<button class="menu-btn" id="btn-rematch" style="background:var(--col-green);">REMATCH</button>' : ''}
      ${!isMultiplayer ? '<button class="menu-btn" id="btn-play-again">PLAY AGAIN</button>' : ''}
      <button class="menu-btn" id="btn-main-menu">MAIN MENU</button>
    </div>
  `;
  uiOverlay.appendChild(el);

  document.getElementById('btn-replay')?.addEventListener('click', () => {
    el.remove();
    destroyLeaderboard();
    startReplayPlayback();
  });
  document.getElementById('btn-play-again')?.addEventListener('click', () => {
    el.remove();
    if (postWinnerTimer) { clearTimeout(postWinnerTimer); postWinnerTimer = null; }
    startRace();
  });
  document.getElementById('btn-rematch')?.addEventListener('click', () => {
    el.remove();
    if (postWinnerTimer) { clearTimeout(postWinnerTimer); postWinnerTimer = null; }
    if (isHost) {
      raceReadyCount = 0;
      trackSeed = Math.floor(Math.random() * 99999);
      const rematchPlayers = [{ id: netPeer!.getLocalId(), name: localPlayerName, carId: selectedCar.id }];
      for (const rp of netPeer!.getRemotePlayers()) rematchPlayers.push({ id: rp.id, name: rp.name, carId: rp.carId });
      mpPlayersList = rematchPlayers;
      netPeer!.broadcastEvent(EventType.REMATCH_REQUEST, { seed: trackSeed, laps: totalLaps, players: rematchPlayers });
      destroyLeaderboard();
      startRace();
    } else {
      netPeer!.broadcastEvent(EventType.REMATCH_ACCEPT, {});
      showToast(uiOverlay, 'Rematch requested...');
    }
  });
  document.getElementById('btn-main-menu')!.addEventListener('click', () => {
    el.remove();
    if (postWinnerTimer) { clearTimeout(postWinnerTimer); postWinnerTimer = null; }
    netPeer?.destroy();
    netPeer = null;
    clearRaceObjects();
    destroyLeaderboard();
    destroySpectateHUD();
    sessionWins.clear();
    showTitleScreen();
  });
}

function startReplayPlayback() {
  if (!replayRecorder || !trackData || !playerVehicle) return;

  // Build mesh map for replay (player + AI vehicles)
  const meshes = new Map<string, THREE.Group>();
  meshes.set('local', playerVehicle.group);
  for (const ai of aiRacers) meshes.set(ai.id, ai.vehicle.group);

  replayPlayer = new ReplayPlayer(replayRecorder, camera, meshes);
  replayPlayer.start();
  showHUD(false);

  // Show replay HUD with exit button
  const replayHud = document.createElement('div');
  replayHud.id = 'replay-hud';
  replayHud.style.cssText = `
    position:fixed; top:24px; left:50%; transform:translateX(-50%); z-index:100;
    display:flex; align-items:center; gap:16px;
  `;
  replayHud.innerHTML = `
    <div style="font-family:var(--font-display);font-size:18px;color:var(--col-cyan);letter-spacing:3px;">REPLAY</div>
    <div id="replay-progress" style="width:200px;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;">
      <div id="replay-bar" style="height:100%;background:var(--col-cyan);border-radius:2px;width:0%;transition:width 0.1s;"></div>
    </div>
    <button class="menu-btn" id="btn-exit-replay" style="padding:8px 16px;font-size:14px;">EXIT</button>
  `;
  uiOverlay.appendChild(replayHud);

  document.getElementById('btn-exit-replay')!.addEventListener('click', () => {
    stopReplayPlayback();
  });
}

function stopReplayPlayback() {
  if (replayPlayer) {
    replayPlayer.stop();
    replayPlayer = null;
  }
  const hud = document.getElementById('replay-hud');
  if (hud) hud.remove();
  showResults();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LEADERBOARD HUD (in-race)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let lbEl: HTMLElement | null = null;
let lbLastUpdate = 0;
const LB_UPDATE_INTERVAL = 250; // ms — 4Hz

function updateLeaderboard() {
  if (!raceEngine) return;
  const now = performance.now();
  if (now - lbLastUpdate < LB_UPDATE_INTERVAL) return;
  lbLastUpdate = now;

  if (!lbEl) {
    lbEl = document.createElement('div');
    lbEl.className = 'leaderboard';
    lbEl.id = 'leaderboard';
    uiOverlay.appendChild(lbEl);
  }

  const rankings = raceEngine.getRankings();
  lbEl.innerHTML = rankings.map((r, i) => {
    const name = r.id === 'local' ? 'YOU' : resolvePlayerName(r.id);
    const isSelf = r.id === 'local';
    let rttDot = '';
    if (netPeer && !isSelf && !r.id.startsWith('ai_')) {
      const peerRtt = netPeer.getPeerRtt(r.id);
      const dotClass = peerRtt < 80 ? 'ping-good' : peerRtt < 150 ? 'ping-mid' : 'ping-bad';
      rttDot = `<span class="ping-dot ${dotClass}" style="margin-left:4px;"></span>`;
    }
    return `
      <div class="lb-row${isSelf ? ' self' : ''}${r.dnf ? ' dnf' : ''}">
        <span class="lb-pos">${r.dnf ? '\u2014' : i + 1}</span>
        <span class="lb-name">${name}${rttDot}${r.dnf ? ' DNF' : ''}</span>
        <span class="lb-progress">${r.finished ? 'FIN' : `L${r.lapIndex + 1}`}</span>
      </div>
    `;
  }).join('');

  // Latency badge (multiplayer only)
  if (netPeer) {
    const rtt = netPeer.getRtt();
    const color = rtt < 80 ? '#4caf50' : rtt < 150 ? '#ffcc00' : '#ff4444';
    lbEl.innerHTML += `<div style="text-align:right;font-size:11px;color:${color};margin-top:4px;">${rtt}ms</div>`;
  }
}

function destroyLeaderboard() {
  if (lbEl) { lbEl.remove(); lbEl = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN GAME LOOP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function gameLoop(timestamp: number) {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  const s = gameState;

  // ── Garage render ──
  if (s === GameState.GARAGE) {
    updateGarage();
    return;
  }

  // ── Title / Lobby ──
  if (s === GameState.TITLE || s === GameState.LOBBY) {
    renderer.render(scene, camera);
    return;
  }

  // ── Replay playback ──
  if (replayPlayer) {
    if (replayPlayer.isPlaying()) {
      replayPlayer.update(dt);
      const bar = document.getElementById('replay-bar');
      if (bar) bar.style.width = `${Math.round(replayPlayer.getProgress() * 100)}%`;
      renderer.render(scene, camera);
      return;
    } else {
      // Replay ended — auto-cleanup
      stopReplayPlayback();
    }
  }

  // ── Paused: render but don't update physics ──
  if (s === GameState.PAUSED) {
    renderer.render(scene, camera);
    return;
  }

  // ── Countdown / Racing / Results ──
  if (s === GameState.COUNTDOWN || s === GameState.RACING || s === GameState.RESULTS) {
    if (!playerVehicle || !trackData) {
      renderer.render(scene, camera);
      return;
    }

    // Player update
    if (s === GameState.RACING && vehicleCamera?.mode === 'chase') {
      // Apply weather grip modifier
      const origGrip = playerVehicle.def.gripCoeff;
      const origDrift = playerVehicle.def.driftFactor;
      playerVehicle.def.gripCoeff *= getWeatherGripMultiplier();
      playerVehicle.def.driftFactor *= getWeatherDriftMultiplier();
      playerVehicle.update(dt, getInput(), trackData.spline, trackData.bvh);
      playerVehicle.def.gripCoeff = origGrip;
      playerVehicle.def.driftFactor = origDrift;
    }

    // Spectator orbit camera (during RESULTS)
    if (s === GameState.RESULTS && vehicleCamera?.mode === 'orbit') {
      vehicleCamera.updateOrbit(dt);
    }

    // Camera
    if (vehicleCamera && vehicleCamera.mode !== 'orbit') {
      // Chase or follow mode — get the target
      let camTarget = playerVehicle.group.position;
      let camHeading = playerVehicle.heading;
      let camSpeed = playerVehicle.speed;
      let camMaxSpeed = selectedCar.maxSpeed;

      if (vehicleCamera.mode === 'follow' && spectateTargetId) {
        const targetMesh = remoteMeshes.get(spectateTargetId);
        const aiTarget = aiRacers.find(a => a.id === spectateTargetId);
        if (targetMesh) {
          camTarget = targetMesh.position;
          camHeading = targetMesh.rotation.y;
          const snap = netPeer?.getInterpolatedState(spectateTargetId);
          camSpeed = snap?.speed ?? 30;
          camMaxSpeed = 70;
        } else if (aiTarget) {
          camTarget = aiTarget.vehicle.group.position;
          camHeading = aiTarget.vehicle.heading;
          camSpeed = aiTarget.vehicle.speed;
          camMaxSpeed = aiTarget.vehicle.def.maxSpeed;
        }
      }

      vehicleCamera.update(camTarget, camHeading, camSpeed, camMaxSpeed);
    }

    // AI update
    if (s === GameState.RACING) {
      // Build opponent list for AI awareness (player + all other AIs)
      const playerT = getClosestSplinePoint(trackData.spline, playerVehicle.group.position, trackData.bvh).t;
      const allOpponents: OpponentInfo[] = [
        { position: playerVehicle.group.position, t: playerT, id: 'local' },
      ];
      for (const ai of aiRacers) {
        allOpponents.push({ position: ai.vehicle.group.position, t: ai.getCurrentT(), id: ai.id });
      }

      for (const ai of aiRacers) {
        // Pass all opponents except self
        const opponents = allOpponents.filter(o => o.id !== ai.id);
        ai.update(dt, opponents);
        raceEngine?.updateRacer(ai.id, ai.vehicle.group.position, ai.getCurrentT());
      }

      // ── Car-to-car collision (BVH broadphase + push-apart) ──
      const colliders: CarCollider[] = [];
      const velocities: { velX: number; velZ: number }[] = [];

      // Player collider
      colliders.push({
        id: 'local',
        position: playerVehicle.group.position,
        halfExtents: carHalf,
        heading: playerVehicle.heading,
      });
      velocities.push(playerVehicle);

      // AI colliders
      for (const ai of aiRacers) {
        colliders.push({
          id: ai.id,
          position: ai.vehicle.group.position,
          halfExtents: carHalf,
          heading: ai.vehicle.heading,
        });
        velocities.push(ai.vehicle);
      }

      // Remote multiplayer vehicle colliders (push-apart only)
      for (const [id, mesh] of remoteMeshes) {
        colliders.push({
          id,
          position: mesh.position,
          halfExtents: carHalf,
          heading: mesh.rotation.y,
        });
        velocities.push({ velX: 0, velZ: 0 });
      }

      const collisionEvents = resolveCarCollisions(colliders, velocities);

      for (const evt of collisionEvents) {
        if (evt.idA === 'local' && playerVehicle) {
          _impactDir.set(evt.normalX, 0, evt.normalZ);
          playerVehicle.applyDamage(_impactDir, evt.impactForce);
          raceStats.collisionCount++;
        }
        if (evt.idB === 'local' && playerVehicle) {
          _impactDir.set(-evt.normalX, 0, -evt.normalZ);
          playerVehicle.applyDamage(_impactDir, evt.impactForce);
          raceStats.collisionCount++;
        }
        for (const ai of aiRacers) {
          if (evt.idA === ai.id) {
            _impactDir.set(evt.normalX, 0, evt.normalZ);
            ai.vehicle.applyDamage(_impactDir, evt.impactForce);
          }
          if (evt.idB === ai.id) {
            _impactDir.set(-evt.normalX, 0, -evt.normalZ);
            ai.vehicle.applyDamage(_impactDir, evt.impactForce);
          }
        }

        if (evt.impactForce > 5) {
          const cA = colliders.find(c => c.id === evt.idA)!;
          const cB = colliders.find(c => c.id === evt.idB)!;
          _sparkPos.set(
            (cA.position.x + cB.position.x) / 2,
            (cA.position.y + cB.position.y) / 2 + 0.5,
            (cA.position.z + cB.position.z) / 2,
          );
          spawnCollisionSparks(_sparkPos, evt.impactForce);
          if (evt.impactForce > 25) spawnExplosion(_sparkPos, evt.impactForce);
          playCollisionSFX(Math.min(evt.impactForce / 30, 1));
        }
      }
    }

    // VFX
    const driftAbs = Math.abs(playerVehicle.driftAngle);
    if (driftAbs > 0.15 && s === GameState.RACING) {
      spawnTireSmoke(playerVehicle.group.position, driftAbs);
    }
    if (s === GameState.RACING) {
      updateSkidMarks(playerVehicle.group.position, playerVehicle.heading, driftAbs, playerVehicle.group.position.y);
    }
    updateVFX(dt);
    updateWeather(dt, playerVehicle.group.position);
    updateBoostFlame(s === GameState.RACING && getInput().boost, playerVehicle.group.position, playerVehicle.heading, timestamp / 1000);
    const speedRatioForLines = Math.abs(playerVehicle.speed) / selectedCar.maxSpeed;
    if (speedRatioForLines > 0.65) updateSpeedLines(speedRatioForLines);

    // ── Accumulate race stats ──
    if (s === GameState.RACING) {
      const speedMph = Math.abs(playerVehicle.speed) * 2.5;
      if (speedMph > raceStats.topSpeed) raceStats.topSpeed = speedMph;
      if (driftAbs > 0.15) raceStats.totalDriftTime += dt;
    }

    // Audio
    updateEngineAudio(playerVehicle.speed, selectedCar.maxSpeed);
    driftSfxCooldown -= dt;
    if (s === GameState.RACING && driftAbs > 0.3 && driftSfxCooldown <= 0) {
      playDriftSFX(driftAbs);
      driftSfxCooldown = 0.12;
    }

    // Damage smoke + flames (emit when zones are heavily damaged)
    if (s === GameState.RACING && playerVehicle) {
      const dmg = playerVehicle.damage;
      const worstHp = Math.min(dmg.front.hp, dmg.rear.hp, dmg.left.hp, dmg.right.hp);
      if (worstHp < 50) spawnDamageSmoke(playerVehicle.group.position, 1 - worstHp / 50, dt);

      // Per-zone flames for critically damaged areas
      const sinH = Math.sin(playerVehicle.heading);
      const cosH = Math.cos(playerVehicle.heading);
      const pp = playerVehicle.group.position;
      const zoneOffsets: [string, number, number, number][] = [
        ['front', 0, 1.0, -2.0],
        ['rear', 0, 0.8, 1.8],
        ['left', -1.0, 0.7, 0],
        ['right', 1.0, 0.7, 0],
      ];
      for (const [zone, lx, ly, lz] of zoneOffsets) {
        const hp = dmg[zone as keyof typeof dmg].hp;
        if (hp < 20) {
          _flamePos.set(
            pp.x + cosH * lx + sinH * lz,
            pp.y + ly,
            pp.z - sinH * lx + cosH * lz,
          );
          spawnFlameParticle(_flamePos, 1 - hp / 20, dt);
        }
      }

      // Check for newly detached parts
      for (const zone of ['front', 'rear', 'left', 'right'] as const) {
        if (playerVehicle.detachedZones.has(zone) && !detachedParts.some(dp => (dp as any).zone === zone && (dp as any).owner === 'local')) {
          const partMesh = playerVehicle.createDetachedPart(zone);
          if (partMesh) {
            scene.add(partMesh);
            detachedParts.push({
              mesh: partMesh,
              vx: playerVehicle.velX + (Math.random() - 0.5) * 8,
              vy: 3 + Math.random() * 5,
              vz: playerVehicle.velZ + (Math.random() - 0.5) * 8,
              ax: (Math.random() - 0.5) * 10,
              ay: (Math.random() - 0.5) * 10,
              az: (Math.random() - 0.5) * 10,
              life: 4.0,
            });
            // Spawn explosion at detach point
            spawnExplosion(partMesh.position, 30);
          }
        }
      }
    }

    // Update detached parts physics
    for (let i = detachedParts.length - 1; i >= 0; i--) {
      const dp = detachedParts[i];
      dp.life -= dt;
      if (dp.life <= 0 || dp.mesh.position.y < -10) {
        scene.remove(dp.mesh);
        dp.mesh.geometry?.dispose();
        (dp.mesh.material as THREE.Material)?.dispose();
        detachedParts[i] = detachedParts[detachedParts.length - 1];
        detachedParts.pop();
        continue;
      }
      dp.mesh.position.x += dp.vx * dt;
      dp.mesh.position.y += dp.vy * dt;
      dp.mesh.position.z += dp.vz * dt;
      dp.vy -= 15 * dt; // gravity
      dp.mesh.rotation.x += dp.ax * dt;
      dp.mesh.rotation.y += dp.ay * dt;
      dp.mesh.rotation.z += dp.az * dt;
    }

    // Checkpoint detection (local player)
    if (s === GameState.RACING && raceEngine) {
      const localT = getClosestSplinePoint(trackData.spline, playerVehicle.group.position, trackData.bvh).t;
      const event = raceEngine.updateRacer('local', playerVehicle.group.position, localT);
      const progress = raceEngine.getProgress('local');

      if (event === 'checkpoint') {
        playCheckpointSFX();
        netPeer?.broadcastEvent(EventType.CHECKPOINT_HIT, {
          lap: progress?.lapIndex ?? 0,
          cp: progress?.checkpointIndex ?? 0,
        });
      } else if (event === 'lap') {
        playLapFanfare();
        netPeer?.broadcastEvent(EventType.LAP_COMPLETE, { lap: progress?.lapIndex ?? 0 });
        // Show lap completion overlay
        if (progress) {
          const lastLapTime = progress.lapTimes[progress.lapTimes.length - 1] ?? 0;
          const bestLap = raceEngine.getBestLap('local');
          const isBest = bestLap !== null && lastLapTime <= bestLap;
          showLapOverlay(uiOverlay, progress.lapIndex, lastLapTime, isBest);
        }
      } else if (event === 'finish') {
        const finishTime = raceEngine.getProgress('local')?.finishTime ?? 0;
        netPeer?.broadcastEvent(EventType.RACE_FINISH, { finishTime });
        destroyLeaderboard();
        spawnConfetti();
        enterSpectatorMode();
        showResults();
      }

      // HUD update
      const rankings = raceEngine.getRankings();
      const myRank = rankings.findIndex(r => r.id === 'local') + 1;

      // Track average position
      if (myRank > 0) {
        raceStats.avgPosition += myRank;
        raceStats.positionSampleCount++;
      }


      // Position change callout
      if (prevMyRank > 0 && myRank !== prevMyRank && myRank > 0) {
        const gained = myRank < prevMyRank;
        showPositionCallout(gained, myRank);
        playPositionSFX(gained);
      }
      prevMyRank = myRank;
      const wrongWay = raceEngine.isWrongWay(
        playerVehicle.heading,
        trackData.checkpoints[progress?.checkpointIndex ?? 0]?.tangent ?? _defaultTangent,
      );

      updateHUD(
        playerVehicle.speed,
        progress?.lapIndex ?? 0,
        totalLaps,
        myRank,
        rankings.length,
        wrongWay,
        raceEngine.getElapsedTime() * 1000,
        getInput().boost,
      );

      // Minimap (per-player colors)
      const PEER_COLORS = ['#ff6600', '#e040fb', '#ffcc00', '#76ff03', '#ff1744', '#00bcd4'];
      const minimapDots: { pos: THREE.Vector3; color?: string }[] = [];
      aiRacers.forEach(ai => minimapDots.push({ pos: ai.vehicle.group.position, color: '#ff6600' }));
      let peerIdx = 0;
      for (const mesh of remoteMeshes.values()) {
        minimapDots.push({ pos: mesh.position, color: PEER_COLORS[peerIdx % PEER_COLORS.length] });
        peerIdx++;
      }
      updateMinimap(trackData.spline, playerVehicle.group.position, minimapDots);

      // Leaderboard
      updateLeaderboard();

      // Gap timer HUD
      if (raceEngine) {
        const gaps = raceEngine.getGaps('local');
        updateGapHUD(gaps.ahead, gaps.behind);
      }

      // Record replay frames
      if (replayRecorder) {
        replayRecorder.record('local', playerVehicle.group.position, playerVehicle.heading, playerVehicle.speed);
        for (const ai of aiRacers) {
          replayRecorder.record(ai.id, ai.vehicle.group.position, ai.vehicle.heading, ai.vehicle.speed);
        }
      }

      // Damage HUD
      if (playerVehicle) updateDamageHUD(playerVehicle.damage);
    }

    // Remote vehicle positions
    if (netPeer) {
      for (const [id, mesh] of remoteMeshes) {
        const snap = netPeer.getInterpolatedState(id);
        if (snap) {
          // Raycast against road mesh for accurate surface height
          _remoteRayOrigin.set(snap.x, mesh.position.y + 15, snap.z);
          _remoteRaycaster.set(_remoteRayOrigin, _remoteRayDir);
          _remoteRaycaster.far = 30;
          const remoteHits = _remoteRaycaster.intersectObject(trackData!.roadMesh, false);
          if (remoteHits.length > 0) {
            mesh.position.set(snap.x, remoteHits[0].point.y, snap.z);
          } else {
            _rPos.set(snap.x, 0, snap.z);
            const nearest = getClosestSplinePoint(trackData!.spline, _rPos, trackData!.bvh);
            mesh.position.set(snap.x, nearest.point.y, snap.z);
          }
          mesh.rotation.y = snap.heading;

          // Remote VFX: tire smoke from approximate drift
          if (s === GameState.RACING) {
            const prev = remotePrevPos.get(id);
            if (prev) {
              const dx = snap.x - prev.x;
              const dz = snap.z - prev.z;
              if (dx * dx + dz * dz > 0.01) {
                const moveHeading = Math.atan2(dx, dz);
                let driftApprox = Math.abs(snap.heading - moveHeading);
                if (driftApprox > Math.PI) driftApprox = Math.PI * 2 - driftApprox;
                if (driftApprox > 0.2) {
                  spawnTireSmoke(mesh.position, driftApprox * 0.5);
                }
              }
            }
            remotePrevPos.set(id, { x: snap.x, z: snap.z });

            // Remote damage smoke
            const worstHp = Math.min(
              snap.dmgFront ?? 100, snap.dmgRear ?? 100,
              snap.dmgLeft ?? 100, snap.dmgRight ?? 100,
            );
            if (worstHp < 50) {
              spawnDamageSmoke(mesh.position, 1 - worstHp / 50, dt);
            }
          }
        }

        const tag = remoteNameTags.get(id);
        if (tag) updateNameTag(tag, mesh.position);
      }
    }

    // Shadow camera follows player for sharper nearby shadows
    if (playerVehicle) {
      const dl = getDirLight();
      const pp = playerVehicle.group.position;
      dl.position.set(pp.x + 50, 80, pp.z + 30);
      dl.target.position.set(pp.x, pp.y, pp.z);
      dl.target.updateMatrixWorld();
      dl.shadow.camera.left = -40;
      dl.shadow.camera.right = 40;
      dl.shadow.camera.top = 40;
      dl.shadow.camera.bottom = -40;
      dl.shadow.camera.updateProjectionMatrix();
    }

    // Rear-view mirror render (low-res, every other frame for perf)
    if (mirrorCamera && mirrorTarget && mirrorCtx && mirrorCanvas && playerVehicle && s === GameState.RACING) {
      const sinH = Math.sin(playerVehicle.heading);
      const cosH = Math.cos(playerVehicle.heading);
      const pp = playerVehicle.group.position;
      mirrorCamera.position.set(pp.x + sinH * 1.5, pp.y + 2.5, pp.z + cosH * 1.5);
      mirrorCamera.lookAt(pp.x + sinH * 20, pp.y + 1.5, pp.z + cosH * 20);
      renderer.setRenderTarget(mirrorTarget);
      renderer.render(scene, mirrorCamera);
      renderer.setRenderTarget(null);

      // Copy to canvas
      const buf = new Uint8Array(320 * 120 * 4);
      renderer.readRenderTargetPixels(mirrorTarget, 0, 0, 320, 120, buf);
      const imgData = mirrorCtx.createImageData(320, 120);
      // WebGL is bottom-up, canvas is top-down — flip vertically
      for (let row = 0; row < 120; row++) {
        const srcOff = (119 - row) * 320 * 4;
        const dstOff = row * 320 * 4;
        imgData.data.set(buf.subarray(srcOff, srcOff + 320 * 4), dstOff);
      }
      mirrorCtx.putImageData(imgData, 0, 0);
    }

    // Debug overlay
    updateDebugOverlay();

    // Render
    renderer.render(scene, camera);
  }
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
if (savedSettings.playerName) localPlayerName = savedSettings.playerName;
applySettingsToRenderer();

lastTime = performance.now();
showTitleScreen();
requestAnimationFrame(gameLoop);
