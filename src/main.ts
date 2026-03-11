/* ── Hood Racer — Main Entry Point & Game Orchestrator ── */

import * as THREE from 'three';
import './index.css';

import { GameState, CAR_ROSTER, CarDef, EventType } from './types';
import type { TrackData } from './types';
import { initScene, getRenderer, getScene, getCamera, applyEnvironment, getEnvironmentForSeed } from './scene';
import { loadCarModel } from './loaders';
import { generateTrack, buildCheckpointMarkers, getClosestSplinePoint } from './track';
import { Vehicle } from './vehicle';
import { VehicleCamera } from './vehicle-camera';
import { RaceEngine } from './race-engine';
import { createHUD, updateHUD, updateMinimap, updateDamageHUD, showHUD, destroyHUD } from './hud';
import { runCountdown } from './countdown';
import { initAudio, updateEngineAudio, playCheckpointSFX, playLapFanfare, playDriftSFX, playCollisionSFX, stopAudio } from './audio';
import { AIRacer } from './ai-racer';
import { initGarage, updateGarage, destroyGarage } from './garage';
import { NetPeer } from './net-peer';
import { showLobby, updatePlayerList, destroyLobby, showToast } from './mp-lobby';
import {
  initVFX, spawnTireSmoke, updateVFX,
  initSpeedLines, updateSpeedLines,
  initBoostFlame, updateBoostFlame,
  createNameTag, updateNameTag,
  destroyVFX, spawnCollisionSparks, spawnDamageSmoke,
  initSkidMarks, updateSkidMarks, destroySkidMarks,
} from './vfx';
import { initInput, showTouchControls, getInput } from './input';
import { loadSettings, getSettings, showSettings } from './settings';
import { ReplayRecorder, ReplayPlayer } from './replay';
import { resolveCarCollisions, CarCollider, CollisionEvent } from './bvh';

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

// ── Race engine ──
let raceEngine: RaceEngine | null = null;

// ── Multiplayer ──
let netPeer: NetPeer | null = null;
const remoteMeshes = new Map<string, THREE.Group>();
const remoteNameTags = new Map<string, THREE.Sprite>();

// ── Input ──
const input = initInput();

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

// ── Debug Overlay ──
let debugVisible = false;
let debugEl: HTMLElement | null = null;

