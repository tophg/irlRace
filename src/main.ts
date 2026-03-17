/* ── Hood Racer — Main Entry Point & Game Orchestrator ── */

import * as THREE from 'three';
import './index.css';

import { GameState, CAR_ROSTER, CarDef, EventType } from './types';
import type { TrackData } from './types';
import { initScene, getRenderer, getScene, getCamera, getDirLight, applyEnvironment, getEnvironmentForSeed, getEnvironmentByName } from './scene';
import { loadCarModel } from './loaders';
import { generateTrack, buildCheckpointMarkers, getClosestSplinePoint, updateCheckpointHighlight } from './track';
import { Vehicle } from './vehicle';
import { VehicleCamera } from './vehicle-camera';
import { RaceEngine } from './race-engine';
import { createHUD, updateHUD, updateMinimap, updateDamageHUD, updateGapHUD, updateNitroHUD, updateHeatHUD, showHUD, destroyHUD, showLapOverlay } from './hud';
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
  destroyVFX, spawnDamageSmoke,
  initSkidMarks, updateSkidMarks, destroySkidMarks, updateSkidGlowTime,
  spawnFlameParticle,
  spawnDamageZoneSmoke,

  initRainDroplets, updateRainDroplets,
  initImpactFlash, triggerImpactFlash, updateImpactFlash,
  createUnderglow, updateUnderglow,
  initBoostShockwave, triggerBoostShockwave, updateBoostShockwave,
  initNitroFlash, triggerBoostBurst, triggerBackfireSequence,
  createBrakeDiscs, updateBrakeDiscs,
  initHeatShimmer, updateHeatShimmer,
  initLensFlares, updateLensFlares,
  initLightning, setLightningEnabled, updateLightning,
  initNearMissStreaks, triggerNearMiss, updateNearMissStreaks,
  initNearMissWhoosh, triggerNearMissWhoosh, updateNearMissWhoosh,
  initVictoryConfetti, spawnVictoryConfetti, updateVictoryConfetti, setConfettiContinuous,
  spawnDebris,
} from './vfx';
import {
  initGPUParticles, updateGPUParticles, destroyGPUParticles,
  spawnGPUSparks, spawnGPUExplosion, spawnGPUDamageSmoke, spawnGPUFlame,
  spawnGPUScrapeSparks, spawnGPUGlassShards, spawnGPUShoulderDust,
  spawnGPUNitroTrail, spawnGPURimSparks, spawnGPUBackfire,
  spawnGPUSlipstream,
} from './gpu-particles';
import { initTrackRadar, updateTrackRadar, destroyTrackRadar } from './minimap';
import { playTitleMusic, playGameMusic, pauseMusic, resumeMusic, stopAllMusic } from './audio';
import { showTrackEditor, destroyTrackEditor } from './track-editor';
import { triggerVehicleDestruction, updateDestructionFragments, cleanupDestruction } from './vehicle-destruction';
import { triggerSlowMotion, updateTimeScale, applyTimeScale, getTimeScale, resetTimeScale } from './time-scale';
import { showExplosionFlash, showLetterbox, hideLetterbox, showEngineDestroyedText, cleanupScreenEffects } from './screen-effects';
import { loadProgress, processRaceRewards, getProgress, levelProgress, xpToNextLevel, type RaceResult } from './progression';
import { startGhostRecording, sampleGhostFrame, finalizeGhostLap, loadGhostForSeed, startGhostPlayback, updateGhostPlayback, destroyGhost, getGhostBestTime } from './ghost';
import {
  initRapierWorld, addBarrierCollider, addCarBody,
  syncCarToRapier, stepRapierWorld, destroyRapierWorld,
} from './rapier-world';
import { rollbackManager, packInput } from './rollback-netcode';
import { initInput, showTouchControls, getInput } from './input';
import { loadSettings, getSettings, showSettings } from './settings';
import { ReplayRecorder, ReplayPlayer } from './replay';
import { resolveCarCollisions, CarCollider, CollisionEvent } from './bvh';
import { getWeatherForSeed, initWeather, updateWeather, applyWetRoad, destroyWeather, getWeatherGripMultiplier, getWeatherDriftMultiplier, getCurrentWeather, getWeatherPhysics, getPrecipMesh } from './weather';
import { initPostFX, updatePostFX, setImpactIntensity, setBoostActive, setExplosionMode, getPostFXPipeline, destroyPostFX } from './post-fx';

// ── Shared state ──
import { G, PHYSICS_DT, PHYSICS_HZ, MAX_FRAME_DT, LB_UPDATE_INTERVAL, resetRaceStats } from './game-context';
import type { DetachedPart, RaceStats } from './game-context';

// ── Extracted UI ──
import {
  showPositionCallout, showEmoteBubble, spawnConfetti,
  updateDebugOverlay, togglePause, destroyPause,
  showLoading, hideLoading, showRaceConfig, showControlsRef,
  showTitleScreen as showTitleScreenUI,
} from './ui-screens';

// ── Extracted Multiplayer ──
import {
  initMultiplayerHandler, enterMultiplayerLobby,
  broadcastPlayerList, wireNetworkCallbacks,
} from './multiplayer-handler';

// ── Event Bus ──
import { bus } from './event-bus';

// ── DOM ──
const container = document.getElementById('game-container')!;
const uiOverlay = document.getElementById('ui-overlay')!;

// ── Damage flash overlay (red vignette on impacts) ──
let _damageFlashEl: HTMLDivElement | null = null;
let _damageFlashTimer = 0;

