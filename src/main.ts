/* ── Hood Racer — Main Entry Point & Game Orchestrator ── */

import * as THREE from 'three';
import './index.css';

import { GameState, CarDef, EventType } from './types';
import { initScene, getScene } from './scene';
import { showLapOverlay } from './hud';
import { playCheckpointSFX, playLapFanfare, playFinishFanfare, playPositionSFX } from './audio';
import { playTitleMusic, pauseMusic, resumeMusic, stopAllMusic } from './audio';
import { showResults, resolvePlayerName } from './results-screen';
import { enterSpectatorMode, cycleSpectateTarget, destroySpectateHUD } from './spectator';
import { initGarage, destroyGarage } from './garage';
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
const input = initInput();

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
// TITLE SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function showTitleScreen() {
  G.gameState = GameState.TITLE;
  showTouchControls(false);
  playTitleMusic();

  const titleEl = document.createElement('div');
  titleEl.className = 'title-screen';
  titleEl.id = 'title-screen';
  titleEl.innerHTML = `
    <div class="title-logo">HOOD RACER</div>
    <div class="title-subtitle">Street Legends Never Stop</div>
    <div class="menu-buttons">
      <button class="menu-btn" id="btn-singleplayer">SINGLEPLAYER</button>
      <button class="menu-btn" id="btn-multiplayer">MULTIPLAYER</button>
      <button class="menu-btn" id="btn-track-editor" style="border-color:#ff6600;color:#ff8833;">🏁 TRACK EDITOR</button>
      <button class="menu-btn" id="btn-calibrate" style="border-color:#00ffff;color:#00ffff;">✨ CALIBRATION STUDIO</button>
      <button class="menu-btn" id="btn-controls" style="border-color:var(--col-text-dim);font-size:16px;">CONTROLS</button>
      <button class="menu-btn" id="btn-settings" style="border-color:var(--col-text-dim);font-size:16px;">SETTINGS</button>
    </div>
  `;
  uiOverlay.appendChild(titleEl);

  // Browser autoplay policy blocks music at page load; retry on first user click
  titleEl.addEventListener('click', () => playTitleMusic(), { once: true });

  document.getElementById('btn-singleplayer')!.addEventListener('click', () => {
    titleEl.remove();
    enterGarage('singleplayer');
  });

  document.getElementById('btn-multiplayer')!.addEventListener('click', () => {
    titleEl.remove();
    enterGarage('multiplayer');
  });

  document.getElementById('btn-track-editor')!.addEventListener('click', () => {
    titleEl.remove();
    enterTrackEditor();
  });

  document.getElementById('btn-controls')!.addEventListener('click', showControlsRef);

  document.getElementById('btn-settings')!.addEventListener('click', () => {
    showSettings(uiOverlay, () => {
      G.localPlayerName = getSettings().playerName || G.localPlayerName;
      applySettingsToRenderer();
    });
  });

  document.getElementById('btn-calibrate')!.addEventListener('click', () => {
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
});

startGameLoop();

