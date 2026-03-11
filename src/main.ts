/* ── Hood Racer — Main Entry Point & Game Orchestrator ── */

import * as THREE from 'three';
import './index.css';

import { GameState, CAR_ROSTER, CarDef, EventType } from './types';
import type { TrackData } from './types';
import { initScene, getRenderer, getScene, getCamera } from './scene';
import { loadCarModel } from './loaders';
import { generateTrack, buildCheckpointMarkers, getClosestSplinePoint } from './track';
import { Vehicle } from './vehicle';
import { VehicleCamera } from './vehicle-camera';
import { RaceEngine } from './race-engine';
import { createHUD, updateHUD, updateMinimap, showHUD, destroyHUD } from './hud';
import { runCountdown } from './countdown';
import { initAudio, updateEngineAudio, playCheckpointSFX, playLapFanfare } from './audio';
import { AIRacer } from './ai-racer';
import { initGarage, updateGarage, destroyGarage } from './garage';
import { NetPeer } from './net-peer';
import { showLobby, updatePlayerList, destroyLobby, showToast } from './mp-lobby';
import {
  initVFX, spawnTireSmoke, updateVFX,
  initSpeedLines, updateSpeedLines,
  initBoostFlame, updateBoostFlame,
  createNameTag, updateNameTag,
} from './vfx';
import { initInput, showTouchControls, getInput } from './input';

// ── DOM ──
const container = document.getElementById('game-container')!;
const uiOverlay = document.getElementById('ui-overlay')!;

// ── Scene ──
const { renderer, scene, camera } = initScene(container);

// ── Game State ──
let gameState: GameState = GameState.TITLE;
let totalLaps = 3;
let selectedCar: CarDef = CAR_ROSTER[0];

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

// ── Audio ──
const input = initInput();