function flashDamage(intensity: number) {
  if (!_damageFlashEl) {
    _damageFlashEl = document.createElement('div');
    _damageFlashEl.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      pointer-events:none; z-index:9999; opacity:0;
      transition: opacity 0.3s ease-out;
    `;
    document.body.appendChild(_damageFlashEl);
  }
  const alpha = Math.min(intensity, 0.7);
  _damageFlashEl.style.background = `radial-gradient(ellipse at center, transparent 40%, rgba(255,20,0,${alpha}) 100%)`;
  _damageFlashEl.style.opacity = '1';
  clearTimeout(_damageFlashTimer);
  _damageFlashTimer = window.setTimeout(() => {
    if (_damageFlashEl) _damageFlashEl.style.opacity = '0';
  }, 80);
}

// ── Scene (async — WebGPU renderer init) ──
const { renderer, scene, camera } = await initScene(container);

// ── Input ──
const input = initInput();

// ── Reusable temp (local to main.ts) ──
const _rPos = new THREE.Vector3();

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
// PAUSE MENU
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━



// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOADING SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━




// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RACE CONFIGURATION (singleplayer only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONTROLS REFERENCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


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
      (G as any)._customTrack = track;
      startRace();
    },
    onRaceWithTrack: (track) => {
      destroyTrackEditor();
      (G as any)._customTrack = track;
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
        (G as any)._selectedWeather = weather;
        (G as any)._selectedEnvironment = environment;
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
// MULTIPLAYER (→ multiplayer-handler.ts)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RACE SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


async function startRace() {
  if (G.raceStarting) return;
  G.raceStarting = true;

  try {
    // State stays at TITLE during loading — prevents physics from running on incomplete track
    showLoading();

    clearRaceObjects();
    G.physicsAccumulator = 0; // prevent stale accumulation from loading
    G._drsFrameTimes.length = 0; // clear stale DRS data from previous race
    // Reset pixel ratio to native (DRS may have reduced it in previous race)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Generate track (use custom track from editor if present, else procedural)
    let seed = G.trackSeed ?? Math.floor(Math.random() * 99999);
    if ((G as any)._customTrack) {
      G.trackData = (G as any)._customTrack;
      (G as any)._customTrack = null; // consume — restart uses random seed
      G.currentRaceSeed = 0;
    } else {
      G.currentRaceSeed = seed;
      G.trackSeed = null;
      G.trackData = generateTrack(seed);
    }
    const trackData = G.trackData!; // guaranteed non-null after if/else above
    // Environment: use player-selected environment if not 'random', else seed-based
    const selectedEnv = (G as any)._selectedEnvironment as string;
    const envPreset = (selectedEnv && selectedEnv !== 'random')
      ? getEnvironmentByName(selectedEnv)
      : getEnvironmentForSeed(seed);
    applyEnvironment(envPreset);
    // Weather: use player-selected weather if not 'random', else seed-based
    const selectedW = (G as any)._selectedWeather as string;
    const weatherType = (selectedW && selectedW !== 'random')
      ? selectedW as any
      : getWeatherForSeed(seed);
    initWeather(scene, weatherType);

    // Override env preset for cold weather types to match visuals
    const w = getCurrentWeather();
    if (w === 'snow') applyEnvironment(getEnvironmentByName('Alpine Snow'));
    else if (w === 'blizzard') applyEnvironment(getEnvironmentByName('Blizzard'));
    else if (w === 'ice') applyEnvironment(getEnvironmentByName('Black Ice'));

    if (w !== 'clear') applyWetRoad(trackData.roadMesh);
    scene.add(trackData.roadMesh);
    scene.add(trackData.barrierLeft);
    scene.add(trackData.barrierRight);
    scene.add(trackData.shoulderMesh);
    scene.add(trackData.kerbGroup);
    scene.add(trackData.sceneryGroup);

    G.checkpointMarkers = buildCheckpointMarkers(trackData.checkpoints);
    scene.add(G.checkpointMarkers);

    G.raceEngine = new RaceEngine(trackData.checkpoints, G.totalLaps);

    const playerModel = await loadCarModel(G.selectedCar.file);
    // Defensive: ensure model starts with clean transforms
    playerModel.position.set(0, 0, 0);
    playerModel.scale.setScalar(1);
    playerModel.rotation.set(0, 0, 0);
    G.playerVehicle = new Vehicle(G.selectedCar);
    G.playerVehicle.setModel(playerModel, renderer, camera);
    // Apply custom paint if set
    const paintHue = getSettings().paintHue;
    if (paintHue >= 0) G.playerVehicle.setPaintColor(paintHue);
    scene.add(G.playerVehicle.group);
    G.playerVehicle.setRoadMesh(trackData.roadMesh);
    G.playerVehicle.placeOnTrack(trackData.spline, 0, -3.5);
    G._playerUnderglow = createUnderglow(G.playerVehicle.group, 0);
    // G._playerBrakeDiscs = createBrakeDiscs(G.playerVehicle.group.children[0] as THREE.Group); // DISABLED
    G.raceEngine.addRacer('local');

    G.vehicleCamera = new VehicleCamera(camera);

    initVFX(scene);
    initBoostFlame(scene);
    initSpeedLines(container);
    initSkidMarks(scene);

    initRainDroplets(container);
    initImpactFlash(container);
    initBoostShockwave(scene);
    initNitroFlash(container);
    initHeatShimmer(container);

    // Track radar minimap
    initTrackRadar(trackData.spline, document.getElementById('ui-overlay')!);

    // Collect street light positions for lens flares
    const lightPositions: THREE.Vector3[] = [];
    trackData.sceneryGroup.traverse((child: THREE.Object3D) => {
      if ((child as any).isPointLight) {
        lightPositions.push(child.position.clone());
      }
    });
    initLensFlares(scene, lightPositions);
    initLightning(container);
    initNearMissStreaks(container);
    initNearMissWhoosh(scene);
    initVictoryConfetti(scene);

    // Enable lightning if storm weather
    setLightningEnabled(getCurrentWeather() === 'heavy_rain');
    await initGPUParticles(renderer, scene);

    // Initialize post-processing pipeline (bloom, chromatic aberration, vignette)
    try {
      G.postFXPipeline = initPostFX(renderer, scene, camera);
    } catch (e) {
      console.warn('[PostFX] Pipeline init failed, rendering without post-processing:', e);
      G.postFXPipeline = null;
    }
    try {
      await initRapierWorld();
      addBarrierCollider(trackData.barrierLeft);
      addBarrierCollider(trackData.barrierRight);
      const playerPos = G.playerVehicle.group.position;
      addCarBody('local', playerPos.x, playerPos.y, playerPos.z, G.playerVehicle.heading);
    } catch (e) {
      console.warn('[Rapier] WASM init failed, running without enhanced collision:', e);
    }

    if (!G.netPeer) await spawnAI(trackData);

    if (G.netPeer) {
      await spawnRemoteVehicles();

      G.netPeer.startBroadcasting(() => ({
        x: G.playerVehicle!.group.position.x,
        z: G.playerVehicle!.group.position.z,
        heading: G.playerVehicle!.heading,
        speed: G.playerVehicle!.speed,
        dmgFront: G.playerVehicle!.damage.front.hp,
        dmgRear: G.playerVehicle!.damage.rear.hp,
        dmgLeft: G.playerVehicle!.damage.left.hp,
        dmgRight: G.playerVehicle!.damage.right.hp,
      }));

      G.netPeer.startPinging();
      G.netPeer.startHeartbeat();
    }

    createHUD(uiOverlay);
    showHUD(true);

    // Rear-view mirror (WebGPU scissor viewport target)
    G.mirrorCamera = new THREE.PerspectiveCamera(50, 320 / 120, 0.5, 500);
    G.mirrorBorder = document.createElement('div');
    G.mirrorBorder.style.cssText = `
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
      width: 320px; height: 120px;
      border: 2px solid rgba(255,255,255,0.2); border-radius: 6px;
      pointer-events: none; z-index: 20; opacity: 0.85;
      overflow: hidden;
    `;
    uiOverlay.appendChild(G.mirrorBorder);
    showTouchControls(true);
    initAudio();

    // ── Robust Pre-Render ──
    // Force shaders to compile and textures to upload to the GPU *now* by explicitly rendering once.
    // This will block the main thread for hundreds of milliseconds on the first run.
    renderer.render(scene, camera);

    // Yield to the browser's render pipeline. We wait for TWO animation frames to guarantee
    // the blocking render has fully flushed to the screen and the browser has recovered to 60fps
    // before we hide the loading screen and start the time-sensitive countdown.
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));

    hideLoading();
    // NOW enter COUNTDOWN — track is fully built, all assets loaded
    G.gameState = GameState.COUNTDOWN;

    // ── Synchronized start (multiplayer ready barrier) ──
    if (G.netPeer) {
      if (G.netPeer.getIsHost()) {
        const guestCount = G.netPeer.getConnectionCount();
        if (guestCount > 0 && G.raceReadyCount < guestCount) {
          await Promise.race([
            new Promise<void>(resolve => {
              G.raceGoResolve = resolve;
              if (G.raceReadyCount >= guestCount) resolve();
            }),
            new Promise<void>(resolve => setTimeout(resolve, 10000)),
          ]);
          G.raceGoResolve = null;
        }
        G.netPeer.broadcastEvent(EventType.RACE_GO, {});
      } else {
        G.netPeer.broadcastEvent(EventType.RACE_READY, {});
        await Promise.race([
          new Promise<void>(resolve => { G.raceGoResolve = resolve; }),
          new Promise<void>(resolve => setTimeout(resolve, 10000)),
        ]);
        G.raceGoResolve = null;
      }
    }

    await runCountdown(uiOverlay);
    playGameMusic();

    resetRaceStats();
    G.raceEngine.start();
    G.replayRecorder = new ReplayRecorder();
    G.replayRecorder.start();
    G.gameState = GameState.RACING;

    // Ghost car: spawn ghost playback if one exists for this seed
    const ghostData = loadGhostForSeed(G.currentRaceSeed);
    if (ghostData) {
      startGhostPlayback(getScene(), ghostData);
    }
    // Start recording ghost for the first lap
    startGhostRecording(G.playerVehicle.group.position, G.playerVehicle.heading);
  } finally {
    G.raceStarting = false;
  }
}

async function spawnAI(td: TrackData) {
  // Defensive: clear any leftover AI from previous race
  for (const ai of G.aiRacers) {
    scene.remove(ai.vehicle.group);
  }
  G.aiRacers.length = 0;

  const available = CAR_ROSTER.filter(c => c.id !== G.selectedCar.id);
  const count = Math.min(G.aiCount, available.length);
  const aiCars = available.slice(0, count);
  const laneOffsets = [3.5, -3.5, 3.5, -3.5, 3.5, -3.5];
  const startTs = [0.005, 0.005, 0.012, 0.012, 0.019, 0.019];

  console.log(`[spawnAI] G.aiCount=${G.aiCount}, spawning ${aiCars.length} AI racers`);

  for (let i = 0; i < aiCars.length; i++) {
    const def = aiCars[i];
    const ai = new AIRacer(`ai_${i}`, { ...def }, i);
    ai.applyDifficulty(G.aiDifficulty);
    G.raceEngine!.addRacer(`ai_${i}`);

    try {
      const model = await loadCarModel(def.file);
      model.position.set(0, 0, 0);
      model.scale.setScalar(1);
      model.rotation.set(0, 0, 0);
      ai.vehicle.setModel(model, renderer, camera);
    } catch {}

    ai.vehicle.setRoadMesh(G.trackData!.roadMesh);
    ai.place(G.trackData!.spline, startTs[i] ?? 0.02, laneOffsets[i] ?? 0, G.trackData!.bvh);
    ai.setSpeedProfile(G.trackData!.speedProfile);
    scene.add(ai.vehicle.group);
    createUnderglow(ai.vehicle.group, i + 1); // Different color per AI

    // AI name tag (billboard sprite above car)
    const AI_NAMES = ['SHADOW', 'BLAZE', 'NITRO', 'GHOST', 'VIPER', 'STORM', 'RAZOR', 'DRIFT', 'FURY', 'ACE', 'NOVA'];
    const nameTag = createNameTag(AI_NAMES[i % AI_NAMES.length], scene);
    (ai as any)._nameTag = nameTag;

    G.aiRacers.push(ai);
  }
}

async function spawnRemoteVehicles() {
  if (!G.netPeer || !G.trackData) return;

  // Use the full players list from COUNTDOWN_START (includes guests we have no direct connection to)
  // Filter out our own local ID
  const localId = G.netPeer.getLocalId();
  const allPlayers = G.mpPlayersList.length > 0
    ? G.mpPlayersList.filter(p => p.id !== localId)
    : G.netPeer.getRemotePlayers().map(r => ({ id: r.id, name: r.name, carId: r.carId }));

  const laneOffsets = [3.5, -3.5, 3.5, -3.5, 3.5, -3.5];

  for (let ri = 0; ri < allPlayers.length; ri++) {
    const player = allPlayers[ri];
    if (G.remoteMeshes.has(player.id)) continue;

    const def = CAR_ROSTER.find(c => c.id === player.carId) ?? CAR_ROSTER[0];
    try {
      const model = await loadCarModel(def.file);
      const startT = 0.02 + ri * 0.02;
      const pt = G.trackData.spline.getPointAt(startT);
      const tangent = G.trackData.spline.getTangentAt(startT).normalize();
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const lane = laneOffsets[ri % laneOffsets.length];
      model.position.copy(pt);
      model.position.x += right.x * lane;
      model.position.z += right.z * lane;

      // Snap to road surface via raycast
      const rayOrigin = new THREE.Vector3(model.position.x, model.position.y + 10, model.position.z);
      const rc = new THREE.Raycaster(rayOrigin, new THREE.Vector3(0, -1, 0), 0, 25);
      const hits = rc.intersectObject(G.trackData.roadMesh, false);
      if (hits.length > 0) {
        model.position.y = hits[0].point.y;
      } else {
        model.position.y += 0.05;
      }

      model.rotation.y = Math.atan2(tangent.x, tangent.z);
      scene.add(model);
      G.remoteMeshes.set(player.id, model);

      const tag = createNameTag(player.name || 'Racer', scene);
      G.remoteNameTags.set(player.id, tag);
    } catch {}

    G.raceEngine!.addRacer(player.id);
  }
}

function disposeMaterial(mat: THREE.Material) {
  const std = mat as THREE.MeshStandardMaterial;
  if (std.map) std.map.dispose();
  if (std.normalMap) std.normalMap.dispose();
  if (std.aoMap) std.aoMap.dispose();
  if (std.emissiveMap) std.emissiveMap.dispose();
  if (std.envMap) std.envMap.dispose();
  if (std.roughnessMap) std.roughnessMap.dispose();
  if (std.metalnessMap) std.metalnessMap.dispose();
  if (std.alphaMap) std.alphaMap.dispose();
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
  G.netPeer?.stopBroadcasting();
  G.netPeer?.stopPinging();
  G.netPeer?.clearBuffers();

  // Stop replay recorder
  G.replayRecorder?.stop();
  G.replayRecorder = null;

  // Remove and dispose old track
  if (G.trackData) {
    destroyWeather();
    scene.remove(G.trackData.roadMesh);
    scene.remove(G.trackData.barrierLeft);
    scene.remove(G.trackData.barrierRight);
    scene.remove(G.trackData.shoulderMesh);
    scene.remove(G.trackData.kerbGroup);
    scene.remove(G.trackData.sceneryGroup);
    disposeMesh(G.trackData.roadMesh);
    disposeMesh(G.trackData.barrierLeft);
    disposeMesh(G.trackData.barrierRight);
    disposeMesh(G.trackData.shoulderMesh);
    disposeMesh(G.trackData.kerbGroup);
    disposeMesh(G.trackData.sceneryGroup);
    G.trackData = null;
  }
  if (G.checkpointMarkers) {
    scene.remove(G.checkpointMarkers);
    disposeMesh(G.checkpointMarkers);
    G.checkpointMarkers = null;
  }

  // Destroy mirror
  if (G.mirrorBorder) { G.mirrorBorder.remove(); G.mirrorBorder = null; }
  G.mirrorCamera = null;

  // Remove player
  if (G.playerVehicle) {
    scene.remove(G.playerVehicle.group);
    disposeMesh(G.playerVehicle.group);
    G.playerVehicle = null;
  }

  // Remove AI
  for (const ai of G.aiRacers) {
    scene.remove(ai.vehicle.group);
    disposeMesh(ai.vehicle.group);
  }
  G.aiRacers.length = 0;

  // Remove remote meshes
  for (const mesh of G.remoteMeshes.values()) {
    scene.remove(mesh);
    disposeMesh(mesh);
  }
  G.remoteMeshes.clear();
  for (const tag of G.remoteNameTags.values()) {
    scene.remove(tag);
    if ((tag as THREE.Sprite).material) {
      const spMat = (tag as THREE.Sprite).material as THREE.SpriteMaterial;
      spMat.map?.dispose();
      spMat.dispose();
    }
  }
  G.remoteNameTags.clear();

  G.remotePrevPos.clear();

  // Clean up detached parts
  for (const dp of G.detachedParts) {
    scene.remove(dp.mesh);
    dp.mesh.geometry?.dispose();
    (dp.mesh.material as THREE.Material)?.dispose();
  }
  G.detachedParts.length = 0;

  // Clean up VFX (smoke, speed lines, boost flame, skid marks, cracks)
  G._leftTireBlown = false;
  G._rightTireBlown = false;

  destroyVFX();
  destroySkidMarks();
  destroyGPUParticles();
  destroyRapierWorld();
  rollbackManager.reset();
  cleanupDestruction();
  resetTimeScale();
  cleanupScreenEffects();
  setExplosionMode(false);

  // Stop audio
  stopAudio();

  destroyHUD();
  destroyTrackRadar();
  destroyGhost(getScene());
  destroyLeaderboard();

  // Clean up debug overlay
  if (G.debugEl) { G.debugEl.remove(); G.debugEl = null; }

  // Reset cooldowns
  G.driftSfxCooldown = 0;
  G.lbLastUpdate = 0;
  G.spectateTargetId = null;
  G.prevMyRank = 0;
  destroySpectateHUD();
}

function enterSpectatorMode() {
  if (!G.vehicleCamera || !G.raceEngine) return;

  // Find the closest unfinished racer to follow
  const rankings = G.raceEngine.getRankings();
  const unfinished = rankings.filter(r => !r.finished && !r.dnf && r.id !== 'local');

  if (unfinished.length > 0) {
    G.spectateTargetId = unfinished[0].id;
    G.vehicleCamera.startFollow();
    showSpectateHUD();
  } else {
    // No one left to follow — orbit the track center
    G.spectateTargetId = null;
    if (G.playerVehicle) {
      G.vehicleCamera.startOrbit(G.playerVehicle.group.position);
    }
  }
}

function cycleSpectateTarget(direction: 1 | -1) {
  if (!G.raceEngine || !G.vehicleCamera) return;
  const rankings = G.raceEngine.getRankings();
  const targets = rankings.filter(r => !r.finished && !r.dnf && r.id !== 'local');
  if (targets.length === 0) {
    // Everyone finished — switch to orbit
    G.spectateTargetId = null;
    G.vehicleCamera.startOrbit(G.playerVehicle!.group.position);
    destroySpectateHUD();
    return;
  }

  const curIdx = targets.findIndex(r => r.id === G.spectateTargetId);
  let nextIdx = curIdx + direction;
  if (nextIdx < 0) nextIdx = targets.length - 1;
  if (nextIdx >= targets.length) nextIdx = 0;
  G.spectateTargetId = targets[nextIdx].id;
  G.vehicleCamera.startFollow();
  updateSpectateHUD();
}

function showSpectateHUD() {
  destroySpectateHUD();
  G.spectateHudEl = document.createElement('div');
  G.spectateHudEl.className = 'spectate-hud';
  uiOverlay.appendChild(G.spectateHudEl);

  G.spectateHudEl.querySelector('.arrow-left')?.addEventListener('click', () => cycleSpectateTarget(-1));
  G.spectateHudEl.querySelector('.arrow-right')?.addEventListener('click', () => cycleSpectateTarget(1));

  updateSpectateHUD();
}

function updateSpectateHUD() {
  if (!G.spectateHudEl || !G.spectateTargetId) return;
  const name = resolvePlayerName(G.spectateTargetId);
  G.spectateHudEl.innerHTML = `
    <span class="spectate-label">SPECTATING</span>
    <span class="arrow arrow-left" id="spec-left">◀</span>
    <span class="spectate-name">${name}</span>
    <span class="arrow arrow-right" id="spec-right">▶</span>
  `;
  // Re-wire click events after innerHTML update
  G.spectateHudEl.querySelector('#spec-left')?.addEventListener('click', () => cycleSpectateTarget(-1));
  G.spectateHudEl.querySelector('#spec-right')?.addEventListener('click', () => cycleSpectateTarget(1));
}

function destroySpectateHUD() {
  if (G.spectateHudEl) { G.spectateHudEl.remove(); G.spectateHudEl = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RESULTS SCREEN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const AI_DRIVER_NAMES = [
  'Blaze', 'Nitro', 'Ghost', 'Viper', 'Smoke', 'Flash',
  'Turbo', 'Clutch', 'Drift', 'Razor', 'Burn', 'Apex',
];



function resolvePlayerName(id: string): string {
  if (id === 'local') return 'You';
  if (id.startsWith('ai_')) {
    const idx = parseInt(id.replace('ai_', ''), 10) || 0;
    return AI_DRIVER_NAMES[idx % AI_DRIVER_NAMES.length];
  }
  const netName = G.netPeer?.getRemotePlayers().find(rp => rp.id === id)?.name;
  if (netName && netName !== 'Racer') return netName;
  const mpName = G.mpPlayersList.find(p => p.id === id)?.name;
  return mpName || netName || id.slice(0, 8);
}

function buildRewardHTML(rankings: any[], localProgress: any): string {
  // Process rewards via progression system
  const localRank = rankings.findIndex((r: any) => r.id === 'local') + 1;
  const bestLap = localProgress?.lapTimes?.length > 0 ? Math.min(...localProgress.lapTimes) : 0;
  const raceResult: RaceResult = {
    placement: localRank || 1,
    totalRacers: rankings.length,
    lapTimes: localProgress?.lapTimes ?? [],
    bestLap: bestLap / 1000, // convert to seconds
    collisionCount: G.raceStats.collisionCount,
    driftTime: G.raceStats.totalDriftTime,
    topSpeed: G.raceStats.topSpeed,
    trackLength: G.trackData?.totalLength ?? 500,
    lapsCompleted: localProgress?.lapTimes?.length ?? 0,
  };
  const rewards = processRaceRewards(raceResult);
  const prog = getProgress();
  const lvlPct = Math.round(levelProgress() * 100);

  let html = `<div class="lap-breakdown" style="margin-top:8px;">
    <div class="lap-breakdown-title">REWARDS</div>
    <div class="lap-breakdown-row"><span>Race Complete</span><span>+${rewards.baseXP} XP / +${rewards.baseCredits} CR</span></div>`;
  if (rewards.winBonus > 0) html += `<div class="lap-breakdown-row best"><span>🏆 Victory!</span><span>+${rewards.winBonus} XP / +${rewards.winCreditsBonus} CR</span></div>`;
  if (rewards.podiumBonus > 0) html += `<div class="lap-breakdown-row"><span>🥇 Podium</span><span>+${rewards.podiumBonus} XP / +${rewards.podiumCreditsBonus} CR</span></div>`;
  if (rewards.cleanBonus > 0) html += `<div class="lap-breakdown-row"><span>✨ Clean Race</span><span>+${rewards.cleanBonus} XP</span></div>`;
  if (rewards.driftBonus > 0) html += `<div class="lap-breakdown-row"><span>🔥 Drift Bonus</span><span>+${rewards.driftBonus} XP</span></div>`;
  html += `<div class="lap-breakdown-row" style="border-top:1px solid rgba(255,255,255,0.15);padding-top:4px;font-weight:700;"><span>Total</span><span>+${rewards.totalXP} XP / +${rewards.totalCredits} CR</span></div>`;
  if (rewards.leveledUp) html += `<div class="lap-breakdown-row best" style="color:#ffcc00;font-weight:700;"><span>⬆ LEVEL UP!</span><span>Level ${rewards.newLevel}</span></div>`;
  html += `<div class="lap-breakdown-row" style="margin-top:6px;"><span>Level ${prog.level}</span><span>${xpToNextLevel()} XP to next</span></div>`;
  html += `<div style="background:rgba(255,255,255,0.1);border-radius:4px;height:6px;margin:4px 0;"><div style="background:var(--col-orange);border-radius:4px;height:100%;width:${lvlPct}%;transition:width 0.5s;"></div></div>`;
  html += `<div class="lap-breakdown-row"><span>Credits</span><span style="color:#ffcc00;font-weight:700;">${prog.credits} CR</span></div>`;
  html += `</div>`;
  return html;
}

function showResults() {
  G.gameState = GameState.RESULTS;
  // Victory confetti burst!
  if (G.playerVehicle) {
    spawnVictoryConfetti(G.playerVehicle.group.position);
    setConfettiContinuous(true, G.playerVehicle.group.position);
  }

  // Record session wins
  const preRankings = G.raceEngine?.getRankings() ?? [];
  if (preRankings.length > 0 && !preRankings[0].dnf && preRankings[0].finished) {
    const winnerId = preRankings[0].id;
    G.sessionWins.set(winnerId, (G.sessionWins.get(winnerId) || 0) + 1);
  }
  G.netPeer?.stopBroadcasting();
  G.netPeer?.stopPinging();
  showTouchControls(false);
  G.replayRecorder?.stop();

  if (G.postWinnerTimer) clearTimeout(G.postWinnerTimer);
  G.postWinnerTimer = window.setTimeout(() => {
    if (G.raceEngine) {
      for (const r of G.raceEngine.getRankings()) {
        if (!r.finished) G.raceEngine.markDnf(r.id);
      }
    }
    G.postWinnerTimer = null;
  }, 15000);

  const rankings = G.raceEngine?.getRankings() ?? [];
  const winner = rankings[0];
  const winnerName = winner ? resolvePlayerName(winner.id) : '???';
  const isMultiplayer = !!G.netPeer;
  const isHost = G.netPeer?.getIsHost() ?? false;
  const hasReplay = G.replayRecorder?.hasData() ?? false;

  const el = document.createElement('div');
  el.className = 'results-overlay';
  // Build per-lap breakdown for the local player
  const localProgress = G.raceEngine?.getProgress('local');
  const localBestLap = G.raceEngine?.getBestLap('local');
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
    <div class="results-title">${winner?.dnf ? 'RACE COMPLETE' : `${winnerName.toUpperCase()} ${winner?.id === 'local' ? 'WIN' : 'WINS'}!`}</div>
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
          const wins = G.sessionWins.get(r.id) || 0;
          const winsHtml = wins > 0 ? ` <span class="session-wins">${wins}W</span>` : '';
          const crownHtml = G.sessionWins.size > 0 && wins === Math.max(...G.sessionWins.values()) && wins > 0 ? ' 👑' : '';
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
      <div class="lap-breakdown-row"><span>Top Speed</span><span>${Math.floor(G.raceStats.topSpeed)} MPH</span></div>
      <div class="lap-breakdown-row"><span>Drift Time</span><span>${G.raceStats.totalDriftTime.toFixed(1)}s</span></div>
      <div class="lap-breakdown-row"><span>Avg Position</span><span>${G.raceStats.positionSampleCount > 0 ? (G.raceStats.avgPosition / G.raceStats.positionSampleCount).toFixed(1) : '—'}</span></div>
      <div class="lap-breakdown-row"><span>Collisions</span><span>${G.raceStats.collisionCount}</span></div>
      <div class="lap-breakdown-row"><span>Near Misses</span><span>${G.raceStats.nearMissCount}</span></div>
    </div>
    ${buildRewardHTML(rankings, localProgress)}
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
    if (G.postWinnerTimer) { clearTimeout(G.postWinnerTimer); G.postWinnerTimer = null; }
    startRace();
  });
  document.getElementById('btn-rematch')?.addEventListener('click', () => {
    el.remove();
    if (G.postWinnerTimer) { clearTimeout(G.postWinnerTimer); G.postWinnerTimer = null; }
    if (isHost) {
      G.raceReadyCount = 0;
      G.trackSeed = Math.floor(Math.random() * 99999);
      const rematchPlayers = [{ id: G.netPeer!.getLocalId(), name: G.localPlayerName, carId: G.selectedCar.id }];
      for (const rp of G.netPeer!.getRemotePlayers()) rematchPlayers.push({ id: rp.id, name: rp.name, carId: rp.carId });
      G.mpPlayersList = rematchPlayers;
      G.netPeer!.broadcastEvent(EventType.REMATCH_REQUEST, { seed: G.trackSeed, laps: G.totalLaps, players: rematchPlayers });
      destroyLeaderboard();
      startRace();
    } else {
      G.netPeer!.broadcastEvent(EventType.REMATCH_ACCEPT, {});
      showToast(uiOverlay, 'Rematch requested...');
    }
  });
  document.getElementById('btn-main-menu')!.addEventListener('click', () => {
    el.remove();
    if (G.postWinnerTimer) { clearTimeout(G.postWinnerTimer); G.postWinnerTimer = null; }
    G.netPeer?.destroy();
    G.netPeer = null;
    clearRaceObjects();
    destroyLeaderboard();
    destroySpectateHUD();
    G.sessionWins.clear();
    showTitleScreen();
  });
}

function startReplayPlayback() {
  if (!G.replayRecorder || !G.trackData || !G.playerVehicle) return;

  // Clean up any destruction effects (explosion fragments, shockwave, scorch, light)
  cleanupDestruction();

  // Restore car visibility (destroyed during explosion animation)
  G.playerVehicle.bodyGroupRef.visible = true;
  G.playerVehicle.destroyed = false;
  for (const w of G.playerVehicle.wheelRefs) {
    if (w) w.visible = true;
  }

  // Reset body pitch/roll so car sits level (stale from last physics frame)
  // Also reset wheel steering + spin rotations
  const resetVehicleRotations = (v: { bodyGroupRef: THREE.Group; group: THREE.Group; wheelRefs: (THREE.Mesh | null)[] }) => {
    v.bodyGroupRef.rotation.set(0, 0, 0);
    v.group.rotation.set(0, 0, 0, 'YXZ');
    for (const w of v.wheelRefs) {
      if (!w) continue;
      w.rotation.set(0, 0, 0); // clear steering angle
      if (w.children[0]) w.children[0].rotation.set(0, 0, 0); // clear wheel spin
    }
  };
  resetVehicleRotations(G.playerVehicle);
  for (const ai of G.aiRacers) resetVehicleRotations(ai.vehicle);

  // Build mesh map for replay (player + AI vehicles)
  const meshes = new Map<string, THREE.Group>();
  meshes.set('local', G.playerVehicle.group);
  for (const ai of G.aiRacers) meshes.set(ai.id, ai.vehicle.group);

  // Full explosion callback for replay — triggers complete destruction animation
  const onExplosion = (pos: THREE.Vector3, vehicleId: string) => {
    // Find the vehicle that exploded
    const isLocal = vehicleId === 'local';
    const vehicle = isLocal ? G.playerVehicle : G.aiRacers.find(a => a.id === vehicleId)?.vehicle;
    if (vehicle) {
      triggerVehicleDestruction(
        vehicle.bodyGroupRef,
        vehicle.group,
        getScene(),
        0, 0, // no velocity in replay
        vehicle.wheelRefs,
        vehicle.cachedFragments,
      );
    } else {
      // Fallback: just spawn particles if we can't find the vehicle
      spawnGPUExplosion(pos, 40);
    }
  };

  // Loop cleanup — restore car state when replay loops back to start
  const onLoop = () => {
    cleanupDestruction();
    G.playerVehicle!.bodyGroupRef.visible = true;
    G.playerVehicle!.destroyed = false;
    for (const w of G.playerVehicle!.wheelRefs) {
      if (w) w.visible = true;
    }
    resetVehicleRotations(G.playerVehicle!);
    for (const ai of G.aiRacers) {
      ai.vehicle.bodyGroupRef.visible = true;
      ai.vehicle.destroyed = false;
      for (const w of ai.vehicle.wheelRefs) {
        if (w) w.visible = true;
      }
      resetVehicleRotations(ai.vehicle);
    }
  };

  G.replayPlayer = new ReplayPlayer(G.replayRecorder, camera, meshes, onExplosion, onLoop);
  G.replayPlayer.start();
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
  if (G.replayPlayer) {
    G.replayPlayer.stop();
    G.replayPlayer = null;
  }
  const hud = document.getElementById('replay-hud');
  if (hud) hud.remove();
  showResults();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LEADERBOARD HUD (in-race)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


function updateLeaderboard() {
  if (!G.raceEngine) return;
  const now = performance.now();
  if (now - G.lbLastUpdate < LB_UPDATE_INTERVAL) return;
  G.lbLastUpdate = now;

  if (!G.lbEl) {
    G.lbEl = document.createElement('div');
    G.lbEl.className = 'leaderboard';
    G.lbEl.id = 'leaderboard';
    uiOverlay.appendChild(G.lbEl);
  }

  const rankings = G.raceEngine.getRankings();
  G.lbEl.innerHTML = rankings.map((r, i) => {
    const name = r.id === 'local' ? 'YOU' : resolvePlayerName(r.id);
    const isSelf = r.id === 'local';
    let rttDot = '';
    if (G.netPeer && !isSelf && !r.id.startsWith('ai_')) {
      const peerRtt = G.netPeer.getPeerRtt(r.id);
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
  if (G.netPeer) {
    const rtt = G.netPeer.getRtt();
    const color = rtt < 80 ? '#4caf50' : rtt < 150 ? '#ffcc00' : '#ff4444';
    G.lbEl.innerHTML += `<div style="text-align:right;font-size:11px;color:${color};margin-top:4px;">${rtt}ms</div>`;
  }
}

function destroyLeaderboard() {
  if (G.lbEl) { G.lbEl.remove(); G.lbEl = null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIXED-TIMESTEP PHYSICS (120Hz)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** One deterministic physics sub-step at fixed dt. Contains all gameplay simulation. */
function stepPhysics(dt: number, s: GameState) {
  if (!G.playerVehicle || !G.trackData) return;

  // ── Countdown: zero-input physics so cars settle on road surface ──
  if (s === GameState.COUNTDOWN) {
    const neutralInput = { up: false, down: false, left: false, right: false, boost: false, steerAnalog: 0 };
    G.playerVehicle.update(dt, neutralInput, G.trackData.spline, G.trackData.bvh);
    for (const ai of G.aiRacers) {
      ai.vehicle.update(dt, neutralInput, G.trackData.spline, G.trackData.bvh);
    }
    return;
  }

  if (s !== GameState.RACING) return;

  // ── Player vehicle physics ──
  if (G.vehicleCamera?.mode === 'chase') {
    const wp = getWeatherPhysics();
    G.playerVehicle.update(dt, getInput(), G.trackData.spline, G.trackData.bvh, wp);
  }

  // ── AI vehicle physics ──
  const playerT = getClosestSplinePoint(G.trackData.spline, G.playerVehicle.group.position, G.trackData.bvh).t;
  const allOpponents: OpponentInfo[] = [
    { position: G.playerVehicle.group.position, t: playerT, id: 'local' },
  ];
  for (const ai of G.aiRacers) {
    allOpponents.push({ position: ai.vehicle.group.position, t: ai.getCurrentT(), id: ai.id });
  }

  for (const ai of G.aiRacers) {
    const opponents = allOpponents.filter(o => o.id !== ai.id);
    const wp = getWeatherPhysics();
    ai.update(dt, opponents, wp);
  }

  // ── Car-to-car collision (BVH broadphase + push-apart) ──
  const colliders: CarCollider[] = [];
  const velocities: { velX: number; velZ: number }[] = [];

  colliders.push({
    id: 'local',
    position: G.playerVehicle.group.position,
    halfExtents: G.carHalf,
    heading: G.playerVehicle.heading,
  });
  velocities.push(G.playerVehicle);

  for (const ai of G.aiRacers) {
    colliders.push({
      id: ai.id,
      position: ai.vehicle.group.position,
      halfExtents: G.carHalf,
      heading: ai.vehicle.heading,
    });
    velocities.push(ai.vehicle);
  }

  for (const [id, mesh] of G.remoteMeshes) {
    colliders.push({
      id,
      position: mesh.position,
      halfExtents: G.carHalf,
      heading: mesh.rotation.y,
    });
    velocities.push({ velX: 0, velZ: 0 });
  }

  const collisionEvents = resolveCarCollisions(colliders, velocities);

  for (const evt of collisionEvents) {
    if (evt.idA === 'local' && G.playerVehicle) {
      G._impactDir.set(evt.normalX, 0, evt.normalZ);
      G.playerVehicle.applyDamage(G._impactDir, evt.impactForce);
      G.raceStats.collisionCount++;
      G.vehicleCamera?.shake(Math.min(evt.impactForce / 40, 1));
      flashDamage(evt.impactForce / 40);
      setImpactIntensity(evt.impactForce / 40);
    }
    if (evt.idB === 'local' && G.playerVehicle) {
      G._impactDir.set(-evt.normalX, 0, -evt.normalZ);
      G.playerVehicle.applyDamage(G._impactDir, evt.impactForce);
      G.raceStats.collisionCount++;
      G.vehicleCamera?.shake(Math.min(evt.impactForce / 40, 1));
      flashDamage(evt.impactForce / 40);
      setImpactIntensity(evt.impactForce / 40);
    }
    for (const ai of G.aiRacers) {
      if (evt.idA === ai.id) {
        G._impactDir.set(evt.normalX, 0, evt.normalZ);
        ai.vehicle.applyDamage(G._impactDir, evt.impactForce);
      }
      if (evt.idB === ai.id) {
        G._impactDir.set(-evt.normalX, 0, -evt.normalZ);
        ai.vehicle.applyDamage(G._impactDir, evt.impactForce);
      }
    }

    if (evt.impactForce > 5) {
      const cA = colliders.find(c => c.id === evt.idA)!;
      const cB = colliders.find(c => c.id === evt.idB)!;
      G._sparkPos.set(
        (cA.position.x + cB.position.x) / 2,
        (cA.position.y + cB.position.y) / 2 + 0.5,
        (cA.position.z + cB.position.z) / 2,
      );
      spawnGPUSparks(G._sparkPos, evt.impactForce);
      if (evt.impactForce > 20) spawnGPUExplosion(G._sparkPos, evt.impactForce);
      playCollisionSFX(Math.min(evt.impactForce / 30, 1));
    }
  }

  // ── Barrier collision effects ──
  // Player barrier hit
  if (G.playerVehicle?.lastBarrierImpact) {
    const b = G.playerVehicle.lastBarrierImpact;
    G._sparkPos.set(b.posX, b.posY, b.posZ);
    spawnGPUSparks(G._sparkPos, b.force);
    if (b.force > 20) spawnGPUExplosion(G._sparkPos, b.force);
    G.vehicleCamera?.shake(Math.min(b.force / 30, 0.8));
    flashDamage(b.force / 25);
    setImpactIntensity(b.force / 25);
    triggerImpactFlash(b.force / 30);
    G._impactDir.set(b.normalX, 0, b.normalZ);
    G.playerVehicle.applyDamage(G._impactDir, b.force * 0.7);
    G.raceStats.collisionCount++;
    playCollisionSFX(Math.min(b.force / 25, 1));

    // Glass shard burst: trigger when any zone drops below 40% HP for the first time
    const zones: Array<'front' | 'rear' | 'left' | 'right'> = ['front', 'rear', 'left', 'right'];
    for (const zone of zones) {
      const z = G.playerVehicle.damage[zone];
      if (z.hp < 40 && !z.glassBroken) {
        z.glassBroken = true;
        G._sparkPos.set(b.posX, b.posY, b.posZ);
        spawnGPUGlassShards(G._sparkPos);
      }
    }
  }
  // AI barrier hits (sparks only, no camera shake)
  for (const ai of G.aiRacers) {
    if (ai.vehicle.lastBarrierImpact) {
      const b = ai.vehicle.lastBarrierImpact;
      G._sparkPos.set(b.posX, b.posY, b.posZ);
      spawnGPUSparks(G._sparkPos, b.force * 0.5);
    }
  }

  // Engine smoke via GPU particles (continuous when front damaged)
  if (G.playerVehicle && G.playerVehicle.damage.front.hp < 30) {
    const p = G.playerVehicle.group.position;
    const sinH = Math.sin(G.playerVehicle.heading);
    const cosH = Math.cos(G.playerVehicle.heading);
    G._sparkPos.set(p.x + sinH * 1.5, p.y + 1.0, p.z + cosH * 1.5);
    spawnGPUDamageSmoke(G._sparkPos, 1 - G.playerVehicle.damage.front.hp / 30, dt);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN GAME LOOP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function gameLoop(timestamp: number) {
  requestAnimationFrame(gameLoop);

  const frameDt = Math.min((timestamp - G.lastTime) / 1000, MAX_FRAME_DT);
  G.lastTime = timestamp;

  const s = G.gameState;

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
  if (G.replayPlayer) {
    if (G.replayPlayer.isPlaying()) {
      G.replayPlayer.update(frameDt);
      // Animate destruction fragments during replay (gravity, flying, fade)
      updateDestructionFragments(frameDt);
      const bar = document.getElementById('replay-bar');
      if (bar) bar.style.width = `${Math.round(G.replayPlayer.getProgress() * 100)}%`;
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
    if (!G.playerVehicle || !G.trackData) {
      renderer.render(scene, camera);
      return;
    }

    // ── FIXED-TIMESTEP PHYSICS ──
    // Accumulate frame time, then step physics at a deterministic rate.
    // Leftover accumulator fraction (`alpha`) is used to interpolate visuals.
    G.physicsAccumulator += frameDt;

    // Run deterministic physics sub-steps
    let physicsStepsThisFrame = 0;
    while (G.physicsAccumulator >= PHYSICS_DT && physicsStepsThisFrame < 4) {
      // Save pre-physics state for rendering interpolation
      if (G.playerVehicle) G.playerVehicle.saveSnapshot();
      for (const ai of G.aiRacers) ai.vehicle.saveSnapshot();

      // ── Rollback: record local input + snapshot before this step ──
      const currentInput = s === GameState.RACING ? getInput() : { up: false, down: false, left: false, right: false, boost: false, steerAnalog: 0 };
      if (G.playerVehicle) {
        rollbackManager.recordLocalFrame(currentInput, G.playerVehicle.serializeState());
      }

      // Broadcast input to remote peers (multiplayer only)
      if (G.netPeer && s === GameState.RACING) {
        const packed = packInput(currentInput);
        G.netPeer.broadcastInput(rollbackManager.frame, packed.bits, packed.steerI16);
      }

      stepPhysics(PHYSICS_DT, s);
      rollbackManager.advanceFrame();
      G.physicsAccumulator -= PHYSICS_DT;
      physicsStepsThisFrame++;
    }

    // Clamp leftover to prevent runaway accumulation (spiral of death)
    if (G.physicsAccumulator > PHYSICS_DT) G.physicsAccumulator = PHYSICS_DT;

    // Interpolate vehicle visuals between prev and curr physics state
    const alpha = G.physicsAccumulator / PHYSICS_DT;
    G.playerVehicle.lerpToRender(alpha);
    for (const ai of G.aiRacers) ai.vehicle.lerpToRender(alpha);

    // Update AI name tags to follow car positions
    for (const ai of G.aiRacers) {
      const tag = (ai as any)._nameTag as THREE.Sprite | undefined;
      if (tag) updateNameTag(tag, ai.vehicle.group.position);
    }

    // ── RENDERING-RATE CODE (runs once per frame, using interpolated positions) ──

    // Slipstream detection (visual-rate, using interpolated positions)
    if (s === GameState.RACING && G.vehicleCamera?.mode === 'chase') {
      const pp = G.playerVehicle.group.position;
      const pH = G.playerVehicle.heading;
      for (const ai of G.aiRacers) {
        const aPos = ai.vehicle.group.position;
        const dx = aPos.x - pp.x;
        const dz = aPos.z - pp.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 15 && dist > 2) {
          const toAiAngle = Math.atan2(dx, dz);
          let angleDiff = Math.abs(toAiAngle - pH);
          if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
          if (angleDiff < 0.52) {
            const draftStrength = (1 - dist / 15) * 20;
            G.playerVehicle.addNitro(draftStrength * frameDt);
            // Slipstream air-streak particles from AI car's rear
            spawnGPUSlipstream(aPos, ai.vehicle.heading, G.playerVehicle.speed);
          }
        }
      }


      updateNitroHUD(G.playerVehicle.nitro, G.playerVehicle.isNitroActive);
      updateHeatHUD(G.playerVehicle.engineHeat, G.playerVehicle.engineDead);

      // Record replay frames BEFORE explosion flag is consumed/cleared
      if (G.replayRecorder) {
        const pv = G.playerVehicle;
        G.replayRecorder.record('local', pv.group.position, pv.heading, pv.speed,
          pv.isNitroActive, pv.engineHeat, pv.engineDead, pv.engineJustExploded);
        for (const ai of G.aiRacers) {
          G.replayRecorder.record(ai.id, ai.vehicle.group.position, ai.vehicle.heading, ai.vehicle.speed);
        }
      }

      // ── Engine overheat explosion VFX (at front hood) ──
      if (G.playerVehicle.engineJustExploded) {
        const sinH = Math.sin(G.playerVehicle.heading);
        const cosH = Math.cos(G.playerVehicle.heading);
        const hoodExplosion = G.playerVehicle.group.position.clone();
        hoodExplosion.y += 1.0;
        hoodExplosion.x += sinH * 2.2; // front hood
        hoodExplosion.z += cosH * 2.2;
        spawnGPUExplosion(hoodExplosion, 40);
        spawnDebris(hoodExplosion, 35, G.playerVehicle.velX, G.playerVehicle.velZ);
        spawnGPUGlassShards(hoodExplosion);
        flashDamage(0.9);
        setImpactIntensity(1.0);

        // Engine explosion ends the race — DNF + cinematic orbit + destruction
        if (G.raceEngine && s === GameState.RACING) {
          G.raceEngine.markDnf('local');
          // Trigger vehicle destruction animation
          triggerVehicleDestruction(
            G.playerVehicle.bodyGroupRef,
            G.playerVehicle.group,
            getScene(),
            G.playerVehicle.velX,
            G.playerVehicle.velZ,
            G.playerVehicle.wheelRefs,
            G.playerVehicle.cachedFragments,
          );
          G.playerVehicle.destroyed = true;
          // Screen effects: flash + letterbox + post-FX
          showExplosionFlash();
          showLetterbox();
          setExplosionMode(true);
          // Cinematic explosion orbit camera
          if (G.vehicleCamera) {
            G.vehicleCamera.startExplosionOrbit(hoodExplosion);
          }
          // Delayed text overlay and results
          setTimeout(() => showEngineDestroyedText(), 800);
          setTimeout(() => { hideLetterbox(); setExplosionMode(false); }, 3500);
          setTimeout(() => showResults(), 4000);
        }
      }

      // Clear single-frame flag AFTER VFX code consumed it
      if (G.playerVehicle.engineJustExploded) {
        G.playerVehicle.clearExplosionFlag();
      }

      // ── Hood smoke/flames at high engine heat (front hood position) ──
      const heat = G.playerVehicle.engineHeat;
      if (heat > 60) {
        const sinH = Math.sin(G.playerVehicle.heading);
        const cosH = Math.cos(G.playerVehicle.heading);
        const hoodPos = G.playerVehicle.group.position.clone();
        hoodPos.y += 1.0;
        hoodPos.x += sinH * 2.2; // front hood
        hoodPos.z += cosH * 2.2;
        const smokeIntensity = (heat - 60) / 40; // 0 at 60, 1 at 100
        if (heat > 90) {
          spawnGPUFlame(hoodPos, smokeIntensity, frameDt);
        }
        spawnGPUDamageSmoke(hoodPos, smokeIntensity * 0.8, frameDt);
      }
    }

    // Update AI race progress (rendering-rate is fine for rankings)
    if (s === GameState.RACING) {
      for (const ai of G.aiRacers) {
        G.raceEngine?.updateRacer(ai.id, ai.vehicle.group.position, ai.getCurrentT(), ai.vehicle.heading);
      }
    }

    // Spectator orbit camera (during RESULTS)
    if (s === GameState.RESULTS && G.vehicleCamera?.mode === 'orbit') {
      G.vehicleCamera.updateOrbit(frameDt);
    }

    // Explosion orbit cinematic (during RACING after DNF or RESULTS)
    if (G.vehicleCamera?.mode === 'explosion-orbit') {
      G.vehicleCamera.updateExplosionOrbit(frameDt);
    }

    // Update vehicle destruction fragments
    updateDestructionFragments(frameDt);

    // Camera
    if (G.vehicleCamera && G.vehicleCamera.mode !== 'orbit' && G.vehicleCamera.mode !== 'explosion-orbit') {
      let camTarget = G.playerVehicle.group.position;
      let camHeading = G.playerVehicle.heading;
      let camSpeed = G.playerVehicle.speed;
      let camMaxSpeed = G.selectedCar.maxSpeed;

      if (G.vehicleCamera.mode === 'follow' && G.spectateTargetId) {
        const targetMesh = G.remoteMeshes.get(G.spectateTargetId);
        const aiTarget = G.aiRacers.find(a => a.id === G.spectateTargetId);
        if (targetMesh) {
          camTarget = targetMesh.position;
          camHeading = targetMesh.rotation.y;
          const snap = G.netPeer?.getInterpolatedState(G.spectateTargetId);
          camSpeed = snap?.speed ?? 30;
          camMaxSpeed = 70;
        } else if (aiTarget) {
          camTarget = aiTarget.vehicle.group.position;
          camHeading = aiTarget.vehicle.heading;
          camSpeed = aiTarget.vehicle.speed;
          camMaxSpeed = aiTarget.vehicle.def.maxSpeed;
        }
      }

      G.vehicleCamera.update(camTarget, camHeading, camSpeed, camMaxSpeed, G.playerVehicle.driftAngle);
    }

    // VFX
    const driftAbs = Math.abs(G.playerVehicle.driftAngle);
    if (driftAbs > 0.15 && s === GameState.RACING) {
      spawnTireSmoke(G.playerVehicle.group.position, driftAbs, G.playerVehicle.isNitroActive);
    }
    if (s === GameState.RACING) {
      updateSkidGlowTime();
      updateSkidMarks(G.playerVehicle.group.position, G.playerVehicle.heading, driftAbs, G.playerVehicle.group.position.y);
      // Ghost car: sample position + update playback
      sampleGhostFrame(G.playerVehicle.group.position, G.playerVehicle.heading);
      updateGhostPlayback();
    }
    updateVFX(frameDt);

    // ── Per-frame damage zone smoke (player car) ──
    if (s === GameState.RACING && G.playerVehicle) {
      const pp = G.playerVehicle.group.position;
      const sinH = Math.sin(G.playerVehicle.heading);
      const cosH = Math.cos(G.playerVehicle.heading);
      const zones: Array<{ zone: 'front' | 'rear' | 'left' | 'right'; ox: number; oz: number }> = [
        { zone: 'front', ox: 0, oz: -2.2 },
        { zone: 'rear', ox: 0, oz: 2.0 },
        { zone: 'left', ox: -1.0, oz: 0 },
        { zone: 'right', ox: 1.0, oz: 0 },
      ];
      for (const z of zones) {
        const dmg = G.playerVehicle.damage[z.zone];
        const severity = 1 - dmg.hp / 100;
        if (severity > 0.7) {
          G._sparkPos.set(
            pp.x + cosH * z.ox + sinH * z.oz,
            pp.y + 0.6,
            pp.z - sinH * z.ox + cosH * z.oz,
          );
          spawnDamageZoneSmoke(G._sparkPos, severity, frameDt);
        }
      }



      // ── Tire blowout (side zone destruction) ──
      const leftHP = G.playerVehicle.damage.left.hp;
      const rightHP = G.playerVehicle.damage.right.hp;

      if (leftHP <= 0 && !G._leftTireBlown) {
        G._leftTireBlown = true;
        G._sparkPos.set(
          pp.x + cosH * (-1.0),
          pp.y + 0.2,
          pp.z - sinH * (-1.0),
        );
        spawnGPUExplosion(G._sparkPos, 25);
        G.playerVehicle.flattenTire('left');
      }
      if (rightHP <= 0 && !G._rightTireBlown) {
        G._rightTireBlown = true;
        G._sparkPos.set(
          pp.x + cosH * 1.0,
          pp.y + 0.2,
          pp.z - sinH * 1.0,
        );
        spawnGPUExplosion(G._sparkPos, 25);
        G.playerVehicle.flattenTire('right');
      }
    }
    updateGPUParticles(renderer, frameDt);
    updateWeather(frameDt, G.playerVehicle.group.position);

    // Rain screen droplets (intensity from weather type)
    const weatherType = getCurrentWeather();
    const rainIntensity = weatherType === 'heavy_rain' ? 0.5 : weatherType === 'light_rain' ? 0.25 : 0;
    updateRainDroplets(rainIntensity, frameDt);

    // Impact flash decay
    updateImpactFlash(frameDt);

    // Neon underglow pulse (nitrous-synced)
    if (G._playerUnderglow) {
      updateUnderglow(G._playerUnderglow, G.playerVehicle.speed, timestamp / 1000, G.playerVehicle.isNitroActive);
    }
    updateBoostFlame(s === GameState.RACING && G.playerVehicle.isNitroActive, G.playerVehicle.group.position, G.playerVehicle.heading, timestamp / 1000, G.playerVehicle.engineHeat);

    // Nitrous activation shockwave (rising edge detection)
    const isNitroNow = s === GameState.RACING && G.playerVehicle.isNitroActive;
    if (isNitroNow && !G._wasNitroActive) {
      triggerBoostShockwave(G.playerVehicle.group.position, G.playerVehicle.heading);
      triggerBoostBurst();
    }
    // Backfire pops on nitro release (falling edge)
    if (!isNitroNow && G._wasNitroActive) {
      triggerBackfireSequence(G.playerVehicle.group.position, G.playerVehicle.heading);
    }
    G._wasNitroActive = isNitroNow;
    updateBoostShockwave(frameDt);

    // FOV punch during nitrous (smooth ramp)
    const baseFOV = 75;
    const targetFOV = isNitroNow ? baseFOV + 8 : baseFOV;
    camera.fov += (targetFOV - camera.fov) * (1 - Math.exp(-(isNitroNow ? 12 : 5) * frameDt));
    camera.updateProjectionMatrix();

    // Camera micro-shake during nitro burn (Perlin-noise sinusoids)
    if (isNitroNow) {
      const t = timestamp / 1000;
      camera.position.x += Math.sin(t * 47) * 0.012 + Math.sin(t * 73) * 0.008;
      camera.position.y += Math.sin(t * 53) * 0.006;
    }
    // Heavy shake on engine explosion (decaying)
    if (G.playerVehicle.engineDead) {
      const shakeDecay = G.playerVehicle.engineJustExploded ? 0.15 : 0.03;
      const t = timestamp / 1000;
      camera.position.x += Math.sin(t * 90) * shakeDecay;
      camera.position.y += Math.sin(t * 110) * shakeDecay * 0.7;
    }

    // Nitro exhaust trail (fire particles during boost — doubled density for richness)
    if (s === GameState.RACING && G.playerVehicle.isNitroActive) {
      spawnGPUNitroTrail(G.playerVehicle.group.position, G.playerVehicle.heading, G.playerVehicle.speed);
      // Second trail call with slight lateral offset for width
      const cosH2 = Math.cos(G.playerVehicle.heading);
      const offsetPos = G.playerVehicle.group.position.clone();
      offsetPos.x += cosH2 * 0.15;
      spawnGPUNitroTrail(offsetPos, G.playerVehicle.heading, G.playerVehicle.speed);
    }

    // Continuous rim sparks on blown tires
    if (G._leftTireBlown && Math.abs(G.playerVehicle.speed) > 3) {
      const cosH = Math.cos(G.playerVehicle.heading);
      const sinH = Math.sin(G.playerVehicle.heading);
      const pos = G.playerVehicle.group.position;
      G._sparkPos.set(
        pos.x + cosH * (-1.0),
        pos.y + 0.1,
        pos.z - sinH * (-1.0),
      );
      spawnGPURimSparks(G._sparkPos, G.playerVehicle.speed);
    }
    if (G._rightTireBlown && Math.abs(G.playerVehicle.speed) > 3) {
      const cosH = Math.cos(G.playerVehicle.heading);
      const sinH = Math.sin(G.playerVehicle.heading);
      const pos = G.playerVehicle.group.position;
      G._sparkPos.set(
        pos.x + cosH * 1.0,
        pos.y + 0.1,
        pos.z - sinH * 1.0,
      );
      spawnGPURimSparks(G._sparkPos, G.playerVehicle.speed);
    }

    // Exhaust backfire on deceleration
    const currentSpeedRatio = Math.abs(G.playerVehicle.speed) / G.selectedCar.maxSpeed;
    if (G._prevSpeedRatio - currentSpeedRatio > 0.15 && Math.abs(G.playerVehicle.speed) > 15) {
      spawnGPUBackfire(G.playerVehicle.group.position, G.playerVehicle.heading);
    }
    G._prevSpeedRatio = currentSpeedRatio;

    // Brake disc glow — DISABLED
    // if (G._playerBrakeDiscs) {
    //   updateBrakeDiscs(G._playerBrakeDiscs, G.playerVehicle.brake, G.playerVehicle.speed, frameDt, G.selectedCar.maxSpeed, G.playerVehicle.group.position);
    // }

    // Shoulder dust (near barriers = near road edge)
    if (G.playerVehicle.lastBarrierImpact && Math.abs(G.playerVehicle.speed) > 8) {
      spawnGPUShoulderDust(G.playerVehicle.group.position, G.playerVehicle.speed, G.playerVehicle.heading);
    }

    // Heat shimmer (canvas wavering — nitro-aware, heat-responsive)
    const speedR = Math.abs(G.playerVehicle.speed) / G.selectedCar.maxSpeed;
    updateHeatShimmer(speedR, isNitroNow, G.playerVehicle.engineHeat);

    // Track radar minimap
    if (G.playerVehicle) {
      const aiDots = G.aiRacers.map(a => ({ pos: a.vehicle.group.position, id: a.id }));
      updateTrackRadar(G.playerVehicle.group.position, G.playerVehicle.heading, aiDots);

      // Checkpoint gate highlight (pulse next, dim passed)
      if (G.checkpointMarkers) {
        const localProgress = G.raceEngine?.getProgress('local');
        const nextCp = localProgress ? localProgress.checkpointIndex : 0;
        updateCheckpointHighlight(G.checkpointMarkers, nextCp, timestamp / 1000);
      }
    }

    // Lens flare sprites (distance fade from camera)
    updateLensFlares(camera.position, timestamp / 1000);

    // Lightning flashes (storm weather)
    updateLightning(frameDt);

    // Near-miss detection (within 3 units of any AI, 1s cooldown per AI)
    // Awards nitro, increments stats, and triggers directional streak VFX
    if (s === GameState.RACING && Math.abs(G.playerVehicle.speed) > 15) {
      const pPos = G.playerVehicle.group.position;
      const now = timestamp / 1000;
      for (const ai of G.aiRacers) {
        const aPos = ai.vehicle.group.position;
        const dx = pPos.x - aPos.x;
        const dz = pPos.z - aPos.z;
        const dist2 = dx * dx + dz * dz;
        if (dist2 < 3.5 * 3.5 && dist2 > 1.5 * 1.5) {
          const lastMiss = G._nearMissCooldowns?.get(ai.id) ?? 0;
          if (now - lastMiss > 1.0) {
            if (!G._nearMissCooldowns) G._nearMissCooldowns = new Map();
            G._nearMissCooldowns.set(ai.id, now);
            // Directional streak VFX
            const cosH = Math.cos(G.playerVehicle.heading);
            const sinH = Math.sin(G.playerVehicle.heading);
            const cross = dx * cosH - dz * sinH;
            triggerNearMiss(cross > 0 ? 'right' : 'left');
            triggerNearMissWhoosh(cross > 0 ? 'right' : 'left', camera.position, G.playerVehicle.heading);
            // Nitro reward + stat tracking
            G.playerVehicle.addNitro(5);
            G.raceStats.nearMissCount = (G.raceStats.nearMissCount ?? 0) + 1;
          }
        }
      }
    }
    updateNearMissStreaks(frameDt);
    updateNearMissWhoosh(frameDt, camera.position, G.playerVehicle.heading);

    // Victory confetti physics
    updateVictoryConfetti(frameDt);

    const speedRatioForLines = Math.abs(G.playerVehicle.speed) / G.selectedCar.maxSpeed;
    const nitroForLines = G.playerVehicle.isNitroActive;
    if (speedRatioForLines > 0.3 || nitroForLines) updateSpeedLines(speedRatioForLines, nitroForLines);

    // ── Accumulate race stats ──
    if (s === GameState.RACING) {
      const speedMph = Math.abs(G.playerVehicle.speed) * 2.5;
      if (speedMph > G.raceStats.topSpeed) G.raceStats.topSpeed = speedMph;
      if (driftAbs > 0.15) G.raceStats.totalDriftTime += frameDt;
    }

    // Audio
    updateEngineAudio(G.playerVehicle.speed, G.selectedCar.maxSpeed);
    G.driftSfxCooldown -= frameDt;
    if (s === GameState.RACING && driftAbs > 0.3 && G.driftSfxCooldown <= 0) {
      playDriftSFX(driftAbs);
      G.driftSfxCooldown = 0.12;
    }

    // Damage smoke + flames (emit when zones are heavily damaged)
    if (s === GameState.RACING && G.playerVehicle) {
      const dmg = G.playerVehicle.damage;
      const worstHp = Math.min(dmg.front.hp, dmg.rear.hp, dmg.left.hp, dmg.right.hp);
      if (worstHp < 50) spawnDamageSmoke(G.playerVehicle.group.position, 1 - worstHp / 50, frameDt);

      // Per-zone flames for critically damaged areas
      const sinH = Math.sin(G.playerVehicle.heading);
      const cosH = Math.cos(G.playerVehicle.heading);
      const pp = G.playerVehicle.group.position;
      const zoneOffsets: [string, number, number, number][] = [
        ['front', 0, 1.0, -2.0],
        ['rear', 0, 0.8, 1.8],
        ['left', -1.0, 0.7, 0],
        ['right', 1.0, 0.7, 0],
      ];
      for (const [zone, lx, ly, lz] of zoneOffsets) {
        const hp = dmg[zone as keyof typeof dmg].hp;
        if (hp < 20) {
          G._flamePos.set(
            pp.x + cosH * lx + sinH * lz,
            pp.y + ly,
            pp.z - sinH * lx + cosH * lz,
          );
          spawnFlameParticle(G._flamePos, 1 - hp / 20, frameDt);
        }
      }

      // Check for newly detached parts
      for (const zone of ['front', 'rear', 'left', 'right'] as const) {
        if (G.playerVehicle.detachedZones.has(zone) && !G.detachedParts.some(dp => (dp as any).zone === zone && (dp as any).owner === 'local')) {
          const partMesh = G.playerVehicle.createDetachedPart(zone);
          if (partMesh) {
            scene.add(partMesh);
            G.detachedParts.push({
              mesh: partMesh,
              vx: G.playerVehicle.velX + (Math.random() - 0.5) * 8,
              vy: 3 + Math.random() * 5,
              vz: G.playerVehicle.velZ + (Math.random() - 0.5) * 8,
              ax: (Math.random() - 0.5) * 10,
              ay: (Math.random() - 0.5) * 10,
              az: (Math.random() - 0.5) * 10,
              life: 4.0,
            });
            // Spawn explosion at detach point
            spawnGPUExplosion(partMesh.position, 30);
          }
        }
      }
    }

    // Update detached parts physics
    for (let i = G.detachedParts.length - 1; i >= 0; i--) {
      const dp = G.detachedParts[i];
      dp.life -= frameDt;
      if (dp.life <= 0 || dp.mesh.position.y < -10) {
        scene.remove(dp.mesh);
        dp.mesh.geometry?.dispose();
        (dp.mesh.material as THREE.Material)?.dispose();
        G.detachedParts[i] = G.detachedParts[G.detachedParts.length - 1];
        G.detachedParts.pop();
        continue;
      }
      dp.mesh.position.x += dp.vx * frameDt;
      dp.mesh.position.y += dp.vy * frameDt;
      dp.mesh.position.z += dp.vz * frameDt;
      dp.vy -= 15 * frameDt; // gravity
      dp.mesh.rotation.x += dp.ax * frameDt;
      dp.mesh.rotation.y += dp.ay * frameDt;
      dp.mesh.rotation.z += dp.az * frameDt;

      // Ground bounce
      if (dp.mesh.position.y < 0.1) {
        dp.mesh.position.y = 0.1;
        dp.vy = Math.abs(dp.vy) * 0.3;
        dp.vx *= 0.6;
        dp.vz *= 0.6;
        dp.ax *= 0.4;
        dp.ay *= 0.4;
        dp.az *= 0.4;
      }

      // Fade out in last 1.5s
      if (dp.life < 1.5) {
        const mat = dp.mesh.material as THREE.MeshStandardMaterial;
        if (mat.transparent !== undefined) {
          mat.transparent = true;
          mat.opacity = dp.life / 1.5;
        }
      }
    }

    // Checkpoint detection (local player)
    if (s === GameState.RACING && G.raceEngine) {
      const localT = getClosestSplinePoint(G.trackData.spline, G.playerVehicle.group.position, G.trackData.bvh).t;
      const event = G.raceEngine.updateRacer('local', G.playerVehicle.group.position, localT, G.playerVehicle.heading);
      const progress = G.raceEngine.getProgress('local');

      if (event === 'checkpoint') {
        bus.emit('checkpoint', {
          racerId: 'local',
          index: progress?.checkpointIndex ?? 0,
          lap: progress?.lapIndex ?? 0,
        });
      } else if (event === 'lap') {
        const lastLapTime = progress?.lapTimes[progress.lapTimes.length - 1] ?? 0;
        const bestLap = G.raceEngine.getBestLap('local');
        // Finalize ghost recording for this lap
        finalizeGhostLap(lastLapTime, G.currentRaceSeed, G.selectedCar?.id ?? '');
        // Start recording the next lap
        startGhostRecording(G.playerVehicle.group.position, G.playerVehicle.heading);
        bus.emit('lap', {
          racerId: 'local',
          lapIndex: progress?.lapIndex ?? 0,
          lapTime: lastLapTime,
          isBest: bestLap !== null && lastLapTime <= bestLap,
        });
      } else if (event === 'finish') {
        const finishTime = G.raceEngine.getProgress('local')?.finishTime ?? 0;
        bus.emit('finish', { racerId: 'local', finishTime });
      }

      // HUD update
      const rankings = G.raceEngine.getRankings();
      const myRank = rankings.findIndex(r => r.id === 'local') + 1;

      // Track average position
      if (myRank > 0) {
        G.raceStats.avgPosition += myRank;
        G.raceStats.positionSampleCount++;
      }


      // Position change callout
      if (G.prevMyRank > 0 && myRank !== G.prevMyRank && myRank > 0) {
        const gained = myRank < G.prevMyRank;
        bus.emit('position_change', {
          racerId: 'local', oldRank: G.prevMyRank, newRank: myRank, gained,
        });
      }
      G.prevMyRank = myRank;
      const wrongWay = G.raceEngine.isWrongWay(
        G.playerVehicle.heading,
        G.trackData.checkpoints[progress?.checkpointIndex ?? 0]?.tangent ?? G._defaultTangent,
      );

      updateHUD(
        G.playerVehicle.speed,
        progress?.lapIndex ?? 0,
        G.totalLaps,
        myRank,
        rankings.length,
        wrongWay,
        G.raceEngine.getElapsedTime() * 1000,
        G.playerVehicle.isNitroActive,
      );

      // Minimap (per-player colors)
      const PEER_COLORS = ['#ff6600', '#e040fb', '#ffcc00', '#76ff03', '#ff1744', '#00bcd4'];
      const minimapDots: { pos: THREE.Vector3; color?: string }[] = [];
      G.aiRacers.forEach(ai => minimapDots.push({ pos: ai.vehicle.group.position, color: '#ff6600' }));
      let peerIdx = 0;
      for (const mesh of G.remoteMeshes.values()) {
        minimapDots.push({ pos: mesh.position, color: PEER_COLORS[peerIdx % PEER_COLORS.length] });
        peerIdx++;
      }
      updateMinimap(G.trackData.spline, G.playerVehicle.group.position, minimapDots);

      // Leaderboard
      updateLeaderboard();

      // Gap timer HUD
      if (G.raceEngine) {
        const gaps = G.raceEngine.getGaps('local');
        updateGapHUD(gaps.ahead, gaps.behind);
      }


      // Damage HUD
      if (G.playerVehicle) updateDamageHUD(G.playerVehicle.damage);
    }

    // Remote vehicle positions
    if (G.netPeer) {
      for (const [id, mesh] of G.remoteMeshes) {
        const snap = G.netPeer.getInterpolatedState(id);
        if (snap) {
          // Raycast against road mesh for accurate surface height
          G._remoteRayOrigin.set(snap.x, mesh.position.y + 15, snap.z);
          G._remoteRaycaster.set(G._remoteRayOrigin, G._remoteRayDir);
          G._remoteRaycaster.far = 30;
          const remoteHits = G._remoteRaycaster.intersectObject(G.trackData!.roadMesh, false);
          if (remoteHits.length > 0) {
            mesh.position.set(snap.x, remoteHits[0].point.y, snap.z);
          } else {
            _rPos.set(snap.x, 0, snap.z);
            const nearest = getClosestSplinePoint(G.trackData!.spline, _rPos, G.trackData!.bvh);
            mesh.position.set(snap.x, nearest.point.y, snap.z);
          }
          mesh.rotation.y = snap.heading;

          // Remote VFX: tire smoke from approximate drift
          if (s === GameState.RACING) {
            const prev = G.remotePrevPos.get(id);
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
            G.remotePrevPos.set(id, { x: snap.x, z: snap.z });

            // Remote damage smoke
            const worstHp = Math.min(
              snap.dmgFront ?? 100, snap.dmgRear ?? 100,
              snap.dmgLeft ?? 100, snap.dmgRight ?? 100,
            );
            if (worstHp < 50) {
              spawnDamageSmoke(mesh.position, 1 - worstHp / 50, frameDt);
            }
          }
        }

        const tag = G.remoteNameTags.get(id);
        if (tag) updateNameTag(tag, mesh.position);
      }
    }

    // Shadow camera follows player for sharper nearby shadows
    if (G.playerVehicle) {
      const dl = getDirLight();
      const pp = G.playerVehicle.group.position;
      dl.position.set(pp.x + 50, 80, pp.z + 30);
      dl.target.position.set(pp.x, pp.y, pp.z);
      dl.target.updateMatrixWorld();
      const dx = pp.x - (G._lastShadowX ?? -999);
      const dz = pp.z - (G._lastShadowZ ?? -999);
      if (dx * dx + dz * dz > 64) { // Only recalculate when player moves > 8 units
        dl.shadow.camera.left = -40;
        dl.shadow.camera.right = 40;
        dl.shadow.camera.top = 40;
        dl.shadow.camera.bottom = -40;
        dl.shadow.camera.updateProjectionMatrix();
        G._lastShadowX = pp.x;
        G._lastShadowZ = pp.z;
      }
    }

    // Debug overlay
    updateDebugOverlay();

    // Main render — post-FX pipeline (bloom + chromatic aberration + vignette)
    if (G.postFXPipeline) {
      // Update post-FX uniforms
      const speedRatio = G.playerVehicle ? Math.abs(G.playerVehicle.speed) / G.playerVehicle.def.maxSpeed : 0;
      const isNitro = G.playerVehicle?.isNitroActive ?? false;
      updatePostFX(Math.min(speedRatio, 1), isNitro);
      if (isNitro) setBoostActive(true);
      G.postFXPipeline.render();
    } else {
      renderer.render(scene, camera);
    }

    // Rear-view mirror render (Scissor Test, perfectly hardware accelerated)
    if (G.mirrorCamera && G.playerVehicle && s === GameState.RACING) {
      const sinH = Math.sin(G.playerVehicle.heading);
      const cosH = Math.cos(G.playerVehicle.heading);
      const pp = G.playerVehicle.group.position;
      G.mirrorCamera.position.set(pp.x, pp.y + 2.5, pp.z);
      G.mirrorCamera.lookAt(pp.x - sinH * 20, pp.y + 1.5, pp.z - cosH * 20);
      
      // Update camera projection to perfectly flip horizontally
      G.mirrorCamera.updateMatrixWorld();
      G.mirrorCamera.updateProjectionMatrix();
      G.mirrorCamera.projectionMatrix.elements[0] *= -1; // Flip X

      // Hide weather particles during mirror render (prevents VFX bleed)
      const precip = getPrecipMesh();
      if (precip) precip.visible = false;

      // Scissor / Viewport
      const w = 320, h = 120;
      const x = Math.floor(window.innerWidth / 2 - w / 2);
      
      // WebGPU viewport Y=0 is TOP. WebGL viewport Y=0 is BOTTOM.
      const isWebGL = !!(renderer as any).isWebGLRenderer;
      const y = isWebGL ? Math.floor(window.innerHeight - h - 14) : 14;

      renderer.setScissorTest(true);
      renderer.setScissor(x, y, w, h);
      renderer.setViewport(x, y, w, h);
      
      const oldAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      
      renderer.render(scene, G.mirrorCamera);
      
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
      renderer.autoClear = oldAutoClear;

      // Restore weather particles
      if (precip) precip.visible = true;
    }

    // ── Dynamic Resolution Scaling ──
    // Monitors rolling FPS average; reduces pixel ratio when dropping below target
    G._drsFrameTimes.push(frameDt);
    if (G._drsFrameTimes.length > 30) G._drsFrameTimes.shift();
    if (G._drsFrameTimes.length === 30) {
      const avgDt = G._drsFrameTimes.reduce((a, b) => a + b, 0) / 30;
      const avgFps = 1 / avgDt;
      const currentPR = renderer.getPixelRatio();
      const basePR = Math.min(window.devicePixelRatio, 2);
      let newPR = currentPR;
      if (avgFps < 45 && currentPR > 0.5) {
        newPR = Math.max(currentPR - 0.15, 0.5);
      } else if (avgFps > 56 && currentPR < basePR) {
        newPR = Math.min(currentPR + 0.05, basePR);
      }
      // Only update if changed — must call setSize after setPixelRatio
      // to properly resize the internal framebuffer (required by WebGPURenderer)
      if (newPR !== currentPR) {
        renderer.setPixelRatio(newPR);
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
    }

    // Restore physics-authoritative positions after rendering
    // so the next frame's physics steps use the real state, not interpolated
    G.playerVehicle.restoreFromRender();
    for (const ai of G.aiRacers) ai.vehicle.restoreFromRender();
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
loadProgress();
if (savedSettings.playerName) G.localPlayerName = savedSettings.playerName;
applySettingsToRenderer();

// Wire multiplayer handler with main orchestrator callbacks
initMultiplayerHandler(uiOverlay, scene, {
  startRace,
  showTitleScreen,
  showResults,
  clearRaceObjects,
  destroyLeaderboard,
  destroySpectateHUD,
  resolvePlayerName,
});

G.lastTime = performance.now();
showTitleScreen();

// ── Event Bus Consumer Registrations ──
// Subscribers are registered once at boot. Producers in the game loop
// just call bus.emit() — consumers react automatically.

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
  spawnConfetti();
  enterSpectatorMode();
  showResults();
});

bus.on('position_change', (e) => {
  showPositionCallout(e.gained, e.newRank);
  playPositionSFX(e.gained);
});

requestAnimationFrame(gameLoop);