window.addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') {
    debugVisible = !debugVisible;
    if (debugEl) debugEl.style.display = debugVisible ? 'block' : 'none';
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
      startRace();
    } else {
      // Return to lobby flow after car selection
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
        onStart: () => {
          destroyLobby();
          trackSeed = Math.floor(Math.random() * 99999);
          const players = [{ id: netPeer!.getLocalId(), name: localPlayerName, carId: selectedCar.id }];
          for (const rp of netPeer!.getRemotePlayers()) players.push({ id: rp.id, name: rp.name, carId: rp.carId });
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
        // Store remote player car selections for spawning
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
        trackSeed = data.seed ?? Math.floor(Math.random() * 99999);
        totalLaps = data.laps ?? totalLaps;
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

    // Clean up remote mesh
    const mesh = remoteMeshes.get(id);
    if (mesh) { scene.remove(mesh); remoteMeshes.delete(id); }

    const tag = remoteNameTags.get(id);
    if (tag) { scene.remove(tag); remoteNameTags.delete(id); };
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RACE SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function startRace() {
  if (raceStarting) return;
  raceStarting = true;

  try {
    gameState = GameState.COUNTDOWN;

    // Clear previous race
    clearRaceObjects();

    // Generate track
    const seed = trackSeed ?? Math.floor(Math.random() * 99999);
    trackSeed = null; // consume the seed
    trackData = generateTrack(seed);
    applyEnvironment(getEnvironmentForSeed(seed));
    scene.add(trackData.roadMesh);
    scene.add(trackData.barrierLeft);
    scene.add(trackData.barrierRight);
    scene.add(trackData.sceneryGroup);

    // Checkpoint markers
    checkpointMarkers = buildCheckpointMarkers(trackData.checkpoints);
    scene.add(checkpointMarkers);

    // Race engine
    raceEngine = new RaceEngine(trackData.checkpoints, totalLaps);

    // Player vehicle
    const playerModel = await loadCarModel(selectedCar.file);
    playerVehicle = new Vehicle(selectedCar);
    playerVehicle.setModel(playerModel);
    scene.add(playerVehicle.group);
    playerVehicle.placeOnTrack(trackData.spline, 0, -3.5);
    playerVehicle.setRoadMesh(trackData.roadMesh);
    raceEngine.addRacer('local');

    // Camera
    vehicleCamera = new VehicleCamera(camera);

    // VFX
    initVFX(scene);
    initBoostFlame(scene);
    initSpeedLines(container);
    initSkidMarks(scene);

    // AI opponents
    // Only spawn AI in singleplayer — multiplayer has real opponents
    if (!netPeer) await spawnAI(trackData);

    // Multiplayer remote vehicles
    if (netPeer) {
      await spawnRemoteVehicles();

      // Start broadcasting player state
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

      // Start latency monitoring
      netPeer.startPinging();
    }

    // HUD
    createHUD(uiOverlay);
    showHUD(true);
    showTouchControls(true);

    // Audio
    initAudio();

    // Countdown
    // Sync countdown: guests shorten duration by estimated network delay
    const countdownDuration = netPeer ? Math.max(2000, 3400 - netPeer.getRtt() / 2) : 3400;
    await runCountdown(uiOverlay, countdownDuration);

    raceEngine.start();
    replayRecorder = new ReplayRecorder();
    replayRecorder.start();
    gameState = GameState.RACING;
  } finally {
    raceStarting = false;
  }
}

async function spawnAI(trackData: TrackData) {
  const aiCars = CAR_ROSTER.filter(c => c.id !== selectedCar.id).slice(0, 4);
  const laneOffsets = [3.5, -3.5, 3.5, -3.5];
  const startTs = [0.02, 0.02, 0.04, 0.04];

  for (let i = 0; i < aiCars.length; i++) {
    const def = aiCars[i];
    const ai = new AIRacer(`ai_${i}`, { ...def });
    raceEngine!.addRacer(`ai_${i}`);

    try {
      const model = await loadCarModel(def.file);
      ai.vehicle.setModel(model);
    } catch {}

    ai.place(trackData!.spline, startTs[i] ?? 0.02, laneOffsets[i] ?? 0, trackData!.bvh);
    ai.vehicle.setRoadMesh(trackData!.roadMesh);
    scene.add(ai.vehicle.group);
    aiRacers.push(ai);
  }
}

async function spawnRemoteVehicles() {
  if (!netPeer) return;

  for (const remote of netPeer.getRemotePlayers()) {
    const def = CAR_ROSTER.find(c => c.id === remote.carId) ?? CAR_ROSTER[0];
    try {
      const model = await loadCarModel(def.file);
      model.position.set(0, 0, 0);
      scene.add(model);
      remoteMeshes.set(remote.id, model);

      const tag = createNameTag(remote.name, scene);
      remoteNameTags.set(remote.id, tag);
    } catch {}

    raceEngine!.addRacer(remote.id);
  }
}

function disposeMesh(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else if (mat) mat.dispose();
    }
  });
}