// ── Timing ──
let lastTime = 0;

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
    </div>
  `;
  uiOverlay.appendChild(titleEl);

  document.getElementById('btn-singleplayer')!.addEventListener('click', () => {
    titleEl.remove();
    enterGarage('singleplayer');
  });

  document.getElementById('btn-multiplayer')!.addEventListener('click', () => {
    titleEl.remove();
    enterMultiplayerLobby();
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
    onHost: async () => {
      netPeer = new NetPeer();

      // Wire callbacks BEFORE creating room (eager wiring pattern)
      wireNetworkCallbacks();

      const code = await netPeer.createRoom();
      const playerName = localStorage.getItem('playerName') || `Racer_${Math.floor(Math.random() * 9999)}`;

      destroyLobby();
      showLobby(uiOverlay, {
        isHost: true,
        roomCode: code,
        onHost: () => {},
        onJoin: () => {},
        onStart: () => {
          destroyLobby();
          netPeer!.broadcastEvent(EventType.COUNTDOWN_START, { laps: totalLaps });
          startRace();
        },
        onBack: () => { netPeer?.destroy(); netPeer = null; destroyLobby(); showTitleScreen(); },
      });
    },

    onJoin: async (code: string) => {
      netPeer = new NetPeer();
      wireNetworkCallbacks();

      const playerName = localStorage.getItem('playerName') || `Racer_${Math.floor(Math.random() * 9999)}`;

      try {
        showToast(uiOverlay, 'Connecting...');
        await netPeer.joinRoom(code, playerName, selectedCar.id);

        destroyLobby();
        showLobby(uiOverlay, {
          isHost: false,
          roomCode: code,
          onHost: () => {},
          onJoin: () => {},
          onStart: () => {},
          onBack: () => { netPeer?.destroy(); netPeer = null; destroyLobby(); showTitleScreen(); },
        });

        showToast(uiOverlay, '✓ Connected to room');
      } catch (err) {
        showToast(uiOverlay, '✗ Could not connect');
      }
    },

    onStart: () => {},
    onBack: () => { destroyLobby(); showTitleScreen(); },
  });
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
        startRace();
        break;

      case EventType.CHECKPOINT_HIT:
        raceEngine?.updateRemoteProgress(fromId, data.lap, data.cp);
        break;

      case EventType.LAP_COMPLETE:
        raceEngine?.updateRemoteProgress(fromId, data.lap, 0);
        break;
    }
  };

  netPeer.onPlayerJoin = (id, name) => {
    showToast(uiOverlay, `${name} joined`);
    updatePlayerList(netPeer!.getRemotePlayers().map(p => ({ id: p.id, name: p.name })));
  };

  netPeer.onPlayerLeave = (id) => {
    showToast(uiOverlay, `Player disconnected`);

    // Clean up remote mesh
    const mesh = remoteMeshes.get(id);
    if (mesh) { scene.remove(mesh); remoteMeshes.delete(id); }

    const tag = remoteNameTags.get(id);
    if (tag) { scene.remove(tag); remoteNameTags.delete(id); }
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RACE SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function startRace() {
  gameState = GameState.COUNTDOWN;

  // Clear previous race
  clearRaceObjects();

  // Generate track
  trackData = generateTrack(Math.floor(Math.random() * 99999));
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
  raceEngine.addRacer('local');

  // Camera
  vehicleCamera = new VehicleCamera(camera);

  // VFX
  initVFX(scene);
  initBoostFlame(scene);
  initSpeedLines(container);

  // AI opponents
  spawnAI(trackData);

  // Multiplayer remote vehicles
  if (netPeer) {
    await spawnRemoteVehicles();

    // Start broadcasting player state
    netPeer.startBroadcasting(() => ({
      x: playerVehicle!.group.position.x,
      z: playerVehicle!.group.position.z,
      heading: playerVehicle!.heading,
      speed: playerVehicle!.speed,
    }));
  }

  // HUD
  createHUD(uiOverlay);
  showHUD(true);
  showTouchControls(true);

  // Audio
  initAudio();

  // Countdown
  await runCountdown(uiOverlay);

  raceEngine.start();
  gameState = GameState.RACING;
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

    ai.place(trackData!.spline, startTs[i] ?? 0.02, laneOffsets[i] ?? 0);
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

function clearRaceObjects() {
  // Remove old track
  if (trackData) {
    scene.remove(trackData.roadMesh);
    scene.remove(trackData.barrierLeft);
    scene.remove(trackData.barrierRight);
    scene.remove(trackData.sceneryGroup);
    trackData = null;
  }
  if (checkpointMarkers) { scene.remove(checkpointMarkers); checkpointMarkers = null; }

  // Remove player
  if (playerVehicle) { scene.remove(playerVehicle.group); playerVehicle = null; }

  // Remove AI
  for (const ai of aiRacers) scene.remove(ai.vehicle.group);
  aiRacers.length = 0;

  // Remove remote meshes
  for (const mesh of remoteMeshes.values()) scene.remove(mesh);
  remoteMeshes.clear();
  for (const tag of remoteNameTags.values()) scene.remove(tag);
  remoteNameTags.clear();

  destroyHUD();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESULTS SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function showResults() {
  gameState = GameState.RESULTS;
  netPeer?.stopBroadcasting();
  showTouchControls(false);

  const rankings = raceEngine?.getRankings() ?? [];

  const el = document.createElement('div');
  el.className = 'results-overlay';
  el.innerHTML = `
    <div class="results-title">🏁 RACE COMPLETE</div>
    <table class="results-table">
      <thead><tr>
        <th>POS</th>
        <th>RACER</th>
        <th>TIME</th>
      </tr></thead>
      <tbody>
        ${rankings.map((r, i) => `
          <tr class="${r.id === 'local' ? 'local' : ''}">
            <td>${i + 1}</td>
            <td>${r.id === 'local' ? 'You' : r.id.startsWith('ai_') ? `AI ${r.id.replace('ai_', '')}` : r.id}</td>
            <td>${r.finished ? RaceEngine.formatTime(r.finishTime) : 'DNF'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="menu-buttons" style="width:240px; margin-top:8px;">
      <button class="menu-btn" id="btn-play-again">PLAY AGAIN</button>
      <button class="menu-btn" id="btn-main-menu">MAIN MENU</button>
    </div>
  `;
  uiOverlay.appendChild(el);

  document.getElementById('btn-play-again')!.addEventListener('click', () => {
    el.remove();
    startRace();
  });
  document.getElementById('btn-main-menu')!.addEventListener('click', () => {
    el.remove();
    netPeer?.destroy();
    netPeer = null;
    clearRaceObjects();
    showTitleScreen();
  });
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
    const name = r.id === 'local' ? 'YOU' : r.id.startsWith('ai_') ? `AI ${i}` : r.id.slice(0, 8);
    const isSelf = r.id === 'local';
    return `
      <div class="lb-row${isSelf ? ' self' : ''}">
        <span class="lb-pos">${i + 1}</span>
        <span class="lb-name">${name}</span>
        <span class="lb-progress">L${r.lapIndex + 1}</span>
      </div>
    `;
  }).join('');
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

  // ── Countdown / Racing / Results ──
  if (s === GameState.COUNTDOWN || s === GameState.RACING || s === GameState.RESULTS) {
    if (!playerVehicle || !trackData) {
      renderer.render(scene, camera);
      return;
    }

    // Player update
    if (s === GameState.RACING) {
      playerVehicle.update(dt, getInput(), trackData.spline);
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
      for (const ai of aiRacers) {
        ai.setRubberBand(getClosestSplinePoint(trackData.spline, playerVehicle.group.position, 100).t);
        ai.update(dt);
        raceEngine?.updateRacer(ai.id, ai.vehicle.group.position);
      }
    }

    // VFX
    const driftAbs = Math.abs(playerVehicle.driftAngle);
    if (driftAbs > 0.15 && s === GameState.RACING) {
      spawnTireSmoke(playerVehicle.group.position, driftAbs);
    }
    updateVFX(dt);
    updateBoostFlame(getInput().boost, playerVehicle.group.position, playerVehicle.heading, timestamp / 1000);
    updateSpeedLines(Math.abs(playerVehicle.speed) / selectedCar.maxSpeed);

    // Audio
    updateEngineAudio(playerVehicle.speed, selectedCar.maxSpeed);

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
        destroyLeaderboard();
        showResults();
      }

      // HUD update
      const rankings = raceEngine.getRankings();
      const myRank = rankings.findIndex(r => r.id === 'local') + 1;
      const wrongWay = raceEngine.isWrongWay(
        playerVehicle.heading,
        trackData.checkpoints[progress?.checkpointIndex ?? 0]?.tangent ?? new THREE.Vector3(0, 0, 1),
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
    }

    // Remote vehicle positions
    if (netPeer) {
      for (const [id, mesh] of remoteMeshes) {
        const snap = netPeer.getInterpolatedState(id);
        if (snap) {
          mesh.position.set(snap.x, 0, snap.z);
          mesh.rotation.y = snap.heading;
        }

        const tag = remoteNameTags.get(id);
        if (tag) updateNameTag(tag, mesh.position);
      }
    }

    // Render
    renderer.render(scene, camera);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

lastTime = performance.now();
showTitleScreen();
requestAnimationFrame(gameLoop);