function clearRaceObjects() {
  // Remove and dispose old track
  if (trackData) {
    scene.remove(trackData.roadMesh);
    scene.remove(trackData.barrierLeft);
    scene.remove(trackData.barrierRight);
    scene.remove(trackData.sceneryGroup);
    disposeMesh(trackData.roadMesh);
    disposeMesh(trackData.barrierLeft);
    disposeMesh(trackData.barrierRight);
    disposeMesh(trackData.sceneryGroup);
    trackData = null;
  }
  if (checkpointMarkers) {
    scene.remove(checkpointMarkers);
    disposeMesh(checkpointMarkers);
    checkpointMarkers = null;
  }

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

  // Clean up VFX (smoke, speed lines, boost flame, skid marks)
  destroyVFX();
  destroySkidMarks();

  // Stop audio
  stopAudio();

  destroyHUD();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESULTS SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function showResults() {
  gameState = GameState.RESULTS;
  netPeer?.stopBroadcasting();
  netPeer?.stopPinging();
  showTouchControls(false);
  replayRecorder?.stop();

  const rankings = raceEngine?.getRankings() ?? [];
  const winner = rankings[0];
  const winnerName = winner?.id === 'local' ? 'You' : winner?.id.startsWith('ai_') ? `AI ${winner.id.replace('ai_', '')}` : (netPeer?.getRemotePlayers().find(r => r.id === winner?.id)?.name || winner?.id || '???');
  const isMultiplayer = !!netPeer;
  const isHost = netPeer?.getIsHost() ?? false;
  const hasReplay = replayRecorder?.hasData() ?? false;

  const el = document.createElement('div');
  el.className = 'results-overlay';
  el.innerHTML = `
    <div class="results-title">${winner?.dnf ? '🏁 RACE COMPLETE' : `🏆 ${winnerName.toUpperCase()} WINS!`}</div>
    <table class="results-table">
      <thead><tr>
        <th>POS</th>
        <th>RACER</th>
        <th>TIME</th>
      </tr></thead>
      <tbody>
        ${rankings.map((r, i) => {
          const name = r.id === 'local' ? 'You' : r.id.startsWith('ai_') ? `AI ${r.id.replace('ai_', '')}` : (netPeer?.getRemotePlayers().find(rp => rp.id === r.id)?.name || r.id.slice(0, 8));
          const isSelf = r.id === 'local';
          const isDnf = r.dnf;
          return `
            <tr class="${isSelf ? 'local' : ''} ${isDnf ? 'dnf' : ''} ${i === 0 && !isDnf ? 'winner' : ''}">
              <td>${isDnf ? '—' : i + 1}</td>
              <td>${name}${isDnf ? ' <span style="color:#ff4444;font-size:11px;">DNF</span>' : ''}</td>
              <td>${isDnf ? '—' : r.finished ? RaceEngine.formatTime(r.finishTime) : 'Racing...'}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
    <div class="menu-buttons" style="width:240px; margin-top:8px;">
      ${hasReplay ? '<button class="menu-btn" id="btn-replay" style="border-color:var(--col-cyan);color:var(--col-cyan);">WATCH REPLAY</button>' : ''}
      ${isMultiplayer && isHost ? '<button class="menu-btn" id="btn-rematch" style="background:var(--col-green);">REMATCH</button>' : ''}
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
    startRace();
  });
  document.getElementById('btn-rematch')?.addEventListener('click', () => {
    el.remove();
    trackSeed = Math.floor(Math.random() * 99999);
    netPeer!.broadcastEvent(EventType.REMATCH_REQUEST, { seed: trackSeed, laps: totalLaps });
    destroyLeaderboard();
    startRace();
  });
  document.getElementById('btn-main-menu')!.addEventListener('click', () => {
    el.remove();
    netPeer?.destroy();
    netPeer = null;
    clearRaceObjects();
    destroyLeaderboard();
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

function updateLeaderboard() {
  if (!raceEngine) return;

  if (!lbEl) {
    lbEl = document.createElement('div');
    lbEl.className = 'leaderboard';
    lbEl.id = 'leaderboard';
    uiOverlay.appendChild(lbEl);
  }

  const rankings = raceEngine.getRankings();
  lbEl.innerHTML = rankings.map((r, i) => {
    const name = r.id === 'local' ? 'YOU' : r.id.startsWith('ai_') ? `AI ${r.id.replace('ai_', '')}` : (netPeer?.getRemotePlayers().find(rp => rp.id === r.id)?.name?.slice(0, 8) || r.id.slice(0, 8));
    const isSelf = r.id === 'local';
    return `
      <div class="lb-row${isSelf ? ' self' : ''}${r.dnf ? ' dnf' : ''}">
        <span class="lb-pos">${r.dnf ? '—' : i + 1}</span>
        <span class="lb-name">${name}${r.dnf ? ' DNF' : ''}</span>
        <span class="lb-progress">L${r.lapIndex + 1}</span>
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
  if (replayPlayer?.isPlaying()) {
    replayPlayer.update(dt);
    const bar = document.getElementById('replay-bar');
    if (bar) bar.style.width = `${Math.round(replayPlayer.getProgress() * 100)}%`;
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
    if (s === GameState.RACING) {
      playerVehicle.update(dt, getInput(), trackData.spline, trackData.bvh);
    }

    // Camera
    vehicleCamera?.update(
      playerVehicle.group.position,
      playerVehicle.heading,
      playerVehicle.speed,
      selectedCar.maxSpeed,
    );

    // AI update
    if (s === GameState.RACING) {
      const playerT = getClosestSplinePoint(trackData.spline, playerVehicle.group.position, trackData.bvh).t;
      for (const ai of aiRacers) {
        ai.setRubberBand(playerT);
        ai.update(dt);
        raceEngine?.updateRacer(ai.id, ai.vehicle.group.position);
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

      const collisionEvents = resolveCarCollisions(colliders, velocities);

      for (const evt of collisionEvents) {
        if (evt.idA === 'local' && playerVehicle) {
          _impactDir.set(evt.normalX, 0, evt.normalZ);
          playerVehicle.applyDamage(_impactDir, evt.impactForce);
        }
        if (evt.idB === 'local' && playerVehicle) {
          _impactDir.set(-evt.normalX, 0, -evt.normalZ);
          playerVehicle.applyDamage(_impactDir, evt.impactForce);
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
    updateBoostFlame(s === GameState.RACING && getInput().boost, playerVehicle.group.position, playerVehicle.heading, timestamp / 1000);
    updateSpeedLines(Math.abs(playerVehicle.speed) / selectedCar.maxSpeed);

    // Audio
    updateEngineAudio(playerVehicle.speed, selectedCar.maxSpeed);
    driftSfxCooldown -= dt;
    if (s === GameState.RACING && driftAbs > 0.3 && driftSfxCooldown <= 0) {
      playDriftSFX(driftAbs);
      driftSfxCooldown = 0.12;
    }

    // Damage smoke (emit when zones are heavily damaged)
    if (s === GameState.RACING && playerVehicle) {
      const dmg = playerVehicle.damage;
      const worstHp = Math.min(dmg.front.hp, dmg.rear.hp, dmg.left.hp, dmg.right.hp);
      if (worstHp < 50) spawnDamageSmoke(playerVehicle.group.position, 1 - worstHp / 50, dt);
    }

    // Checkpoint detection (local player)
    if (s === GameState.RACING && raceEngine) {
      const event = raceEngine.updateRacer('local', playerVehicle.group.position);
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
      } else if (event === 'finish') {
        const finishTime = raceEngine.getProgress('local')?.finishTime ?? 0;
        netPeer?.broadcastEvent(EventType.RACE_FINISH, { finishTime });
        destroyLeaderboard();
        showResults();
      }

      // HUD update
      const rankings = raceEngine.getRankings();
      const myRank = rankings.findIndex(r => r.id === 'local') + 1;
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
      );

      // Minimap
      const others = aiRacers.map(ai => ai.vehicle.group.position);
      for (const mesh of remoteMeshes.values()) others.push(mesh.position);
      updateMinimap(trackData.spline, playerVehicle.group.position, others);

      // Leaderboard
      updateLeaderboard();

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
